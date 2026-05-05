"""Channel registrar for the cockpit (round-management).

Client-facing channels:

  * ``cockpit:event:{slug}:round:{round_id}``
        Combined cockpit feed for one (event, round). Aggregates three
        backing Redis publishers and transforms each into the cockpit
        envelope shape so the client only deals with one stream.

  * ``permissions:user:{user_id}``
        Self-only fan-out of permission-change events. The cockpit
        client subscribes alongside the cockpit channel so it can react
        (redirect / re-handshake) when its own perms change.

Backing Redis channels and transforms:

  * ``matches:round:{round_id}``
        Per-pairing match.update events. ``_enrich_match_envelope``
        below shapes them into ``cockpit.match.update``.

  * ``cockpit:season:{season_pk}``
        Season-scoped cockpit pushes — round transitions, management
        bundle updates. Filtered to events affecting ``round_id`` (or
        global season-wide events). Pass through unchanged otherwise.
"""

from __future__ import annotations

import logging
import re
from typing import Any, Callable

from heltour.api.deps import in_thread
from heltour.api.shared.ws_multiplex import (
    BackingSource,
    ChannelContext,
    ChannelSpec,
)

logger = logging.getLogger("heltour.api.round_management.cockpit.ws_channels")


def _resolve_cockpit_target_sync(slug: str, round_id: int) -> tuple[int, int] | str:
    """Return ``(season_pk, round_pk)`` on success, or a denial reason.

    No permission gate at the channel level — the cockpit GET endpoint
    (and the SSR page) accepts any viewer and lets the per-viewer DTO
    builder filter management/intervention bits via
    ``_build_management_sync`` and ``_viewer_dto``. The WS shows
    whatever the page already shows.

    Uses ``values_list`` to fetch raw column values rather than
    instantiating model objects — keeps the path off any model __init__
    / property side-effects and reduces the surface for unrelated
    bugs in the ORM layer.
    """
    from heltour.api.shared.models import Round, Season

    season_pk = (
        Season.objects.filter(slug=slug).values_list("pk", flat=True).first()
    )
    if season_pk is None:
        logger.warning("cockpit subscribe denied: slug=%r not found", slug)
        return "slug_not_found"
    row = (
        Round.objects.filter(pk=round_id)
        .values_list("pk", "season_id")
        .first()
    )
    if row is None:
        logger.warning(
            "cockpit subscribe denied slug=%r round_id=%s reason=round_does_not_exist",
            slug,
            round_id,
        )
        return "round_does_not_exist"
    rnd_pk, rnd_season_id = row
    if rnd_season_id != season_pk:
        logger.warning(
            "cockpit subscribe denied slug=%r season_pk=%s round_id=%s round_season_id=%s reason=round_in_different_season",
            slug,
            season_pk,
            round_id,
            rnd_season_id,
        )
        return "round_in_different_season"
    return int(season_pk), int(rnd_pk)


def _attention_count_for_round(round_id: int) -> int:
    """Recompute needs-you count for the round.

    Cheap because the per-round pairing set is small (≤ 40 in realistic
    deployments). Pulls raw column values via ``values_list`` to keep
    the path off Django's heavier ORM machinery — this transform runs
    on the WS hot path and a stray ``RecursionError`` here drops the
    push silently. Returns 0 on any error rather than blocking the
    push.
    """
    from django.utils import timezone

    from heltour.api.round_management.cockpit.attention import (
        AttentionInput,
        compute_attention,
    )
    from heltour.api.shared.models import (
        LonePlayerPairing,
        Round,
        Season,
        TeamPlayerPairing,
    )

    try:
        round_row = (
            Round.objects.filter(pk=round_id)
            .values_list("end_date", "season_id")
            .first()
        )
        if round_row is None:
            return 0
        deadline, season_id = round_row
        if deadline is None:
            return 0
        boards = (
            Season.objects.filter(pk=season_id)
            .values_list("boards", flat=True)
            .first()
        )
        is_team = boards is not None
        rows = (
            TeamPlayerPairing.objects.filter(team_pairing__round_id=round_id)
            .values_list("result", "game_link", "scheduled_time")
            if is_team
            else LonePlayerPairing.objects.filter(round_id=round_id)
            .values_list("result", "game_link", "scheduled_time")
        )
        rows = list(rows)
    except Exception:
        logger.exception("attention count lookup failed round=%s", round_id)
        return 0

    now = timezone.now()
    count = 0
    for result, game_link, scheduled_time in rows:
        out = compute_attention(
            AttentionInput(
                has_result=bool(result),
                has_game_link=bool(game_link),
                scheduled_at=scheduled_time,
            ),
            now=now,
            round_deadline=deadline,
        )
        if out.level in ("act", "watch"):
            count += 1
    return count


