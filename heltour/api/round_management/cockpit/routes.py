"""HTTP routes for the cockpit.

Thin wrappers: each route validates the path, resolves the viewer, and
hands off to a sync service via ``in_thread``. The DTO shape is identical
between the GET snapshot and the WS push so the UI replaces state with
the payload.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query

from heltour.api.deps import in_thread
from heltour.api.round_management.cockpit.actions import (
    advance_tournament_sync,
    backfill_fide_data_sync,
    clear_caches_sync,
    close_round_sync,
    close_season_sync,
    create_missing_matches_sync,
    finalize_tournament_sync,
    generate_next_match_set_sync,
    generate_pairings_sync,
    start_round_sync,
    update_fide_ratings_sync,
    validate_tokens_sync,
)
from heltour.api.round_management.cockpit.schemas import (
    CloseRoundRequest,
    CloseSeasonRequest,
    CockpitActionResultDTO,
    CockpitAuditEntryDTO,
    CockpitDTO,
    CockpitMatchDTO,
    ForceResultRequest,
    GeneratePairingsRequest,
    MarkForfeitRequest,
    RescheduleRequest,
    StartRoundRequest,
)
from heltour.api.round_management.cockpit.service import (
    audit_for_pairing_sync,
    build_cockpit_for_event_sync,
    build_cockpit_for_round_id_sync,
    force_result_sync,
    mark_forfeit_sync,
    reschedule_sync,
)
from heltour.api.shared.auth import Viewer, get_viewer_and_user
from heltour.api.shared.paths import SlugPath

router = APIRouter()

_RESPONSES: dict[int | str, dict[str, Any]] = {
    401: {"description": "Not authenticated"},
    403: {"description": "Forbidden — viewer lacks change_pairing perm"},
    404: {"description": "Not found"},
    409: {"description": "Optimistic-concurrency conflict"},
    422: {"description": "Validation error"},
}


@router.get(
    "/round_management/events/{event_slug}/cockpit",
    response_model=CockpitDTO,
    responses=_RESPONSES,
)
async def get_cockpit(
    event_slug: SlugPath,
    round_id: int | None = Query(default=None),
    viewer_and_user: tuple[Viewer, object | None] = Depends(get_viewer_and_user),
) -> CockpitDTO:
    viewer, user = viewer_and_user
    if round_id is not None:
        return await in_thread(build_cockpit_for_round_id_sync, event_slug, round_id, viewer, user)
    return await in_thread(build_cockpit_for_event_sync, event_slug, viewer, user)


@router.get(
    "/round_management/cockpit/{pairing_id}/audit",
    response_model=list[CockpitAuditEntryDTO],
    responses=_RESPONSES,
)
async def get_cockpit_audit(
    pairing_id: int,
    viewer_and_user: tuple[Viewer, object | None] = Depends(get_viewer_and_user),
) -> list[CockpitAuditEntryDTO]:
    viewer, user = viewer_and_user
    return await in_thread(audit_for_pairing_sync, pairing_id, viewer, user)


@router.post(
    "/round_management/cockpit/{pairing_id}/force-result",
    response_model=CockpitMatchDTO,
    responses=_RESPONSES,
)
async def post_force_result(
    pairing_id: int,
    body: ForceResultRequest,
    viewer_and_user: tuple[Viewer, object | None] = Depends(get_viewer_and_user),
) -> CockpitMatchDTO:
    viewer, user = viewer_and_user
    return await in_thread(
        force_result_sync,
        pairing_id,
        body.result,
        body.expected_version,
        body.reason,
        viewer,
        user,
    )


@router.post(
    "/round_management/cockpit/{pairing_id}/mark-forfeit",
    response_model=CockpitMatchDTO,
    responses=_RESPONSES,
)
async def post_mark_forfeit(
    pairing_id: int,
    body: MarkForfeitRequest,
    viewer_and_user: tuple[Viewer, object | None] = Depends(get_viewer_and_user),
) -> CockpitMatchDTO:
    viewer, user = viewer_and_user
    return await in_thread(
        mark_forfeit_sync,
        pairing_id,
        body.forfeit_side,
        body.expected_version,
        body.reason,
        viewer,
        user,
    )


@router.post(
    "/round_management/cockpit/{pairing_id}/reschedule",
    response_model=CockpitMatchDTO,
    responses=_RESPONSES,
)
async def post_reschedule(
    pairing_id: int,
    body: RescheduleRequest,
    viewer_and_user: tuple[Viewer, object | None] = Depends(get_viewer_and_user),
) -> CockpitMatchDTO:
    viewer, user = viewer_and_user
    return await in_thread(
        reschedule_sync,
        pairing_id,
        body.new_scheduled_at,
        body.expected_version,
        body.reason,
        viewer,
        user,
    )


# ---------- One-shot tournament management actions -----------------------------
#
# Each action takes the event slug, performs a single side-effect (signal
# dispatch, workflow run, or direct DB update), and returns a unified
# ``CockpitActionResultDTO`` envelope. The frontend toasts the result and
# refreshes the cockpit snapshot when ``refresh=True``.


_ACTION_BASE = "/round_management/cockpit/events/{event_slug}/actions"


@router.post(
    f"{_ACTION_BASE}/clear-caches",
    response_model=CockpitActionResultDTO,
    responses=_RESPONSES,
)
async def post_clear_caches(
    event_slug: SlugPath,
    viewer_and_user: tuple[Viewer, object | None] = Depends(get_viewer_and_user),
) -> CockpitActionResultDTO:
    viewer, user = viewer_and_user
    return await in_thread(clear_caches_sync, event_slug, viewer, user)


@router.post(
    f"{_ACTION_BASE}/validate-tokens",
    response_model=CockpitActionResultDTO,
    responses=_RESPONSES,
)
async def post_validate_tokens(
    event_slug: SlugPath,
    viewer_and_user: tuple[Viewer, object | None] = Depends(get_viewer_and_user),
) -> CockpitActionResultDTO:
    viewer, user = viewer_and_user
    return await in_thread(validate_tokens_sync, event_slug, viewer, user)


@router.post(
    f"{_ACTION_BASE}/update-fide-ratings",
    response_model=CockpitActionResultDTO,
    responses=_RESPONSES,
)
async def post_update_fide_ratings(
    event_slug: SlugPath,
    viewer_and_user: tuple[Viewer, object | None] = Depends(get_viewer_and_user),
) -> CockpitActionResultDTO:
    viewer, user = viewer_and_user
    return await in_thread(update_fide_ratings_sync, event_slug, viewer, user)


@router.post(
    f"{_ACTION_BASE}/backfill-fide-data",
    response_model=CockpitActionResultDTO,
    responses=_RESPONSES,
)
async def post_backfill_fide_data(
    event_slug: SlugPath,
    viewer_and_user: tuple[Viewer, object | None] = Depends(get_viewer_and_user),
) -> CockpitActionResultDTO:
    viewer, user = viewer_and_user
    return await in_thread(backfill_fide_data_sync, event_slug, viewer, user)


@router.post(
    f"{_ACTION_BASE}/generate-pairings",
    response_model=CockpitActionResultDTO,
    responses=_RESPONSES,
)
async def post_generate_pairings(
    event_slug: SlugPath,
    body: GeneratePairingsRequest,
    viewer_and_user: tuple[Viewer, object | None] = Depends(get_viewer_and_user),
) -> CockpitActionResultDTO:
    viewer, user = viewer_and_user
    return await in_thread(
        generate_pairings_sync,
        event_slug,
        body.round_id,
        body.overwrite,
        body.auto_assign_forfeits,
        body.publish_immediately,
        viewer,
        user,
    )


@router.post(
    f"{_ACTION_BASE}/start-round",
    response_model=CockpitActionResultDTO,
    responses=_RESPONSES,
)
async def post_start_round(
    event_slug: SlugPath,
    body: StartRoundRequest,
    viewer_and_user: tuple[Viewer, object | None] = Depends(get_viewer_and_user),
) -> CockpitActionResultDTO:
    viewer, user = viewer_and_user
    return await in_thread(
        start_round_sync,
        event_slug,
        body.round_id,
        body.update_board_order,
        viewer,
        user,
    )


@router.post(
    f"{_ACTION_BASE}/close-round",
    response_model=CockpitActionResultDTO,
    responses=_RESPONSES,
)
async def post_close_round(
    event_slug: SlugPath,
    body: CloseRoundRequest,
    viewer_and_user: tuple[Viewer, object | None] = Depends(get_viewer_and_user),
) -> CockpitActionResultDTO:
    viewer, user = viewer_and_user
    return await in_thread(close_round_sync, event_slug, body.round_id, viewer, user)


@router.post(
    f"{_ACTION_BASE}/close-season",
    response_model=CockpitActionResultDTO,
    responses=_RESPONSES,
)
async def post_close_season(
    event_slug: SlugPath,
    body: CloseSeasonRequest,
    viewer_and_user: tuple[Viewer, object | None] = Depends(get_viewer_and_user),
) -> CockpitActionResultDTO:
    viewer, user = viewer_and_user
    if not body.confirm:
        return CockpitActionResultDTO(status="error", title="Not confirmed", refresh=False)
    return await in_thread(close_season_sync, event_slug, viewer, user)


@router.post(
    f"{_ACTION_BASE}/advance-tournament",
    response_model=CockpitActionResultDTO,
    responses=_RESPONSES,
)
async def post_advance_tournament(
    event_slug: SlugPath,
    viewer_and_user: tuple[Viewer, object | None] = Depends(get_viewer_and_user),
) -> CockpitActionResultDTO:
    viewer, user = viewer_and_user
    return await in_thread(advance_tournament_sync, event_slug, viewer, user)


@router.post(
    f"{_ACTION_BASE}/finalize-tournament",
    response_model=CockpitActionResultDTO,
    responses=_RESPONSES,
)
async def post_finalize_tournament(
    event_slug: SlugPath,
    viewer_and_user: tuple[Viewer, object | None] = Depends(get_viewer_and_user),
) -> CockpitActionResultDTO:
    viewer, user = viewer_and_user
    return await in_thread(finalize_tournament_sync, event_slug, viewer, user)


@router.post(
    f"{_ACTION_BASE}/generate-next-match-set",
    response_model=CockpitActionResultDTO,
    responses=_RESPONSES,
)
async def post_generate_next_match_set(
    event_slug: SlugPath,
    viewer_and_user: tuple[Viewer, object | None] = Depends(get_viewer_and_user),
) -> CockpitActionResultDTO:
    viewer, user = viewer_and_user
    return await in_thread(generate_next_match_set_sync, event_slug, viewer, user)


@router.post(
    f"{_ACTION_BASE}/create-missing-matches",
    response_model=CockpitActionResultDTO,
    responses=_RESPONSES,
)
async def post_create_missing_matches(
    event_slug: SlugPath,
    viewer_and_user: tuple[Viewer, object | None] = Depends(get_viewer_and_user),
) -> CockpitActionResultDTO:
    viewer, user = viewer_and_user
    return await in_thread(create_missing_matches_sync, event_slug, viewer, user)
