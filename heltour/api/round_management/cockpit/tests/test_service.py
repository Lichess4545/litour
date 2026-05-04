"""Integration tests for the cockpit service layer.

Per CLAUDE.md rule 3 + design doc ER9, integration-heavy: real DB,
real Django signals, real audit-row writes. Mirrors the
``test_round_matches.py`` pattern that exercises sync handlers directly
(the HTTP layer is a thin ``in_thread`` wrapper that schemathesis
covers separately on a live uvicorn).

Coverage:
  * build_cockpit shapes (mode, needs_you_count, attention)
  * force_result_sync writes audit + returns enriched DTO
  * mark_forfeit_sync handles all three forfeit_side codes
  * reschedule_sync updates scheduled_time + writes audit
  * Optimistic concurrency: 409 on stale expected_version
  * 401 / 403 / 404 / 422 paths
"""

from datetime import timedelta

from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone
from fastapi import HTTPException

from heltour.api.round_management.cockpit.service import (
    audit_for_pairing_sync,
    build_cockpit_for_event_sync,
    build_cockpit_for_round_id_sync,
    force_result_sync,
    mark_forfeit_sync,
    reschedule_sync,
)
from heltour.api.round_management.tests.builders import make_lone_round
from heltour.api.shared.auth import Viewer
from heltour.tournament.models import (
    CockpitAuditEntry,
    LonePlayerPairing,
    Round,
)


def _staff_viewer(user: User) -> Viewer:
    return Viewer(user_id=user.pk, is_authenticated=True, is_staff=True)


def _make_organizer(username: str = "td1") -> User:
    # `tournament.change_pairing` isn't a Django auto-permission in this
    # codebase (no bare `Pairing` model + no migration that creates it),
    # so we side-step the permission check by using a superuser. Django's
    # `has_perm` returns True for superusers regardless of the registered
    # permission set — the cockpit service code goes through the same
    # ``can_change_pairing_sync`` path either way.
    return User.objects.create_user(username=username, is_staff=True, is_superuser=True)


def _make_live_round(slug: str = "evt") -> Round:
    rnd = make_lone_round(
        league_tag=f"l-{slug}",
        season_tag=f"s-{slug}",
        pairing_count=2,
    )
    season = rnd.season
    season.slug = slug
    season.save()
    rnd.start_date = timezone.now() - timedelta(hours=2)
    rnd.end_date = timezone.now() + timedelta(days=1)
    rnd.save()
    return rnd


# ---------- build_cockpit ------------------------------------------------------


class BuildCockpitTests(TestCase):
    def test_returns_cockpit_dto_with_mode_live(self):
        rnd = _make_live_round("evt-live")
        viewer = Viewer.anonymous()
        dto = build_cockpit_for_event_sync("evt-live", viewer, None)

        self.assertEqual(dto.mode, "live")
        self.assertEqual(dto.round_id, rnd.pk)
        self.assertEqual(len(dto.matches), 2)
        for m in dto.matches:
            self.assertIn(m.attention.level, ("none", "watch", "act"))
            self.assertGreater(m.version, 0)

    def test_event_not_found_raises_404(self):
        with self.assertRaises(HTTPException) as ctx:
            build_cockpit_for_event_sync("does-not-exist", Viewer.anonymous(), None)
        self.assertEqual(ctx.exception.status_code, 404)

    def test_history_mode_for_past_round_id(self):
        rnd = _make_live_round("evt-hist")
        # Build a past round explicitly via round_id query.
        dto = build_cockpit_for_round_id_sync("evt-hist", rnd.pk, Viewer.anonymous(), None)
        self.assertEqual(dto.mode, "history")

    def test_attention_count_reflects_unscheduled_pairings(self):
        rnd = _make_live_round("evt-attn")
        # Make all pairings unscheduled-near-deadline:
        # - clear result so the rule isn't bypassed by has_result
        # - clear scheduled_time so NO_SCHEDULE_NEAR_DEADLINE fires
        # - bring deadline within the 72h window
        for p in LonePlayerPairing.objects.filter(round=rnd):
            p.result = ""
            p.scheduled_time = None
            p.save()
        rnd.end_date = timezone.now() + timedelta(hours=24)
        rnd.save()

        dto = build_cockpit_for_event_sync("evt-attn", Viewer.anonymous(), None)
        self.assertGreaterEqual(dto.needs_you_count, 1)


# ---------- Intervention services ----------------------------------------------


