"""Generalized background-job runtime.

The cockpit (and eventually anywhere else in the app) can register a
"job kind" via ``@background_job`` to get:

  * a tracked ``BackgroundJob`` row per execution
  * Celery as the executor
  * pubsub fan-out so the UI can render progress in real time
  * uniform handling of success / warning / failure

Call sites enqueue jobs via the registered task's ``.enqueue(...)``
helper rather than ``.delay()`` directly — that's what creates the
tracking row and stamps the source / triggered_by fields.

Usage::

    @background_job(kind="clear_caches", title_template="Clear caches")
    def clear_caches_job(ctx: JobContext) -> dict:
        ctx.progress(50, "Invalidating Django cache")
        cache.clear()
        ctx.progress(100, "Done")
        return {"status": "ok", "detail": "Caches cleared"}

    # Enqueue:
    job = clear_caches_job.enqueue(user=request.user, season=season)
"""

from __future__ import annotations

import json
import logging
import traceback
from dataclasses import dataclass
from typing import Any, Callable, Protocol

import redis
from django.conf import settings
from django.utils import timezone

from heltour.celery import app

logger = logging.getLogger(__name__)


# ---------- pubsub publisher ---------------------------------------------------
#
# Mirrors the pattern in `heltour/tournament/signals_pubsub.py` —
# fire-and-forget Redis publish per state change. Fan-out to browsers
# happens via the `/ws` multiplex (`heltour/api/shared/ws_multiplex.py`)
# on the `jobs:*` channels.

_client: redis.Redis | None = None


def _get_redis_client() -> redis.Redis:
    global _client
    if _client is None:
        _client = redis.Redis.from_url(settings.REDIS_URL, decode_responses=True)
    return _client


def _publish(channels: list[str], payload: dict[str, Any]) -> None:
    try:
        client = _get_redis_client()
        body = json.dumps(payload, default=str)
        for channel in channels:
            receivers = client.publish(channel, body)
            logger.info(
                "jobs pubsub publish channel=%s type=%s job_id=%s status=%s receivers=%s",
                channel,
                payload.get("type"),
                payload.get("job", {}).get("id"),
                payload.get("job", {}).get("status"),
                receivers,
            )
    except Exception:
        logger.exception("jobs pubsub publish failed channels=%s", channels)


def _channels_for(job) -> list[str]:
    """Channels to fan out a job event onto.

    Always emits to ``jobs:all`` (the global admin view) plus a
    season-scoped channel when the job is tied to a season — that's how
    the cockpit only sees its own jobs without per-event filtering.
    """
    chans = ["jobs:all"]
    if job.season_id:
        chans.append(f"jobs:season:{job.season_id}")
    if job.league_id:
        chans.append(f"jobs:league:{job.league_id}")
    return chans


def _envelope(job, event_type: str) -> dict[str, Any]:
    return {
        "type": event_type,
        "job": _job_to_dict(job),
    }


def _job_to_dict(job) -> dict[str, Any]:
    """Compact dict shape for WS payloads + REST responses.

    Kept in sync with the zod schema in
    ``frontend/api-client/src/jobs-messages.ts``.
    """
    return {
        "id": job.pk,
        "kind": job.kind,
        "status": job.status,
        "source": job.source,
        "title": job.title,
        "description": job.description,
        "progress": job.progress,
        "progress_message": job.progress_message,
        "result": job.result_json or {},
        "error_message": job.error_message,
        "triggered_by_username": (job.triggered_by.username if job.triggered_by_id else None),
        "season_id": job.season_id,
        "season_slug": job.season.slug if job.season_id else None,
        "league_tag": job.league.tag if job.league_id else None,
        "created_at": job.date_created.isoformat() if job.date_created else None,
        "started_at": job.started_at.isoformat() if job.started_at else None,
        "completed_at": job.completed_at.isoformat() if job.completed_at else None,
    }


# ---------- JobContext ---------------------------------------------------------


class JobContext:
    """Handle passed to job bodies for progress + result reporting.

    The body calls ``ctx.progress(pct, msg)`` to surface activity. The
    body's *return value* is the result; if it's a dict containing
    ``"status": "warning"`` the job ends in warning instead of ok.
    """

    def __init__(self, job_id: int) -> None:
        self.job_id = job_id

    def progress(self, percent: int | None, message: str = "") -> None:
        from heltour.api.shared.models import BackgroundJob

        clamped: int | None = None
        if percent is not None:
            clamped = max(0, min(100, int(percent)))
        BackgroundJob.objects.filter(pk=self.job_id).update(
            progress=clamped,
            progress_message=message[:255],
        )
        try:
            job = _reload_job(self.job_id)
            _publish(_channels_for(job), _envelope(job, "job.progress"))
        except BackgroundJob.DoesNotExist:  # pragma: no cover
            pass


def _reload_job(job_id: int):
    """Re-read a BackgroundJob row, bypassing cacheops.

    Every publish-time read goes through here. The job row mutates
    several times per task (queued → running → progress* → ok/failed)
    and cacheops's invalidation of ``select_related`` variants isn't
    reliably synchronous; without bypassing the cache we observed
    envelopes whose ``status`` regressed as stale snapshots leaked.

    The FastAPI process disables cacheops globally
    (``LITOUR_CACHEOPS_DISABLED=1`` in ``heltour/api/main.py``), but
    this code also runs inside the Celery worker — a separate process
    that still has cacheops enabled — so the per-query ``.nocache()``
    is what actually keeps stale rows out of the published envelope.
    """
    from heltour.api.shared.models import BackgroundJob

    return (
        BackgroundJob.objects.select_related("season", "league", "triggered_by")
        .nocache()
        .get(pk=job_id)
    )


