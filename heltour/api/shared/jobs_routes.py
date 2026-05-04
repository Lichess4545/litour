"""REST routes for the background-job system.

These are read-only — listing + detail. Enqueueing happens through
domain-specific routes (e.g. cockpit's POST endpoints) which import the
registered ``RegisteredJob`` directly. Treating "enqueue" as a domain
concern keeps permission checks colocated with the action's other
gating logic.
"""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field

from heltour.api.deps import in_thread
from heltour.api.shared.auth import Viewer, get_viewer_and_user
from heltour.api.shared.jobs import _job_to_dict

router = APIRouter()


JobStatus = Literal["queued", "running", "ok", "warning", "failed"]
JobSource = Literal["manual", "scheduled", "system"]


class BackgroundJobDTO(BaseModel):
    """Compact wire format — matches ``_job_to_dict`` in jobs.py."""

    model_config = ConfigDict(title="BackgroundJobDTO")

    id: int
    kind: str
    status: JobStatus
    source: JobSource
    title: str
    description: str
    progress: int | None
    progress_message: str
    result: dict[str, Any] = Field(default_factory=dict)
    error_message: str
    triggered_by_username: str | None
    season_id: int | None
    season_slug: str | None
    league_tag: str | None
    created_at: str | None
    started_at: str | None
    completed_at: str | None


def _list_jobs_sync(
    user,
    season_slug: str | None,
    league_tag: str | None,
    active_only: bool,
    limit: int,
) -> list[dict[str, Any]]:
    from heltour.api.shared.models import BackgroundJob, League, Season

    if user is None or not getattr(user, "is_authenticated", False):
        raise HTTPException(status_code=401, detail="not authenticated")

    qs = BackgroundJob.objects.select_related("season", "league", "triggered_by")

    if season_slug:
        try:
            season = Season.objects.select_related("league").get(slug=season_slug)
        except Season.DoesNotExist as exc:
            raise HTTPException(status_code=404, detail="season not found") from exc
        if not user.has_perm("tournament.view_dashboard", season.league):
            raise HTTPException(status_code=403, detail="forbidden")
        qs = qs.filter(season=season)
    elif league_tag:
        try:
            league = League.objects.get(tag=league_tag)
        except League.DoesNotExist as exc:
            raise HTTPException(status_code=404, detail="league not found") from exc
        if not user.has_perm("tournament.view_dashboard", league):
            raise HTTPException(status_code=403, detail="forbidden")
        qs = qs.filter(league=league)
    else:
        # Global view — staff only.
        if not user.is_staff:
            raise HTTPException(status_code=403, detail="forbidden")

    if active_only:
        qs = qs.filter(status__in=["queued", "running"])

    return [_job_to_dict(j) for j in qs.order_by("-date_created")[:limit]]


def _get_job_sync(user, job_id: int) -> dict[str, Any]:
    from heltour.api.shared.models import BackgroundJob

    if user is None or not getattr(user, "is_authenticated", False):
        raise HTTPException(status_code=401, detail="not authenticated")
    try:
        job = BackgroundJob.objects.select_related(
            "season__league", "league", "triggered_by"
        ).get(pk=job_id)
    except BackgroundJob.DoesNotExist as exc:
        raise HTTPException(status_code=404, detail="job not found") from exc

    # A user can read a job if they have view_dashboard on its scope, or
    # they're staff (global view).
    league = job.league if job.league_id else (job.season.league if job.season_id else None)
    allowed = user.is_staff or (
        league is not None and user.has_perm("tournament.view_dashboard", league)
    )
    if not allowed:
        raise HTTPException(status_code=403, detail="forbidden")
    return _job_to_dict(job)


@router.get("/jobs", response_model=list[BackgroundJobDTO])
async def list_jobs(
    season_slug: str | None = Query(default=None, max_length=100),
    league_tag: str | None = Query(default=None, max_length=64),
    active_only: bool = Query(default=False),
    limit: int = Query(default=50, ge=1, le=500),
    viewer_and_user: tuple[Viewer, object | None] = Depends(get_viewer_and_user),
) -> list[dict[str, Any]]:
    _, user = viewer_and_user
    return await in_thread(_list_jobs_sync, user, season_slug, league_tag, active_only, limit)


