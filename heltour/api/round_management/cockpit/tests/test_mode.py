"""Tests for ``resolve_current_round`` precedence (design doc ER7)."""

from datetime import timedelta

from django.test import TestCase
from django.utils import timezone

from heltour.api.round_management.cockpit.mode import resolve_current_round
from heltour.tournament.models import League, Round, Season


class ResolveCurrentRoundTests(TestCase):
    def setUp(self):
        self.league = League.objects.create(
            name="L",
            tag="m",
            competitor_type="individual",
            rating_type="classical",
        )

    def _season(self, *, rounds: int) -> Season:
        return Season.objects.create(
            league=self.league,
            name="S",
            tag="s1",
            rounds=rounds,
        )

    def test_live_when_open_round_with_future_end_date(self):
        season = self._season(rounds=1)
        rnd = Round.objects.get(season=season, number=1)
        rnd.publish_pairings = True
        rnd.is_completed = False
        rnd.start_date = timezone.now() - timedelta(days=1)
        rnd.end_date = timezone.now() + timedelta(days=1)
        rnd.save()

        resolved, mode = resolve_current_round(season)
        self.assertEqual(mode, "live")
        self.assertIsNotNone(resolved)
        self.assertEqual(resolved.pk, rnd.pk)  # type: ignore[union-attr]

    def test_pre_round_when_next_opens_within_7_days(self):
        season = self._season(rounds=2)
        for r in Round.objects.filter(season=season):
            r.is_completed = True
            r.publish_pairings = False
            r.end_date = timezone.now() - timedelta(days=10)
            r.save()
        # Override one to be a future-opening round.
        future = Round.objects.filter(season=season).order_by("number").first()
        assert future is not None
        future.is_completed = False
        future.start_date = timezone.now() + timedelta(days=2)
        future.end_date = timezone.now() + timedelta(days=5)
        future.save()

        resolved, mode = resolve_current_round(season)
        self.assertEqual(mode, "pre_round")
        self.assertIsNone(resolved)

    def test_history_when_no_open_or_imminent_round(self):
        season = self._season(rounds=1)
        rnd = Round.objects.get(season=season, number=1)
        rnd.is_completed = True
        rnd.start_date = timezone.now() - timedelta(days=30)
        rnd.end_date = timezone.now() - timedelta(days=20)
        rnd.save()

        resolved, mode = resolve_current_round(season)
        self.assertEqual(mode, "history")
        self.assertIsNotNone(resolved)
        self.assertEqual(resolved.pk, rnd.pk)  # type: ignore[union-attr]

    def test_empty_when_no_rounds_at_all(self):
        # Creating a Season with rounds=0 produces no Round rows.
        season = Season.objects.create(
            league=self.league,
            name="Z",
            tag="z1",
            rounds=0,
        )
        resolved, mode = resolve_current_round(season)
        self.assertEqual(mode, "empty")
        self.assertIsNone(resolved)
