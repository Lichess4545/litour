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
    CockpitMatchDTO,
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
