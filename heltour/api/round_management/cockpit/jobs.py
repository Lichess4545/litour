"""Background-job definitions for the cockpit.

Each function is a ``@background_job``-decorated callable that does the
real work. The cockpit POST routes call ``.enqueue(...)`` to dispatch
them via Celery and return the BackgroundJob row to the client. The
cockpit's existing in-thread action functions remain in ``actions.py``
during the migration window — they're called *inside* these jobs, so
the business logic lives in one place.
"""

from __future__ import annotations

from typing import Any

from heltour.api.shared.jobs import JobContext, background_job


@background_job(
    kind="clear_caches",
    label="Clear caches",
    title_template="Clear caches",
    description_template="Invalidate Django cache + cacheops",
    permission="tournament.view_dashboard",
    scope="league",
)
def clear_caches_job(ctx: JobContext) -> dict[str, Any]:
    """POC migration target.

    Body intentionally tiny so we exercise the wrapper plumbing
    without business-logic interference. The Phase-2B migration moves
    every action in ``actions.py`` to its own ``@background_job``
    function in this module.
    """
    from django.core.cache import cache

    ctx.progress(20, "Invalidating Django cache")
    cache.clear()
    detail = "Django cache invalidated."
    try:
        from cacheops import invalidate_all  # type: ignore

        ctx.progress(70, "Invalidating cacheops")
        invalidate_all()
        detail = "Django + cacheops invalidated."
    except ImportError:
        pass
    ctx.progress(100, "Done")
    return {"status": "ok", "detail": detail}


# ---------- Helpers shared across jobs -----------------------------------------


def _job_row(ctx: JobContext):
    """Load the BackgroundJob row + its scope objects.

    Each job needs the season (to call the underlying ``*_sync``
    helper) and the triggered_by user (to satisfy permission checks
    inside that helper). Routes set both fields at enqueue time.
    """
    from heltour.tournament.models import BackgroundJob

    return BackgroundJob.objects.select_related("season__league", "triggered_by").get(pk=ctx.job_id)


def _result_dict_from_action(result) -> dict[str, Any]:
    """Convert a ``CockpitActionResultDTO`` into a job-result dict.

    Maps ``status="error"`` from the action layer to a raised exception
    so the wrapper marks the job ``failed``; the action layer used
    ``error`` for in-line responses but at the job layer the natural
    fit is the ``failed`` terminal state.
    """
    if result.status == "error":
        # Surfaced via the wrapper's exception handling → status=failed.
        raise RuntimeError(result.detail or result.title)
    return {
        "status": "warning" if result.status == "warning" else "ok",
        "title": result.title,
        "detail": result.detail,
    }


# ---------- Operational + token health ----------------------------------------


@background_job(
    kind="validate_tokens",
    label="Validate Lichess tokens",
    title_template="Validate Lichess tokens — {season_name}",
    permission="tournament.view_dashboard",
    scope="league",
)
def validate_tokens_job(ctx: JobContext) -> dict[str, Any]:
    from heltour.api.round_management.cockpit.actions import validate_tokens_sync
    from heltour.api.shared.auth import Viewer

    job = _job_row(ctx)
    ctx.progress(20, "Dispatching token validation signal")
    res = validate_tokens_sync(job.season.slug, Viewer.anonymous(), job.triggered_by)
    ctx.progress(100, "Validation queued")
    return _result_dict_from_action(res)


@background_job(
    kind="update_fide_ratings",
    label="Update FIDE ratings",
    title_template="Update FIDE ratings — {season_name}",
    permission="tournament.view_dashboard",
    scope="league",
)
def update_fide_ratings_job(ctx: JobContext) -> dict[str, Any]:
    from heltour.api.round_management.cockpit.actions import update_fide_ratings_sync
    from heltour.api.shared.auth import Viewer

    job = _job_row(ctx)
    ctx.progress(20, "Queueing FIDE rating refresh")
    res = update_fide_ratings_sync(job.season.slug, Viewer.anonymous(), job.triggered_by)
    ctx.progress(100, "Refresh queued")
    return _result_dict_from_action(res)


@background_job(
    kind="backfill_fide_data",
    label="Backfill FIDE data",
    title_template="Backfill FIDE IDs / gender — {season_name}",
    permission="tournament.view_dashboard",
    scope="league",
)
def backfill_fide_data_job(ctx: JobContext) -> dict[str, Any]:
    from heltour.api.round_management.cockpit.actions import backfill_fide_data_sync
    from heltour.api.shared.auth import Viewer

    job = _job_row(ctx)
    ctx.progress(20, "Queueing FIDE backfill")
    res = backfill_fide_data_sync(job.season.slug, Viewer.anonymous(), job.triggered_by)
    ctx.progress(100, "Backfill queued")
    return _result_dict_from_action(res)


# ---------- Round transitions --------------------------------------------------


