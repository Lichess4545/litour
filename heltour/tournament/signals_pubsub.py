import json
import logging

import redis
from django.conf import settings
from django.db.models.signals import post_save
from django.dispatch import receiver

logger = logging.getLogger(__name__)

_client: redis.Redis | None = None


def _get_client() -> redis.Redis:
    global _client
    if _client is None:
        _client = redis.Redis.from_url(settings.REDIS_URL, decode_responses=True)
    return _client


def _publish(channel: str, payload: dict) -> None:
    try:
        _get_client().publish(channel, json.dumps(payload))
    except Exception:
        logger.exception("pubsub publish failed channel=%s", channel)


def _publish_pairing_event(event_type: str, pairing, round_id: int) -> None:
    _publish(
        f"pairings:round:{round_id}",
        {
            "type": event_type,
            "pairing_id": pairing.pk,
            "round_id": round_id,
            "result": pairing.result,
            "game_link": pairing.game_link,
            "white_username": pairing.white.lichess_username if pairing.white else None,
            "black_username": pairing.black.lichess_username if pairing.black else None,
        },
    )


def _emit(instance, round_id: int) -> None:
    if instance.result != instance.initial_result:
        _publish_pairing_event("pairing.result", instance, round_id)
    if instance.game_link != instance.initial_game_link:
        _publish_pairing_event("pairing.game_link", instance, round_id)


def _connect():
    from heltour.tournament.models import (
        LonePlayerPairing,
        PlayerPairing,
        TeamPlayerPairing,
    )

    def _round_id_for(instance) -> int | None:
        # Multi-table inheritance: instance may be the base PlayerPairing or a
        # subclass; reverse OneToOne relations let us reach the round either way.
        if isinstance(instance, TeamPlayerPairing):
            return instance.team_pairing.round_id
        if isinstance(instance, LonePlayerPairing):
            return instance.round_id
        if hasattr(instance, "teamplayerpairing"):
            return instance.teamplayerpairing.team_pairing.round_id
        if hasattr(instance, "loneplayerpairing"):
            return instance.loneplayerpairing.round_id
        return None

    def _handle(instance) -> None:
        round_id = _round_id_for(instance)
        if round_id is None:
            logger.debug("no round for pairing=%s; skipping pubsub", instance.pk)
            return
        _emit(instance, round_id)

    @receiver(post_save, sender=PlayerPairing, dispatch_uid="api_pp_event")
    def _base(sender, instance, **kwargs):
        _handle(instance)

    @receiver(post_save, sender=TeamPlayerPairing, dispatch_uid="api_team_pp_event")
    def _team(sender, instance, **kwargs):
        _handle(instance)

    @receiver(post_save, sender=LonePlayerPairing, dispatch_uid="api_lone_pp_event")
    def _lone(sender, instance, **kwargs):
        _handle(instance)


_connect()
