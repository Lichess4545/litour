"""Cockpit service functions.

``build_cockpit`` composes the cockpit DTO from the round-management
substrate (``_build_round_matches``) and adds cockpit-specific fields
(mode, attention per match, deadline, last_event_id, needs_you_count).

Intervention services wrap existing primitives with audit logging +
optimistic concurrency:

- ``force_result_sync``  → wraps ``set_match_result_sync``
- ``mark_forfeit_sync``  → wraps ``set_match_result_sync`` with forfeit codes
- ``reschedule_sync``    → updates ``scheduled_time`` directly

All three write a ``CockpitAuditEntry`` row on success.
"""

from __future__ import annotations

import time
from datetime import datetime
from typing import Any

from django.db import transaction
from django.utils import timezone
from fastapi import HTTPException

from heltour.api.round_management.cockpit.attention import (
    AttentionInput,
    AttentionOutput,
    compute_attention,
)
from heltour.api.round_management.cockpit.mode import CockpitMode, resolve_current_round
from heltour.api.round_management.cockpit.schemas import (
    AttentionDTO,
    CockpitAuditEntryDTO,
    CockpitDTO,
    CockpitKnockoutAdvancementDTO,
    CockpitManagementDTO,
    CockpitMatchDTO,
    CockpitMultiMatchInfoDTO,
    CockpitPrimaryActionDTO,
    CockpitTiedMatchDTO,
    CockpitTokenStatusDTO,
    CockpitTokenValidationDTO,
    CockpitUrlsDTO,
    CockpitViewerDTO,
)
from heltour.api.round_management.permissions import (
    can_change_pairing_sync,
)
from heltour.api.round_management.schemas import MatchDTO
from heltour.api.round_management.service import (
    VALID_RESULTS,
    _build_round_matches,
)
from heltour.api.shared.auth import Viewer

# Forfeit codes per heltour/tournament/models.py:2409 RESULT_OPTIONS
_FORFEIT_CODES: dict[str, str] = {
    "white": "1X-0F",
    "black": "0F-1X",
    "double": "0F-0F",
}


def _epoch_ms(dt: datetime) -> int:
    return int(dt.timestamp() * 1000)


def _scheduled_at_for(pairing) -> datetime | None:
    return pairing.scheduled_time


def _pairing_version(pairing) -> int:
    """Optimistic-concurrency token for a PlayerPairing.

    Uses ``date_modified`` (auto_now on _BaseModel) rendered as epoch ms.
    Two writes within the same millisecond are vanishingly rare for
    organizer interventions; this is the same precision pattern the
    discovery domain uses.
    """
    return _epoch_ms(pairing.date_modified)


def _enrich_match(
    match_dto: MatchDTO,
    pairing,
    now: datetime,
    round_deadline: datetime | None,
) -> CockpitMatchDTO:
    if round_deadline is None:
        attention = AttentionDTO(level="none", reasons=[])
    else:
        out: AttentionOutput = compute_attention(
            AttentionInput(
                has_result=bool(match_dto.result),
                has_game_link=bool(match_dto.game_link),
                scheduled_at=_scheduled_at_for(pairing),
            ),
            now=now,
            round_deadline=round_deadline,
        )
        attention = AttentionDTO(
            level=out.level,  # type: ignore[arg-type]
            reasons=[r.value for r in out.reasons],  # type: ignore[misc]
        )

    return CockpitMatchDTO(
        **match_dto.model_dump(),
        attention=attention,
        scheduled_at=_scheduled_at_for(pairing),
        version=_pairing_version(pairing),
    )


def _last_event_id_for(round_id: int | None) -> int:
    """Monotonic snapshot ↔ WS gap-replay token.

    Phase 1: epoch ms at snapshot time. The publisher must include a
    matching token in every envelope; replay on subscribe is a TODO
    (see TODOS.md "Initial-join race"). Even without replay, carrying
    the token now means the contract is in place when replay ships.
    """
    return int(time.time() * 1000)


