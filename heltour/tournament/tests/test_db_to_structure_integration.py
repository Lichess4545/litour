"""
Integration tests to verify that db_to_structure produces correct results
when used with the actual score calculation methods.
"""

from django.test import TestCase
from heltour.tournament.models import (
    League,
    Season,
    Round,
    Team,
    TeamScore,
    TeamPairing,
    TeamPlayerPairing,
    Player,
    SeasonPlayer,
    TeamMember,
)
from heltour.tournament.db_to_structure import season_to_tournament_structure


class DbToStructureIntegrationTests(TestCase):
    """Test that the conversion works correctly with real score calculations."""

    def setUp(self):
        """Create a simple team tournament."""
        self.league = League.objects.create(
            name="Test League",
            tag="TL",
            competitor_type="team",
            rating_type="standard",
            # Configure tiebreaks
            team_tiebreak_1="game_points",
            team_tiebreak_2="head_to_head",
            team_tiebreak_3="games_won",
            team_tiebreak_4="sonneborn_berger",
        )
        self.season = Season.objects.create(
            league=self.league,
            name="Test Season",
            rounds=3,
            boards=2,
        )

        # Create 3 teams with 2 players each
        self.teams = []
        for i in range(1, 4):
            team = Team.objects.create(
                season=self.season,
                name=f"Team {i}",
                number=i,
            )
            self.teams.append(team)

            # Create players for each team
            for j in range(1, 3):  # 2 boards
                player = Player.objects.create(lichess_username=f"team{i}_player{j}")
                SeasonPlayer.objects.create(season=self.season, player=player)
                TeamMember.objects.create(team=team, player=player, board_number=j)

        # Create TeamScore objects for each team
        for team in self.teams:
            TeamScore.objects.create(team=team)

    def create_pairing_with_results(self, round_obj, team1_idx, team2_idx, results):
        """Helper to create a pairing with results."""
        team1 = self.teams[team1_idx]
        team2 = self.teams[team2_idx]

        # Create pairing without triggering save calculations
        # by creating it with incomplete round first
        round_obj.is_completed = False
        round_obj.save()
        
        pairing = TeamPairing.objects.create(
            round=round_obj,
            white_team=team1,
            black_team=team2,
            pairing_order=1,
        )

        # Get team members
        team1_members = list(team1.teammember_set.order_by("board_number"))
        team2_members = list(team2.teammember_set.order_by("board_number"))

        # Create board pairings
        for board_num, result in enumerate(results, 1):
            if board_num % 2 == 1:  # Odd boards: team1 gets white
                white_player = team1_members[board_num - 1].player
                black_player = team2_members[board_num - 1].player
            else:  # Even boards: team2 gets white
                white_player = team2_members[board_num - 1].player
                black_player = team1_members[board_num - 1].player

            TeamPlayerPairing.objects.create(
                team_pairing=pairing,
                board_number=board_num,
                white=white_player,
                black=black_player,
                result=result,
            )

        # Update pairing points
        pairing.refresh_points()
        pairing.save()
        
        # Now mark round as completed
        round_obj.is_completed = True
        round_obj.save()

        return pairing

    def test_simple_tournament_scores(self):
        """Test a simple 3-team round robin."""
        # Round 1: Team 1 beats Team 2 (1.5-0.5)
        round1 = Round.objects.create(season=self.season, number=1, is_completed=False)
        self.create_pairing_with_results(round1, 0, 1, ["1-0", "1/2-1/2"])

        # Round 2: Team 1 beats Team 3 (2-0), Team 2 gets bye
        round2 = Round.objects.create(season=self.season, number=2, is_completed=False)
        self.create_pairing_with_results(round2, 0, 2, ["1-0", "0-1"])

        # Round 3: Team 2 beats Team 3 (2-0), Team 1 gets bye
        round3 = Round.objects.create(season=self.season, number=3, is_completed=False)
        self.create_pairing_with_results(round3, 1, 2, ["1-0", "0-1"])

        # Calculate scores using the new method
        self.season.calculate_scores()

        # Get the scores
        scores = {
            ts.team.number: ts
            for ts in TeamScore.objects.filter(team__season=self.season)
        }
        # Verify match points
        # Team 1: Win + Win + Bye = 2 + 2 + 1 = 5
        # Note: With proper bye handling, Team 1 gets a bye in round 3
        self.assertEqual(scores[1].match_points, 5)
        # Team 2: Loss + Bye + Win = 0 + 1 + 2 = 3
        self.assertEqual(scores[2].match_points, 3)
        # Team 3: Bye + Loss + Loss = 1 + 0 + 0 = 1
        self.assertEqual(scores[3].match_points, 1)

        # Verify game points
        # Team 1: 1.5 + 2 + 1 (bye) = 4.5
        self.assertEqual(scores[1].game_points, 4.5)
        # Team 2: 0.5 + 1 (bye) + 2 = 3.5
        self.assertEqual(scores[2].game_points, 3.5)
        # Team 3: 1 (bye) + 0 + 0 = 1
        self.assertEqual(scores[3].game_points, 1)

        # Verify games won
        # Team 1: 1 + 2 + 0 = 3
        self.assertEqual(scores[1].games_won, 3)
        # Team 2: 0 + 0 + 2 = 2
        self.assertEqual(scores[2].games_won, 2)
        # Team 3: 0 + 0 + 0 = 0
        self.assertEqual(scores[3].games_won, 0)

        # Verify match count (excluding byes)
        self.assertEqual(scores[1].match_count, 2)
        self.assertEqual(scores[2].match_count, 2)
        self.assertEqual(scores[3].match_count, 2)

        # Verify Sonneborn-Berger
        # Team 1: Beat Team2(3MP) = 3, Beat Team3(1MP) = 1, Total = 4
        self.assertEqual(scores[1].sb_score, 4.0)
        # Team 2: Lost to Team1(5MP) = 0, Beat Team3(1MP) = 1, Total = 1
        self.assertEqual(scores[2].sb_score, 1.0)
        # Team 3: Lost to Team1(5MP) = 0, Lost to Team2(3MP) = 0, Total = 0
        self.assertEqual(scores[3].sb_score, 0.0)

    def test_conversion_matches_calculation(self):
        """Test that direct conversion gives same results as calculate_scores."""
        # Set up same tournament as above
        round1 = Round.objects.create(season=self.season, number=1, is_completed=False)
        self.create_pairing_with_results(round1, 0, 1, ["1-0", "1/2-1/2"])

        round2 = Round.objects.create(season=self.season, number=2, is_completed=False)
        self.create_pairing_with_results(round2, 0, 2, ["1-0", "0-1"])

        round3 = Round.objects.create(season=self.season, number=3, is_completed=False)
        self.create_pairing_with_results(round3, 1, 2, ["1-0", "1-0"])

        # Convert to tournament structure
        tournament = season_to_tournament_structure(self.season)
        results = tournament.calculate_results()

        # Calculate using the season method
        self.season.calculate_scores()

        # Compare results
        scores = {
            ts.team.number: ts
            for ts in TeamScore.objects.filter(team__season=self.season)
        }

        for team_num, score in scores.items():
            team_id = self.teams[team_num - 1].id
            self.assertIn(team_id, results)
            result = results[team_id]

            # Compare basic scores
            self.assertEqual(
                result.match_points,
                score.match_points,
                f"Team {team_num} match points mismatch",
            )
            self.assertEqual(
                result.game_points,
                score.game_points,
                f"Team {team_num} game points mismatch",
            )

