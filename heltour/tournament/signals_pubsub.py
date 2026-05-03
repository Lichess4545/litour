"""Redis pub/sub fan-out for live UI updates.

When a board pairing's result/game_link changes (or its players are swapped),
publishes a `match.update` event carrying the full current `MatchDTO` to
the `matches:round:{round_id}` channel. The FastAPI WebSocket layer
forwards that payload verbatim to subscribed browsers, which replace the
matching row in-place — no refetch, no diffing.

Team-match-level changes (score aggregates after a result is set) emit a
companion `team_match.update` event on the same channel.

Discovery (home + drill-in) gets its own `events:home` and
`events:slug:{slug}` channels, fanning out `event.update` /
`event.removed` envelopes carrying the full EventCardDTO / EventDetailDTO
so subscribed browsers replace state without a refetch.
"""

import json
import logging

import redis
from django.conf import settings
from django.db import transaction
from django.db.models.signals import post_delete, post_save
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


def _publish_match_update(match_dto, round_id: int) -> None:
    _publish(
        f"matches:round:{round_id}",
        {
            "type": "match.update",
            "round_id": round_id,
            "match": match_dto.model_dump(mode="json"),
        },
    )


def _publish_team_match_update(team_match_dto, round_id: int) -> None:
    _publish(
        f"matches:round:{round_id}",
        {
            "type": "team_match.update",
            "round_id": round_id,
            "team_match": team_match_dto.model_dump(mode="json"),
        },
    )


def _connect():
    from heltour.api.round_management.dto_builders import (
        captains_for_team_pairing,
        lone_player_pairing_to_match,
        team_pairing_to_team_match,
        team_player_pairing_to_match,
    )
    from heltour.tournament.models import (
        LonePlayerPairing,
        PlayerPairing,
        TeamPairing,
        TeamPlayerPairing,
    )

    def _round_for(instance):
        # Multi-table inheritance: instance may be the base PlayerPairing
        # or a subclass; reverse OneToOne relations let us reach the round
        # either way. Return (round_obj, league, concrete_pairing) — the
        # concrete subclass is needed so the DTO builders see the right
        # model fields (board_number, team_pairing_id, etc.).
        if isinstance(instance, TeamPlayerPairing):
            tp = instance.team_pairing
            return tp.round, tp.round.season.league, instance
        if isinstance(instance, LonePlayerPairing):
            return instance.round, instance.round.season.league, instance
        if hasattr(instance, "teamplayerpairing"):
            tpp = instance.teamplayerpairing
            return tpp.team_pairing.round, tpp.team_pairing.round.season.league, tpp
        if hasattr(instance, "loneplayerpairing"):
            lp = instance.loneplayerpairing
            return lp.round, lp.round.season.league, lp
        return None

    def _emit_match(instance) -> None:
        # Only emit when something visible changed — avoids a publish on
        # every save (e.g. unrelated admin edits).
        changed = (
            instance.result != instance.initial_result
            or instance.game_link != instance.initial_game_link
            or instance.white_id != instance.initial_white_id
            or instance.black_id != instance.initial_black_id
        )
        if not changed:
            return
        resolved = _round_for(instance)
        if resolved is None:
            logger.debug("no round for pairing=%s; skipping pubsub", instance.pk)
            return
        rnd, league, concrete = resolved
        if isinstance(concrete, TeamPlayerPairing):
            captains = captains_for_team_pairing(concrete.team_pairing)
            dto = team_player_pairing_to_match(concrete, league, captains)
        else:
            dto = lone_player_pairing_to_match(concrete, league)
        _publish_match_update(dto, rnd.pk)

    @receiver(post_save, sender=PlayerPairing, dispatch_uid="api_pp_event")
    def _base(sender, instance, **kwargs):
        _emit_match(instance)

    @receiver(post_save, sender=TeamPlayerPairing, dispatch_uid="api_team_pp_event")
    def _team(sender, instance, **kwargs):
        _emit_match(instance)

    @receiver(post_save, sender=LonePlayerPairing, dispatch_uid="api_lone_pp_event")
    def _lone(sender, instance, **kwargs):
        _emit_match(instance)

    @receiver(post_save, sender=TeamPairing, dispatch_uid="api_team_pairing_event")
    def _team_match(sender, instance, **kwargs):
        # TeamPairing.save recomputes white_points/black_points whenever a
        # child board's result changes; we publish the resulting aggregate
        # so the team-match header score in the UI updates without needing
        # to refetch the round.
        try:
            dto = team_pairing_to_team_match(instance)
        except Exception:
            logger.exception("failed to build TeamMatchDTO pk=%s", instance.pk)
            return
        _publish_team_match_update(dto, instance.round_id)


_connect()


# ---------- Discovery domain fan-out ------------------------------------------
#
# Channels:
#   events:home              — list-level changes (visible card list)
#   events:slug:{slug}       — one event's detail surface
#
# Envelopes:
#   {"type": "event.update",  "slug": str, "card":   EventCardDTO}     (events:home)
#   {"type": "event.update",  "slug": str, "detail": EventDetailDTO}   (events:slug:{slug})
#   {"type": "event.removed", "slug": str, "reason": str}              (both channels)
#
# Visibility rules (matches `discovery.permissions`):
#   public   → home + slug channels both fire.
#   unlisted → only the slug channel fires (home stays narrow).
#   draft    → no fan-out (drafts are admin-only via Django admin).
# A visibility transition from public→{unlisted,draft} fires `event.removed`
# on `events:home` so subscribers prune the card; the slug channel keeps
# firing if the new state is still readable through the slug surface.


