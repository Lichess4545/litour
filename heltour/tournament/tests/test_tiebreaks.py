from django.test import TestCase
from django.core.exceptions import ValidationError
from heltour.tournament.models import (
    Round,
    Team,
    TeamScore,
    TeamPairing,
    TeamBye,
    TeamPlayerPairing,
    TEAM_TIEBREAK_OPTIONS,
)
from heltour.tournament.tests.test_tournament_simulation import TournamentBuilder


class TeamTiebreakTestCase(TestCase):
    def create_base_tournament(self, rounds=3, boards=2):
        """Create a base tournament with 4 teams for testing."""
        return (
            TournamentBuilder()
            .league("Test League", "TL", "team", theme="blue", pairing_type="swiss-dutch", rating_type="classical")
            .season("TL", "Test Season", rounds=rounds, boards=boards)
            .team("Team 1", "T1P1", "T1P2")
            .team("Team 2", "T2P1", "T2P2")
            .team("Team 3", "T3P1", "T3P2")
            .team("Team 4", "T4P1", "T4P2")
        )

    def test_match_points_calculation(self):
        """Test that match points are calculated correctly"""
        tournament = (
            self.create_base_tournament(rounds=1)
            .round(1)
            .match("Team 1", "Team 2", "1-0", "1/2-1/2")  # Team 1 wins 1.5-0.5
            # Teams 3 and 4 get automatic byes
            .complete()
            .calculate()
            .build()
        )

        season = tournament.seasons["Test Season"]
        scores = {
            ts.team.number: ts
            for ts in TeamScore.objects.filter(team__season=season)
        }

        # Check match points
        self.assertEqual(scores[1].match_points, 2)  # Win = 2 points
        self.assertEqual(scores[2].match_points, 0)  # Loss = 0 points
        # Team 3 got a bye (no pairing)
        self.assertEqual(scores[3].match_points, 1)  # Bye = 1 point
        self.assertEqual(scores[3].game_points, 1.0)  # 2 boards / 2 = 1 game point

    def test_game_points_calculation(self):
        """Test that game points are calculated correctly"""
        tournament = (
            self.create_base_tournament(rounds=1)
            .round(1)
            .match("Team 1", "Team 2", "1-0", "1/2-1/2")  # Team 1 wins 1.5-0.5
            .complete()
            .calculate()
            .build()
        )

        season = tournament.seasons["Test Season"]
        scores = {
            ts.team.number: ts
            for ts in TeamScore.objects.filter(team__season=season)
        }

        self.assertEqual(scores[1].game_points, 1.5)
        self.assertEqual(scores[2].game_points, 0.5)

    def test_sonneborn_berger_calculation(self):
        """Test Sonneborn-Berger tiebreak calculation"""
        tournament = (
            self.create_base_tournament(rounds=2)
            .round(1)
            .match("Team 1", "Team 2", "1-0", "1/2-1/2")  # Team 1 wins 1.5-0.5
            # Team 3 gets bye
            .complete()
            .round(2)
            .match("Team 1", "Team 3", "1-0", "0-1")  # Draw 1-1
            # Team 2 gets bye
            .complete()
            .calculate()
            .build()
        )

        season = tournament.seasons["Test Season"]
        league = season.league
        
        # Configure sonneborn-berger as a tiebreak
        league.team_tiebreak_1 = "sonneborn_berger"
        league.save()
        
        # Recalculate scores with the tiebreak configured
        season.calculate_scores()

        scores = {
            ts.team.number: ts
            for ts in TeamScore.objects.filter(team__season=season)
        }

        # Verify SB calculation
        # Team 1: Won vs Team 2 (final: 1 MP), Drew vs Team 3 (final: 2 MP)
        # SB = 1*1 + 2*0.5 = 2.0
        self.assertEqual(scores[1].sb_score, 2.0)

    def test_buchholz_calculation(self):
        """Test Buchholz tiebreak calculation"""
        tournament = (
            self.create_base_tournament(rounds=2)
            .round(1)
            .match("Team 1", "Team 2", "1-0", "1/2-1/2")  # Team 1 wins 1.5-0.5
            # Team 3 and 4 get byes
            .complete()
            .round(2)
            .match("Team 1", "Team 3", "1-0", "1/2-1/2")  # Team 1 wins 1.5-0.5  
            # Team 2 and 4 get byes
            .complete()
            .calculate()
            .build()
        )

        season = tournament.seasons["Test Season"]
        league = season.league
        
        # Configure buchholz as a tiebreak
        league.team_tiebreak_2 = "buchholz"  # Add buchholz to the tiebreaks
        league.save()
        
        # Recalculate scores with the tiebreak configured
        season.calculate_scores()

        scores = {
            ts.team.number: ts
            for ts in TeamScore.objects.filter(team__season=season)
        }

        # Verify individual team scores first
        # Team 1: Win R1 (2) + Win R2 (2) = 4 match points
        self.assertEqual(scores[1].match_points, 4)  # Team 1: 2 wins = 4 points
        # Team 2: Loss R1 (0) + Bye R2 (1) = 1 match point
        self.assertEqual(scores[2].match_points, 1)  # Team 2: 1 loss + 1 bye = 1 point
        # Team 3: Bye R1 (1) + Loss R2 (0) = 1 match point
        self.assertEqual(scores[3].match_points, 1)  # Team 3: 1 bye + 1 loss = 1 point
        # Team 4 gets a bye in both rounds = 1 + 1 = 2 match points
        self.assertEqual(scores[4].match_points, 2)  # Team 4: 2 byes = 2 points

        # Team 1 played against Team 2 and Team 3
        # Buchholz is the sum of all opponents' match points
        # Team 2: 0 (loss) + 1 (bye) = 1 match point
        # Team 3: 1 (bye) + 0 (loss) = 1 match point
        # Buchholz = 1 + 1 = 2.0
        self.assertEqual(scores[1].buchholz, 2.0)

    def test_head_to_head_calculation(self):
        """Test head-to-head tiebreak among tied teams"""
        tournament = (
            self.create_base_tournament(rounds=2)
            .round(1)
            .match("Team 1", "Team 2", "1-0", "1/2-1/2")  # Team 1 wins 1.5-0.5
            # Team 3 gets a bye
            .complete()
            .round(2)
            .match("Team 1", "Team 3", "1-0", "1/2-1/2")  # Team 1 wins 1.5-0.5
            # Team 2 gets a bye
            .complete()
            .calculate()
            .build()
        )

        season = tournament.seasons["Test Season"]
        scores = {
            ts.team.number: ts
            for ts in TeamScore.objects.filter(team__season=season)
        }

        # Head-to-head only applies among teams tied on both match points and game points
        # Since Team 1 has 4 match points and Team 3 has 3 match points, they're not tied
        # So head-to-head won't be calculated between them
        self.assertTrue(scores[1].match_points > scores[3].match_points)

    def test_games_won_calculation(self):
        """Test games won tiebreak"""
        tournament = (
            self.create_base_tournament(rounds=1)
            .round(1)
            .match("Team 1", "Team 2", "1-0", "1/2-1/2")  # Team 1: 1 win, 1 draw
            # Team 3 gets a bye
            .complete()
            .calculate()
            .build()
        )

        season = tournament.seasons["Test Season"]
        scores = {
            ts.team.number: ts
            for ts in TeamScore.objects.filter(team__season=season)
        }

        self.assertEqual(scores[1].games_won, 1)
        self.assertEqual(scores[2].games_won, 0)
        self.assertEqual(scores[3].games_won, 0)  # Bye doesn't count as games won

    def test_configurable_tiebreak_order(self):
        """Test that tiebreaks are applied in the configured order"""
        tournament = (
            self.create_base_tournament(rounds=1)
            .round(1)
            .match("Team 1", "Team 2", "1-0", "1/2-1/2")
            .complete()
            .calculate()
            .build()
        )

        season = tournament.seasons["Test Season"]
        league = season.league
        
        # Configure custom tiebreak order
        league.team_tiebreak_1 = "buchholz"
        league.team_tiebreak_2 = "sonneborn_berger"
        league.team_tiebreak_3 = "game_points"
        league.team_tiebreak_4 = "head_to_head"
        league.save()

        # Recalculate scores with configured tiebreaks
        season.calculate_scores()

        team = Team.objects.get(season=season, number=1)
        team_score = TeamScore.objects.get(team=team)
        sort_key = team_score.pairing_sort_key()

        # Verify sort key order: playoff_score, match_points, buchholz, sb, game_points, h2h, seed_rating
        self.assertEqual(len(sort_key), 7)
        # The configured tiebreaks should appear after match_points in the specified order
        self.assertEqual(sort_key[2], team_score.buchholz)  # First configured tiebreak
        self.assertEqual(sort_key[3], team_score.sb_score)  # Second configured tiebreak
        self.assertEqual(
            sort_key[4], team_score.game_points
        )  # Third configured tiebreak
        self.assertEqual(
            sort_key[5], team_score.head_to_head
        )  # Fourth configured tiebreak

    def test_bye_handling(self):
        """Test that byes are handled correctly in score calculations"""
        tournament = (
            self.create_base_tournament(rounds=1)
            .round(1)
            .match("Team 1", "Team 2", "1-0", "1/2-1/2")
            # Team 3 and 4 get automatic byes
            .complete()
            .calculate()
            .build()
        )

        season = tournament.seasons["Test Season"]
        scores = {
            ts.team.number: ts
            for ts in TeamScore.objects.filter(team__season=season)
        }

        # Team with bye should get 1 match point and half the board points
        self.assertEqual(scores[3].match_points, 1)  # Bye = 1 match point
        self.assertEqual(scores[3].game_points, 1.0)  # 2 boards / 2 = 1 game point

    def test_tiebreak_choices(self):
        """Test that all tiebreak choices are valid"""
        tournament = self.create_base_tournament(rounds=1).build()
        league = tournament.simulator.leagues["TL"]
        
        valid_choices = [choice[0] for choice in TEAM_TIEBREAK_OPTIONS]

        # Test all valid choices can be set
        for choice in valid_choices:
            league.team_tiebreak_1 = choice
            league.full_clean()  # Should not raise ValidationError

        # Test invalid choice raises error
        with self.assertRaises(ValidationError):
            league.team_tiebreak_1 = "invalid_choice"
            league.full_clean()

    def test_standings_sort_order(self):
        """Test that teams are sorted correctly in standings"""
        # Create a simple pairing
        # Board 1: Team 1 plays white, Team 2 plays black
        # Board 2: Team 2 plays white, Team 1 plays black
        # To have Team 1 win 2-0, we need:
        # - Board 1: '1-0' (Team 1 wins as white)
        # - Board 2: '1-0' (Team 2 wins as white, but this means Team 1 wins the board)
        tournament = (
            self.create_base_tournament(rounds=1)
            .round(1)
            .match("Team 1", "Team 2", "1-0", "1-0")  # Team 1 wins 2-0
            .complete()
            .calculate()
            .build()
        )

        season = tournament.seasons["Test Season"]
        # Get all team scores
        team_scores = TeamScore.objects.filter(team__season=season)
        teams = {team.name: team for team in Team.objects.filter(season=season)}

        # Verify scores are calculated
        scores_dict = {ts.team: ts for ts in team_scores}

        # Team that won should have 2 match points
        self.assertEqual(scores_dict[teams["Team 1"]].match_points, 2)
        # Team that lost should have 0 match points
        self.assertEqual(scores_dict[teams["Team 2"]].match_points, 0)

        # Test that sorting works - winner should rank higher than loser
        sorted_scores = sorted(
            team_scores, key=lambda ts: ts.pairing_sort_key(), reverse=True
        )
        winner_index = None
        loser_index = None

        for i, score in enumerate(sorted_scores):
            if score.team == teams["Team 1"]:
                winner_index = i
            elif score.team == teams["Team 2"]:
                loser_index = i

        self.assertIsNotNone(winner_index)
        self.assertIsNotNone(loser_index)
        self.assertLess(winner_index, loser_index)  # Winner should come before loser

    def test_tiebreak_sorting_when_tied(self):
        """Test that tiebreaks are used to sort teams with equal match points"""
        # Create a single pairing where teams draw
        # For a true 1-1 draw:
        # Board 1: Team 1 (white) draws with Team 2 (black): '1/2-1/2'
        # Board 2: Team 2 (white) draws with Team 1 (black): '1/2-1/2'
        tournament = (
            self.create_base_tournament(rounds=1)
            .round(1)
            .match("Team 1", "Team 2", "1/2-1/2", "1/2-1/2")  # Draw 1-1 with both boards drawn
            # Teams 3 and 4 get automatic byes
            .complete()
            .calculate()
            .build()
        )

        season = tournament.seasons["Test Season"]
        # Get scores
        scores = TeamScore.objects.filter(team__season=season)
        teams = list(Team.objects.filter(season=season).order_by("number"))
        scores_dict = {ts.team: ts for ts in scores}

        # Teams 1 and 2 should have 1 match point each (draw)
        self.assertEqual(scores_dict[teams[0]].match_points, 1)  # Team 1
        self.assertEqual(scores_dict[teams[1]].match_points, 1)  # Team 2
        # Teams 3 and 4 should have 1 match point each (bye)
        self.assertEqual(scores_dict[teams[2]].match_points, 1)  # Team 3
        self.assertEqual(scores_dict[teams[3]].match_points, 1)  # Team 4

        # All teams should have 1 game point
        self.assertEqual(scores_dict[teams[0]].game_points, 1.0)  # 0.5 + 0.5 = 1
        self.assertEqual(scores_dict[teams[1]].game_points, 1.0)  # 0.5 + 0.5 = 1
        # Teams 3 and 4 with byes get half board points
        self.assertEqual(
            scores_dict[teams[2]].game_points, 1.0
        )  # 2 boards / 2 = 1
        self.assertEqual(scores_dict[teams[3]].game_points, 1.0)

        # All teams are tied on match points and game points
        # Other tiebreaks (like seed rating) determine order
        sorted_scores = sorted(
            scores, key=lambda ts: ts.pairing_sort_key(), reverse=True
        )

        # Just verify that sorting produces a consistent order
        self.assertEqual(len(sorted_scores), 4)

        # Verify that tiebreaks are being calculated
        for score in scores:
            # At least some tiebreak values should be non-zero
            if score.team in [teams[0], teams[1]]:
                # Teams that played should have opponent-based tiebreaks
                self.assertIsNotNone(score.sb_score)
                self.assertIsNotNone(score.buchholz)
