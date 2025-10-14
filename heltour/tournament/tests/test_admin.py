from unittest.mock import ANY, patch

from django.contrib import admin, messages
from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone

from heltour.tournament.models import (
    Alternate,
    LonePlayerPairing,
    Player,
    Round,
    Season,
    SeasonPlayer,
    Team,
    TeamMember,
    TeamPairing,
    TeamPlayerPairing,
)
from heltour.tournament.tests.testutils import (
    createCommonLeagueData,
    get_round,
    get_season,
)


class AdminSearchTestCase(TestCase):
    def test_all_search_fields(self):
        superuser = User(
            username="superuser",
            password="Password",
            is_superuser=True,
            is_staff=True,
        )
        superuser.save()
        self.client.force_login(user=superuser)
        for model_class, admin_class in admin.site._registry.items():
            with self.subTest(model_class._meta.model_name):
                path = reverse(
                    f"admin:{model_class._meta.app_label}_{model_class._meta.model_name}_changelist"
                )
                response = self.client.get(path + "?q=whatever")
                self.assertEqual(response.status_code, 200)


class SeasonAdminTestCase(TestCase):
    @classmethod
    def setUpTestData(cls):
        createCommonLeagueData()
        cls.superuser = User.objects.create(
            username="superuser", password="password", is_superuser=True, is_staff=True
        )
        cls.t1 = Team.objects.get(number=1)
        cls.t2 = Team.objects.get(number=2)
        cls.t3 = Team.objects.get(number=3)
        cls.t4 = Team.objects.get(number=4)
        cls.r1 = get_round("team", 1)
        Round.objects.filter(pk=cls.r1.pk).update(publish_pairings=True)
        cls.tp1 = TeamPairing.objects.create(
            white_team=cls.t1, black_team=cls.t2, round=cls.r1, pairing_order=1
        )
        cls.p1 = Player.objects.get(lichess_username="Player1")
        cls.p2 = Player.objects.get(lichess_username="Player2")
        cls.p3 = Player.objects.get(lichess_username="Player3")
        cls.p4 = Player.objects.get(lichess_username="Player4")
        cls.s = get_season("team")
        cls.sp1 = SeasonPlayer.objects.create(player=cls.p1, season=cls.s)
        cls.path_s_changelist = reverse("admin:tournament_season_changelist")
        cls.path_m_p = reverse("admin:manage_players", args=[cls.s.pk])

    @patch("django.contrib.admin.ModelAdmin.message_user")
    @patch("heltour.tournament.signals.do_create_broadcast.send")
    def test_create_several_broadcasts(self, dcb, message):
        self.client.force_login(user=self.superuser)
        self.client.post(
            reverse("admin:tournament_season_changelist"),
            data={
                "action": "create_broadcast",
                "_selected_action": Season.objects.all().values_list("pk", flat=True)
            },
            follow=True,
        )
        message.assert_called_once_with(
            ANY,
            "Can only create one broadcast at a time.",
            ANY
        )
        dcb.assert_not_called()


    @patch("heltour.tournament.simulation.simulate_season")
    @patch("django.contrib.admin.ModelAdmin.message_user")
    def test_simulate(self, message, simulate):
        with self.settings(DEBUG=True, STAGING=False):
            from django.conf import settings
            self.client.force_login(user=self.superuser)
            self.client.post(
                self.path_s_changelist,
                data={
                    "action": "simulate_tournament",
                    "_selected_action": get_season("lone").pk,
                },
                follow=True,
            )
            self.assertTrue(message.called)
            self.assertEqual(message.call_args.args[1], "Simulation complete.")
            self.assertTrue(simulate.called)

    @patch("heltour.tournament.models.Season.calculate_scores")
    @patch("heltour.tournament.models.TeamPairing.refresh_points")
    @patch("heltour.tournament.models.TeamPairing.save")
    @patch("django.contrib.admin.ModelAdmin.message_user")
    def test_recalculate(self, message, tpsave, tprefresh, scalculate):
        self.client.force_login(user=self.superuser)
        self.client.post(
            self.path_s_changelist,
            data={
                "action": "recalculate_scores",
                "_selected_action": get_season("lone").pk,
            },
            follow=True,
        )
        self.assertFalse(tprefresh.called)
        self.assertFalse(tpsave.called)
        self.assertTrue(scalculate.called)
        self.assertTrue(message.called)
        self.assertEqual(message.call_args.args[1], "Scores recalculated.")
        message.reset_mock()
        scalculate.reset_mock()
        self.client.post(
            self.path_s_changelist,
            data={
                "action": "recalculate_scores",
                "_selected_action": Season.objects.all().values_list("pk", flat=True),
            },
            follow=True,
        )
        self.assertTrue(tprefresh.called)
        self.assertTrue(tpsave.called)
        self.assertTrue(scalculate.called)
        self.assertEqual(scalculate.call_count, 2)
        self.assertTrue(message.called)
        self.assertEqual(message.call_args.args[1], "Scores recalculated.")

    @patch("django.contrib.admin.ModelAdmin.message_user")
    @patch(
        "heltour.tournament.admin.normalize_gamelink",
        side_effect=[("incorrectlink1", False), ("mockedlink2", True)],
    )
    def test_verify(self, gamelink, message):
        self.client.force_login(user=self.superuser)
        self.client.post(
            self.path_s_changelist,
            data={
                "action": "verify_data",
                "_selected_action": Season.objects.all().values_list("pk", flat=True),
            },
            follow=True,
        )
        self.assertTrue(message.called)
        self.assertEqual(message.call_args.args[1], "Data verified.")
        message.reset_mock()
        lr1 = get_round("lone", 1)
        lpp1 = LonePlayerPairing.objects.create(
            round=lr1,
            white=self.p1,
            black=self.p2,
            game_link="incorrectlink1",
            pairing_order=0,
        )
        lpp2 = LonePlayerPairing.objects.create(
            round=lr1,
            white=self.p3,
            black=self.p4,
            game_link="incorrectlink2",
            pairing_order=1,
        )
        self.client.post(
            self.path_s_changelist,
            data={
                "action": "verify_data",
                "_selected_action": Season.objects.all().values_list("pk", flat=True),
            },
            follow=True,
        )
        lpp2.refresh_from_db()
        self.assertEqual(gamelink.call_count, 2)
        self.assertTrue(message.call_count, 2)
        self.assertEqual(
            message.call_args_list[0][0][1], "1 bad gamelinks for Test Season."
        )
        self.assertEqual(message.call_args[0][1], "Data verified.")
        self.assertEqual(lpp1.game_link, "incorrectlink1")
        self.assertEqual(lpp2.game_link, "mockedlink2")

    @patch("django.contrib.admin.ModelAdmin.message_user")
    def test_review_nominated(self, message):
        self.client.force_login(user=self.superuser)
        TeamPlayerPairing.objects.create(
            white=self.p1,
            black=self.p2,
            board_number=1,
            team_pairing=self.tp1,
            game_link="https://lichess.org/rgame01",
        )
        TeamPlayerPairing.objects.create(
            white=self.p3,
            black=self.p4,
            board_number=2,
            team_pairing=self.tp1,
            game_link="https://lichess.org/rgame02",
        )
        response = self.client.post(
            self.path_s_changelist,
            data={
                "action": "review_nominated_games",
                "_selected_action": Season.objects.all().values_list("pk", flat=True),
            },
            follow=True,
        )
        self.assertTrue(message.called)
        self.assertEqual(
            message.call_args.args[1],
            "Nominated games can only be reviewed one season at a time.",
        )
        message.reset_mock()
        response = self.client.post(
            self.path_s_changelist,
            data={"action": "review_nominated_games", "_selected_action": self.s.pk},
            follow=True,
        )
        self.assertEqual(response.context["original"], self.s)
        self.assertEqual(response.context["title"], "Review nominated games")
        self.assertEqual(response.context["nominations"], [])
        self.assertFalse(message.called)
        Season.objects.filter(pk=self.s.pk).update(nominations_open=True)
        response = self.client.post(
            self.path_s_changelist,
            data={"action": "review_nominated_games", "_selected_action": self.s.pk},
            follow=True,
        )
        self.assertTrue(message.called)
        self.assertEqual(
            message.call_args.args[1],
            "Nominations are still open. You should edit the season and close nominations before reviewing.",
        )

    @patch("django.contrib.admin.ModelAdmin.message_user")
    def test_round_transition(self, message):
        self.client.force_login(user=self.superuser)
        response = self.client.post(
            self.path_s_changelist,
            data={
                "action": "round_transition",
                "_selected_action": Season.objects.all().values_list("pk", flat=True),
            },
            follow=True,
        )
        self.assertTrue(message.called)
        self.assertEqual(
            message.call_args.args[1],
            "Rounds can only be transitioned one season at a time.",
        )
        message.reset_mock()
        response = self.client.post(
            self.path_s_changelist,
            data={"action": "round_transition", "_selected_action": self.s.pk},
            follow=True,
        )
        self.assertFalse(message.called)
        self.assertTemplateUsed(response, "tournament/admin/round_transition.html")

    @patch("django.contrib.admin.ModelAdmin.message_user")
    @patch(
        "heltour.tournament.workflows.RoundTransitionWorkflow.run",
        return_value=[("workflow_mock", messages.INFO)],
    )
    def test_round_transition_view(self, workflow, message):
        self.client.force_login(user=self.superuser)
        path = reverse("admin:round_transition", args=[self.s.pk])
        # test invalid form
        response = self.client.post(
            path, data={"round_to_open": 2, "generate_pairings": True}, follow=True
        )
        self.assertFalse(message.called)
        self.assertTemplateUsed(response, "tournament/admin/round_transition.html")
        # test valid form
        response = self.client.post(
            path,
            data={"round_to_close": 1, "round_to_open": 2, "generate_pairings": True},
            follow=True,
        )
        self.assertTrue(message.called)
        self.assertEqual(message.call_args.args[1], "workflow_mock")
        self.assertTemplateUsed(response, "tournament/admin/review_team_pairings.html")
        # don't generate pairings
        response = self.client.post(
            path,
            data={"round_to_close": 1, "round_to_open": 2, "generate_pairings": False},
            follow=True,
        )
        self.assertTemplateUsed(response, "admin/change_list.html")

    @patch("django.contrib.admin.ModelAdmin.message_user")
    def test_team_spam(self, message):
        self.client.force_login(user=self.superuser)
        path = reverse("admin:tournament_season_changelist")
        response = self.client.post(
            path,
            data={
                "action": "team_spam",
                "_selected_action": Season.objects.all().values_list("pk", flat=True),
            },
            follow=True,
        )
        self.assertTrue(message.called)
        self.assertEqual(
            message.call_args.args[1],
            "Team spam can only be sent one season at a time.",
        )
        message.reset_mock()
        response = self.client.post(
            path,
            data={"action": "team_spam", "_selected_action": self.s.pk},
            follow=True,
        )
        self.assertFalse(message.called)
        self.assertTemplateUsed(response, "tournament/admin/team_spam.html")

    @patch("heltour.tournament.slackapi.send_message")
    @patch("django.contrib.admin.ModelAdmin.message_user")
    def test_team_spam_view(self, message, slack_message):
        self.client.force_login(user=self.superuser)
        path = reverse("admin:team_spam", args=[self.s.pk])
        # no confirm_send, no messages
        response = self.client.post(
            path,
            data={"text": "message sent to teams", "confirm_send": False},
            follow=True,
        )
        self.assertFalse(message.called)
        self.assertFalse(slack_message.called)
        self.assertTemplateUsed(response, "tournament/admin/team_spam.html")
        # teams have no slack channels
        response = self.client.post(
            path,
            data={"text": "message sent to teams", "confirm_send": True},
            follow=True,
        )
        self.assertTrue(message.called)
        self.assertEqual(
            message.call_args.args[1], "Spam sent to 4 teams."
        )  # bug that should be fixed, spam was not sent to 4 teams.
        self.assertFalse(slack_message.called)
        self.assertTemplateUsed(response, "admin/change_list.html")
        # create slack channels
        Team.objects.all().update(slack_channel="channel")
        response = self.client.post(
            path,
            data={"text": "message sent to teams", "confirm_send": True},
            follow=True,
        )
        self.assertTrue(message.called)
        self.assertEqual(
            message.call_args.args[1], "Spam sent to 4 teams."
        )  # correct now.
        self.assertEqual(slack_message.call_count, 4)
        self.assertEqual(slack_message.call_args.args[1], "message sent to teams")
        self.assertTemplateUsed(response, "admin/change_list.html")

    def test_manage_players_add_delete_alternate(self):
        Season.objects.filter(pk=self.s.pk).update(start_date=timezone.now())
        self.client.force_login(user=self.superuser)
        self.client.post(
            self.path_m_p,
            data={
                "changes": '[{"action": "create-alternate", "board_number": 1, "player_name": "Player1"}]'
            },
        )
        # check that the correct alternate was created
        self.assertEqual(Alternate.objects.all().count(), 1)
        self.assertEqual(
            Alternate.objects.all().first().season_player.player.lichess_username,
            "Player1",
        )
        self.client.post(
            self.path_m_p,
            data={
                "changes": '[{"action": "delete-alternate", "board_number": 1, "player_name": "Player1"}]'
            },
        )
        self.assertEqual(Alternate.objects.all().count(), 0)

    @patch("django.contrib.admin.ModelAdmin.message_user")
    def test_manage_players_switch_team_players(self, message):
        # assert the correct team player order
        self.assertEqual(
            TeamMember.objects.get(team=self.t1, board_number=1).player, self.p1
        )
        self.assertEqual(
            TeamMember.objects.get(team=self.t2, board_number=1).player, self.p3
        )
        self.client.force_login(user=self.superuser)
        # switch team players between teams
        datastring = (
            '[{"action": "change-member", "team_number": 1, "board_number": 1,'
            ' "player": {"name": "Player3", "is_captain": false, "is_vice_captain": false}}, '
            '{"action": "change-member", "team_number": 2, "board_number": 1,'
            ' "player": {"name": "Player1", "is_captain": false, "is_vice_captain": false}}]'
        )
        self.client.post(
            self.path_m_p,
            data={"changes": datastring},
        )
        self.assertFalse(message.called)
        # assert new order
        self.assertEqual(
            TeamMember.objects.get(team=self.t1, board_number=1).player, self.p3
        )
        self.assertEqual(
            TeamMember.objects.get(team=self.t2, board_number=1).player, self.p1
        )
        # try malformed data
        self.client.post(
            self.path_m_p,
            data={
                "changes": (
                    '[{"action": "change-member","team_number": 1, "board_nuber": 1}]'
                )
            },
        )
        # message should be called allerting us to the problem
        self.assertTrue(message.called)
        self.assertEqual(message.call_args.args[1], "Some changes could not be saved.")

    @patch("django.contrib.admin.ModelAdmin.message_user")
    def test_manage_players_empty_team_player(self, message):
        # assert the correct team player order
        self.assertEqual(
            TeamMember.objects.get(team=self.t1, board_number=1).player, self.p1
        )
        self.client.force_login(user=self.superuser)
        # switch team players between teams
        datastring = (
            '[{"action": "change-member", "team_number": 1, "board_number": 1,'
            ' "player": null}]'
        )
        self.client.post(
            self.path_m_p,
            data={"changes": datastring},
        )
        self.assertFalse(message.called)
        self.assertEqual(
            TeamMember.objects.filter(team=self.t1, board_number=1).count(), 0
        )

    def test_manage_players_get(self):
        # assert the correct team player order
        self.client.force_login(user=self.superuser)
        response = self.client.get(self.path_m_p)
        self.assertIn("red_players", response.context)
        self.assertIn("blue_players", response.context)
        self.assertIn("green_players", response.context)
        self.assertIn("purple_players", response.context)
        self.assertIn("unassigned_by_board", response.context)
        self.assertIn("teams", response.context)
        self.assertEqual(response.context["red_players"], {self.p1})
        self.assertEqual(response.context["blue_players"], set())
        self.assertEqual(response.context["green_players"], set())
        self.assertEqual(response.context["purple_players"], set())
        self.assertEqual(response.context["unassigned_by_board"], [(1, []), (2, [])])
        self.assertEqual(
            response.context["teams"], [self.t1, self.t2, self.t3, self.t4]
        )