def _viewer_dto(can_change: bool, is_authenticated: bool) -> CockpitViewerDTO:
    """All three intervention permissions collapse to ``can_change`` today.

    Splitting them in the schema (per ER3 field tier) lets future
    deployments flip them independently without breaking callers.
    """
    return CockpitViewerDTO(
        is_authenticated=is_authenticated,
        can_edit_pairings=can_change,
        can_view_presence_log=can_change,
        can_force_result=can_change,
        can_mark_forfeit=can_change,
        can_reschedule=can_change,
    )


def _empty_cockpit_dto(season, viewer: Viewer, user, mode: CockpitMode) -> CockpitDTO:
    """Cockpit DTO when no round resolves (mode=pre_round / empty)."""

    league = season.league
    can_change = can_change_pairing_sync(user, league)
    return CockpitDTO(
        round_id=0,
        round_number=0,
        event_tag=season.tag,
        event_name=season.name,
        league_tag=league.tag,
        is_completed=bool(season.is_completed),
        is_team=season.boards is not None,
        settings=__import__(
            "heltour.api.round_management.service", fromlist=["_event_settings"]
        )._event_settings(season),
        rounds=__import__(
            "heltour.api.round_management.service", fromlist=["_event_rounds"]
        )._event_rounds(season),
        matches=[],
        team_matches=[],
        viewer=_viewer_dto(can_change, viewer.is_authenticated),
        presence_events={},
        mode=mode,
        needs_you_count=0,
        last_event_id=_last_event_id_for(None),
        round_deadline=None,
        management=_build_management_sync(season, viewer, user),
    )


def build_cockpit_for_event_sync(event_slug: str, viewer: Viewer, user) -> CockpitDTO:
    """Build the cockpit DTO for an event slug.

    Resolves the current round via the precedence rules in ``mode.py``,
    then either composes the live/history DTO or returns an empty shell
    for pre_round / empty modes.
    """

    from heltour.tournament.models import Season

    try:
        season = Season.objects.select_related("league").get(slug=event_slug)
    except Season.DoesNotExist:
        raise HTTPException(status_code=404, detail="event not found")

    rnd, mode = resolve_current_round(season)
    if rnd is None:
        return _empty_cockpit_dto(season, viewer, user, mode)

    return _build_cockpit_for_round(rnd, viewer, user, mode)


def build_cockpit_for_round_id_sync(
    event_slug: str, round_id: int, viewer: Viewer, user
) -> CockpitDTO:
    """Build a read-only history-mode cockpit DTO for a specific past round."""

    from heltour.tournament.models import Round, Season

    try:
        season = Season.objects.select_related("league").get(slug=event_slug)
    except Season.DoesNotExist:
        raise HTTPException(status_code=404, detail="event not found")

    try:
        rnd = Round.objects.select_related("season__league").get(pk=round_id, season=season)
    except Round.DoesNotExist:
        raise HTTPException(status_code=404, detail="round not found")

    # Past rounds always render in history mode regardless of state.
    return _build_cockpit_for_round(rnd, viewer, user, "history")


