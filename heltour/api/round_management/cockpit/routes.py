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
from heltour.api.round_management.cockpit.schemas import (
    CockpitAuditEntryDTO,
    CockpitDTO,
    CockpitMatchDTO,
    ForceResultRequest,
    MarkForfeitRequest,
    RescheduleRequest,
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
