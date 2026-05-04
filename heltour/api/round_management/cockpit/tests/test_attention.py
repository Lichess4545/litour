"""Pure-logic tests for the attention predicate.

No DB hits — ``compute_attention`` is unit-testable by design (decoupled
from the Django model via ``AttentionInput``). Covers all three rules and
the precedence between them per design doc Architecture section.
"""

from datetime import datetime, timedelta, timezone
from unittest import TestCase

from heltour.api.round_management.cockpit.attention import (
    AttentionInput,
    AttentionReason,
    compute_attention,
)

UTC = timezone.utc
NOW = datetime(2026, 5, 3, 12, 0, tzinfo=UTC)


class ComputeAttentionTests(TestCase):
    def test_no_reasons_when_result_already_set(self):
        out = compute_attention(
            AttentionInput(has_result=True, has_game_link=True, scheduled_at=None),
            now=NOW,
            round_deadline=NOW + timedelta(days=2),
        )
        self.assertEqual(out.level, "none")
        self.assertEqual(out.reasons, ())

    def test_no_schedule_near_deadline_fires_within_72h(self):
        out = compute_attention(
            AttentionInput(has_result=False, has_game_link=False, scheduled_at=None),
            now=NOW,
            round_deadline=NOW + timedelta(hours=24),
        )
        self.assertEqual(out.level, "watch")
        self.assertIn(AttentionReason.NO_SCHEDULE_NEAR_DEADLINE, out.reasons)

    def test_no_schedule_quiet_outside_72h(self):
        out = compute_attention(
            AttentionInput(has_result=False, has_game_link=False, scheduled_at=None),
            now=NOW,
            round_deadline=NOW + timedelta(days=10),
        )
        self.assertEqual(out.level, "none")

    def test_scheduled_but_not_started(self):
        out = compute_attention(
            AttentionInput(
                has_result=False,
                has_game_link=False,
                scheduled_at=NOW - timedelta(hours=1),
            ),
            now=NOW,
            round_deadline=NOW + timedelta(days=1),
        )
        self.assertEqual(out.level, "watch")
        self.assertEqual(list(out.reasons), [AttentionReason.SCHEDULED_BUT_NOT_STARTED])

    def test_past_deadline_no_result_promotes_to_act(self):
        out = compute_attention(
            AttentionInput(has_result=False, has_game_link=False, scheduled_at=None),
            now=NOW,
            round_deadline=NOW - timedelta(hours=1),
        )
        self.assertEqual(out.level, "act")
        self.assertIn(AttentionReason.PAST_DEADLINE_NO_RESULT, out.reasons)

    def test_past_deadline_supersedes_scheduled_not_started(self):
        # When both rules would fire, only PAST_DEADLINE is appended (per
        # the precedence rule in the implementation).
        out = compute_attention(
            AttentionInput(
                has_result=False,
                has_game_link=False,
                scheduled_at=NOW - timedelta(hours=2),
            ),
            now=NOW,
            round_deadline=NOW - timedelta(minutes=10),
        )
        self.assertEqual(out.level, "act")
        self.assertNotIn(AttentionReason.SCHEDULED_BUT_NOT_STARTED, out.reasons)
        self.assertIn(AttentionReason.PAST_DEADLINE_NO_RESULT, out.reasons)

    def test_result_after_deadline_is_quiet(self):
        # Result is in. Past deadline rule does not fire.
        out = compute_attention(
            AttentionInput(has_result=True, has_game_link=True, scheduled_at=None),
            now=NOW,
            round_deadline=NOW - timedelta(hours=1),
        )
        self.assertEqual(out.level, "none")