@background_job(
    kind="generate_pairings",
    label="Generate pairings",
    title_template="Generate pairings — {season_name}",
    permission="tournament.generate_pairings",
    scope="league",
)
def generate_pairings_job(
    ctx: JobContext,
    round_id: int | None = None,
    overwrite: bool = False,
    auto_assign_forfeits: bool = False,
    publish_immediately: bool = False,
) -> dict[str, Any]:
    from heltour.api.round_management.cockpit.actions import generate_pairings_sync
    from heltour.api.shared.auth import Viewer

    job = _job_row(ctx)
    ctx.progress(10, "Loading roster")
    res = generate_pairings_sync(
        job.season.slug,
        round_id,
        overwrite,
        auto_assign_forfeits,
        publish_immediately,
        Viewer.anonymous(),
        job.triggered_by,
    )
    ctx.progress(100, "Pairings ready")
    return _result_dict_from_action(res)


@background_job(
    kind="start_round",
    label="Start round",
    title_template="Start round — {season_name}",
    permission="tournament.generate_pairings",
    scope="league",
)
def start_round_job(
    ctx: JobContext,
    round_id: int | None = None,
    update_board_order: bool = False,
) -> dict[str, Any]:
    from heltour.api.round_management.cockpit.actions import start_round_sync
    from heltour.api.shared.auth import Viewer

    job = _job_row(ctx)
    ctx.progress(20, "Publishing pairings")
    res = start_round_sync(
        job.season.slug,
        round_id,
        update_board_order,
        Viewer.anonymous(),
        job.triggered_by,
    )
    ctx.progress(100, "Round started")
    return _result_dict_from_action(res)


@background_job(
    kind="close_round",
    label="Close round",
    title_template="Close round — {season_name}",
    permission="tournament.generate_pairings",
    scope="league",
)
def close_round_job(ctx: JobContext, round_id: int | None = None) -> dict[str, Any]:
    from heltour.api.round_management.cockpit.actions import close_round_sync
    from heltour.api.shared.auth import Viewer

    job = _job_row(ctx)
    ctx.progress(50, "Marking round complete")
    res = close_round_sync(job.season.slug, round_id, Viewer.anonymous(), job.triggered_by)
    ctx.progress(100, "Round closed")
    return _result_dict_from_action(res)


@background_job(
    kind="close_season",
    label="Close season",
    title_template="Close season — {season_name}",
    permission="tournament.generate_pairings",
    scope="league",
)
def close_season_job(ctx: JobContext) -> dict[str, Any]:
    from heltour.api.round_management.cockpit.actions import close_season_sync
    from heltour.api.shared.auth import Viewer

    job = _job_row(ctx)
    ctx.progress(50, "Marking season complete")
    res = close_season_sync(job.season.slug, Viewer.anonymous(), job.triggered_by)
    ctx.progress(100, "Season closed")
    return _result_dict_from_action(res)


# ---------- Knockout flow ------------------------------------------------------


@background_job(
    kind="advance_tournament",
    label="Advance tournament",
    title_template="Advance tournament — {season_name}",
    permission="tournament.generate_pairings",
    scope="league",
)
def advance_tournament_job(ctx: JobContext) -> dict[str, Any]:
    from heltour.api.round_management.cockpit.actions import advance_tournament_sync
    from heltour.api.shared.auth import Viewer

    job = _job_row(ctx)
    ctx.progress(20, "Computing advancement")
    res = advance_tournament_sync(job.season.slug, Viewer.anonymous(), job.triggered_by)
    ctx.progress(100, "Advanced")
    return _result_dict_from_action(res)


@background_job(
    kind="finalize_tournament",
    label="Finalize tournament",
    title_template="Finalize tournament — {season_name}",
    permission="tournament.generate_pairings",
    scope="league",
)
def finalize_tournament_job(ctx: JobContext) -> dict[str, Any]:
    from heltour.api.round_management.cockpit.actions import finalize_tournament_sync
    from heltour.api.shared.auth import Viewer

    job = _job_row(ctx)
    ctx.progress(50, "Finalizing standings")
    res = finalize_tournament_sync(job.season.slug, Viewer.anonymous(), job.triggered_by)
    ctx.progress(100, "Finalized")
    return _result_dict_from_action(res)


@background_job(
    kind="generate_next_match_set",
    label="Generate next match set",
    title_template="Generate next match set — {season_name}",
    permission="tournament.generate_pairings",
    scope="league",
)
def generate_next_match_set_job(ctx: JobContext) -> dict[str, Any]:
    from heltour.api.round_management.cockpit.actions import (
        generate_next_match_set_sync,
    )
    from heltour.api.shared.auth import Viewer

    job = _job_row(ctx)
    ctx.progress(30, "Creating next match")
    res = generate_next_match_set_sync(job.season.slug, Viewer.anonymous(), job.triggered_by)
    ctx.progress(100, "Match set created")
    return _result_dict_from_action(res)


@background_job(
    kind="create_missing_matches",
    label="Create missing matches",
    title_template="Create missing matches — {season_name}",
    permission="tournament.generate_pairings",
    scope="league",
)
def create_missing_matches_job(ctx: JobContext) -> dict[str, Any]:
    from heltour.api.round_management.cockpit.actions import (
        create_missing_matches_sync,
    )
    from heltour.api.shared.auth import Viewer

    job = _job_row(ctx)
    ctx.progress(30, "Creating initial match set")
    res = create_missing_matches_sync(job.season.slug, Viewer.anonymous(), job.triggered_by)
    ctx.progress(100, "Matches created")
    return _result_dict_from_action(res)
