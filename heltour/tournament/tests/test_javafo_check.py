from unittest import skipUnless
from unittest.mock import patch

from django.contrib.auth.models import User
from django.core.cache import cache
from django.test import SimpleTestCase, TestCase, override_settings

from heltour.tournament import pairinggen
from heltour.tournament.models import Season
from heltour.tournament.tests.testutils import (
    can_run_javafo,
    createCommonLeagueData,
    league_url,
)

BROKEN_JAVAFO_COMMAND = "java -jar /nonexistent/javafo.jar"
LOCMEM_CACHE = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}


class JavafoCheckPairsTestCase(SimpleTestCase):
    def setUp(self):
        self.players = pairinggen._synthetic_round_one(["A", "B", "C", "D"], 1)

    def test_accepts_fresh_pairings(self):
        self.assertIsNone(pairinggen._check_javafo_pairs(self.players, [["A", "B"], ["C", "D"]]))

    def test_rejects_rematch(self):
        error = pairinggen._check_javafo_pairs(self.players, [["A", "C"], ["B", "D"]])
        self.assertIn("paired again", error)

    def test_rejects_missing_competitor(self):
        error = pairinggen._check_javafo_pairs(self.players, [["A", "B"]])
        self.assertIn("paired once", error)


@override_settings(CACHES=LOCMEM_CACHE)
class JavafoCheckTestCase(SimpleTestCase):
    @skipUnless(can_run_javafo(), "JavaFo environment not available")
    def test_lone_and_team_pass_with_working_javafo(self):
        result = pairinggen.check_javafo("web")

        self.assertTrue(result["ok"], result)
        self.assertEqual(["lone", "team"], [s["name"] for s in result["scenarios"]])
        self.assertEqual([4, 3], [s["pairs"] for s in result["scenarios"]])

    @override_settings(JAVAFO_COMMAND=BROKEN_JAVAFO_COMMAND)
    def test_reports_failure_when_javafo_cannot_run(self):
        result = pairinggen.check_javafo("web")

        self.assertFalse(result["ok"])
        for scenario in result["scenarios"]:
            self.assertFalse(scenario["ok"])
            self.assertIn("Javafo return code", scenario["error"])


@override_settings(CACHES=LOCMEM_CACHE, JAVAFO_COMMAND=BROKEN_JAVAFO_COMMAND)
class JavafoCheckDashboardTestCase(TestCase):
    @classmethod
    def setUpTestData(cls):
        createCommonLeagueData()
        Season.objects.update(is_active=True)
        User.objects.create_superuser("admin", "admin@test.com", "test")

    def setUp(self):
        cache.clear()
        self.client.login(username="admin", password="test")

    def test_shows_never_tested_before_first_run(self):
        response = self.client.get(league_url("team", "league_dashboard"))

        self.assertContains(response, "Test JavaFo")
        self.assertContains(response, "web: never tested")
        self.assertContains(response, "celery: never tested")

    @patch("heltour.tournament.tasks.check_javafo.delay")
    def test_runs_web_check_and_queues_celery_check(self, delay):
        response = self.client.post(
            league_url("lone", "league_dashboard"), {"check_javafo": "1"}
        )

        delay.assert_called_once_with()
        self.assertContains(response, "JavaFo failed in the web process")
        self.assertContains(response, "lone FAILED")
        self.assertContains(response, "celery: queued")
        self.assertFalse(cache.get(pairinggen.javafo_check_cache_key("web"))["ok"])
