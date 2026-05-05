"""Single multiplexed WebSocket endpoint.

Per CLAUDE.md rule 6 ("every page is real-time") the browser opens a
**single** WebSocket per page and subscribes to one or more hierarchical
channels over it. The server fans matching pubsub events down the same
socket; permission is checked per-channel at subscribe time.

Wire protocol (JSON, both directions)::

    client -> server
        {"type": "subscribe",   "channel": "<name>"}
        {"type": "unsubscribe", "channel": "<name>"}

    server -> client
        {"type": "subscribed",       "channel": "<name>"}
        {"type": "unsubscribed",     "channel": "<name>"}
        {"type": "subscribe.error",  "channel": "<name>", "reason": "<code>"}
        {"type": "event",            "channel": "<name>", "payload": {...}}

Channels are matched against a registry of ``ChannelSpec`` regexes; the
spec resolves the backing Redis pubsub channel(s), authorizes the
viewer, and optionally transforms each Redis message before it is
forwarded to the client. One client channel may fan in multiple Redis
channels (e.g. the cockpit channel composes match.update + round.update
+ management.update from three separate publishers).

This module is the **only** WebSocket endpoint the app exposes. Old
per-page endpoints (``/ws/jobs/*``, ``/ws/discovery/*``, etc.) have
been deleted; use a channel name instead.
"""

from __future__ import annotations

import asyncio
import logging
import re
from dataclasses import dataclass
from typing import Any, Awaitable, Callable

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from heltour.api.deps import in_thread
from heltour.api.shared.auth import Viewer, _resolve_viewer_sync
from heltour.api.shared.pubsub import subscribe

logger = logging.getLogger("heltour.api.shared.ws_multiplex")
router = APIRouter()


# ---------- registry types -----------------------------------------------------


@dataclass
class ChannelContext:
    """Per-connection state passed to authorize/transform hooks."""

    viewer: Viewer
    user: Any  # Django User or None — kept loose to avoid import cycles


# A backing source: a Redis channel name plus an optional sync transform
# applied to each envelope before it is forwarded.
#
# The transform receives ``(ctx, channel_match_groups, raw_message)`` and
# may return a replacement dict, ``None`` to drop the envelope, or raise
# to drop and log. Transforms run on a worker thread so they may do
# blocking ORM work (cockpit enrichment etc.).
@dataclass
class BackingSource:
    redis_channel: str
    transform: (
        Callable[[ChannelContext, dict[str, str], dict[str, Any]], dict[str, Any] | None] | None
    ) = None


@dataclass
class ChannelSpec:
    """One client-facing channel pattern.

    ``pattern`` is a full-match regex with named groups. ``open`` is the
    single hook the multiplex calls on subscribe: it returns a list of
    backing Redis sources (with optional transforms) on success, or
    a non-list value to deny:
      * a string  → used as the wire-level ``reason`` for the
        ``subscribe.error`` envelope (e.g. ``"round_does_not_exist"``).
      * ``None``  → generic ``"forbidden"`` denial.

    Surfacing the specific reason lets the client log a useful diagnostic
    without round-tripping through server logs.
    """

    pattern: re.Pattern[str]
    open: Callable[[ChannelContext, dict[str, str]], Awaitable[list[BackingSource] | str | None]]


_REGISTRY: list[ChannelSpec] = []


def register(spec: ChannelSpec) -> None:
    _REGISTRY.append(spec)


def _match_spec(channel: str) -> tuple[ChannelSpec, dict[str, str]] | None:
    for spec in _REGISTRY:
        m = spec.pattern.fullmatch(channel)
        if m is not None:
            return spec, m.groupdict()
    return None


# ---------- per-channel forwarders --------------------------------------------


async def _forward_one_source(
    ws: WebSocket,
    ctx: ChannelContext,
    channel: str,
    groups: dict[str, str],
    source: BackingSource,
    send_lock: asyncio.Lock,
) -> None:
    """Pump a single Redis channel into the client websocket.

    Uses ``send_lock`` because FastAPI's WebSocket isn't safe under
    concurrent ``send_*`` calls — multiple sources or the control loop
    might otherwise race a partial frame.
    """
    try:
        async for message in subscribe(source.redis_channel):
            logger.info(
                "ws received channel=%s redis=%s type=%s",
                channel,
                source.redis_channel,
                message.get("type") if isinstance(message, dict) else None,
            )
            if source.transform is not None:
                try:
                    transformed = await in_thread(source.transform, ctx, groups, message)
                except Exception:
                    logger.exception(
                        "ws transform failed channel=%s redis=%s",
                        channel,
                        source.redis_channel,
                    )
                    continue
                if transformed is None:
                    logger.info(
                        "ws transform dropped channel=%s redis=%s in_type=%s",
                        channel,
                        source.redis_channel,
                        message.get("type") if isinstance(message, dict) else None,
                    )
                    continue
                payload = transformed
            else:
                payload = message
            logger.info(
                "ws forward channel=%s out_type=%s",
                channel,
                payload.get("type") if isinstance(payload, dict) else None,
            )
            async with send_lock:
                await ws.send_json({"type": "event", "channel": channel, "payload": payload})
    except asyncio.CancelledError:
        raise
    except Exception:
        logger.exception(
            "ws forward error channel=%s redis=%s",
            channel,
            source.redis_channel,
        )


