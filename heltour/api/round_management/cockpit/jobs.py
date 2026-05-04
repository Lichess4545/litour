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
