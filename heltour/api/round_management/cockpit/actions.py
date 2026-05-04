"""Cockpit one-shot action services.

Each function wraps an existing Django primitive (workflow, signal, or
celery task) and returns a uniform ``CockpitActionResultDTO`` so the
client can render a toast and decide whether to refresh the cockpit
snapshot. Actions never raise except for permission / 404 errors —
business-logic failures (e.g. pairings already exist) come back as
``status="warning"`` or ``status="error"`` results.
"""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException

from heltour.api.round_management.cockpit.schemas import CockpitActionResultDTO
from heltour.api.shared.auth import Viewer


def _get_season(event_slug: str):
    from heltour.api.shared.models import Season

    try:
        return Season.objects.select_related("league").get(slug=event_slug)
    except Season.DoesNotExist as exc:
        raise HTTPException(status_code=404, detail="event not found") from exc


def _require_perm(user, league, perm: str) -> None:
    if user is None or not getattr(user, "is_authenticated", False):
        raise HTTPException(status_code=401, detail="not authenticated")
    if not user.has_perm(perm, league):
        raise HTTPException(status_code=403, detail=f"missing permission: {perm}")


def _require_dashboard(user, league) -> None:
    _require_perm(user, league, "tournament.view_dashboard")


def _require_change_season(user) -> None:
    if user is None or not getattr(user, "is_authenticated", False):
        raise HTTPException(status_code=401, detail="not authenticated")
    if not user.has_perm("tournament.change_season"):
        raise HTTPException(status_code=403, detail="missing permission: tournament.change_season")


def _ok(title: str, detail: str = "", refresh: bool = True) -> CockpitActionResultDTO:
    return CockpitActionResultDTO(status="ok", title=title, detail=detail, refresh=refresh)


def _warn(title: str, detail: str = "", refresh: bool = True) -> CockpitActionResultDTO:
    return CockpitActionResultDTO(status="warning", title=title, detail=detail, refresh=refresh)


def _err(title: str, detail: str = "", refresh: bool = False) -> CockpitActionResultDTO:
    return CockpitActionResultDTO(status="error", title=title, detail=detail, refresh=refresh)


# ---------- Cache + token health -----------------------------------------------


def clear_caches_sync(event_slug: str, _viewer: Viewer, user) -> CockpitActionResultDTO:
    season = _get_season(event_slug)
    _require_dashboard(user, season.league)
    from django.core.cache import cache

    try:
        cache.clear()
        try:
            from cacheops import invalidate_all  # type: ignore

            invalidate_all()
            return _ok("Caches cleared", "Django + cacheops invalidated.")
        except ImportError:
            return _ok("Caches cleared", "Django cache invalidated.")
    except Exception as exc:  # pragma: no cover — defensive
        return _err("Cache clear failed", str(exc))


def validate_tokens_sync(event_slug: str, _viewer: Viewer, user) -> CockpitActionResultDTO:
    season = _get_season(event_slug)
    _require_dashboard(user, season.league)
    from heltour.tournament import signals

    signals.do_validate_season_tokens.send(sender=None, season_id=season.pk)
    return _ok(
        "Token validation started",
        "Running in the background. Refresh in a moment to see results.",
    )


def update_fide_ratings_sync(event_slug: str, _viewer: Viewer, user) -> CockpitActionResultDTO:
    season = _get_season(event_slug)
    _require_dashboard(user, season.league)
    if not season.league.require_fide_id:
        return _err("FIDE not enabled", "This league doesn't require FIDE IDs.")
    from heltour.tournament.tasks import update_fide_ratings

    update_fide_ratings.delay()
    return _ok("FIDE rating update queued", "Running in the background.")


def backfill_fide_data_sync(event_slug: str, _viewer: Viewer, user) -> CockpitActionResultDTO:
    season = _get_season(event_slug)
    _require_dashboard(user, season.league)
    if not season.league.require_fide_id:
        return _err("FIDE not enabled", "This league doesn't require FIDE IDs.")
    from heltour.tournament.tasks import backfill_fide_data_for_season

    backfill_fide_data_for_season.delay(season.pk)
    return _ok("FIDE backfill queued", "Copying FIDE IDs / gender; running in the background.")


# ---------- Round transitions ---------------------------------------------------


def _round_or_404(season, round_id: int | None, *, must_be_unpublished: bool = False):
    """Resolve the target round.

    When ``round_id`` is None we pick the natural next/last candidate
    based on ``must_be_unpublished``: True → next round to open
    (publish_pairings=False), False → next round to close
    (publish_pairings=True, is_completed=False).
    """
    from heltour.api.shared.models import Round

    if round_id is not None:
        try:
            return Round.objects.select_related("season__league").get(pk=round_id, season=season)
        except Round.DoesNotExist as exc:
            raise HTTPException(status_code=404, detail="round not found") from exc

    if must_be_unpublished:
        rnd = (
            Round.objects.filter(season=season, publish_pairings=False, is_completed=False)
            .order_by("number")
            .first()
        )
    else:
        rnd = (
            Round.objects.filter(season=season, publish_pairings=True, is_completed=False)
            .order_by("number")
            .first()
        )
    if rnd is None:
        raise HTTPException(status_code=409, detail="no candidate round")
    return rnd