# ---------- Registry + decorator -----------------------------------------------


@dataclass(frozen=True)
class JobKindSpec:
    """Static description of a job kind — enables the API to validate
    enqueue requests + the UI to label rows even when the row was
    created in a previous deploy."""

    kind: str
    label: str
    permission: str | None  # Django perm string ('app.view_x') checked at enqueue
    scope: str  # 'season' | 'league' | 'global' — drives perm check + WS fan-out


_REGISTRY: dict[str, "RegisteredJob"] = {}


def get_registry() -> dict[str, "RegisteredJob"]:
    return dict(_REGISTRY)


class _Enqueuer(Protocol):
    def enqueue(
        self,
        *,
        user: Any = None,
        source: str = "manual",
        season: Any = None,
        league: Any = None,
        input: dict[str, Any] | None = None,
        title: str | None = None,
        description: str = "",
    ) -> Any: ...


@dataclass
class RegisteredJob:
    spec: JobKindSpec
    celery_task: Any  # the wrapped task; supports .delay()
    title_template: str
    description_template: str

    def enqueue(
        self,
        *,
        user: Any = None,
        source: str = "manual",
        season: Any = None,
        league: Any = None,
        input: dict[str, Any] | None = None,
        title: str | None = None,
        description: str = "",
    ):
        """Create the BackgroundJob row + dispatch the Celery task.

        Returns the BackgroundJob instance. Caller may .pk it back to
        the client so they can subscribe to that job's updates.
        """
        from heltour.api.shared.models import BackgroundJob

        ctx = dict(input or {})
        ctx.update(
            {
                "season_name": season.name if season is not None else "",
                "season_slug": season.slug if season is not None else "",
                "league_name": league.name if league is not None else "",
                "kind": self.spec.kind,
                "label": self.spec.label,
            }
        )
        rendered_title = title or _safe_format(self.title_template, ctx) or self.spec.label
        rendered_description = description or _safe_format(self.description_template, ctx)

        job = BackgroundJob.objects.create(
            kind=self.spec.kind,
            status="queued",
            source=source,
            triggered_by=user
            if user is not None and getattr(user, "is_authenticated", False)
            else None,
            title=rendered_title[:255],
            description=rendered_description,
            input_json=input or {},
            season=season,
            league=league,
        )
        # Best-effort; if Redis is down we still have the row, just no WS.
        _publish(_channels_for(job), _envelope(job, "job.created"))
        async_result = self.celery_task.delay(job.pk)
        if async_result and async_result.id:
            BackgroundJob.objects.filter(pk=job.pk).update(celery_task_id=async_result.id)
        return job


def _safe_format(template: str, ctx: dict[str, Any]) -> str:
    if not template:
        return ""
    try:
        return template.format(**ctx)
    except (KeyError, IndexError):
        return template


def background_job(
    *,
    kind: str,
    label: str | None = None,
    title_template: str = "",
    description_template: str = "",
    permission: str | None = None,
    scope: str = "season",
):
    """Register a function as a tracked background job.

    The decorated function must accept ``(ctx: JobContext, **input)``
    and return either a plain dict (status defaults to ``ok``) or a
    dict with an explicit ``"status"`` of ``"ok"`` / ``"warning"``.
    Raised exceptions become ``failed`` with the traceback in
    ``error_message``.
    """

    def decorator(func: Callable[..., dict[str, Any]]) -> RegisteredJob:
        spec = JobKindSpec(
            kind=kind,
            label=label or kind.replace("_", " ").title(),
            permission=permission,
            scope=scope,
        )

        # The Celery task — receives just ``job_id`` so the body can be
        # restarted by Celery without us serialising the full input again.
        @app.task(name=f"jobs.{kind}", bind=True)
        def _task(self, job_id: int):  # noqa: ARG001 — `self` required by bind=True
            from heltour.api.shared.models import BackgroundJob

            try:
                job = _reload_job(job_id)
            except BackgroundJob.DoesNotExist:
                logger.error("background job %s missing", job_id)
                return

            BackgroundJob.objects.filter(pk=job_id).update(
                status="running",
                started_at=timezone.now(),
            )
            job = _reload_job(job_id)
            _publish(_channels_for(job), _envelope(job, "job.started"))

            ctx = JobContext(job_id=job_id)
            try:
                result = func(ctx, **(job.input_json or {}))
                if not isinstance(result, dict):
                    result = {"status": "ok", "value": result}
                status = result.get("status", "ok")
                if status not in {"ok", "warning"}:
                    status = "ok"
                BackgroundJob.objects.filter(pk=job_id).update(
                    status=status,
                    completed_at=timezone.now(),
                    result_json=result,
                    progress=100,
                )
            except Exception as exc:
                tb = traceback.format_exc()
                logger.exception("background job %s (%s) failed", job_id, kind)
                BackgroundJob.objects.filter(pk=job_id).update(
                    status="failed",
                    completed_at=timezone.now(),
                    error_message=f"{exc.__class__.__name__}: {exc}\n\n{tb}"[:8000],
                )

            job = _reload_job(job_id)
            _publish(_channels_for(job), _envelope(job, "job.completed"))

        registered = RegisteredJob(
            spec=spec,
            celery_task=_task,
            title_template=title_template or label or kind,
            description_template=description_template,
        )
        _REGISTRY[kind] = registered
        return registered

    return decorator


# ---------- Permission helpers --------------------------------------------------


def can_enqueue(user, registered: RegisteredJob, *, league=None) -> bool:
    if user is None or not getattr(user, "is_authenticated", False):
        return False
    if registered.spec.permission is None:
        return True
    obj = league if registered.spec.scope == "league" else None
    return bool(user.has_perm(registered.spec.permission, obj))
