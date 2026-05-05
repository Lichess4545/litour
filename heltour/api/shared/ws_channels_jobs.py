"""Channel registrar for jobs feed + queue lag.

Channels:

  * ``jobs:all``                   — every job (staff only)
  * ``jobs:season:{slug}``         — jobs for one season (dashboard perm)
  * ``jobs:league:{tag}``          — jobs for one league (dashboard perm)
  * ``system:queue_lag``           — Beat canary lag snapshot (any signed-in)

Backing Redis channels follow the publisher conventions in
``heltour/tournament/signals_pubsub.py`` and ``heltour/api/shared/jobs.py``.
The publisher emits to numeric pks (``jobs:season:42``); the client-facing
slug/tag aliases are resolved here so URLs stay human-readable.
"""

from __future__ import annotations

import re
from typing import Callable

from heltour.api.deps import in_thread
from heltour.api.shared.jobs_lag import LAG_CHANNEL
from heltour.api.shared.ws_multiplex import (
    BackingSource,
    ChannelContext,
    ChannelSpec,
)


def _resolve_season_pk_sync(slug: str, user) -> int | None:
    from heltour.api.shared.models import Season

    try:
        season = Season.objects.select_related("league").get(slug=slug)
    except Season.DoesNotExist:
        return None
    if user is None or not getattr(user, "is_authenticated", False):
        return None
    if not user.has_perm("tournament.view_dashboard", season.league):
        return None
    return season.pk


def _resolve_league_pk_sync(tag: str, user) -> int | None:
    from heltour.api.shared.models import League

    try:
        league = League.objects.get(tag=tag)
    except League.DoesNotExist:
        return None
    if user is None or not getattr(user, "is_authenticated", False):
        return None
    if not user.has_perm("tournament.view_dashboard", league):
        return None
    return league.pk


def register(register_spec: Callable[[ChannelSpec], None]) -> None:
    async def _open_lag(ctx: ChannelContext, _groups: dict[str, str]):
        if not ctx.viewer.is_authenticated:
            return None
        return [BackingSource(redis_channel=LAG_CHANNEL)]

    register_spec(
        ChannelSpec(
            pattern=re.compile(r"^system:queue_lag$"),
            open=_open_lag,
        )
    )

    async def _open_jobs_all(ctx: ChannelContext, _groups: dict[str, str]):
        if not (ctx.viewer.is_authenticated and ctx.viewer.is_staff):
            return None
        return [BackingSource(redis_channel="jobs:all")]

    register_spec(
        ChannelSpec(
            pattern=re.compile(r"^jobs:all$"),
            open=_open_jobs_all,
        )
    )

    async def _open_jobs_season(ctx: ChannelContext, groups: dict[str, str]):
        slug = groups["slug"]
        pk = await in_thread(_resolve_season_pk_sync, slug, ctx.user)
        if pk is None:
            return None
        return [BackingSource(redis_channel=f"jobs:season:{pk}")]

    register_spec(
        ChannelSpec(
            pattern=re.compile(r"^jobs:season:(?P<slug>[\w\-]+)$"),
            open=_open_jobs_season,
        )
    )

    async def _open_jobs_league(ctx: ChannelContext, groups: dict[str, str]):
        tag = groups["tag"]
        pk = await in_thread(_resolve_league_pk_sync, tag, ctx.user)
        if pk is None:
            return None
        return [BackingSource(redis_channel=f"jobs:league:{pk}")]

    register_spec(
        ChannelSpec(
            pattern=re.compile(r"^jobs:league:(?P<tag>[\w\-]+)$"),
            open=_open_jobs_league,
        )
    )
