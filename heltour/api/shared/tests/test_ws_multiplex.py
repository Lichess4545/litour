"""Tests for the multiplex WebSocket registry and per-channel resolution.

These exercise pure / mostly-pure code paths — channel pattern
matching, async ``open`` predicates, transform shape — without spinning
up the FastAPI websocket pipeline. The TestClient route is avoided for
the same reason ``round_management/tests/test_http.py`` documents
(thread-pinned sync DB work fights postgres teardown).
"""

from __future__ import annotations

import asyncio
import re
from unittest import TestCase

from django.test import TestCase as DjangoTestCase

from heltour.api.shared.auth import Viewer
from heltour.api.shared.ws_multiplex import (
    BackingSource,
    ChannelContext,
    ChannelSpec,
    _ensure_registry_loaded,
    _match_spec,
)


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


class RegistryMatchTests(TestCase):
    """Pattern matching on the channel name → ChannelSpec resolution."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        _ensure_registry_loaded()

    def test_system_queue_lag_matches(self):
        result = _match_spec("system:queue_lag")
        self.assertIsNotNone(result)

    def test_jobs_all_matches(self):
        result = _match_spec("jobs:all")
        self.assertIsNotNone(result)

    def test_jobs_season_extracts_slug(self):
        result = _match_spec("jobs:season:winter-2026")
        self.assertIsNotNone(result)
        assert result is not None  # narrow for type checker
        _spec, groups = result
        self.assertEqual(groups["slug"], "winter-2026")

    def test_jobs_league_extracts_tag(self):
        result = _match_spec("jobs:league:lichess4545")
        self.assertIsNotNone(result)
        assert result is not None
        _spec, groups = result
        self.assertEqual(groups["tag"], "lichess4545")

    def test_cockpit_event_round_extracts_groups(self):
        result = _match_spec("cockpit:event:winter-2026:round:42")
        self.assertIsNotNone(result)
        assert result is not None
        _spec, groups = result
        self.assertEqual(groups["slug"], "winter-2026")
        self.assertEqual(groups["round_id"], "42")

    def test_permissions_user_extracts_user_id(self):
        result = _match_spec("permissions:user:7")
        self.assertIsNotNone(result)
        assert result is not None
        _spec, groups = result
        self.assertEqual(groups["user_id"], "7")

    def test_events_home_matches(self):
        result = _match_spec("events:home")
        self.assertIsNotNone(result)

    def test_events_slug_extracts_slug(self):
        result = _match_spec("events:slug:winter-2026")
        self.assertIsNotNone(result)
        assert result is not None
        _spec, groups = result
        self.assertEqual(groups["slug"], "winter-2026")

    def test_unknown_channel_returns_none(self):
        self.assertIsNone(_match_spec("foo:bar:baz"))

    def test_partial_match_rejected(self):
        # Trailing garbage must not match — the registry uses fullmatch.
        self.assertIsNone(_match_spec("system:queue_lag:extra"))


class JobsChannelAuthTests(TestCase):
    """``open`` hooks for jobs:* channels gate on viewer flags."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        _ensure_registry_loaded()

    def test_queue_lag_denied_for_anonymous(self):
        matched = _match_spec("system:queue_lag")
        assert matched is not None
        spec, groups = matched
        ctx = ChannelContext(viewer=Viewer.anonymous(), user=None)
        self.assertIsNone(_run(spec.open(ctx, groups)))

    def test_queue_lag_allowed_for_signed_in(self):
        matched = _match_spec("system:queue_lag")
        assert matched is not None
        spec, groups = matched
        ctx = ChannelContext(
            viewer=Viewer(user_id=1, is_authenticated=True, is_staff=False),
            user=None,
        )
        sources = _run(spec.open(ctx, groups))
        self.assertIsNotNone(sources)
        assert sources is not None
        self.assertEqual(len(sources), 1)
        self.assertEqual(sources[0].redis_channel, "system:queue_lag")

    def test_jobs_all_denied_for_non_staff(self):
        matched = _match_spec("jobs:all")
        assert matched is not None
        spec, groups = matched
        ctx = ChannelContext(
            viewer=Viewer(user_id=1, is_authenticated=True, is_staff=False),
            user=None,
        )
        self.assertIsNone(_run(spec.open(ctx, groups)))

    def test_jobs_all_allowed_for_staff(self):
        matched = _match_spec("jobs:all")
        assert matched is not None
        spec, groups = matched
        ctx = ChannelContext(
            viewer=Viewer(user_id=1, is_authenticated=True, is_staff=True),
            user=None,
        )
        sources = _run(spec.open(ctx, groups))
        self.assertIsNotNone(sources)