def generate_pairings_sync(
    event_slug: str,
    round_id: int | None,
    overwrite: bool,
    auto_assign_forfeits: bool,
    publish_immediately: bool,
    _viewer: Viewer,
    user,
) -> CockpitActionResultDTO:
    season = _get_season(event_slug)
    _require_perm(user, season.league, "tournament.generate_pairings")
    from heltour.tournament import pairinggen
    import reversion

    rnd = _round_or_404(season, round_id, must_be_unpublished=True)
    try:
        pairinggen.generate_pairings(rnd, overwrite=overwrite)
    except pairinggen.PairingsExistException:
        return _warn(
            "Pairings already exist",
            "Use Overwrite to regenerate them, or open Review pairings.",
        )
    except pairinggen.PairingHasResultException:
        return _err(
            "Cannot regenerate",
            "Some pairings already have results recorded.",
        )
    except pairinggen.PairingGenerationException as exc:
        return _err("Pairing generation failed", str(exc))

    forfeit_count = 0
    if auto_assign_forfeits:
        try:
            forfeit_count = pairinggen.assign_automatic_forfeits(rnd)
        except Exception as exc:  # pragma: no cover
            return _warn("Pairings generated, forfeits failed", str(exc))

    with reversion.create_revision():
        reversion.set_user(user)
        comment = "Generated pairings via cockpit."
        if forfeit_count:
            comment += f" Auto-forfeits: {forfeit_count}."
        if publish_immediately:
            comment += " Published immediately."
        reversion.set_comment(comment)
        rnd.publish_pairings = bool(publish_immediately)
        rnd.save()

    parts: list[str] = [f"Round {rnd.number} pairings generated."]
    if forfeit_count:
        parts.append(f"{forfeit_count} auto-forfeits assigned.")
    if publish_immediately:
        parts.append("Published immediately.")
    return _ok("Pairings ready", " ".join(parts))


def start_round_sync(
    event_slug: str,
    round_id: int | None,
    update_board_order: bool,
    _viewer: Viewer,
    user,
) -> CockpitActionResultDTO:
    """Open the next round — sets `publish_pairings=True`.

    Mirrors the publish step inside `RoundTransitionWorkflow.run` minus
    the close-prior-round / generate-pairings side effects (those live
    in their own cockpit actions). Pairings must already be generated.
    """
    season = _get_season(event_slug)
    _require_perm(user, season.league, "tournament.generate_pairings")
    from heltour.api.shared.models import LonePlayerPairing, TeamPairing
    from heltour.tournament.workflows import UpdateBoardOrderWorkflow
    from django.db import transaction
    import reversion

    rnd = _round_or_404(season, round_id, must_be_unpublished=True)
    if season.boards is not None:
        has_pairings = TeamPairing.objects.filter(round=rnd).exists()
    else:
        has_pairings = LonePlayerPairing.objects.filter(round=rnd).exists()
    if not has_pairings:
        return _err(
            "No pairings yet",
            f"Round {rnd.number} has no pairings — generate them first.",
        )

    with transaction.atomic():
        if update_board_order and season.league.competitor_type == "team":
            try:
                UpdateBoardOrderWorkflow(season).run(alternates_only=False)
            except IndexError:
                return _err("Board order update failed", "")
        with reversion.create_revision():
            reversion.set_user(user)
            reversion.set_comment(f"Started round {rnd.number} via cockpit.")
            rnd.publish_pairings = True
            rnd.save()
    return _ok("Round started", f"Round {rnd.number} is now live.")


def close_round_sync(
    event_slug: str, round_id: int | None, _viewer: Viewer, user
) -> CockpitActionResultDTO:
    season = _get_season(event_slug)
    _require_perm(user, season.league, "tournament.generate_pairings")
    import reversion
    from django.db import transaction

    rnd = _round_or_404(season, round_id, must_be_unpublished=False)
    with transaction.atomic():
        with reversion.create_revision():
            reversion.set_user(user)
            reversion.set_comment(f"Closed round {rnd.number} via cockpit.")
            rnd.is_completed = True
            rnd.save()
    return _ok("Round closed", f"Round {rnd.number} is complete.")


def close_season_sync(event_slug: str, _viewer: Viewer, user) -> CockpitActionResultDTO:
    season = _get_season(event_slug)
    _require_perm(user, season.league, "tournament.generate_pairings")
    if season.is_completed:
        return _warn("Already closed", f"{season.name} is already marked complete.")
    import reversion
    from django.db import transaction

    with transaction.atomic():
        with reversion.create_revision():
            reversion.set_user(user)
            reversion.set_comment("Closed season via cockpit.")
            season.is_completed = True
            season.save()
    return _ok("Season closed", f"{season.name} is now complete.")


