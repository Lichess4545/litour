"""Service-level tests for the discovery domain.

These exercise the real ORM path (Season/League/Round) so the queryset
filters, default sort, pagination, and slug resolution are tested end
to end. We deliberately stay below the FastAPI HTTP layer for the same
reason `round_management/tests/test_http.py` documents — `TestClient`
plus thread-pinned sync DB work leaves a connection open at suite
teardown.
"""

from __future__ import annotations

from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext

from heltour.api.discovery.services import (
    build_card,
    format_line,
    get_event_with_tabs,
    list_events,
    resolve_slug,
    schedule_line,
    slot_status,
    status_group,
    status_label,
)
from heltour.api.discovery.tests.builders import make_season, publish_round, utc
from heltour.api.shared.auth import Viewer


_ANON = Viewer.anonymous()
_STAFF = Viewer(user_id=1, is_authenticated=True, is_staff=True)
_AUTHED = Viewer(user_id=2, is_authenticated=True, is_staff=False)


class StatusGroupTests(TestCase):
    def test_completed_wins_over_running(self):
        s = make_season(league_tag="sg-c", is_active=True, is_completed=True)
        self.assertEqual(status_group(s), "completed")
        self.assertEqual(status_label("completed"), "Finished")

    def test_active_requires_published_round(self):
        s = make_season(league_tag="sg-a", is_active=True, is_completed=False)
        publish_round(s, 1)
        self.assertEqual(status_group(s), "active")
        self.assertEqual(status_label("active"), "Now playing")

    def test_upcoming_when_active_but_no_round_published(self):
        s = make_season(league_tag="sg-u", is_active=True, is_completed=False)
        self.assertEqual(status_group(s), "upcoming")
        self.assertEqual(status_label("upcoming"), "Open")

    def test_awaiting_when_schedule_elapsed_but_not_marked_complete(self):
        from datetime import datetime, timedelta, timezone

        from heltour.tournament.models import Round

        s = make_season(league_tag="sg-e", is_active=True, rounds=2, boards=2)
        publish_round(s, 1)
        publish_round(s, 2)
        last = Round.objects.get(season=s, number=2)
        last.end_date = datetime.now(tz=timezone.utc) - timedelta(days=1)
        last.save()
        self.assertEqual(status_group(s), "awaiting")
        self.assertEqual(status_label("awaiting"), "Awaiting results")


class CardCompositionTests(TestCase):
    def test_format_line_team_swiss(self):
        s = make_season(
            league_tag="fl-ts", competitor_type="team", pairing_type="swiss-dutch",
            rounds=8,
        )
        self.assertEqual(format_line(s), "Team Swiss · 8 rounds")

    def test_format_line_individual_knockout(self):
        s = make_season(
            league_tag="fl-ik", competitor_type="individual",
            pairing_type="knockout-single", rounds=5, boards=None,
        )
        self.assertEqual(format_line(s), "Individual Knockout · 5 rounds")

    def test_schedule_line_uses_absolute_date_not_weekday_plural(self):
        s = make_season(
            league_tag="sl-1", time_control="45+45",
            start_date=utc(2026, 5, 3),  # Sunday at 11am UTC
        )
        line = schedule_line(s)
        self.assertIn("45+45", line)
        self.assertIn("May 3", line)
        self.assertIn("11am UTC", line)
        self.assertNotIn("Sundays", line)

    def test_schedule_line_omits_date_when_no_start_date(self):
        s = make_season(league_tag="sl-2", time_control="45+45", start_date=None)
        self.assertEqual(schedule_line(s), "45+45")

    def test_organizer_override_takes_priority_over_league(self):
        from heltour.tournament.models import Season

        s = make_season(league_tag="og-1", league_name="Mother League", is_active=True)
        Season.objects.filter(pk=s.pk).update(
            organizer_name="Guest Host", organizer_tag_override="guest-host",
        )
        s.refresh_from_db()
        from heltour.api.discovery.services import organizer_label, organizer_tag

        self.assertEqual(organizer_label(s), "Guest Host")
        self.assertEqual(organizer_tag(s), "guest-host")

    def test_organizer_falls_back_to_league_when_unset(self):
        s = make_season(league_tag="og-2", league_name="Mother League", is_active=True)
        from heltour.api.discovery.services import organizer_label, organizer_tag

        self.assertEqual(organizer_label(s), "Mother League")
        self.assertEqual(organizer_tag(s), "og-2")

    def test_slot_status_active_uses_latest_published_round(self):
        s = make_season(
            league_tag="ss-a", is_active=True, rounds=8,
        )
        publish_round(s, 1)
        publish_round(s, 2)
        self.assertEqual(slot_status(s), "Round 2 of 8")

    def test_slot_status_upcoming_shows_player_count(self):
        s = make_season(league_tag="ss-u", is_active=True, is_completed=False)
        self.assertEqual(slot_status(s), "0 players registered")

    def test_slot_status_completed_is_empty(self):
        s = make_season(league_tag="ss-c", is_completed=True)
        self.assertEqual(slot_status(s), "")

    def test_build_card_uses_organizer_terminology(self):
        s = make_season(
            league_tag="bc-1", league_name="Team 4545",
            season_tag="s30", is_active=True,
        )
        publish_round(s, 1)
        card = build_card(s)
        self.assertEqual(card.organizer_label, "Team 4545")
        self.assertEqual(card.organizer_tag, "bc-1")
        self.assertEqual(card.status_group, "active")
        self.assertEqual(card.status_label, "Now playing")
        self.assertEqual(card.visibility, "public")