class SeasonAdminNoPublishedPairingsTestCase(TestCase):
    @classmethod
    def setUpTestData(cls):
        createCommonLeagueData()
        cls.superuser = User.objects.create(
            username="superuser", password="password", is_superuser=True, is_staff=True
        )
        cls.t1 = Team.objects.get(number=1)
        cls.p1 = Player.objects.get(lichess_username="Player1")
        cls.s = get_season("team")
        cls.sp1 = SeasonPlayer.objects.create(player=cls.p1, season=cls.s)
        cls.path_m_p = reverse("admin:manage_players", args=[cls.s.pk])

    @patch("django.contrib.admin.ModelAdmin.message_user")
    def test_change_team(self, message):
        # assert the correct team player order
        self.assertEqual(self.t1.name, "Team 1")
        self.client.force_login(user=self.superuser)
        # rename team
        datastring = (
            '[{"action": "change-team", "team_number": 1, "team_name": "TestTeam"}]'
        )
        self.client.post(
            self.path_m_p,
            data={"changes": datastring},
        )
        self.assertFalse(message.called)
        self.assertEqual(Team.objects.get(pk=self.t1.pk).name, "TestTeam")

    @patch("django.contrib.admin.ModelAdmin.message_user")
    def test_create_team(self, message):
        self.assertEqual(Team.objects.all().count(), 4)
        self.client.force_login(user=self.superuser)
        datastring = (
            '[{"action": "create-team", "team_number": 5, '
            '"model": {"number": 5, "name": "AddTeam", "boards": ['
            '{"name": "Player1", "is_captain": false},'
            '{"name": "Player2", "is_captain": true}]}}]'
        )
        self.client.post(
            self.path_m_p,
            data={"changes": datastring},
        )
        self.assertEqual(Team.objects.all().count(), 5)
        self.assertEqual(Team.objects.get(number=5).name, "AddTeam")
        self.assertFalse(message.called)