# ---------- Knockout advancement -----------------------------------------------


def _last_completed_round(season):
    from heltour.api.shared.models import Round

    return Round.objects.filter(season=season, is_completed=True).order_by("-number").first()


def advance_tournament_sync(event_slug: str, _viewer: Viewer, user) -> CockpitActionResultDTO:
    season = _get_season(event_slug)
    _require_perm(user, season.league, "tournament.generate_pairings")
    if not season.league.pairing_type.startswith("knockout"):
        return _err("Not a knockout", "This action only applies to knockout tournaments.")
    rnd = _last_completed_round(season)
    if rnd is None:
        return _err("No completed round", "Close a round before advancing.")
    if season.rounds and rnd.number >= season.rounds:
        return _err(
            "Final round reached",
            "Use Finalize Tournament to complete the season.",
        )
    from heltour.tournament.pairinggen import (
        PairingGenerationException,
        advance_knockout_tournament,
    )

    try:
        next_round = advance_knockout_tournament(rnd)
    except PairingGenerationException as exc:
        return _err("Cannot advance", str(exc))
    if next_round is None:
        return _ok("Tournament complete", "All rounds finished.")
    return _ok("Tournament advanced", f"Round {next_round.number} created.")


def finalize_tournament_sync(event_slug: str, _viewer: Viewer, user) -> CockpitActionResultDTO:
    """Close the season and let the existing post-completion logic run."""
    return close_season_sync(event_slug, _viewer, user)


# ---------- Multi-match knockout helpers ---------------------------------------


def _create_multi_match_set(season, current_round) -> tuple[int, str]:
    """Create or extend a multi-match set for the current round.

    Returns ``(created_count, message)``. Mirrors the
    create-missing-matches branch from `LeagueDashboardView`. Counts the
    expected number of matches per team-pair and creates the next match
    in the sequence.
    """
    from heltour.api.shared.models import KnockoutBracket, TeamPairing

    bracket = KnockoutBracket.objects.get(season=season)
    matches_per_stage = bracket.matches_per_stage
    if matches_per_stage <= 1:
        return 0, "Not a multi-match tournament."

    existing = list(TeamPairing.objects.filter(round=current_round).order_by("pairing_order"))
    # Count by unordered (white, black) pair so colour swaps in the
    # sequence still group together.
    by_pair: dict[tuple[int, int | None], list[TeamPairing]] = {}
    for tp in existing:
        key = tuple(sorted([tp.white_team_id, tp.black_team_id or 0]))
        by_pair.setdefault(key, []).append(tp)

    if not by_pair:
        return 0, "No team pairings yet for this round — generate the first set first."

    created = 0
    for _key, group in by_pair.items():
        if len(group) >= matches_per_stage:
            continue
        seed = group[0]
        match_index = len(group)  # 0-based position of the new match
        # Alternate colours each match: even indices keep original colour,
        # odd indices swap. Mirrors the colour-alternation pattern used by
        # multi-match knockouts in the legacy admin.
        if match_index % 2 == 0:
            white_team = seed.white_team
            black_team = seed.black_team
        else:
            white_team = seed.black_team
            black_team = seed.white_team
        TeamPairing.objects.create(
            round=current_round,
            white_team=white_team,
            black_team=black_team,
            pairing_order=seed.pairing_order * matches_per_stage + match_index,
        )
        created += 1
    return created, f"Created {created} match{'es' if created != 1 else ''}."


def generate_next_match_set_sync(event_slug: str, _viewer: Viewer, user) -> CockpitActionResultDTO:
    season = _get_season(event_slug)
    _require_perm(user, season.league, "tournament.generate_pairings")
    if not season.league.pairing_type.startswith("knockout"):
        return _err("Not a knockout", "This action only applies to knockout tournaments.")
    from heltour.api.shared.models import Round

    current = (
        Round.objects.filter(season=season, teampairing__isnull=False)
        .distinct()
        .order_by("-number")
        .first()
    )
    if current is None:
        current = Round.objects.filter(season=season).order_by("number").first()
    if current is None:
        return _err("No round", "No rounds exist for this season.")
    try:
        created, message = _create_multi_match_set(season, current)
    except Exception as exc:
        return _err("Could not create match set", str(exc))
    if created == 0:
        return _warn("Nothing to do", message)
    return _ok("Next match set ready", message)


def create_missing_matches_sync(event_slug: str, _viewer: Viewer, user) -> CockpitActionResultDTO:
    """Alias for generate_next_match_set when no matches exist yet.

    The Django dashboard exposes the same endpoint under two labels
    depending on whether matches already exist; the underlying
    operation is the same.
    """
    return generate_next_match_set_sync(event_slug, _viewer, user)


# ---------- Aggregator for unknown / future actions ----------------------------


def dispatch_action(name: str, _payload: dict[str, Any]) -> CockpitActionResultDTO:
    """Reserved for future extension."""
    return _err("Unknown action", name)
