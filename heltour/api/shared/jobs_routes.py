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
    from heltour.tournament.models import BackgroundJob, League, Season

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
    from heltour.tournament.models import BackgroundJob

    if user is None or not getattr(user, "is_authenticated", False):
        raise HTTPException(status_code=401, detail="not authenticated")
    try:
        job = BackgroundJob.objects.select_related("season__league", "league", "triggered_by").get(
            pk=job_id
        )
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


@router.get("/jobs/{job_id}", response_model=BackgroundJobDTO)
async def get_job(
    job_id: int,
    viewer_and_user: tuple[Viewer, object | None] = Depends(get_viewer_and_user),
) -> dict[str, Any]:
    _, user = viewer_and_user
    return await in_thread(_get_job_sync, user, job_id)
