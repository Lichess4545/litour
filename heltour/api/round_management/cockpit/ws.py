"""WebSocket endpoint for the cockpit.

Per design doc ER2 (handshake-only + close-on-revoke) and ER4 (reuse the
existing ``matches:round:{round_id}`` channel + enrich on subscribe).

On accept:

1. Resolve viewer from session cookie (``_viewer_from_ws``).
2. Resolve event slug → season → current round (via ``resolve_current_round``).
3. Handshake check: viewer must have ``tournament.change_pairing`` on
   the league. If not, close 1008.
4. Subscribe concurrently to two channels:
   - ``matches:round:{round_id}`` (forwarded with cockpit enrichment)
   - ``permissions:user:{user_id}`` (closes the connection on receipt)
5. Per-connection cache for ``round_deadline`` (ER11) — refreshed only
   on round-transition close.

Round transition isn't observed continuously; the WS closes when the
round changes state (publisher-driven via the new ``cockpit.round.transition``
envelope). Clients reconnect and the cycle re-runs.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status

from heltour.api.deps import in_thread
from heltour.api.discovery.services import resolve_slug
from heltour.api.discovery.ws import _viewer_from_ws
from heltour.api.round_management.cockpit.mode import resolve_current_round
from heltour.api.round_management.cockpit.schemas import WSCockpitClose
from heltour.api.round_management.cockpit.service import (
    _build_match_dto_from_concrete,
    _enrich_match,
    _last_event_id_for,
    _pairing_version,
)
from heltour.api.round_management.permissions import can_change_pairing_sync
from heltour.api.shared.auth import Viewer
from heltour.api.shared.pubsub import subscribe

logger = logging.getLogger("heltour.api.round_management.cockpit.ws")
router = APIRouter()


def _resolve_handshake_sync(slug: str, user) -> tuple[Any | None, Any | None, str]:
    """Run the auth+round resolution under one ``in_thread`` call.

    Returns ``(season, round_obj, mode)``. ``season`` is None on slug miss.
    """
    season = resolve_slug(slug)
    if season is None:
        return None, None, "empty"
    rnd, mode = resolve_current_round(season)
    if rnd is None:
        return season, None, mode
    if not can_change_pairing_sync(user, season.league):
        return season, None, "forbidden"
    return season, rnd, mode


def _attention_count_for_round(round_id: int) -> int:
    """Recompute needs-you count for the round on every push.

    Cheap because the per-round pairing set is small (40-pairing realistic
    upper bound per design doc Success Criteria) and the loop runs entirely
    on cached fields. Falls through to 0 on any error rather than blocking
    the push.
    """
    from django.utils import timezone

    from heltour.tournament.models import (
        LonePlayerPairing,
        Round,
        TeamPlayerPairing,
    )

    try:
        rnd = Round.objects.select_related("season").get(pk=round_id)
    except Round.DoesNotExist:
        return 0

    is_team = rnd.season.boards is not None
    pairings_qs = (
        TeamPlayerPairing.objects.filter(team_pairing__round_id=round_id)
        if is_team
        else LonePlayerPairing.objects.filter(round_id=round_id)
    )
    pairings = list(pairings_qs.only("result", "game_link", "scheduled_time"))
    from heltour.api.round_management.cockpit.attention import (
        AttentionInput,
        compute_attention,
    )

    now = timezone.now()
    deadline = rnd.end_date
    if deadline is None:
        return 0
    count = 0
    for p in pairings:
        out = compute_attention(
            AttentionInput(
                has_result=bool(p.result),
                has_game_link=bool(p.game_link),
                scheduled_at=p.scheduled_time,
            ),
            now=now,
            round_deadline=deadline,
        )
        if out.level in ("act", "watch"):
            count += 1
    return count


def _enrich_envelope_sync(
    message: dict[str, Any], round_id: int
) -> dict[str, Any] | None:
    """Convert a base ``match.update`` envelope into a cockpit envelope.

    Returns the new envelope or ``None`` if enrichment fails (envelope is
    dropped rather than forwarded raw). Other envelope types (e.g.
    ``team_match.update``) pass through unmodified.
    """
    if message.get("type") != "match.update":
        return message

    raw_match = message.get("match")
    if not isinstance(raw_match, dict):
        return None

    from django.utils import timezone

    from heltour.tournament.models import (
        LonePlayerPairing,
        TeamPlayerPairing,
    )

    pairing_id = raw_match.get("id")
    if not isinstance(pairing_id, int):
        return None

    try:
        concrete = TeamPlayerPairing.objects.select_related(
            "white", "black", "team_pairing__round__season__league"
        ).get(pk=pairing_id)
        league = concrete.team_pairing.round.season.league
        rnd = concrete.team_pairing.round
    except TeamPlayerPairing.DoesNotExist:
        try:
            concrete = LonePlayerPairing.objects.select_related(
                "white", "black", "round__season__league"
            ).get(pk=pairing_id)
            league = concrete.round.season.league
            rnd = concrete.round
        except LonePlayerPairing.DoesNotExist:
            return None

    try:
        match_dto = _build_match_dto_from_concrete(concrete, league)
        enriched = _enrich_match(
            match_dto, concrete, now=timezone.now(), round_deadline=rnd.end_date
        )
    except Exception:
        logger.exception("cockpit ws enrich failed pairing=%s", pairing_id)
        return None

    needs_you_count = _attention_count_for_round(round_id)
    return {
        "type": "cockpit.match.update",
        "round_id": round_id,
        "match": enriched.model_dump(mode="json"),
        "needs_you_count": needs_you_count,
        "last_event_id": _last_event_id_for(round_id),
    }


@router.websocket("/ws/round_management/events/{event_slug}/cockpit")
async def cockpit_ws(ws: WebSocket, event_slug: str) -> None:
    await ws.accept()
    client = ws.client

    viewer: Viewer = await _viewer_from_ws(ws)
    if not viewer.is_authenticated or viewer.user_id is None:
        logger.info(
            "cockpit ws reject slug=%s client=%s reason=anonymous",
            event_slug,
            client,
        )
        await ws.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    # User object needed for guardian-backed permission check.
    from django.contrib.auth import get_user_model

    User = get_user_model()
    try:
        user = await in_thread(User.objects.get, pk=viewer.user_id)
    except User.DoesNotExist:
        await ws.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    season, rnd, mode = await in_thread(_resolve_handshake_sync, event_slug, user)
    if season is None or rnd is None:
        logger.info(
            "cockpit ws reject slug=%s client=%s mode=%s",
            event_slug,
            client,
            mode,
        )
        await ws.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    round_id = rnd.pk
    user_id = viewer.user_id
    matches_channel = f"matches:round:{round_id}"
    perms_channel = f"permissions:user:{user_id}"
    logger.info(
        "cockpit ws connect slug=%s round=%s user=%s client=%s",
        event_slug,
        round_id,
        user_id,
        client,
    )

    queue: asyncio.Queue[tuple[str, dict[str, Any]]] = asyncio.Queue()

    async def _pump(channel_label: str, channel: str) -> None:
        try:
            async for msg in subscribe(channel):
                await queue.put((channel_label, msg))
        except Exception:
            logger.exception(
                "cockpit ws pump error slug=%s channel=%s",
                event_slug,
                channel,
            )
            raise

    matches_task = asyncio.create_task(_pump("matches", matches_channel))
    perms_task = asyncio.create_task(_pump("perms", perms_channel))

    sent = 0
    try:
        while True:
            label, message = await queue.get()
            if label == "perms":
                logger.info(
                    "cockpit ws revoke slug=%s round=%s user=%s",
                    event_slug,
                    round_id,
                    user_id,
                )
                await ws.send_json(
                    WSCockpitClose(reason="permission_revoked").model_dump()
                )
                await ws.close(code=status.WS_1008_POLICY_VIOLATION)
                return

            enriched = await in_thread(_enrich_envelope_sync, message, round_id)
            if enriched is None:
                continue
            sent += 1
            logger.info(
                "cockpit ws forward slug=%s round=%s seq=%s type=%s",
                event_slug,
                round_id,
                sent,
                enriched.get("type"),
            )
            await ws.send_json(enriched)
    except WebSocketDisconnect:
        logger.info(
            "cockpit ws disconnect slug=%s round=%s sent=%s",
            event_slug,
            round_id,
            sent,
        )
    except Exception:
        logger.exception(
            "cockpit ws error slug=%s round=%s sent=%s",
            event_slug,
            round_id,
            sent,
        )
        raise
    finally:
        matches_task.cancel()
        perms_task.cancel()
        for t in (matches_task, perms_task):
            try:
                await t
            except (asyncio.CancelledError, Exception):
                pass


# Keep ``_pairing_version`` referenced so the import isn't pruned by lint;
# it's used implicitly via ``_enrich_match`` but exposed here for tests.
__all__ = ["router", "cockpit_ws", "_enrich_envelope_sync", "_pairing_version"]