# ---------- Queue-health canary --------------------------------------------------
#
# Declared before the ``/jobs/{job_id}`` route so FastAPI matches the
# fixed path first; otherwise ``/jobs/lag`` would be parsed as
# ``job_id="lag"`` and rejected with a 422 from the int validator.


class JobLagDTO(BaseModel):
    """Snapshot of recent broker round-trip lag.

    All times in seconds. ``samples`` is the count behind the
    aggregates so the UI can render "—" instead of a misleading value
    when the canary hasn't run enough yet.
    """

    model_config = ConfigDict(title="JobLagDTO")

    samples: int
    queue_lag_latest: float | None
    queue_lag_avg: float | None
    queue_lag_stddev: float | None
    queue_lag_p95: float | None
    queue_lag_max: float | None
    last_observed_at: str | None


@router.get("/jobs/lag", response_model=JobLagDTO)
async def get_job_lag(
    viewer_and_user: tuple[Viewer, object | None] = Depends(get_viewer_and_user),
) -> dict[str, Any]:
    """Aggregate ``JobLagSample`` rows from the last hour into a queue-health DTO."""
    from heltour.api.shared.jobs_lag import compute_lag_snapshot

    _, user = viewer_and_user
    if user is None or not getattr(user, "is_authenticated", False):
        raise HTTPException(status_code=401, detail="not authenticated")
    return await in_thread(compute_lag_snapshot)


class JobLagHistoryPointDTO(BaseModel):
    model_config = ConfigDict(title="JobLagHistoryPointDTO")

    bucket_start: str
    queue_lag_mean: float
    queue_lag_p95: float
    queue_lag_max: float
    sample_count: int


class JobLagHistoryDTO(BaseModel):
    """Recent rolled-up lag buckets for the popover sparkline.

    Ordered oldest → newest so the client can render straight off the
    array without reversing. Gaps in the timeline (hours where the
    rollup didn't run / the canary was down) are NOT filled — the
    array just contains whatever buckets exist.
    """

    model_config = ConfigDict(title="JobLagHistoryDTO")

    granularity: Literal["hour", "day", "week", "month", "year"]
    points: list[JobLagHistoryPointDTO]


def _job_lag_history_sync(granularity: str, limit: int) -> dict[str, Any]:
    from heltour.api.shared.models import JobLagBucket

    rows = list(
        JobLagBucket.objects.filter(granularity=granularity)
        .order_by("-bucket_start")
        .values(
            "bucket_start",
            "queue_lag_mean",
            "queue_lag_p95",
            "queue_lag_max",
            "sample_count",
        )[:limit]
    )
    rows.reverse()
    return {
        "granularity": granularity,
        "points": [
            {
                "bucket_start": r["bucket_start"].isoformat(),
                "queue_lag_mean": r["queue_lag_mean"],
                "queue_lag_p95": r["queue_lag_p95"],
                "queue_lag_max": r["queue_lag_max"],
                "sample_count": r["sample_count"],
            }
            for r in rows
        ],
    }


@router.get("/jobs/lag/history", response_model=JobLagHistoryDTO)
async def get_job_lag_history(
    granularity: Literal["hour", "day", "week", "month", "year"] = Query(default="hour"),
    limit: int = Query(default=24, ge=1, le=365),
    viewer_and_user: tuple[Viewer, object | None] = Depends(get_viewer_and_user),
) -> dict[str, Any]:
    """Return the most recent N rolled-up lag buckets at the given granularity."""
    _, user = viewer_and_user
    if user is None or not getattr(user, "is_authenticated", False):
        raise HTTPException(status_code=401, detail="not authenticated")
    return await in_thread(_job_lag_history_sync, granularity, limit)


@router.get("/jobs/{job_id}", response_model=BackgroundJobDTO)
async def get_job(
    job_id: int,
    viewer_and_user: tuple[Viewer, object | None] = Depends(get_viewer_and_user),
) -> dict[str, Any]:
    _, user = viewer_and_user
    return await in_thread(_get_job_sync, user, job_id)