def _build_cockpit_for_round(rnd, viewer: Viewer, user, mode: CockpitMode) -> CockpitDTO:
    from heltour.tournament.models import (
        LonePlayerPairing,
        TeamPlayerPairing,
    )

    league = rnd.season.league
    base_dto = _build_round_matches(rnd, viewer, user)
    can_change = can_change_pairing_sync(user, league)
    round_deadline: datetime | None = rnd.end_date
    now = timezone.now()

    is_team = rnd.season.boards is not None
    if is_team:
        pairings = TeamPlayerPairing.objects.filter(team_pairing__round_id=rnd.pk).select_related(
            "white", "black", "team_pairing__round"
        )
    else:
        pairings = LonePlayerPairing.objects.filter(round_id=rnd.pk).select_related(
            "white", "black", "round"
        )

    pairing_by_id = {p.pk: p for p in pairings}

    enriched: list[CockpitMatchDTO] = []
    needs_you_count = 0
    for match in base_dto.matches:
        pairing = pairing_by_id.get(match.id)
        if pairing is None:
            continue
        cm = _enrich_match(match, pairing, now=now, round_deadline=round_deadline)
        enriched.append(cm)
        if cm.attention.level in ("act", "watch"):
            needs_you_count += 1

    return CockpitDTO(
        round_id=base_dto.round_id,
        round_number=base_dto.round_number,
        event_tag=base_dto.event_tag,
        event_name=base_dto.event_name,
        league_tag=base_dto.league_tag,
        is_completed=base_dto.is_completed,
        is_team=base_dto.is_team,
        settings=base_dto.settings,
        rounds=base_dto.rounds,
        matches=enriched,
        team_matches=base_dto.team_matches,
        viewer=_viewer_dto(can_change, viewer.is_authenticated),
        presence_events=base_dto.presence_events,
        mode=mode,
        needs_you_count=needs_you_count,
        last_event_id=_last_event_id_for(rnd.pk),
        round_deadline=round_deadline,
        management=_build_management_sync(rnd.season, viewer, user, current_round=rnd),
    )


# ---------- Intervention services -----------------------------------------------


def _resolve_concrete_pairing(match_id: int):
    """Mirror of set_match_result_sync's resolve step.

    Returns ``(concrete, league)`` for the concrete subclass so signal
    publishers receive the right sender. Raises 404 on miss.
    """
    from heltour.tournament.models import LonePlayerPairing, TeamPlayerPairing

    try:
        concrete = TeamPlayerPairing.objects.select_related(
            "white", "black", "team_pairing__round__season__league"
        ).get(pk=match_id)
        return concrete, concrete.team_pairing.round.season.league
    except TeamPlayerPairing.DoesNotExist:
        pass
    try:
        concrete = LonePlayerPairing.objects.select_related(
            "white", "black", "round__season__league"
        ).get(pk=match_id)
        return concrete, concrete.round.season.league
    except LonePlayerPairing.DoesNotExist:
        raise HTTPException(status_code=404, detail="pairing not found")


def _check_version(pairing, expected_version: int) -> None:
    actual = _pairing_version(pairing)
    if actual != expected_version:
        raise HTTPException(
            status_code=409,
            detail={
                "error": "version_mismatch",
                "expected": expected_version,
                "actual": actual,
            },
        )


def _summarise(pairing) -> dict[str, Any]:
    return {
        "result": pairing.result,
        "game_link": pairing.game_link,
        "scheduled_time": (pairing.scheduled_time.isoformat() if pairing.scheduled_time else None),
        "white_id": pairing.white_id,
        "black_id": pairing.black_id,
    }


def _write_audit(
    intervention_type: str,
    actor,
    pairing,
    before: dict[str, Any],
    after: dict[str, Any],
    reason: str,
) -> None:
    from heltour.tournament.models import CockpitAuditEntry

    CockpitAuditEntry.objects.create(
        intervention_type=intervention_type,
        actor=actor,
        pairing_id=pairing.pk,
        before_json=before,
        after_json=after,
        reason=reason,
    )


def _build_match_dto_from_concrete(concrete, league) -> MatchDTO:
    from heltour.api.round_management.dto_builders import (
        captains_for_team_pairing,
        lone_player_pairing_to_match,
        team_player_pairing_to_match,
    )
    from heltour.tournament.models import TeamPlayerPairing

    if isinstance(concrete, TeamPlayerPairing):
        captains = captains_for_team_pairing(concrete.team_pairing)
        return team_player_pairing_to_match(concrete, league, captains)
    return lone_player_pairing_to_match(concrete, league)


