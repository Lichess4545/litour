from unittest.mock import PropertyMock, patch

from django.contrib.auth.models import User
from django.test import TestCase
from django.test.client import RequestFactory

from heltour.tournament.forms import RegistrationForm
from heltour.tournament.models import (
    AlternatesManagerSetting,
    League,
    Player,
    PlayerAvailability,
    Season,
    SeasonPlayer,
    TeamMember,
)
from heltour.tournament.tests.testutils import (
    Shush,
    create_reg,
    createCommonLeagueData,
    get_season,
)
from heltour.tournament.workflows import (
    ApproveRegistrationWorkflow,
    UpdateBoardOrderWorkflow,
)


class ApproveRegistrationWorkflowTestCase(TestCase):
    @classmethod
    def setUpTestData(cls):
        createCommonLeagueData(round_count=7)
        Player.objects.create(
            lichess_username="newplayer",
            profile={
                "perfs": {"bullet": {"games": 50, "rating": 1650, "rd": 45, "prog": 10}}
            },
            rating=1650,
        )
        cls.superuser = User.objects.create(
            username="superuser", password="password", is_superuser=True, is_staff=True
        )
        cls.season = get_season("lone")
        # creating a reg writes to the log,
        # disable that temporarily for nicer test output
        with Shush():
            cls.reg = create_reg(cls.season, "newplayer")
            cls.reg.weeks_unavailable = "6,7"
        cls.arw = ApproveRegistrationWorkflow(cls.reg, 4)
        cls.rf = RequestFactory()

    def test_ljp_none_rating(self):
        self.assertEqual(self.arw.default_byes, 2)
        self.assertEqual(self.arw.active_round_count, 3)
        self.assertEqual(self.arw.default_ljp, 0)

    @patch("django.contrib.admin.ModelAdmin.message_user", new_callable=PropertyMock)
    @patch("heltour.tournament.workflows.send_mail")
    @patch("heltour.tournament.slackapi.invite_user")
    def test_approve_reg(self, slack_invite, send_mail, model_admin):
        approve_request = self.rf.post("admin:approve_registration")
        approve_request.user = self.superuser
        self.assertEqual(self.reg.status, "pending")
        self.assertEqual(
            SeasonPlayer.objects.filter(player__lichess_username="newplayer").count(), 0
        )
        self.arw.approve_reg(
            approve_request,
            modeladmin=model_admin,
            send_confirm_email=True,
            invite_to_slack=True,
            season=self.season,
            retroactive_byes=0,
            late_join_points=0,
        )
        self.assertEqual(self.reg.status, "approved")
        self.assertEqual(
            SeasonPlayer.objects.filter(player__lichess_username="newplayer").count(), 1
        )
        self.assertEqual(PlayerAvailability.objects.all().count(), 2)
        self.assertTrue(send_mail.called)
        self.assertEqual(
            send_mail.call_args.args[0], "Registration Confirmation - Lone League"
        )
        self.assertTrue(slack_invite.called)
        self.assertEqual(slack_invite.call_args.args[0], "a@test.com")


class UpdateBoardOrderWorkflowTestCase(TestCase):
    @classmethod
    def setUpTestData(cls):
        createCommonLeagueData()
        cls.s = get_season("team")
        AlternatesManagerSetting(league=cls.s.league)
        cls.ubo = UpdateBoardOrderWorkflow(cls.s)
        cls.players = []
        rating = 1000
        for player in Player.objects.all():
            rating += 100
            Player.objects.filter(pk=player.pk).update(
                profile={"perfs": {"classical": {"rating": rating}}}
            )
            cls.players.append(player)

    def test_lonewolf(self):
        self.assertEqual(
            UpdateBoardOrderWorkflow(get_season("lone")).run(alternates_only=True), None
        )

    def test_team_board_order(self):
        self.assertEqual(TeamMember.objects.get(player=self.players[0]).board_number, 1)
        self.assertEqual(TeamMember.objects.get(player=self.players[1]).board_number, 2)
        self.ubo.run(alternates_only=False)
        self.assertEqual(TeamMember.objects.get(player=self.players[0]).board_number, 2)
        self.assertEqual(TeamMember.objects.get(player=self.players[1]).board_number, 1)


class PreApprovedUsernamesTestCase(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.league = League.objects.create(
            name="Open League",
            tag="open-league",
            competitor_type="lone",
            rating_type="classical",
            email_required=False,
            show_provisional_warning=False,
            ask_availability=False,
        )
        cls.season = Season.objects.create(
            league=cls.league,
            name="Spring 2025",
            tag="spring-2025",
            rounds=5,
            pre_approved_usernames="Alice\nBob\nCharlie",
        )

    def test_is_username_pre_approved_match(self):
        self.assertTrue(self.season.is_username_pre_approved("alice"))
        self.assertTrue(self.season.is_username_pre_approved("ALICE"))
        self.assertTrue(self.season.is_username_pre_approved("Alice"))

    def test_is_username_pre_approved_no_match(self):
        self.assertFalse(self.season.is_username_pre_approved("Dave"))

    def test_is_username_pre_approved_empty(self):
        season = Season.objects.create(
            league=self.league,
            name="Empty Season",
            tag="empty-season",
            rounds=3,
            pre_approved_usernames="",
        )
        self.assertFalse(season.is_username_pre_approved("Alice"))

    def test_is_username_pre_approved_whitespace(self):
        season = Season.objects.create(
            league=self.league,
            name="Whitespace Season",
            tag="ws-season",
            rounds=3,
            pre_approved_usernames="  Alice  \n\n  Bob  \n  \n",
        )
        self.assertTrue(season.is_username_pre_approved("Alice"))
        self.assertTrue(season.is_username_pre_approved("Bob"))
        self.assertFalse(season.is_username_pre_approved(""))

    def _make_form(self, player):
        form_data = {
            "agreed_to_tos": True,
            "agreed_to_rules": True,
            "can_commit": True,
        }
        return RegistrationForm(data=form_data, season=self.season, player=player)

    def test_registration_auto_approved_when_pre_approved(self):
        player = Player.objects.create(lichess_username="Alice", rating=1500)
        form = self._make_form(player)
        self.assertTrue(form.is_valid(), form.errors)
        with Shush():
            reg = form.save()
        self.assertEqual(reg.status, "approved")
        self.assertTrue(
            SeasonPlayer.objects.filter(player=player, season=self.season).exists()
        )

    def test_registration_pending_when_not_pre_approved(self):
        player = Player.objects.create(lichess_username="Dave", rating=1500)
        form = self._make_form(player)
        self.assertTrue(form.is_valid(), form.errors)
        with Shush():
            reg = form.save()
        self.assertEqual(reg.status, "pending")
        self.assertFalse(
            SeasonPlayer.objects.filter(player=player, season=self.season).exists()
        )