class ListEventsTests(TestCase):
    def test_default_filter_excludes_completed(self):
        make_season(league_tag="lf-a", is_active=True, season_tag="a")
        s_published = make_season(league_tag="lf-r", is_active=True, season_tag="r")
        publish_round(s_published, 1)
        make_season(league_tag="lf-c", is_active=True, is_completed=True, season_tag="c")

        page = list_events(_ANON)
        slugs = {e.slug for e in page.events}
        self.assertEqual(page.total, 2)
        self.assertTrue(any(s.startswith("lf-a") for s in slugs))
        self.assertTrue(any(s.startswith("lf-r") for s in slugs))
        self.assertFalse(any(s.startswith("lf-c") for s in slugs))

    def test_drafts_excluded_from_home(self):
        make_season(league_tag="draft-x", is_active=False, is_completed=False)
        page = list_events(_ANON, status=["active", "upcoming", "completed"])
        self.assertEqual(page.total, 0)

    def test_explicit_status_completed_includes_archived(self):
        make_season(league_tag="es-c", is_completed=True)
        page = list_events(_ANON, status=["completed"])
        self.assertEqual(page.total, 1)
        self.assertEqual(page.events[0].status_group, "completed")

    def test_organizer_filter(self):
        make_season(league_tag="org-a", season_tag="s1", is_active=True)
        make_season(league_tag="org-b", season_tag="s1", is_active=True)
        page = list_events(_ANON, organizer_tags=["org-a"])
        self.assertEqual(page.total, 1)
        self.assertEqual(page.events[0].organizer_tag, "org-a")

    def test_default_sort_active_then_upcoming_then_completed(self):
        make_season(league_tag="sort-u", season_tag="u", is_active=True)
        s_active = make_season(league_tag="sort-a", is_active=True, season_tag="a")
        publish_round(s_active, 1)
        make_season(league_tag="sort-c", is_active=True, is_completed=True, season_tag="c")

        page = list_events(_ANON, status=["active", "upcoming", "completed"])
        groups = [e.status_group for e in page.events]
        self.assertEqual(groups, ["active", "upcoming", "completed"])

    def test_pagination_limit_and_offset(self):
        for i in range(5):
            make_season(
                league_tag=f"pg-{i}", season_tag=f"s{i}", is_active=True,
            )
        first = list_events(_ANON, limit=2, offset=0)
        second = list_events(_ANON, limit=2, offset=2)
        self.assertEqual(first.total, 5)
        self.assertEqual(len(first.events), 2)
        self.assertEqual(len(second.events), 2)
        self.assertEqual(first.limit, 2)
        self.assertEqual(second.offset, 2)
        self.assertNotEqual(
            {e.slug for e in first.events},
            {e.slug for e in second.events},
        )

    def test_unlisted_and_draft_hidden_from_home(self):
        make_season(league_tag="vis-p", visibility="public", is_active=True)
        make_season(league_tag="vis-u", visibility="unlisted", is_active=True)
        make_season(league_tag="vis-d", visibility="draft", is_active=True)

        page = list_events(_ANON)
        tags = {e.organizer_tag for e in page.events}
        self.assertEqual(tags, {"vis-p"})

    def test_staff_does_not_see_drafts_on_home(self):
        # Drafts are admin-only on the home surface; staff find them via
        # the Django admin, not the public-shaped discovery list.
        make_season(league_tag="staff-d", visibility="draft", is_active=True)
        page = list_events(_STAFF)
        self.assertEqual(page.total, 0)

    def test_query_count_bounded(self):
        for i in range(20):
            make_season(
                league_tag=f"qc-{i}", season_tag="s", is_active=True,
            )
        # Warm cacheops; measure the second call.
        list_events(_ANON, limit=20)
        with CaptureQueriesContext(connection) as ctx:
            page = list_events(_ANON, limit=20)
            for card in page.events:
                # Force any lazy attribute access to surface N+1s.
                _ = card.organizer_label
                _ = card.format_line
        # COUNT + paged SELECT joins league + a slot_status player count
        # per upcoming season. Active seasons add a published-round
        # lookup. We only assert it's bounded — cacheops may further
        # reduce this.
        self.assertLessEqual(len(ctx.captured_queries), 50)


