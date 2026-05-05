"""Channel registrar for the discovery domain.

Channels:

  * ``events:home``           — public event-card list (anonymous OK)
  * ``events:slug:{slug}``    — one event's detail surface (visibility-gated)

Drafts only fan out on the staff sub-channel; public/unlisted use the
public channel. The slug→channel decision matches the legacy
``heltour/api/discovery/ws.py`` so the wire shapes stay backward
compatible with `discovery-messages` on the frontend.
"""

from __future__ import annotations

import re
from typing import Callable

from heltour.api.deps import in_thread
from heltour.api.discovery.permissions import can_subscribe_event_slug
from heltour.api.discovery.services import resolve_slug
from heltour.api.shared.ws_multiplex import (
    BackingSource,
    ChannelContext,
    ChannelSpec,
)


def register(register_spec: Callable[[ChannelSpec], None]) -> None:
    async def _open_home(_ctx: ChannelContext, _groups: dict[str, str]):
        return [BackingSource(redis_channel="events:home")]

    register_spec(
        ChannelSpec(
            pattern=re.compile(r"^events:home$"),
            open=_open_home,
        )
    )

    async def _open_event(ctx: ChannelContext, groups: dict[str, str]):
        slug = groups["slug"]
        season = await in_thread(resolve_slug, slug)
        if season is None or not can_subscribe_event_slug(ctx.viewer, season):
            return None
        if season.visibility == "draft" and ctx.viewer.is_staff:
            channel_name = f"events:slug:{slug}:staff"
        else:
            channel_name = f"events:slug:{slug}"
        return [BackingSource(redis_channel=channel_name)]

    register_spec(
        ChannelSpec(
            pattern=re.compile(r"^events:slug:(?P<slug>[\w\-]+)$"),
            open=_open_event,
        )
    )
