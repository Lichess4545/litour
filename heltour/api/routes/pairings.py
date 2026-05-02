import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from heltour.api.pubsub import subscribe

logger = logging.getLogger("heltour.api.pairings")
router = APIRouter()


@router.websocket("/ws/pairings/{round_id}")
async def pairings_ws(ws: WebSocket, round_id: int) -> None:
    await ws.accept()
    channel = f"pairings:round:{round_id}"
    client = ws.client
    logger.info("ws connect round=%s client=%s", round_id, client)
    sent = 0
    try:
        async for message in subscribe(channel):
            sent += 1
            logger.info(
                "ws forward round=%s client=%s seq=%s type=%s",
                round_id, client, sent, message.get("type"),
            )
            await ws.send_json(message)
    except WebSocketDisconnect:
        logger.info(
            "ws disconnect round=%s client=%s sent=%s",
            round_id, client, sent,
        )
    except Exception:
        logger.exception(
            "ws error round=%s client=%s sent=%s",
            round_id, client, sent,
        )
        raise