class PermissionsChannelAuthTests(TestCase):
    """``permissions:user:N`` is self-only — staff override deliberately
    does not widen the channel."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        _ensure_registry_loaded()

    def test_anonymous_denied(self):
        matched = _match_spec("permissions:user:7")
        assert matched is not None
        spec, groups = matched
        ctx = ChannelContext(viewer=Viewer.anonymous(), user=None)
        self.assertIsNone(_run(spec.open(ctx, groups)))

    def test_other_user_denied(self):
        matched = _match_spec("permissions:user:7")
        assert matched is not None
        spec, groups = matched
        ctx = ChannelContext(
            viewer=Viewer(user_id=42, is_authenticated=True, is_staff=False),
            user=None,
        )
        self.assertIsNone(_run(spec.open(ctx, groups)))

    def test_staff_for_other_user_still_denied(self):
        matched = _match_spec("permissions:user:7")
        assert matched is not None
        spec, groups = matched
        ctx = ChannelContext(
            viewer=Viewer(user_id=99, is_authenticated=True, is_staff=True),
            user=None,
        )
        self.assertIsNone(_run(spec.open(ctx, groups)))

    def test_self_allowed(self):
        matched = _match_spec("permissions:user:7")
        assert matched is not None
        spec, groups = matched
        ctx = ChannelContext(
            viewer=Viewer(user_id=7, is_authenticated=True, is_staff=False),
            user=None,
        )
        sources = _run(spec.open(ctx, groups))
        self.assertIsNotNone(sources)
        assert sources is not None
        self.assertEqual(sources[0].redis_channel, "permissions:user:7")


class JobsSeasonAuthDBTests(DjangoTestCase):
    """Slug → permission gate on jobs:season:{slug} hits the ORM."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        _ensure_registry_loaded()

    def test_unknown_slug_denied(self):
        matched = _match_spec("jobs:season:does-not-exist")
        assert matched is not None
        spec, groups = matched
        ctx = ChannelContext(
            viewer=Viewer(user_id=1, is_authenticated=True, is_staff=False),
            user=None,
        )
        self.assertIsNone(_run(spec.open(ctx, groups)))


class CockpitChannelTransformTests(TestCase):
    """The cockpit:event:{slug}:round:{id} transforms shape match.update
    envelopes and trigger DTO snapshot rebuilds for cockpit.invalidate."""

    def test_match_transform_drops_non_match_envelopes(self):
        from heltour.api.round_management.cockpit.ws_channels import (
            _cockpit_match_transform,
        )

        ctx = ChannelContext(
            viewer=Viewer(user_id=1, is_authenticated=True, is_staff=False),
            user=None,
        )
        groups = {"slug": "winter-2026", "round_id": "10"}
        out = _cockpit_match_transform(ctx, groups, {"type": "team_match.update"})
        self.assertIsNone(out)

    def test_season_transform_ignores_non_invalidate(self):
        from heltour.api.round_management.cockpit.ws_channels import (
            _cockpit_season_transform,
        )

        ctx = ChannelContext(
            viewer=Viewer(user_id=1, is_authenticated=True, is_staff=False),
            user=None,
        )
        groups = {"slug": "winter-2026", "round_id": "10"}
        out = _cockpit_season_transform(ctx, groups, {"type": "something.else"})
        self.assertIsNone(out)


class BackingSourceShapeTests(TestCase):
    """Smoke test the dataclass surface stays stable for callers."""

    def test_backing_source_with_transform(self):
        called: list[tuple] = []

        def transform(ctx, groups, msg):
            called.append((ctx, groups, msg))
            return {"shaped": True}

        bs = BackingSource(
            redis_channel="x:y",
            transform=transform,
        )
        ctx = ChannelContext(viewer=Viewer.anonymous(), user=None)
        result = bs.transform(ctx, {"k": "v"}, {"type": "raw"})  # type: ignore[misc]
        self.assertEqual(result, {"shaped": True})
        self.assertEqual(len(called), 1)

    def test_channel_spec_pattern_compiles(self):
        spec = ChannelSpec(
            pattern=re.compile(r"^foo:(?P<id>\d+)$"),
            open=lambda _ctx, _groups: asyncio.sleep(0, result=[]),  # type: ignore[arg-type]
        )
        m = spec.pattern.fullmatch("foo:42")
        self.assertIsNotNone(m)
        assert m is not None
        self.assertEqual(m.group("id"), "42")