def _enriched_response(concrete, league) -> CockpitMatchDTO:
    """Return the post-write CockpitMatchDTO so the client can replace state."""
    rnd = concrete.team_pairing.round if hasattr(concrete, "team_pairing") else concrete.round
    match_dto = _build_match_dto_from_concrete(concrete, league)
    return _enrich_match(match_dto, concrete, now=timezone.now(), round_deadline=rnd.end_date)


def _authorise_intervention(user, league) -> None:
    if user is None or not getattr(user, "is_authenticated", False):
        raise HTTPException(status_code=401, detail="not authenticated")
    if not can_change_pairing_sync(user, league):
        raise HTTPException(status_code=403, detail="forbidden")


@transaction.atomic
def force_result_sync(
    pairing_id: int,
    result: str,
    expected_version: int,
    reason: str,
    viewer: Viewer,
    user,
) -> CockpitMatchDTO:
    if result not in VALID_RESULTS or result == "":
        raise HTTPException(status_code=422, detail=f"invalid result: {result!r}")
    concrete, league = _resolve_concrete_pairing(pairing_id)
    _authorise_intervention(user, league)
    _check_version(concrete, expected_version)
    before = _summarise(concrete)
    concrete.result = result
    concrete.save()
    after = _summarise(concrete)
    _write_audit("force_result", user, concrete, before, after, reason)
    return _enriched_response(concrete, league)


@transaction.atomic
def mark_forfeit_sync(
    pairing_id: int,
    forfeit_side: str,
    expected_version: int,
    reason: str,
    viewer: Viewer,
    user,
) -> CockpitMatchDTO:
    if forfeit_side not in _FORFEIT_CODES:
        raise HTTPException(status_code=422, detail=f"invalid forfeit_side: {forfeit_side!r}")
    concrete, league = _resolve_concrete_pairing(pairing_id)
    _authorise_intervention(user, league)
    _check_version(concrete, expected_version)
    before = _summarise(concrete)
    concrete.result = _FORFEIT_CODES[forfeit_side]
    concrete.save()
    after = _summarise(concrete)
    _write_audit("mark_forfeit", user, concrete, before, after, reason)
    return _enriched_response(concrete, league)


@transaction.atomic
def reschedule_sync(
    pairing_id: int,
    new_scheduled_at: datetime,
    expected_version: int,
    reason: str,
    viewer: Viewer,
    user,
) -> CockpitMatchDTO:
    concrete, league = _resolve_concrete_pairing(pairing_id)
    _authorise_intervention(user, league)
    _check_version(concrete, expected_version)
    before = _summarise(concrete)
    concrete.scheduled_time = new_scheduled_at
    concrete.save()
    after = _summarise(concrete)
    _write_audit("reschedule", user, concrete, before, after, reason)
    return _enriched_response(concrete, league)


# ---------- Audit query --------------------------------------------------------


def audit_for_pairing_sync(pairing_id: int, viewer: Viewer, user) -> list[CockpitAuditEntryDTO]:
    """L3 drawer audit-trail data."""
    concrete, league = _resolve_concrete_pairing(pairing_id)
    if not can_change_pairing_sync(user, league):
        raise HTTPException(status_code=403, detail="forbidden")

    from heltour.tournament.models import CockpitAuditEntry

    rows = (
        CockpitAuditEntry.objects.filter(pairing_id=pairing_id)
        .select_related("actor")
        .order_by("-date_created")
    )
    return [
        CockpitAuditEntryDTO(
            id=r.pk,
            intervention_type=r.intervention_type,  # type: ignore[arg-type]
            actor_username=r.actor.username,
            pairing_id=r.pairing_id,
            before_summary=_format_summary(r.before_json),
            after_summary=_format_summary(r.after_json),
            reason=r.reason,
            created_at=r.date_created,
        )
        for r in rows
    ]


