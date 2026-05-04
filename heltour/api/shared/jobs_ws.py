"""WebSocket endpoint for background-job updates.

The browser subscribes to one of three scopes:

  * ``/ws/jobs/all`` — every job (admin-only)
  * ``/ws/jobs/season/{slug}`` — jobs for a single season (cockpit)
  * ``/ws/jobs/league/{tag}`` — jobs for a league

Permission is checked once at handshake; the publisher emits
``job.created`` / ``job.started`` / ``job.progress`` / ``job.completed``
envelopes carrying the full job dict so the client replaces row state
without a refetch (same playbook as the matches WS).
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status

from heltour.api.deps import in_thread
from heltour.api.discovery.ws import _viewer_from_ws
from heltour.api.shared.auth import Viewer
from heltour.api.shared.pubsub import subscribe

logger = logging.getLogger("heltour.api.shared.jobs_ws")
router = APIRouter()


def _resolve_season_scope(slug: str, user) -> tuple[Any | None, str]:
    """Return (season, channel) for a season-scoped WS subscription."""
    from heltour.api.shared.models import Season

    try:
        season = Season.objects.select_related("league").get(slug=slug)
    except Season.DoesNotExist:
        return None, ""
    if user is None or not user.is_authenticated:
        return None, ""
    if not user.has_perm("tournament.view_dashboard", season.league):
        return None, ""
    return season, f"jobs:season:{season.pk}"


def _resolve_league_scope(tag: str, user) -> tuple[Any | None, str]:
    from heltour.api.shared.models import League

    try:
        league = League.objects.get(tag=tag)
    except League.DoesNotExist:
        return None, ""
    if user is None or not user.is_authenticated:
        return None, ""
    if not user.has_perm("tournament.view_dashboard", league):
        return None, ""
    return league, f"jobs:league:{league.pk}"


def _resolve_global_scope(user) -> str:
    """Global jobs feed — staff only."""
    if user is None or not user.is_authenticated:
        return ""
    if not user.is_staff:
        return ""
    return "jobs:all"


async def _resolve_user(viewer: Viewer):
    if viewer.user_id is None:
        return None
    from heltour.api.shared.models import User

    try:
        return await in_thread(User.objects.get, pk=viewer.user_id)
    except User.DoesNotExist:
        return None


async def _run_subscription(ws: WebSocket, channel: str) -> None:
    sent = 0
    try:
        async for message in subscribe(channel):
            sent += 1
            await ws.send_json(message)
    except WebSocketDisconnect:
        logger.info("jobs ws disconnect channel=%s sent=%s", channel, sent)
    except Exception:
        logger.exception("jobs ws error channel=%s sent=%s", channel, sent)
        raise


@router.websocket("/ws/jobs/lag")
async def jobs_lag_ws(ws: WebSocket) -> None:
    """Always-on queue-health stream — pushes the rolling lag snapshot
    every time the canary records a sample. Auth gate is "any signed-in
    viewer" so the cockpit footer can surface ops health regardless of
    league/season scope."""
    from heltour.api.shared.jobs_lag import LAG_CHANNEL

    await ws.accept()
    viewer = await _viewer_from_ws(ws)
    if not viewer.is_authenticated:
        await ws.close(code=status.WS_1008_POLICY_VIOLATION)
        return
    await _run_subscription(ws, LAG_CHANNEL)


@router.websocket("/ws/jobs/all")
async def jobs_all_ws(ws: WebSocket) -> None:
    await ws.accept()
    viewer = await _viewer_from_ws(ws)
    user = await _resolve_user(viewer)
    channel = await in_thread(_resolve_global_scope, user)
    if not channel:
        await ws.close(code=status.WS_1008_POLICY_VIOLATION)
        return
    await _run_subscription(ws, channel)


@router.websocket("/ws/jobs/season/{slug}")
async def jobs_season_ws(ws: WebSocket, slug: str) -> None:
    await ws.accept()
    viewer = await _viewer_from_ws(ws)
    user = await _resolve_user(viewer)
    _, channel = await in_thread(_resolve_season_scope, slug, user)
    if not channel:
        await ws.close(code=status.WS_1008_POLICY_VIOLATION)
        return
    await _run_subscription(ws, channel)


@router.websocket("/ws/jobs/league/{tag}")
async def jobs_league_ws(ws: WebSocket, tag: str) -> None:
    await ws.accept()
    viewer = await _viewer_from_ws(ws)
    user = await _resolve_user(viewer)
    _, channel = await in_thread(_resolve_league_scope, tag, user)
    if not channel:
        await ws.close(code=status.WS_1008_POLICY_VIOLATION)
        return
    await _run_subscription(ws, channel)
