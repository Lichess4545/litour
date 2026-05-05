"""Channel registrar for the public round-management surface.

Channel:

  * ``matches:round:{round_id}``  — board pairings for one round.

This is the substrate the public ``/{league}/{event}/round/{n}/matches``
page consumes. No auth gate today (matches are public on a published
round) — visibility tightening lives behind the discovery layer's
event-level predicates, which the publisher already enforces by only
emitting on rounds whose season is publicly readable.
"""

from __future__ import annotations

import re
from typing import Callable

from heltour.api.shared.ws_multiplex import (
    BackingSource,
    ChannelContext,
    ChannelSpec,
)


def register(register_spec: Callable[[ChannelSpec], None]) -> None:
    async def _open_matches(_ctx: ChannelContext, groups: dict[str, str]):
        round_id = int(groups["round_id"])
        return [BackingSource(redis_channel=f"matches:round:{round_id}")]

    register_spec(
        ChannelSpec(
            pattern=re.compile(r"^matches:round:(?P<round_id>\d+)$"),
            open=_open_matches,
        )
    )