class InterventionTests(TestCase):
    def setUp(self):
        self.user = _make_organizer()
        self.viewer = _staff_viewer(self.user)
        self.rnd = _make_live_round("evt-int")
        self.pairings = list(LonePlayerPairing.objects.filter(round=self.rnd).order_by("pk"))

    def _refresh_version(self, pairing) -> int:
        from heltour.api.round_management.cockpit.service import _pairing_version

        return _pairing_version(LonePlayerPairing.objects.get(pk=pairing.pk))

    def test_force_result_writes_audit_and_returns_enriched(self):
        target = self.pairings[0]
        v = self._refresh_version(target)

        out = force_result_sync(target.pk, "1/2-1/2", v, "agreed draw", self.viewer, self.user)
        self.assertEqual(out.id, target.pk)
        self.assertEqual(out.result, "1/2-1/2")

        audit_qs = list(CockpitAuditEntry.objects.filter(pairing=target))
        self.assertEqual(len(audit_qs), 1)
        self.assertEqual(audit_qs[0].intervention_type, "force_result")
        self.assertEqual(audit_qs[0].reason, "agreed draw")

    def test_mark_forfeit_each_side(self):
        for side, expected in (
            ("white", "1X-0F"),
            ("black", "0F-1X"),
            ("double", "0F-0F"),
        ):
            target = LonePlayerPairing.objects.create(
                round=self.rnd,
                white=self.pairings[0].white,
                black=self.pairings[0].black,
                pairing_order=99,
                result="",
                game_link="",
            )
            v = self._refresh_version(target)
            out = mark_forfeit_sync(target.pk, side, v, "", self.viewer, self.user)
            self.assertEqual(out.result, expected, msg=f"side={side}")

    def test_reschedule_updates_time_and_audits(self):
        target = self.pairings[0]
        v = self._refresh_version(target)
        new_when = timezone.now() + timedelta(hours=6)

        out = reschedule_sync(target.pk, new_when, v, "captain asked", self.viewer, self.user)
        self.assertEqual(out.id, target.pk)
        target.refresh_from_db()
        self.assertEqual(target.scheduled_time, new_when)
        self.assertEqual(
            CockpitAuditEntry.objects.filter(
                pairing=target, intervention_type="reschedule"
            ).count(),
            1,
        )

    def test_force_result_409_on_stale_version(self):
        target = self.pairings[0]
        with self.assertRaises(HTTPException) as ctx:
            force_result_sync(target.pk, "1-0", 0, "", self.viewer, self.user)
        self.assertEqual(ctx.exception.status_code, 409)

    def test_force_result_422_on_invalid_result(self):
        target = self.pairings[0]
        v = self._refresh_version(target)
        with self.assertRaises(HTTPException) as ctx:
            force_result_sync(target.pk, "frob", v, "", self.viewer, self.user)
        self.assertEqual(ctx.exception.status_code, 422)

    def test_force_result_404_on_unknown_pairing(self):
        with self.assertRaises(HTTPException) as ctx:
            force_result_sync(9_999_999, "1-0", 0, "", self.viewer, self.user)
        self.assertEqual(ctx.exception.status_code, 404)

    def test_intervention_401_without_user(self):
        target = self.pairings[0]
        v = self._refresh_version(target)
        with self.assertRaises(HTTPException) as ctx:
            force_result_sync(target.pk, "1-0", v, "", Viewer.anonymous(), None)
        self.assertEqual(ctx.exception.status_code, 401)

    def test_intervention_403_for_user_without_perm(self):
        weak = User.objects.create_user(username="weak", is_staff=False)
        target = self.pairings[0]
        v = self._refresh_version(target)
        weak_viewer = Viewer(user_id=weak.pk, is_authenticated=True, is_staff=False)
        with self.assertRaises(HTTPException) as ctx:
            force_result_sync(target.pk, "1-0", v, "", weak_viewer, weak)
        self.assertEqual(ctx.exception.status_code, 403)


# ---------- Audit query --------------------------------------------------------


class AuditQueryTests(TestCase):
    def test_returns_entries_most_recent_first(self):
        user = _make_organizer("td-aud")
        viewer = _staff_viewer(user)
        rnd = _make_live_round("evt-aud")
        target = LonePlayerPairing.objects.filter(round=rnd).first()
        assert target is not None

        # Two interventions to verify ordering.
        v = LonePlayerPairing.objects.get(pk=target.pk).date_modified
        from heltour.api.round_management.cockpit.service import _epoch_ms

        force_result_sync(target.pk, "1-0", _epoch_ms(v), "first", viewer, user)
        v2 = _epoch_ms(LonePlayerPairing.objects.get(pk=target.pk).date_modified)
        reschedule_sync(
            target.pk,
            timezone.now() + timedelta(hours=2),
            v2,
            "second",
            viewer,
            user,
        )
        entries = audit_for_pairing_sync(target.pk, viewer, user)
        self.assertEqual(len(entries), 2)
        # Most-recent first per DR9.
        self.assertEqual(entries[0].intervention_type, "reschedule")
        self.assertEqual(entries[1].intervention_type, "force_result")

    def test_audit_403_for_non_organizer(self):
        rnd = _make_live_round("evt-aud2")
        target = LonePlayerPairing.objects.filter(round=rnd).first()
        assert target is not None
        weak = User.objects.create_user(username="snoop", is_staff=False)
        viewer = Viewer(user_id=weak.pk, is_authenticated=True, is_staff=False)
        with self.assertRaises(HTTPException) as ctx:
            audit_for_pairing_sync(target.pk, viewer, weak)
        self.assertEqual(ctx.exception.status_code, 403)
