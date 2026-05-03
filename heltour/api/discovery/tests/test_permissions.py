"""Permission-predicate tests for the discovery domain.

Exercises the four-tier scaffolding plug-in: type, instance, and the
queryset filter that backs the home / WS-list surface.
"""

from __future__ import annotations

from django.test import TestCase

from heltour.api.discovery.permissions import (
    SEASON_READ_INSTANCE,
    SEASON_READ_TYPE,
    can_subscribe_event_slug,
    visible_queryset,
)
from heltour.api.discovery.tests.builders import make_season
from heltour.api.shared.auth import Viewer


_ANON = Viewer.anonymous()
_STAFF = Viewer(user_id=1, is_authenticated=True, is_staff=True)
_AUTHED = Viewer(user_id=2, is_authenticated=True, is_staff=False)


class TypeReadTests(TestCase):
    def test_read_is_always_true(self):
        self.assertTrue(SEASON_READ_TYPE.can_read(_ANON))
        self.assertTrue(SEASON_READ_TYPE.can_read(_AUTHED))
        self.assertTrue(SEASON_READ_TYPE.can_read(_STAFF))

    def test_write_is_always_false(self):
        # Discovery is read-only; writes go through other domains.
        self.assertFalse(SEASON_READ_TYPE.can_write(_STAFF))


class InstanceReadTests(TestCase):
    def test_public_visible_to_everyone(self):
        s = make_season(league_tag="ip-1", visibility="public")
        self.assertTrue(SEASON_READ_INSTANCE.can_read(_ANON, s))
        self.assertTrue(SEASON_READ_INSTANCE.can_read(_AUTHED, s))
        self.assertTrue(SEASON_READ_INSTANCE.can_read(_STAFF, s))

    def test_unlisted_visible_to_everyone_with_slug(self):
        s = make_season(league_tag="iu-1", visibility="unlisted")
        self.assertTrue(SEASON_READ_INSTANCE.can_read(_ANON, s))
        self.assertTrue(SEASON_READ_INSTANCE.can_read(_AUTHED, s))

    def test_draft_staff_only(self):
        s = make_season(league_tag="id-1", visibility="draft")
        self.assertFalse(SEASON_READ_INSTANCE.can_read(_ANON, s))
        self.assertFalse(SEASON_READ_INSTANCE.can_read(_AUTHED, s))
        self.assertTrue(SEASON_READ_INSTANCE.can_read(_STAFF, s))


class VisibleQuerysetTests(TestCase):
    def test_only_public_returned(self):
        make_season(league_tag="vq-p", visibility="public", is_active=True)
        make_season(league_tag="vq-u", visibility="unlisted", is_active=True)
        make_season(league_tag="vq-d", visibility="draft", is_active=True)

        anon_tags = set(visible_queryset(_ANON).values_list("league__tag", flat=True))
        staff_tags = set(visible_queryset(_STAFF).values_list("league__tag", flat=True))

        self.assertEqual(anon_tags, {"vq-p"})
        # Staff also restricted on home surface — drafts are admin-only.
        self.assertEqual(staff_tags, {"vq-p"})

    def test_inactive_seasons_filtered_from_home(self):
        make_season(
            league_tag="vq-d2", visibility="public",
            is_active=False, is_completed=False,
        )
        self.assertEqual(visible_queryset(_ANON).count(), 0)


class WSHandshakeTests(TestCase):
    def test_can_subscribe_mirrors_instance_read(self):
        public_s = make_season(league_tag="ws-p", visibility="public")
        draft_s = make_season(league_tag="ws-d", visibility="draft")

        self.assertTrue(can_subscribe_event_slug(_ANON, public_s))
        self.assertFalse(can_subscribe_event_slug(_ANON, draft_s))
        self.assertTrue(can_subscribe_event_slug(_STAFF, draft_s))