def _enrich_match_envelope(message: dict[str, Any], round_id: int) -> dict[str, Any] | None:
    """Convert a base ``match.update`` envelope into ``cockpit.match.update``.

    Returns ``None`` if enrichment fails or the envelope is non-match
    (the multiplex layer drops it). The publisher already serializes
    a complete ``MatchDTO`` into ``message["match"]`` — we don't
    re-resolve the concrete pairing, we just compute attention and
    version from a tiny ``values()`` lookup. This keeps the WS
    transform off the heavy ``select_related`` path that has bitten
    us with ``RecursionError`` from inside Django's lookup machinery
    on this codebase.
    """
    from django.utils import timezone

    from heltour.api.round_management.cockpit.attention import (
        AttentionInput,
        compute_attention,
    )
    from heltour.api.round_management.cockpit.schemas import AttentionDTO
    from heltour.api.round_management.cockpit.service import _last_event_id_for
    from heltour.api.shared.models import (
        LonePlayerPairing,
        Round,
        TeamPlayerPairing,
    )

    def _epoch_ms(dt) -> int:
        return int(dt.timestamp() * 1000) if dt is not None else 0

    if message.get("type") != "match.update":
        return None
    raw_match = message.get("match")
    if not isinstance(raw_match, dict):
        return None
    pairing_id = raw_match.get("id")
    if not isinstance(pairing_id, int):
        return None

    try:
        row = (
            TeamPlayerPairing.objects.filter(pk=pairing_id)
            .values_list("scheduled_time", "date_modified")
            .first()
        )
        if row is None:
            row = (
                LonePlayerPairing.objects.filter(pk=pairing_id)
                .values_list("scheduled_time", "date_modified")
                .first()
            )
        if row is None:
            return None
        scheduled_time, date_modified = row
        round_end = (
            Round.objects.filter(pk=round_id)
            .values_list("end_date", flat=True)
            .first()
        )
    except Exception:
        logger.exception("cockpit ws enrich lookup failed pairing=%s", pairing_id)
        return None

    if round_end is None:
        attention = AttentionDTO(level="none", reasons=[])
    else:
        out = compute_attention(
            AttentionInput(
                has_result=bool(raw_match.get("result")),
                has_game_link=bool(raw_match.get("game_link")),
                scheduled_at=scheduled_time,
            ),
            now=timezone.now(),
            round_deadline=round_end,
        )
        attention = AttentionDTO(
            level=out.level,
            reasons=[r.value for r in out.reasons],
        )

    enriched_match = {
        **raw_match,
        "attention": attention.model_dump(),
        "scheduled_at": scheduled_time.isoformat() if scheduled_time else None,
        "version": _epoch_ms(date_modified),
    }

    return {
        "type": "cockpit.match.update",
        "round_id": round_id,
        "match": enriched_match,
        "needs_you_count": _attention_count_for_round(round_id),
        "last_event_id": _last_event_id_for(round_id),
    }


def _cockpit_match_transform(
    _ctx: ChannelContext, groups: dict[str, str], message: dict[str, Any]
) -> dict[str, Any] | None:
    """Convert ``match.update`` → ``cockpit.match.update`` enrichment."""
    round_id = int(groups["round_id"])
    return _enrich_match_envelope(message, round_id)


def _cockpit_season_transform(
    ctx: ChannelContext, groups: dict[str, str], message: dict[str, Any]
) -> dict[str, Any] | None:
    """Convert season-scoped cockpit signals into per-subscriber snapshots.

    The publisher emits a bare ``cockpit.invalidate`` envelope on any
    state change that affects the cockpit DTO. This transform rebuilds
    the full DTO for the subscriber's viewer + round and emits it as a
    ``cockpit.snapshot`` so the client can replace state in one shot.

    Rebuilding here (rather than at the publisher) keeps the publisher
    cheap and lets us apply each subscriber's own permission/round
    context — viewer.can_change, round-scoped primary_action, etc.
    """
    msg_type = message.get("type")
    if msg_type != "cockpit.invalidate":
        return None

    slug = groups["slug"]
    round_id = int(groups["round_id"])
    from heltour.api.round_management.cockpit.service import (
        build_cockpit_for_round_id_sync,
    )

    try:
        dto = build_cockpit_for_round_id_sync(slug, round_id, ctx.viewer, ctx.user)
    except Exception:
        logger.exception(
            "cockpit snapshot rebuild failed slug=%s round_id=%s",
            slug,
            round_id,
        )
        return None
    logger.info(
        "cockpit snapshot rebuilt slug=%s round_id=%s mode=%s is_completed=%s",
        slug,
        round_id,
        dto.mode,
        dto.is_completed,
    )
    return {
        "type": "cockpit.snapshot",
        "round_id": round_id,
        "dto": dto.model_dump(mode="json"),
    }


def register(register_spec: Callable[[ChannelSpec], None]) -> None:
    async def _open_cockpit(_ctx: ChannelContext, groups: dict[str, str]):
        slug = groups["slug"]
        try:
            round_id = int(groups["round_id"])
        except ValueError:
            return "bad_round_id"
        target = await in_thread(_resolve_cockpit_target_sync, slug, round_id)
        if isinstance(target, str):
            return target
        season_pk, _ = target
        return [
            BackingSource(
                redis_channel=f"matches:round:{round_id}",
                transform=_cockpit_match_transform,
            ),
            BackingSource(
                redis_channel=f"cockpit:season:{season_pk}",
                transform=_cockpit_season_transform,
            ),
        ]

    register_spec(
        ChannelSpec(
            pattern=re.compile(r"^cockpit:event:(?P<slug>[\w\-]+):round:(?P<round_id>\d+)$"),
            open=_open_cockpit,
        )
    )

    async def _open_permissions(ctx: ChannelContext, groups: dict[str, str]):
        try:
            user_id = int(groups["user_id"])
        except ValueError:
            return None
        # Self-only: a user may subscribe to their own permission-change
        # stream and nothing else. Staff override is intentionally not
        # granted here — staff already see admin tooling for the same
        # data — and would otherwise widen the channel's purpose.
        if not ctx.viewer.is_authenticated or ctx.viewer.user_id != user_id:
            return None
        return [BackingSource(redis_channel=f"permissions:user:{user_id}")]

    register_spec(
        ChannelSpec(
            pattern=re.compile(r"^permissions:user:(?P<user_id>\d+)$"),
            open=_open_permissions,
        )
    )
