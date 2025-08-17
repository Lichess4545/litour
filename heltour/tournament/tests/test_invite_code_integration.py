from datetime import timedelta
from unittest.mock import Mock

from django.contrib.auth.models import User
from django.test import TestCase, RequestFactory
from django.utils import timezone

from heltour.tournament.forms import RegistrationForm
from heltour.tournament.models import (
    InviteCode,
    League,
    Player,
    Registration,
    RegistrationMode,
    Round,
    Season,
    SeasonPlayer,
    Team,
    TeamMember,
)
from heltour.tournament.workflows import ApproveRegistrationWorkflow
from heltour.tournament.tests.testutils import Shush


class InviteCodeIntegrationTestCase(TestCase):
    """Integration tests for the complete invite code registration workflow"""
    
    @classmethod
    def setUpTestData(cls):
        """Set up test data for integration tests"""
        cls.admin_user = User.objects.create(
            username='admin',
            password='password',
            is_superuser=True,
            is_staff=True
        )
        
        # Create invite-only team league
        cls.league = League.objects.create(
            name='Integration Test League',
            tag='inttest',
            competitor_type='team',
            rating_type='classical',
            registration_mode=RegistrationMode.INVITE_ONLY
        )
        cls.season = Season.objects.create(
            league=cls.league,
            name='Integration Season',
            tag='intseason',
            rounds=8,
            boards=4
        )
        
        cls.rf = RequestFactory()
        
        # Create rounds with start dates
        start_date = timezone.now()
        for i in range(1, 9):
            Round.objects.create(
                season=cls.season,
                number=i,
                start_date=start_date + timedelta(weeks=i-1),
                end_date=start_date + timedelta(weeks=i),
                publish_pairings=False,
                is_completed=False
            )

    def test_complete_team_formation_workflow(self):
        """Test the complete workflow from captain registration to full team"""
        # Step 1: Admin generates captain codes
        captain_codes = InviteCode.create_batch(
            league=self.league,
            season=self.season,
            count=2,
            created_by=self.admin_user,
            code_type='captain'
        )
        
        self.assertEqual(len(captain_codes), 2)
        
        # Step 2: First captain registers
        captain1 = Player.objects.create(lichess_username='captain1', rating=1800)
        
        form_data = {
            'email': 'captain1@example.com',
            'has_played_20_games': True,
            'can_commit': True,
            'agreed_to_rules': True,
            'agreed_to_tos': True,
            'alternate_preference': 'full_time',
            'invite_code': captain_codes[0].code
        }
        
        form = RegistrationForm(
            data=form_data,
            season=self.season,
            player=captain1
        )
        self.assertTrue(form.is_valid())
        
        with Shush():
            reg1 = form.save()
        
        # Step 3: Approve captain registration
        request = self.rf.post('/')
        request.user = self.admin_user
        
        workflow = ApproveRegistrationWorkflow(reg1)
        modeladmin = Mock()
        
        with Shush():
            workflow.approve_reg(
                request=request,
                modeladmin=modeladmin,
                send_confirm_email=False,
                invite_to_slack=False,
                season=self.season,
                retroactive_byes=0,
                late_join_points=0
            )
        
        # Verify team 1 was created
        team1 = Team.objects.get(season=self.season, number=1)
        self.assertEqual(team1.name, 'Team captain1')
        self.assertTrue(TeamMember.objects.filter(
            team=team1, player=captain1, is_captain=True
        ).exists())
        
        # Step 4: Captain generates team member codes
        member_codes = InviteCode.create_batch(
            league=self.league,
            season=self.season,
            count=3,
            created_by=self.admin_user,  # In practice, would be captain
            code_type='team_member',
            team=team1
        )
        
        # Step 5: Team members register
        members = []
        for i, code in enumerate(member_codes):
            member = Player.objects.create(
                lichess_username=f'member1_{i+1}',
                rating=1600 + (i * 50)
            )
            members.append(member)
            
            form_data = {
                'email': f'member1_{i+1}@example.com',
                'has_played_20_games': True,
                'can_commit': True,
                'agreed_to_rules': True,
                'agreed_to_tos': True,
                'alternate_preference': 'full_time',
                'invite_code': code.code
            }
            
            form = RegistrationForm(
                data=form_data,
                season=self.season,
                player=member
            )
            self.assertTrue(form.is_valid())
            
            with Shush():
                reg = form.save()
            
            # Approve member registration
            workflow = ApproveRegistrationWorkflow(reg)
            with Shush():
                workflow.approve_reg(
                    request=request,
                    modeladmin=modeladmin,
                    send_confirm_email=False,
                    invite_to_slack=False,
                    season=self.season,
                    retroactive_byes=0,
                    late_join_points=0
                )
        
        # Step 6: Verify team composition
        team1.refresh_from_db()
        team_members = TeamMember.objects.filter(team=team1).order_by('board_number')
        self.assertEqual(team_members.count(), 4)  # Captain + 3 members
        
        # Verify board assignments
        self.assertEqual(team_members[0].player, captain1)
        self.assertTrue(team_members[0].is_captain)
        self.assertEqual(team_members[0].board_number, 1)
        
        for i, member in enumerate(members):
            self.assertEqual(team_members[i+1].player, member)
            self.assertFalse(team_members[i+1].is_captain)
            self.assertEqual(team_members[i+1].board_number, i+2)
        
        # Step 7: Second captain creates second team
        captain2 = Player.objects.create(lichess_username='captain2', rating=1900)
        
        form_data = {
            'email': 'captain2@example.com',
            'has_played_20_games': True,
            'can_commit': True,
            'agreed_to_rules': True,
            'agreed_to_tos': True,
            'alternate_preference': 'full_time',
            'invite_code': captain_codes[1].code
        }
        
        form = RegistrationForm(
            data=form_data,
            season=self.season,
            player=captain2
        )
        self.assertTrue(form.is_valid())
        
        with Shush():
            reg2 = form.save()
        
        workflow = ApproveRegistrationWorkflow(reg2)
        with Shush():
            workflow.approve_reg(
                request=request,
                modeladmin=modeladmin,
                send_confirm_email=False,
                invite_to_slack=False,
                season=self.season,
                retroactive_byes=0,
                late_join_points=0
            )
        
        # Verify team 2 was created
        team2 = Team.objects.get(season=self.season, number=2)
        self.assertEqual(team2.name, 'Team captain2')
        
        # Verify we have two teams total
        self.assertEqual(Team.objects.filter(season=self.season).count(), 2)
        
        # Step 8: Verify all codes are properly marked as used
        for code in captain_codes:
            code.refresh_from_db()
            self.assertIsNotNone(code.used_by)
            self.assertIsNotNone(code.used_at)
        
        for code in member_codes:
            code.refresh_from_db()
            self.assertIsNotNone(code.used_by)
            self.assertIsNotNone(code.used_at)
        
        # Step 9: Verify season players were created
        season_players = SeasonPlayer.objects.filter(season=self.season)
        self.assertEqual(season_players.count(), 5)  # 2 captains + 3 members
        
        for sp in season_players:
            self.assertTrue(sp.is_active)
            self.assertIsNotNone(sp.registration)

    def test_mixed_registration_scenarios(self):
        """Test various edge cases and mixed scenarios"""
        # Create a captain code and a team
        captain_code = InviteCode.objects.create(
            league=self.league,
            season=self.season,
            code='EDGE-CAPTAIN-001',
            code_type='captain',
            created_by=self.admin_user
        )
        
        captain = Player.objects.create(lichess_username='edgecaptain', rating=1750)
        
        # Register and approve captain
        form_data = {
            'email': 'edge@example.com',
            'has_played_20_games': True,
            'can_commit': True,
            'agreed_to_rules': True,
            'agreed_to_tos': True,
            'alternate_preference': 'full_time',
            'invite_code': captain_code.code
        }
        
        form = RegistrationForm(data=form_data, season=self.season, player=captain)
        self.assertTrue(form.is_valid())
        
        with Shush():
            reg = form.save()
        
        request = self.rf.post('/')
        request.user = self.admin_user
        workflow = ApproveRegistrationWorkflow(reg)
        modeladmin = Mock()
        
        with Shush():
            workflow.approve_reg(
                request, modeladmin, False, False, self.season, 0, 0
            )
        
        team = Team.objects.get(season=self.season)
        
        # Test: Try to register another player with the same captain code
        another_player = Player.objects.create(lichess_username='another', rating=1600)
        form_data['email'] = 'another@example.com'
        
        form = RegistrationForm(data=form_data, season=self.season, player=another_player)
        self.assertFalse(form.is_valid())
        self.assertIn('already been used', str(form.errors['invite_code']))
        
        # Test: Create member code but try to use it before team exists
        # (This is prevented by the workflow since team is created first)
        
        # Test: Maximum team size enforcement
        # Generate exactly enough codes to fill the team
        max_members = self.season.boards - 1  # -1 for captain
        member_codes = InviteCode.create_batch(
            league=self.league,
            season=self.season,
            count=max_members,
            created_by=self.admin_user,
            code_type='team_member',
            team=team
        )
        
        # Fill the team
        for i, code in enumerate(member_codes):
            member = Player.objects.create(
                lichess_username=f'fullmember{i}',
                rating=1500 + (i * 25)
            )
            
            form_data = {
                'email': f'full{i}@example.com',
                'has_played_20_games': True,
                'can_commit': True,
                'agreed_to_rules': True,
                'agreed_to_tos': True,
                'alternate_preference': 'full_time',
                'invite_code': code.code
            }
            
            form = RegistrationForm(data=form_data, season=self.season, player=member)
            self.assertTrue(form.is_valid())
            
            with Shush():
                reg = form.save()
            
            workflow = ApproveRegistrationWorkflow(reg)
            with Shush():
                workflow.approve_reg(
                    request, modeladmin, False, False, self.season, 0, 0
                )
        
        # Verify team is full
        self.assertEqual(TeamMember.objects.filter(team=team).count(), self.season.boards)
        
        # Test: Player changes their username after registration
        original_member = TeamMember.objects.filter(team=team, is_captain=False).first()
        original_player = original_member.player
        original_username = original_player.lichess_username
        
        # Simulate username change
        original_player.lichess_username = 'changed_username'
        original_player.save()
        
        # Verify team member relationship is maintained
        original_member.refresh_from_db()
        self.assertEqual(original_member.player.lichess_username, 'changed_username')
        self.assertEqual(original_member.team, team)