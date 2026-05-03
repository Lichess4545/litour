"""WebSocket endpoints for the discovery domain.

Two endpoints, mirroring the REST shape:

- ``/ws/discovery/home`` — fans the ``events:home`` channel.
- ``/ws/discovery/events/{slug}`` — fans ``events:slug:{slug}`` after a
  visibility-aware handshake.

The matching publisher lives in `heltour/tournament/signals_pubsub.py`.
Envelopes are forwarded verbatim — the client replaces state with the
payload, so shape is owned by `discovery.schemas`.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status

from heltour.api.deps import in_thread
from heltour.api.discovery.permissions import can_subscribe_event_slug
from heltour.api.discovery.services import resolve_slug
from heltour.api.shared.auth import _resolve_viewer_sync
from heltour.api.shared.pubsub import subscribe

logger = logging.getLogger("heltour.api.discovery.ws")
router = APIRouter()


async def _viewer_from_ws(ws: WebSocket):
    """Resolve a Django session cookie off a WS connection."""

    from django.conf import settings

    cookie_name = settings.SESSION_COOKIE_NAME
    session_key = ws.cookies.get(cookie_name)
    viewer, _ = await in_thread(_resolve_viewer_sync, session_key)
    return viewer


@router.websocket("/ws/discovery/home")
async def discovery_home_ws(ws: WebSocket) -> None:
    """Anonymous-safe: only public Seasons fan to this channel.

    The home channel never carries unlisted or draft events (the
    publisher in `signals_pubsub.py` enforces that), so no per-message
    visibility check is needed here.
    """

    await ws.accept()
    client = ws.client
    logger.info("ws connect discovery:home client=%s", client)
    sent = 0
    try:
        async for message in subscribe("events:home"):
            sent += 1
            logger.info(
                "ws forward discovery:home client=%s seq=%s type=%s slug=%s",
                client, sent, message.get("type"), message.get("slug"),
            )
            await ws.send_json(message)
    except WebSocketDisconnect:
        logger.info(
            "ws disconnect discovery:home client=%s sent=%s", client, sent,
        )
    except Exception:
        logger.exception(
            "ws error discovery:home client=%s sent=%s", client, sent,
        )
        raise


@router.websocket("/ws/discovery/events/{slug}")
async def discovery_event_ws(ws: WebSocket, slug: str) -> None:
    """Visibility-gated: drafts close 4403 to anonymous viewers.

    The handshake mirrors the detail-page rule (`can_subscribe_event_slug`),
    so the WS upgrades succeed for the same slugs the HTML page renders.
    Unknown slugs are treated like drafts — closed 4403 — so visibility
    predicates leak no information about whether a draft exists at the URL.
    """

    await ws.accept()
    client = ws.client

    season = await in_thread(resolve_slug, slug)
    viewer = await _viewer_from_ws(ws)
    if season is None or not can_subscribe_event_slug(viewer, season):
        logger.info(
            "ws reject discovery:slug=%s client=%s reason=visibility",
            slug, client,
        )
        await ws.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    # Drafts only fan out on the staff channel; public/unlisted use the
    # public channel. Picking the right channel is what makes staff
    # subscribers see live updates on a draft.
    if season.visibility == "draft" and viewer.is_staff:
        channel = f"events:slug:{slug}:staff"
    else:
        channel = f"events:slug:{slug}"
    logger.info("ws connect discovery:slug=%s client=%s", slug, client)
    sent = 0
    try:
        async for message in subscribe(channel):
            sent += 1
            logger.info(
                "ws forward discovery:slug=%s client=%s seq=%s type=%s",
                slug, client, sent, message.get("type"),
            )
            await ws.send_json(message)
    except WebSocketDisconnect:
        logger.info(
            "ws disconnect discovery:slug=%s client=%s sent=%s",
            slug, client, sent,
        )
    except Exception:
        logger.exception(
            "ws error discovery:slug=%s client=%s sent=%s",
            slug, client, sent,
        )
        raise
