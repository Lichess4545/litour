"""Cockpit mode resolution.

``resolve_current_round`` returns ``(round_obj | None, mode)`` for an
event (Season). Precedence per design doc ER7:

1. Round open with ``end_date > now`` → that round, mode=live
2. Else next round opens within 7 days → None, mode=pre_round
3. Else most recent completed round → that round, mode=history
4. Else → None, mode=empty
"""

from __future__ import annotations

from datetime import timedelta
from typing import Literal

from django.utils import timezone

CockpitMode = Literal["live", "pre_round", "history", "empty"]

PRE_ROUND_HORIZON = timedelta(days=7)


def resolve_current_round(season) -> tuple[object | None, CockpitMode]:
    from heltour.tournament.models import Round

    now = timezone.now()
    rounds = Round.objects.filter(season=season)

    open_round = (
        rounds.filter(
            publish_pairings=True,
            is_completed=False,
            end_date__gt=now,
        )
        .order_by("number")
        .first()
    )
    if open_round is not None:
        return open_round, "live"

    next_round = (
        rounds.filter(start_date__gt=now, start_date__lte=now + PRE_ROUND_HORIZON)
        .order_by("start_date")
        .first()
    )
    if next_round is not None:
        return None, "pre_round"

    most_recent_completed = rounds.filter(is_completed=True).order_by("-number").first()
    if most_recent_completed is not None:
        return most_recent_completed, "history"

    return None, "empty"