def _format_summary(payload: dict[str, Any]) -> str:
    parts: list[str] = []
    if payload.get("result"):
        parts.append(f"result={payload['result']}")
    if payload.get("scheduled_time"):
        parts.append(f"scheduled_time={payload['scheduled_time']}")
    if payload.get("game_link"):
        parts.append("game_linked")
    return ", ".join(parts) if parts else "—"


# ---------- Management bundle (Phase 1: links out to Django) -------------------
#
# Mirrors the data computed by
# `heltour/tournament/views.py::LeagueDashboardView._common_context` so the
# cockpit can render the full Django dashboard surface area without porting
# any business logic. POST-only actions (clear cache / validate tokens /
# advance / etc.) are exposed as anchor links into the league dashboard URL;
# the user completes those there. Phase 2 promotes the highest-traffic
# actions to FastAPI POST routes.


def _safe_reverse(name: str, *args, **kwargs) -> str:
    """`reverse` that returns "" on NoReverseMatch.

    URL patterns vary by deployment (custom league/season prefixes,
    optional admin paths) — we don't want a missing URL pattern to 500
    the cockpit GET. The client treats "" as "URL unavailable" and
    hides the corresponding control.
    """
    from django.urls import NoReverseMatch, reverse

    try:
        return reverse(name, args=args, kwargs=kwargs)
    except NoReverseMatch:
        return ""


def _league_url(name: str, league_tag: str, season_tag: str | None = None) -> str:
    """Mirror of the `leagueurl` template tag used across dashboards."""
    if season_tag:
        return _safe_reverse(f"by_season:{name}", league_tag, season_tag)
    return _safe_reverse(f"by_league:{name}", league_tag)


def _with_query(base: str, query: str) -> str:
    """Append a query string to a URL, returning "" if base is empty."""
    if not base:
        return ""
    return f"{base}?{query}"


def _build_urls(season, league) -> CockpitUrlsDTO:
    is_team = league.competitor_type == "team"
    show_fide = bool(league.show_fide_names)
    return CockpitUrlsDTO(
        league_dashboard=_league_url("league_dashboard", league.tag, season.tag),
        season_admin=_safe_reverse("admin:tournament_season_change", season.pk),
        season_create=_safe_reverse("admin:tournament_season_add"),
        registrations=_with_query(
            _safe_reverse("admin:tournament_registration_changelist"),
            f"season__id__exact={season.pk}&status__exact=pending",
        ),
        mod_requests=_with_query(
            _safe_reverse("admin:tournament_modrequest_changelist"),
            f"season__id__exact={season.pk}&status__exact=pending",
        ),
        manage_players=_safe_reverse("admin:manage_players", season.pk),
        alternates=_league_url("alternates", league.tag, season.tag) if is_team else None,
        team_composition=(
            _league_url("team_composition", league.tag, season.tag) if is_team else None
        ),
        team_spam=_safe_reverse("admin:team_spam", season.pk) if is_team else None,
        game_ids=_league_url("game_ids", league.tag, season.tag),
        broadcast_players=(
            _league_url("broadcast_players", league.tag, season.tag) if show_fide else None
        ),
        export_trf16=_league_url("export_trf16", league.tag, season.tag),
        knockout_bracket=(
            _league_url("knockout_bracket", league.tag, season.tag)
            if league.pairing_type.startswith("knockout")
            else None
        ),
        review_nominations=_safe_reverse("admin:review_nominated_games", season.pk),
        pre_round_report=_safe_reverse("admin:pre_round_report", season.pk),
        round_transition=_safe_reverse("admin:round_transition", season.pk),
        generate_pairings=None,  # filled per-round below
        tournament_admin=_safe_reverse("admin:app_list", "tournament"),
        user_admin=_safe_reverse("admin:app_list", "auth"),
    )


def _can_view_dashboard_sync(user, league) -> bool:
    if user is None or not getattr(user, "is_authenticated", False):
        return False
    return bool(user.has_perm("tournament.view_dashboard", league))


