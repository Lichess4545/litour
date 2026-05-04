"""Attention predicate — pure logic, no Django imports at function time.

Three rules to start; expand as real-world TD pain dictates. New rules
add to ``AttentionReason``; UI maps codes to labels.

Rule precedence: ``PAST_DEADLINE_NO_RESULT`` supersedes
``SCHEDULED_BUT_NOT_STARTED`` when both would fire. ``NO_SCHEDULE_NEAR_DEADLINE``
is silenced when ``PAST_DEADLINE_NO_RESULT`` fires.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import Enum


class AttentionReason(str, Enum):
    NO_SCHEDULE_NEAR_DEADLINE = "no_schedule_near_deadline"
    SCHEDULED_BUT_NOT_STARTED = "scheduled_but_not_started"
    PAST_DEADLINE_NO_RESULT = "past_deadline_no_result"


@dataclass(frozen=True)
class AttentionInput:
    """Subset of pairing fields needed by ``compute_attention``.

    Decoupled from the Django model so the function is unit-testable
    without a DB and the WS hot path can build it from the cached DTO.
    """

    has_result: bool
    has_game_link: bool
    scheduled_at: datetime | None


@dataclass(frozen=True)
class AttentionOutput:
    level: str  # "none" | "watch" | "act"
    reasons: tuple[AttentionReason, ...]


def compute_attention(
    pairing: AttentionInput,
    now: datetime,
    round_deadline: datetime,
) -> AttentionOutput:
    reasons: list[AttentionReason] = []
    hours_to_deadline = (round_deadline - now).total_seconds() / 3600

    past_deadline = not pairing.has_result and now > round_deadline
    scheduled_not_started = (
        pairing.scheduled_at is not None
        and not pairing.has_game_link
        and pairing.scheduled_at < now - timedelta(minutes=30)
        and not pairing.has_result
    )
    no_schedule_near = (
        pairing.scheduled_at is None
        and not pairing.has_result
        and 0 < hours_to_deadline < 72
    )

    if past_deadline:
        reasons.append(AttentionReason.PAST_DEADLINE_NO_RESULT)
    elif scheduled_not_started:
        reasons.append(AttentionReason.SCHEDULED_BUT_NOT_STARTED)
    if no_schedule_near and not past_deadline:
        reasons.append(AttentionReason.NO_SCHEDULE_NEAR_DEADLINE)

    if not reasons:
        return AttentionOutput(level="none", reasons=())
    if AttentionReason.PAST_DEADLINE_NO_RESULT in reasons:
        return AttentionOutput(level="act", reasons=tuple(reasons))
    return AttentionOutput(level="watch", reasons=tuple(reasons))