def _annotated_season(season):
    """Re-fetch via the annotated queryset so build_card / status_group
    don't fall back to N+1 round queries inside the signal handler."""

    from heltour.api.discovery.permissions import visible_queryset
    from heltour.api.shared.auth import Viewer

    return (
        visible_queryset(Viewer.anonymous())
        .filter(pk=season.pk)
        .first()
    )


def _discovery_publish_card(season) -> None:
    if not season.slug:
        return
    from heltour.api.discovery.services import build_card

    annotated = _annotated_season(season)
    if annotated is None:
        return
    try:
        card = build_card(annotated)
    except Exception:
        logger.exception("discovery: build_card failed slug=%s", season.slug)
        return
    _publish(
        "events:home",
        {
            "type": "event.update",
            "slug": season.slug,
            "card": card.model_dump(mode="json"),
        },
    )


def _discovery_publish_detail(season) -> None:
    if not season.slug:
        return
    from heltour.api.discovery.services import get_event_with_tabs
    from heltour.api.shared.auth import Viewer

    try:
        detail = get_event_with_tabs(season.slug, Viewer.anonymous())
    except Exception:
        logger.exception("discovery: get_event_with_tabs failed slug=%s", season.slug)
        return
    if detail is None:
        return
    _publish(
        f"events:slug:{season.slug}",
        {
            "type": "event.update",
            "slug": season.slug,
            "detail": detail.model_dump(mode="json"),
        },
    )


def _discovery_publish_staff_detail(season) -> None:
    """Publish to the staff-only slug channel for drafts.

    Mirrors `_discovery_publish_detail` but bypasses anon visibility so
    staff WS subscribers on a draft slug get live updates.
    """

    if not season.slug:
        return
    from heltour.api.discovery.services import build_header

    try:
        header = build_header(season)
    except Exception:
        logger.exception("discovery: build_header failed slug=%s", season.slug)
        return
    _publish(
        f"events:slug:{season.slug}:staff",
        {
            "type": "event.update",
            "slug": season.slug,
            "detail": {
                "header": header.model_dump(mode="json"),
                "tabs_available": [],
                "pairings": None,
            },
        },
    )


def _discovery_publish_removed(slug: str, reason: str) -> None:
    if not slug:
        return
    payload = {"type": "event.removed", "slug": slug, "reason": reason}
    _publish("events:home", payload)
    _publish(f"events:slug:{slug}", payload)


def _on_commit(fn) -> None:
    """Run a publish on transaction commit, or immediately if no tx is open."""

    try:
        transaction.on_commit(fn)
    except transaction.TransactionManagementError:
        fn()


def _discovery_connect():
    from heltour.tournament.models import Registration, Round, Season, SeasonPlayer

    def _fan_out(season, *, prior_visibility=None):
        slug = season.slug
        new = season.visibility
        leaving_public = prior_visibility == "public" and new != "public"

        if leaving_public:
            _publish(
                "events:home",
                {
                    "type": "event.removed",
                    "slug": slug,
                    "reason": "visibility_change",
                },
            )
        elif new == "public":
            _discovery_publish_card(season)

        if new in ("public", "unlisted"):
            _discovery_publish_detail(season)
        elif new == "draft":
            _discovery_publish_staff_detail(season)

    @receiver(post_save, sender=Season, dispatch_uid="discovery_season_post_save")
    def _season_saved(sender, instance, created, **kwargs):
        prior = getattr(instance, "initial_visibility", instance.visibility)
        snapshot_pk = instance.pk
        instance.initial_visibility = instance.visibility

        def _run():
            from heltour.tournament.models import Season as SeasonModel

            fresh = SeasonModel.objects.filter(pk=snapshot_pk).first()
            if fresh is None:
                return
            _fan_out(fresh, prior_visibility=prior)

        _on_commit(_run)

    @receiver(post_delete, sender=Season, dispatch_uid="discovery_season_post_delete")
    def _season_deleted(sender, instance, **kwargs):
        slug = instance.slug
        _on_commit(lambda: _discovery_publish_removed(slug, "deleted"))

    @receiver(post_save, sender=Round, dispatch_uid="discovery_round_post_save")
    def _round_saved(sender, instance, **kwargs):
        season_pk = instance.season_id

        def _run():
            from heltour.tournament.models import Season as SeasonModel

            season = SeasonModel.objects.filter(pk=season_pk).first()
            if season is None:
                return
            _fan_out(season)

        _on_commit(_run)

    @receiver(post_save, sender=SeasonPlayer, dispatch_uid="discovery_sp_post_save")
    def _sp_saved(sender, instance, **kwargs):
        season_pk = instance.season_id

        def _run():
            from heltour.tournament.models import Season as SeasonModel

            season = SeasonModel.objects.filter(pk=season_pk).first()
            if season is None:
                return
            _fan_out(season)

        _on_commit(_run)

    @receiver(post_save, sender=Registration, dispatch_uid="discovery_reg_post_save")
    def _reg_saved(sender, instance, **kwargs):
        season_pk = instance.season_id

        def _run():
            from heltour.tournament.models import Season as SeasonModel

            season = SeasonModel.objects.filter(pk=season_pk).first()
            if season is None:
                return
            _fan_out(season)

        _on_commit(_run)


_discovery_connect()