@dataclass
class _Subscription:
    channel: str
    tasks: list[asyncio.Task[None]]

    def cancel(self) -> None:
        for t in self.tasks:
            t.cancel()


async def _open_subscription(
    ws: WebSocket,
    ctx: ChannelContext,
    channel: str,
    sources: list[BackingSource],
    groups: dict[str, str],
    send_lock: asyncio.Lock,
) -> _Subscription:
    tasks = [
        asyncio.create_task(
            _forward_one_source(ws, ctx, channel, groups, src, send_lock),
            name=f"ws-fwd:{channel}:{src.redis_channel}",
        )
        for src in sources
    ]
    return _Subscription(channel=channel, tasks=tasks)


# ---------- /ws endpoint -------------------------------------------------------


async def _resolve_viewer_from_ws(ws: WebSocket) -> tuple[Viewer, Any]:
    from django.conf import settings

    cookie_name = settings.SESSION_COOKIE_NAME
    session_key = ws.cookies.get(cookie_name)
    return await in_thread(_resolve_viewer_sync, session_key)


@router.websocket("/ws")
async def multiplex_ws(ws: WebSocket) -> None:
    # Make sure all channel specs are registered. Importing the module
    # triggers the registration calls at the bottom of this file; the
    # explicit import here protects against import order surprises in
    # uvicorn workers.
    _ensure_registry_loaded()

    await ws.accept()
    viewer, user = await _resolve_viewer_from_ws(ws)
    ctx = ChannelContext(viewer=viewer, user=user)
    send_lock = asyncio.Lock()
    subs: dict[str, _Subscription] = {}
    client = ws.client
    logger.info(
        "ws connect client=%s authed=%s user=%s",
        client,
        viewer.is_authenticated,
        viewer.user_id,
    )

    try:
        while True:
            raw = await ws.receive_json()
            if not isinstance(raw, dict):
                continue
            kind = raw.get("type")
            channel = raw.get("channel")
            if not isinstance(channel, str) or not channel:
                continue

            if kind == "subscribe":
                if channel in subs:
                    async with send_lock:
                        await ws.send_json({"type": "subscribed", "channel": channel})
                    continue
                matched = _match_spec(channel)
                if matched is None:
                    async with send_lock:
                        await ws.send_json(
                            {
                                "type": "subscribe.error",
                                "channel": channel,
                                "reason": "unknown_channel",
                            }
                        )
                    continue
                spec, groups = matched
                try:
                    result: list[BackingSource] | str | None = await spec.open(ctx, groups)
                except Exception as exc:
                    import traceback as _tb

                    tb_text = _tb.format_exc()
                    logger.error("ws open raised channel=%s\n%s", channel, tb_text)
                    last_lines = "\n".join(tb_text.splitlines()[-12:])
                    result = f"open_raised:{type(exc).__name__}:{exc}\n--- tail ---\n{last_lines}"
                if not isinstance(result, list):
                    reason = result if isinstance(result, str) else "forbidden"
                    async with send_lock:
                        await ws.send_json(
                            {"type": "subscribe.error", "channel": channel, "reason": reason}
                        )
                    continue
                sub = await _open_subscription(ws, ctx, channel, result, groups, send_lock)
                subs[channel] = sub
                async with send_lock:
                    await ws.send_json({"type": "subscribed", "channel": channel})
                logger.info("ws subscribe channel=%s user=%s", channel, viewer.user_id)
            elif kind == "unsubscribe":
                sub = subs.pop(channel, None)
                if sub is not None:
                    sub.cancel()
                    for t in sub.tasks:
                        try:
                            await t
                        except (asyncio.CancelledError, Exception):
                            pass
                async with send_lock:
                    await ws.send_json({"type": "unsubscribed", "channel": channel})
            else:
                # Unknown control message — ignore to keep the protocol
                # forward-compatible.
                continue
    except WebSocketDisconnect:
        logger.info("ws disconnect client=%s", client)
    except Exception:
        logger.exception("ws error client=%s", client)
    finally:
        for sub in subs.values():
            sub.cancel()
        for sub in subs.values():
            for t in sub.tasks:
                try:
                    await t
                except (asyncio.CancelledError, Exception):
                    pass


# ---------- channel registry ---------------------------------------------------
#
# Channels live close to their domain logic when possible — but the
# registry assembly happens here so a single import of this module is
# enough to surface every channel. ``_ensure_registry_loaded`` is
# idempotent and called at every connection accept.


_LOADED = False


def _ensure_registry_loaded() -> None:
    global _LOADED
    if _LOADED:
        return
    _LOADED = True
    _register_all()


def _register_all() -> None:
    # Local imports to avoid circular dependencies — the registrar
    # functions pull in domain-scoped permission helpers and DTO
    # builders that themselves import from heltour.api.
    from heltour.api.discovery.ws_channels import register as _disc
    from heltour.api.round_management.cockpit.ws_channels import register as _cockpit
    from heltour.api.round_management.ws_channels import register as _round
    from heltour.api.shared.ws_channels_jobs import register as _jobs

    _disc(register)
    _round(register)
    _cockpit(register)
    _jobs(register)


__all__ = [
    "BackingSource",
    "ChannelContext",
    "ChannelSpec",
    "register",
    "router",
]