class GetEventWithTabsVisibilityTests(TestCase):
    def test_public_visible_to_anon(self):
        s = make_season(league_tag="vp", visibility="public")
        detail = get_event_with_tabs(s.slug, _ANON)
        self.assertIsNotNone(detail)
        self.assertEqual(detail.header.visibility, "public")

    def test_unlisted_visible_to_anon_with_slug(self):
        s = make_season(league_tag="vu", visibility="unlisted")
        detail = get_event_with_tabs(s.slug, _ANON)
        self.assertIsNotNone(detail)
        self.assertEqual(detail.header.visibility, "unlisted")

    def test_draft_invisible_to_anon(self):
        s = make_season(league_tag="vd-a", visibility="draft")
        self.assertIsNone(get_event_with_tabs(s.slug, _ANON))

    def test_draft_invisible_to_authed_non_staff(self):
        s = make_season(league_tag="vd-u", visibility="draft")
        self.assertIsNone(get_event_with_tabs(s.slug, _AUTHED))

    def test_draft_visible_to_staff(self):
        s = make_season(league_tag="vd-s", visibility="draft")
        detail = get_event_with_tabs(s.slug, _STAFF)
        self.assertIsNotNone(detail)
        self.assertEqual(detail.header.visibility, "draft")

    def test_unknown_slug_returns_none(self):
        self.assertIsNone(get_event_with_tabs("does-not-exist", _ANON))


class TabsAvailabilityTests(TestCase):
    def test_pairings_tab_appears_when_round_published(self):
        s = make_season(
            league_tag="tp-1", competitor_type="team", rounds=2, boards=2,
            is_active=True,
        )
        publish_round(s, 1)
        detail = get_event_with_tabs(s.slug, _ANON)
        self.assertIsNotNone(detail)
        self.assertIn("pairings", detail.tabs_available)
        self.assertIsNotNone(detail.pairings)

    def test_pairings_tab_absent_when_no_round_published(self):
        s = make_season(league_tag="tp-2", rounds=2, boards=2, is_active=True)
        detail = get_event_with_tabs(s.slug, _ANON)
        self.assertIsNotNone(detail)
        self.assertNotIn("pairings", detail.tabs_available)
        self.assertIsNone(detail.pairings)


class SlugTests(TestCase):
    def test_save_assigns_slug_on_create(self):
        s = make_season(league_tag="slug-a", season_tag="s30")
        self.assertTrue(s.slug)
        self.assertIn("slug-a", s.slug)
        self.assertIn("s30", s.slug)

    def test_slug_is_unique_across_seasons(self):
        a = make_season(league_tag="slug-x", season_tag="s1")
        b = make_season(league_tag="slug-x2", season_tag="s1")
        self.assertNotEqual(a.slug, b.slug)

    def test_resolve_slug_returns_none_on_miss(self):
        self.assertIsNone(resolve_slug("nope-nope-nope"))

    def test_resolve_slug_hits(self):
        s = make_season(league_tag="rs-1")
        got = resolve_slug(s.slug)
        self.assertIsNotNone(got)
        self.assertEqual(got.pk, s.pk)