def _can_generate_pairings_sync(user, league) -> bool:
    if user is None or not getattr(user, "is_authenticated", False):
        return False
    return bool(user.has_perm("tournament.generate_pairings", league))


def _can_change_season_sync(user, _league) -> bool:
    if user is None or not getattr(user, "is_authenticated", False):
        return False
    return bool(user.has_perm("tournament.change_season"))


def _can_admin_users_sync(user) -> bool:
    if user is None or not getattr(user, "is_authenticated", False):
        return False
    return bool(user.has_module_perms("auth"))


def _token_status_dto() -> CockpitTokenStatusDTO | None:
    """Snapshot the cached Lichess system API token status.

    `lichessapi.check_system_api_token` returns a dict; we only surface
    the fields the cockpit footer renders. Returns None when the cache
    has no entry yet so the UI can render a neutral state.
    """
    from heltour.tournament import lichessapi

    try:
        raw = lichessapi.check_system_api_token()
    except Exception:
        return None
    if not raw:
        return None
    return CockpitTokenStatusDTO(
        valid=bool(raw.get("valid")),
        user_id=raw.get("user_id"),
        expires_at=raw.get("expires_at"),
        scopes=list(raw.get("scopes") or []),
        error=raw.get("error"),
        checked_at=raw.get("checked_at"),
    )


def _token_validation_dto(season_pk: int) -> CockpitTokenValidationDTO | None:
    from django.core.cache import cache

    raw = cache.get(f"token_validation_{season_pk}")
    if not raw:
        return None
    refreshed = list(raw.get("refreshed") or [])
    failed = list(raw.get("failed") or [])
    return CockpitTokenValidationDTO(
        timestamp=str(raw.get("timestamp", "")),
        success=bool(raw.get("success", True)),
        total=int(raw.get("total") or 0),
        refreshed_count=len(refreshed),
        failed_count=len(failed),
    )


def _alternate_search_count(season) -> int | None:
    from heltour.tournament import alternates_manager

    try:
        rnd = alternates_manager.current_round(season)
        if rnd is None:
            return None
        return len(alternates_manager.current_searches(rnd))
    except Exception:
        return None


def _knockout_advancement_dto(season) -> CockpitKnockoutAdvancementDTO | None:
    """Distilled mirror of `LeagueDashboardView._get_knockout_advancement_info`.

    Only computes what the cockpit needs to drive the primary CTA + the
    "Cannot advance" warning. Heavy lifting (multi-match completion
    info, tied-pair detection) stays in the Django view; we re-derive a
    coarser version here from the bracket + round data.
    """
    from heltour.tournament.models import (
        KnockoutBracket,
        Round,
        TeamPairing,
    )

    if not season.league.pairing_type.startswith("knockout"):
        return None
    if season.is_completed:
        return CockpitKnockoutAdvancementDTO(
            can_advance=False,
            is_final_round=False,
            can_generate_next_match_set=False,
            reason="Tournament already completed",
        )
    try:
        bracket = KnockoutBracket.objects.get(season=season)
    except KnockoutBracket.DoesNotExist:
        return CockpitKnockoutAdvancementDTO(
            can_advance=False,
            is_final_round=False,
            can_generate_next_match_set=False,
            reason="No knockout bracket found",
        )

    is_multi = bracket.matches_per_stage > 1

    last_completed = (
        Round.objects.filter(season=season, is_completed=True).order_by("-number").first()
    )
    if is_multi:
        with_pairings = (
            Round.objects.filter(season=season, teampairing__isnull=False)
            .distinct()
            .order_by("-number")
            .first()
        )
        current = with_pairings or Round.objects.filter(season=season).order_by("number").first()
    else:
        current = last_completed

    if current is None:
        return CockpitKnockoutAdvancementDTO(
            can_advance=False,
            is_final_round=False,
            can_generate_next_match_set=False,
            reason="No rounds found",
        )

    multi_match: CockpitMultiMatchInfoDTO | None = None
    can_generate_next = False
    if is_multi:
        actual = TeamPairing.objects.filter(round=current).count()
        # Quick "fresh tournament" path
        if actual == 0:
            multi_match = CockpitMultiMatchInfoDTO(
                is_complete=False,
                matches_per_stage=bracket.matches_per_stage,
                expected_team_pairs=0,
                completed_team_pairs=0,
                total_matches_expected=0,
                total_matches_actual=0,
                total_matches_completed=0,
                status_message=f"Ready to create match 1 of {bracket.matches_per_stage}",
                reason="No matches created yet",
            )
            can_generate_next = True

    round_to_advance = last_completed or current
    is_final = bool(season.rounds and round_to_advance and round_to_advance.number >= season.rounds)
    # Tied pair detection is intentionally simple here — admins still see
    # the rich tied-list on the legacy dashboard which the cockpit links
    # to. We just expose the count so the CTA can be disabled.
    tied: list[CockpitTiedMatchDTO] = []
    can_advance = not multi_match or multi_match.is_complete
    can_advance = can_advance and len(tied) == 0 and last_completed is not None

    return CockpitKnockoutAdvancementDTO(
        can_advance=can_advance,
        is_final_round=is_final,
        can_generate_next_match_set=can_generate_next,
        round_to_advance_number=round_to_advance.number if round_to_advance else None,
        multi_match=multi_match,
        tied_matches=tied,
    )


