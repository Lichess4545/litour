"""HTTP routes for the cockpit.

Thin wrappers: each route validates the path, resolves the viewer, and
hands off to a sync service via ``in_thread``. The DTO shape is identical
between the GET snapshot and the WS push so the UI replaces state with
the payload.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query

from heltour.api.deps import in_thread
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
    """POC migration to the background-job runtime.

    Enqueues `clear_caches_job` and returns a result envelope carrying
    `job_id` so the client can subscribe to live progress. The action
    no longer blocks the request thread.
    """
    _, user = viewer_and_user
    return await in_thread(_enqueue_clear_caches, event_slug, user)


def _enqueue_clear_caches(event_slug: str, user) -> CockpitActionResultDTO:
    from heltour.api.round_management.cockpit.jobs import clear_caches_job

    return _enqueue(
        clear_caches_job,
        event_slug,
        user,
        permission="tournament.view_dashboard",
        success_title="Cache clear started",
    )


def _enqueue(
    job_def,
    event_slug: str,
    user,
    *,
    permission: str,
    success_title: str,
    input: dict[str, Any] | None = None,
) -> CockpitActionResultDTO:
    """Resolve scope + permission, then enqueue the @background_job task.

    Centralises 401/403/404 handling so each route stays a one-liner.
    """
    from heltour.api.shared.models import Season

    if user is None or not getattr(user, "is_authenticated", False):
        raise HTTPException(status_code=401, detail="not authenticated")
    try:
        season = Season.objects.select_related("league").get(slug=event_slug)
    except Season.DoesNotExist as exc:
        raise HTTPException(status_code=404, detail="event not found") from exc
    if not user.has_perm(permission, season.league):
        raise HTTPException(status_code=403, detail="forbidden")

    job = job_def.enqueue(
        user=user,
        source="manual",
        season=season,
        league=season.league,
        input=input or {},
    )
    return CockpitActionResultDTO(
        status="ok",
        title=success_title,
        detail="Running in the background.",
        refresh=False,
        job_id=job.pk,
    )


@router.post(
    f"{_ACTION_BASE}/validate-tokens",
    response_model=CockpitActionResultDTO,
    responses=_RESPONSES,
)
async def post_validate_tokens(
    event_slug: SlugPath,
    viewer_and_user: tuple[Viewer, object | None] = Depends(get_viewer_and_user),
) -> CockpitActionResultDTO:
    _, user = viewer_and_user
    return await in_thread(_enqueue_validate_tokens, event_slug, user)


def _enqueue_validate_tokens(event_slug: str, user) -> CockpitActionResultDTO:
    from heltour.api.round_management.cockpit.jobs import validate_tokens_job

    return _enqueue(
        validate_tokens_job,
        event_slug,
        user,
        permission="tournament.view_dashboard",
        success_title="Token validation started",
    )


@router.post(
    f"{_ACTION_BASE}/update-fide-ratings",
    response_model=CockpitActionResultDTO,
    responses=_RESPONSES,
)
async def post_update_fide_ratings(
    event_slug: SlugPath,
    viewer_and_user: tuple[Viewer, object | None] = Depends(get_viewer_and_user),
) -> CockpitActionResultDTO:
    _, user = viewer_and_user
    return await in_thread(_enqueue_update_fide_ratings, event_slug, user)


def _enqueue_update_fide_ratings(event_slug: str, user) -> CockpitActionResultDTO:
    from heltour.api.round_management.cockpit.jobs import update_fide_ratings_job

    return _enqueue(
        update_fide_ratings_job,
        event_slug,
        user,
        permission="tournament.view_dashboard",
        success_title="FIDE rating refresh started",
    )


@router.post(
    f"{_ACTION_BASE}/backfill-fide-data",
    response_model=CockpitActionResultDTO,
    responses=_RESPONSES,
)
async def post_backfill_fide_data(
    event_slug: SlugPath,
    viewer_and_user: tuple[Viewer, object | None] = Depends(get_viewer_and_user),
) -> CockpitActionResultDTO:
    _, user = viewer_and_user
    return await in_thread(_enqueue_backfill_fide_data, event_slug, user)


def _enqueue_backfill_fide_data(event_slug: str, user) -> CockpitActionResultDTO:
    from heltour.api.round_management.cockpit.jobs import backfill_fide_data_job

    return _enqueue(
        backfill_fide_data_job,
        event_slug,
        user,
        permission="tournament.view_dashboard",
        success_title="FIDE backfill started",
    )


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
    _, user = viewer_and_user
    return await in_thread(_enqueue_generate_pairings, event_slug, user, body)


def _enqueue_generate_pairings(
    event_slug: str, user, body: GeneratePairingsRequest
) -> CockpitActionResultDTO:
    from heltour.api.round_management.cockpit.jobs import generate_pairings_job

    return _enqueue(
        generate_pairings_job,
        event_slug,
        user,
        permission="tournament.generate_pairings",
        success_title="Generating pairings",
        input={
            "round_id": body.round_id,
            "overwrite": body.overwrite,
            "auto_assign_forfeits": body.auto_assign_forfeits,
            "publish_immediately": body.publish_immediately,
        },
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
    _, user = viewer_and_user
    return await in_thread(_enqueue_start_round, event_slug, user, body)


def _enqueue_start_round(event_slug: str, user, body: StartRoundRequest) -> CockpitActionResultDTO:
    from heltour.api.round_management.cockpit.jobs import start_round_job

    return _enqueue(
        start_round_job,
        event_slug,
        user,
        permission="tournament.generate_pairings",
        success_title="Starting round",
        input={
            "round_id": body.round_id,
            "update_board_order": body.update_board_order,
        },
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
    _, user = viewer_and_user
    return await in_thread(_enqueue_close_round, event_slug, user, body)


def _enqueue_close_round(event_slug: str, user, body: CloseRoundRequest) -> CockpitActionResultDTO:
    from heltour.api.round_management.cockpit.jobs import close_round_job

    return _enqueue(
        close_round_job,
        event_slug,
        user,
        permission="tournament.generate_pairings",
        success_title="Closing round",
        input={"round_id": body.round_id},
    )


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
    _, user = viewer_and_user
    if not body.confirm:
        return CockpitActionResultDTO(status="error", title="Not confirmed", refresh=False)
    return await in_thread(_enqueue_close_season, event_slug, user)


def _enqueue_close_season(event_slug: str, user) -> CockpitActionResultDTO:
    from heltour.api.round_management.cockpit.jobs import close_season_job

    return _enqueue(
        close_season_job,
        event_slug,
        user,
        permission="tournament.generate_pairings",
        success_title="Closing season",
    )


@router.post(
    f"{_ACTION_BASE}/advance-tournament",
    response_model=CockpitActionResultDTO,
    responses=_RESPONSES,
)
async def post_advance_tournament(
    event_slug: SlugPath,
    viewer_and_user: tuple[Viewer, object | None] = Depends(get_viewer_and_user),
) -> CockpitActionResultDTO:
    _, user = viewer_and_user
    return await in_thread(_enqueue_advance_tournament, event_slug, user)


def _enqueue_advance_tournament(event_slug: str, user) -> CockpitActionResultDTO:
    from heltour.api.round_management.cockpit.jobs import advance_tournament_job

    return _enqueue(
        advance_tournament_job,
        event_slug,
        user,
        permission="tournament.generate_pairings",
        success_title="Advancing tournament",
    )


@router.post(
    f"{_ACTION_BASE}/finalize-tournament",
    response_model=CockpitActionResultDTO,
    responses=_RESPONSES,
)
async def post_finalize_tournament(
    event_slug: SlugPath,
    viewer_and_user: tuple[Viewer, object | None] = Depends(get_viewer_and_user),
) -> CockpitActionResultDTO:
    _, user = viewer_and_user
    return await in_thread(_enqueue_finalize_tournament, event_slug, user)


def _enqueue_finalize_tournament(event_slug: str, user) -> CockpitActionResultDTO:
    from heltour.api.round_management.cockpit.jobs import finalize_tournament_job

    return _enqueue(
        finalize_tournament_job,
        event_slug,
        user,
        permission="tournament.generate_pairings",
        success_title="Finalizing tournament",
    )


@router.post(
    f"{_ACTION_BASE}/generate-next-match-set",
    response_model=CockpitActionResultDTO,
    responses=_RESPONSES,
)
async def post_generate_next_match_set(
    event_slug: SlugPath,
    viewer_and_user: tuple[Viewer, object | None] = Depends(get_viewer_and_user),
) -> CockpitActionResultDTO:
    _, user = viewer_and_user
    return await in_thread(_enqueue_generate_next_match_set, event_slug, user)


def _enqueue_generate_next_match_set(event_slug: str, user) -> CockpitActionResultDTO:
    from heltour.api.round_management.cockpit.jobs import generate_next_match_set_job

    return _enqueue(
        generate_next_match_set_job,
        event_slug,
        user,
        permission="tournament.generate_pairings",
        success_title="Generating next match set",
    )


@router.post(
    f"{_ACTION_BASE}/create-missing-matches",
    response_model=CockpitActionResultDTO,
    responses=_RESPONSES,
)
async def post_create_missing_matches(
    event_slug: SlugPath,
    viewer_and_user: tuple[Viewer, object | None] = Depends(get_viewer_and_user),
) -> CockpitActionResultDTO:
    _, user = viewer_and_user
    return await in_thread(_enqueue_create_missing_matches, event_slug, user)


def _enqueue_create_missing_matches(event_slug: str, user) -> CockpitActionResultDTO:
    from heltour.api.round_management.cockpit.jobs import create_missing_matches_job

    return _enqueue(
        create_missing_matches_job,
        event_slug,
        user,
        permission="tournament.generate_pairings",
        success_title="Creating missing matches",
    )