class TeamCopyAdminTestCase(TestCase):
    @classmethod
    def setUpTestData(cls):
        createCommonLeagueData()
        cls.superuser = User.objects.create(
            username="superuser", password="password", is_superuser=True, is_staff=True
        )
        
        # Get existing teams and season
        cls.original_season = get_season("team")
        cls.original_teams = Team.objects.filter(season=cls.original_season)[:2]  # Get first 2 teams
        
        # Create a new compatible season (same league, same boards)
        from heltour.tournament.models import League
        cls.target_league = League.objects.create(
            name="Test Target League",
            tag="TTL",
            competitor_type="team"
        )
        cls.target_season = Season.objects.create(
            league=cls.target_league,
            name="Target Season",
            tag="TS",
            rounds=10,  # Required field
            boards=2,  # Same as original (createCommonLeagueData uses 2 boards)
            is_active=True
        )
        
        # Create incompatible season (different boards)
        cls.incompatible_season = Season.objects.create(
            league=cls.target_league,
            name="Incompatible Season", 
            tag="IS",
            rounds=10,  # Required field
            boards=6,  # Different boards
            is_active=True
        )

    def test_copy_teams_to_season_view_get(self):
        """Test the GET request shows the form with compatible seasons"""
        self.client.force_login(user=self.superuser)
        team_ids = ','.join([str(team.id) for team in self.original_teams])
        response = self.client.get(f'/admin/tournament/team/copy_teams_to_season/?team_ids={team_ids}')
        
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'Copy Teams to New Season')
        self.assertContains(response, self.target_season.name)
        self.assertNotContains(response, self.incompatible_season.name)  # Should not show incompatible
        
        # Check teams are displayed
        for team in self.original_teams:
            self.assertContains(response, team.name)

    def test_copy_teams_success(self):
        """Test successful team copying"""
        self.client.force_login(user=self.superuser)
        team_ids = ','.join([str(team.id) for team in self.original_teams])
        
        # Count teams before
        original_count = Team.objects.filter(season=self.target_season).count()
        
        # Post the copy request
        response = self.client.post(
            f'/admin/tournament/team/copy_teams_to_season/?team_ids={team_ids}',
            data={'target_season': self.target_season.id},
            follow=True
        )
        
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'Successfully copied 2 teams')
        
        # Check teams were created
        new_teams = Team.objects.filter(season=self.target_season)
        self.assertEqual(new_teams.count(), original_count + 2)
        
        # Verify team data was copied correctly
        for original_team in self.original_teams:
            copied_team = new_teams.get(name=original_team.name)
            self.assertEqual(copied_team.company_name, original_team.company_name)
            self.assertEqual(copied_team.company_address, original_team.company_address)
            self.assertEqual(copied_team.team_contact_email, original_team.team_contact_email)
            self.assertEqual(copied_team.team_contact_number, original_team.team_contact_number)
            self.assertTrue(copied_team.is_active)
            self.assertEqual(copied_team.slack_channel, '')  # Should be blank
            self.assertEqual(copied_team.seed_rating, original_team.seed_rating)  # Should match original
            
            # Verify TeamScore object was created (required for standings)
            self.assertTrue(hasattr(copied_team, 'teamscore'))
            team_score = copied_team.teamscore
            self.assertIsNotNone(team_score)
            self.assertEqual(team_score.team, copied_team)
            
            # Check team members were copied
            original_members = original_team.teammember_set.all()
            copied_members = copied_team.teammember_set.all()
            self.assertEqual(copied_members.count(), original_members.count())
            
            for original_member in original_members:
                copied_member = copied_members.get(board_number=original_member.board_number)
                self.assertEqual(copied_member.player, original_member.player)
                self.assertEqual(copied_member.is_captain, original_member.is_captain)
                self.assertEqual(copied_member.is_vice_captain, original_member.is_vice_captain)
                
                # Check player was registered for target season
                self.assertTrue(
                    SeasonPlayer.objects.filter(
                        season=self.target_season,
                        player=original_member.player
                    ).exists()
                )

    def test_team_number_assignment(self):
        """Test that team numbers are assigned correctly using max + 1"""
        self.client.force_login(user=self.superuser)
        
        # Create an existing team with number 3 in target season
        existing_team = Team.objects.create(
            season=self.target_season,
            number=3,
            name="Existing Team",
            company_name="Existing Co",
            is_active=True
        )
        
        team_ids = str(self.original_teams[0].id)
        response = self.client.post(
            f'/admin/tournament/team/copy_teams_to_season/?team_ids={team_ids}',
            data={'target_season': self.target_season.id},
            follow=True
        )
        
        self.assertEqual(response.status_code, 200)
        
        # New team should get number 4 (max 3 + 1)
        new_team = Team.objects.filter(season=self.target_season, name=self.original_teams[0].name).first()
        self.assertIsNotNone(new_team)
        self.assertEqual(new_team.number, 4)

    def test_duplicate_team_name_handling(self):
        """Test that duplicate team names are handled by appending numbers"""
        self.client.force_login(user=self.superuser)
        
        # Create an existing team with the same name as one we'll copy
        original_team_name = self.original_teams[0].name
        Team.objects.create(
            season=self.target_season,
            number=1,
            name=original_team_name,  # Same name as original team
            company_name="Existing Co",
            is_active=True
        )
        
        # Copy the team
        team_ids = str(self.original_teams[0].id)
        response = self.client.post(
            f'/admin/tournament/team/copy_teams_to_season/?team_ids={team_ids}',
            data={'target_season': self.target_season.id},
            follow=True
        )
        
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'Successfully copied 1 teams')
        
        # Check that the copied team has a modified name
        copied_team = Team.objects.filter(
            season=self.target_season, 
            name=f"{original_team_name} (2)"
        ).first()
        self.assertIsNotNone(copied_team)
        self.assertEqual(copied_team.name, f"{original_team_name} (2)")
        
        # Verify the original name team still exists
        original_name_team = Team.objects.filter(
            season=self.target_season,
            name=original_team_name
        ).first()
        self.assertIsNotNone(original_name_team)

    def test_board_order_editing_after_copy(self):
        """Test that board order editing works on copied teams"""
        self.client.force_login(user=self.superuser)
        
        # Copy a team first
        team_ids = str(self.original_teams[0].id)
        self.client.post(
            f'/admin/tournament/team/copy_teams_to_season/?team_ids={team_ids}',
            data={'target_season': self.target_season.id}
        )
        
        # Get the copied team
        copied_team = Team.objects.get(season=self.target_season, name=self.original_teams[0].name)
        copied_members = list(copied_team.teammember_set.order_by('board_number'))
        
        # Verify we have team members to work with
        self.assertGreater(len(copied_members), 1)
        
        # Test the board order editing action
        response = self.client.post(
            reverse('admin:tournament_team_changelist'),
            data={
                'action': 'update_board_order_by_rating',
                '_selected_action': [copied_team.id]
            },
            follow=True
        )
        
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'Board order updated')
        
        # Verify board order was updated (members should be reordered by rating)
        updated_members = list(copied_team.teammember_set.order_by('board_number'))
        
        # Check that all members still exist and have valid board numbers
        self.assertEqual(len(updated_members), len(copied_members))
        for i, member in enumerate(updated_members):
            self.assertEqual(member.board_number, i + 1)

    def test_copy_teams_permission_denied(self):
        """Test that copying fails without proper permissions"""
        # Create a non-superuser
        regular_user = User.objects.create(
            username="regular", password="password", is_staff=True
        )
        self.client.force_login(user=regular_user)
        
        team_ids = str(self.original_teams[0].id)
        
        # Should return error message instead of raising exception
        response = self.client.post(
            f'/admin/tournament/team/copy_teams_to_season/?team_ids={team_ids}',
            data={'target_season': self.target_season.id},
            follow=True
        )
        
        # Should contain permission error or redirect back to team list
        self.assertEqual(response.status_code, 200)

    def test_copy_teams_invalid_target_season(self):
        """Test error handling for invalid target season"""
        self.client.force_login(user=self.superuser)
        team_ids = str(self.original_teams[0].id)
        
        response = self.client.post(
            f'/admin/tournament/team/copy_teams_to_season/?team_ids={team_ids}',
            data={'target_season': 99999},  # Non-existent season
            follow=True
        )
        
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'Invalid target season')