def _primary_action(
    season,
    league,
    urls: CockpitUrlsDTO,
    can_generate: bool,
    knockout: CockpitKnockoutAdvancementDTO | None,
) -> CockpitPrimaryActionDTO | None:
    """Pick the single state-aware CTA that drives the round forward.

    Mirrors the conditional ladder at the bottom of the Django dashboard
    template. Returns None when no action is available (e.g. read-only
    viewer, completed season with nothing to review).
    """
    from heltour.tournament.models import Round, TeamPairing, LonePlayerPairing

    if not can_generate:
        return None

    if league.pairing_type.startswith("knockout"):
        if knockout is None:
            return None
        if knockout.can_generate_next_match_set:
            label = "Create Missing Matches"
            if knockout.multi_match and knockout.multi_match.total_matches_actual > 0:
                label = "Generate Next Match Set"
            return CockpitPrimaryActionDTO(
                kind=(
                    "create_missing_matches"
                    if knockout.multi_match and knockout.multi_match.total_matches_actual == 0
                    else "generate_next_match_set"
                ),
                label=label,
                href=urls.league_dashboard,
                confirm="Create / generate the next match set for this stage?",
            )
        if knockout.can_advance:
            if knockout.is_final_round:
                return CockpitPrimaryActionDTO(
                    kind="finalize_tournament",
                    label="Finalize Tournament Standings",
                    href=urls.league_dashboard,
                    confirm="Finalize the tournament standings? This completes the season.",
                )
            return CockpitPrimaryActionDTO(
                kind="advance_tournament",
                label="Advance to Next Round",
                href=urls.league_dashboard,
                confirm="Advance the tournament to the next round?",
            )
        return None

    next_round = (
        Round.objects.filter(season=season, publish_pairings=False, is_completed=False)
        .order_by("number")
        .first()
    )
    last_round = (
        Round.objects.filter(season=season, publish_pairings=True, is_completed=False)
        .order_by("number")
        .first()
    )

    if next_round is not None:
        # Are pairings already generated for this round?
        if season.boards is not None:
            has_pairings = TeamPairing.objects.filter(round=next_round).exists()
        else:
            has_pairings = LonePlayerPairing.objects.filter(round=next_round).exists()

        if not has_pairings:
            return CockpitPrimaryActionDTO(
                kind="generate_pairings",
                label=f"Generate Pairings · Round {next_round.number}",
                href=_safe_reverse("admin:generate_pairings", next_round.pk),
            )
        return CockpitPrimaryActionDTO(
            kind="start_round",
            label=f"Start Round {next_round.number}",
            href=urls.round_transition or urls.league_dashboard,
            secondary_kind="pre_round_report",
            secondary_label="Pre-Round Report",
            secondary_href=urls.pre_round_report or urls.league_dashboard,
        )
    if last_round is not None:
        return CockpitPrimaryActionDTO(
            kind="close_round",
            label=f"Close Round {last_round.number}",
            href=urls.round_transition or urls.league_dashboard,
        )
    if not season.is_completed:
        return CockpitPrimaryActionDTO(
            kind="close_season",
            label="Close Season",
            href=urls.round_transition or urls.league_dashboard,
        )
    return CockpitPrimaryActionDTO(
        kind="review_nominations",
        label="Review Nominations",
        href=urls.review_nominations or urls.league_dashboard,
    )


def _build_management_sync(
    season,
    viewer: Viewer,
    user,
    current_round=None,
) -> CockpitManagementDTO | None:
    """Compose the management bundle.

    Returns None for non-organizer viewers — the cockpit still works
    (read-only history mode etc.), but the toolbar simply doesn't render.
    """
    league = season.league
    if not _can_view_dashboard_sync(user, league):
        return None

    from heltour.tournament import uptime
    from heltour.tournament.models import (
        ModRequest,
        Registration,
        SeasonPlayer,
        TeamMember,
        Alternate,
    )

    is_team = league.competitor_type == "team"
    is_knockout = league.pairing_type.startswith("knockout")

    # Use reg_season fallback so registration count points to the active
    # sub-section when the parent season's registration is closed —
    # mirrors `_common_context`.
    reg_season = season
    if not season.registration_open:
        for s in season.section_list():
            if s.is_active and s.registration_open:
                reg_season = s
                break
    pending_reg_count = Registration.objects.filter(season=reg_season, status="pending").count()
    pending_modreq_count = ModRequest.objects.filter(season=season, status="pending").count()

    if is_team:
        team_members = TeamMember.objects.filter(team__season=season).select_related("player")
        alternates = Alternate.objects.filter(season_player__season=season).select_related(
            "season_player__player"
        )
        season_players = set(
            sp.player
            for sp in SeasonPlayer.objects.filter(season=season, is_active=True).select_related(
                "player"
            )
        )
        team_players = {tm.player for tm in team_members}
        alt_players = {alt.season_player.player for alt in alternates}
        unassigned = len(season_players - team_players - alt_players)
    else:
        unassigned = 0

    urls = _build_urls(season, league)
    if current_round is not None:
        urls = urls.model_copy(
            update={"generate_pairings": _safe_reverse("admin:generate_pairings", current_round.pk)}
        )

    knockout = _knockout_advancement_dto(season) if is_knockout else None
    can_generate = _can_generate_pairings_sync(user, league)
    primary = _primary_action(season, league, urls, can_generate, knockout)

    return CockpitManagementDTO(
        can_view_dashboard=True,
        can_admin_users=_can_admin_users_sync(user),
        can_generate_pairings=can_generate,
        can_change_season=_can_change_season_sync(user, league),
        is_team_league=is_team,
        is_knockout_tournament=is_knockout,
        require_fide_id=bool(league.require_fide_id),
        show_fide_names=bool(league.show_fide_names),
        registration_open=bool(season.registration_open),
        season_completed=bool(season.is_completed),
        pending_reg_count=pending_reg_count,
        pending_modreq_count=pending_modreq_count,
        unassigned_player_count=unassigned,
        alternate_search_count=_alternate_search_count(season) if is_team else None,
        celery_down=bool(uptime.celery.is_down),
        lichess_token=_token_status_dto(),
        token_validation=_token_validation_dto(season.pk),
        primary_action=primary,
        knockout=knockout,
        urls=urls,
    )
