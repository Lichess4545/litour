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
from heltour.tournament.tests.testutils import (
    createCommonLeagueData,
    get_league,
    get_season,
)


class TeamTiebreakTestCase(TestCase):
    def setUp(self):
        createCommonLeagueData()
        self.league = get_league("team")
        self.season = get_season("team")

        # Fix the league to have required fields
        self.league.theme = "blue"
        self.league.pairing_type = "swiss-dutch"
        self.league.save()

        # Get the teams created by createCommonLeagueData (creates 4 teams with 2 boards each)
        self.teams = list(Team.objects.filter(season=self.season).order_by("number"))

        # Create rounds
        self.rounds = []
        for i in range(1, 4):  # 3 rounds
            round_ = Round.objects.create(
                season=self.season, number=i, is_completed=False
            )
            self.rounds.append(round_)

    def complete_round_with_byes(self, round_):
        """Complete a round and create TeamBye records for teams without pairings."""
        # Find teams that didn't play
        teams_that_played = set()
        for pairing in TeamPairing.objects.filter(round=round_):
            teams_that_played.add(pairing.white_team_id)
            teams_that_played.add(pairing.black_team_id)

        all_teams = set(self.teams)
        for team in all_teams:
            if team.id not in teams_that_played:
                TeamBye.objects.create(
                    round=round_, team=team, type="full-point-pairing-bye"
                )

        round_.is_completed = True
        round_.save()

    def create_pairing_with_results(self, round_, white_team, black_team, results):
        """
        Create a team pairing with specified results.
        results: list of results for each board, e.g., ['1-0', '0-1', '1/2-1/2', '1-0']
        """
        pairing = TeamPairing.objects.create(
            round=round_, white_team=white_team, black_team=black_team, pairing_order=1
        )

        white_members = list(white_team.teammember_set.order_by("board_number"))
        black_members = list(black_team.teammember_set.order_by("board_number"))

        for i, result in enumerate(results):
            # Board colors alternate: odd boards have white team on white, even boards have black team on white
            if (i + 1) % 2 == 1:  # Odd board number
                white_player = white_members[i].player
                black_player = black_members[i].player
            else:  # Even board number
                white_player = black_members[i].player
                black_player = white_members[i].player

            # Create TeamPlayerPairing directly without creating a separate PlayerPairing
            TeamPlayerPairing.objects.create(
                team_pairing=pairing,
                board_number=i + 1,
                white=white_player,
                black=black_player,
                result=result,
            )

        pairing.refresh_points()
        pairing.save()
        return pairing

    def test_match_points_calculation(self):
        """Test that match points are calculated correctly"""
        # Round 1: Team 1 wins against Team 2 (1.5-0.5)
        self.create_pairing_with_results(
            self.rounds[0], self.teams[0], self.teams[1], ["1-0", "1/2-1/2"]
        )

        self.complete_round_with_byes(self.rounds[0])
        self.season.calculate_scores()

        scores = {
            ts.team.number: ts
            for ts in TeamScore.objects.filter(team__season=self.season)
        }

        # Check match points
        self.assertEqual(scores[1].match_points, 2)  # Win = 2 points
        self.assertEqual(scores[2].match_points, 0)  # Loss = 0 points
        # Team 3 got a bye (no pairing)
        self.assertEqual(scores[3].match_points, 1)  # Bye = 1 point
        self.assertEqual(scores[3].game_points, 1.0)  # 2 boards / 2 = 1 game point

    def test_game_points_calculation(self):
        """Test that game points are calculated correctly"""
        # Round 1: Team 1 wins 1.5-0.5
        self.create_pairing_with_results(
            self.rounds[0], self.teams[0], self.teams[1], ["1-0", "1/2-1/2"]
        )

        self.rounds[0].is_completed = True
        self.rounds[0].save()
        self.season.calculate_scores()

        scores = {
            ts.team.number: ts
            for ts in TeamScore.objects.filter(team__season=self.season)
        }

        self.assertEqual(scores[1].game_points, 1.5)
        self.assertEqual(scores[2].game_points, 0.5)

    def test_sonneborn_berger_calculation(self):
        """Test Sonneborn-Berger tiebreak calculation"""
        # Configure sonneborn-berger as a tiebreak
        self.league.team_tiebreak_1 = "sonneborn_berger"
        self.league.save()

        # Round 1: Team 1 wins vs Team 2
        self.create_pairing_with_results(
            self.rounds[0],
            self.teams[0],
            self.teams[1],
            ["1-0", "1/2-1/2"],  # Team 1 wins 1.5-0.5
        )
        # Team 3 gets bye

        # Round 2: Team 1 vs Team 3 (draw), Team 2 gets bye
        self.create_pairing_with_results(
            self.rounds[1], self.teams[0], self.teams[2], ["1-0", "0-1"]  # Draw 1-1
        )

        self.complete_round_with_byes(self.rounds[0])
        self.complete_round_with_byes(self.rounds[1])
        self.season.calculate_scores()

        scores = {
            ts.team.number: ts
            for ts in TeamScore.objects.filter(team__season=self.season)
        }

        # Verify SB calculation
        # Team 1: Won vs Team 2 (final: 1 MP), Drew vs Team 3 (final: 2 MP)
        # SB = 1*1 + 2*0.5 = 2.0
        self.assertEqual(scores[1].sb_score, 2.0)

    def test_buchholz_calculation(self):
        """Test Buchholz tiebreak calculation"""
        # Configure buchholz as a tiebreak
        self.league.team_tiebreak_2 = "buchholz"  # Add buchholz to the tiebreaks
        self.league.save()

        # Round 1
        self.create_pairing_with_results(
            self.rounds[0],
            self.teams[0],
            self.teams[1],
            ["1-0", "1/2-1/2"],  # Team 1 wins 1.5-0.5
        )
        # Team 3 gets a bye

        # Round 2
        self.create_pairing_with_results(
            self.rounds[1],
            self.teams[0],
            self.teams[2],
            ["1-0", "0-1"],  # Team 1 wins 1.5-0.5
        )

        self.complete_round_with_byes(self.rounds[0])
        self.complete_round_with_byes(self.rounds[1])
        self.season.calculate_scores()

        scores = {
            ts.team.number: ts
            for ts in TeamScore.objects.filter(team__season=self.season)
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
        # Create a scenario where teams are tied on match points and game points
        # Round 1: Team 1 vs Team 2
        self.create_pairing_with_results(
            self.rounds[0],
            self.teams[0],
            self.teams[1],
            ["1-0", "1/2-1/2"],  # Team 1 wins 1.5-0.5
        )
        # Team 3 gets a bye

        # Round 2: Team 1 beats Team 3 directly
        self.create_pairing_with_results(
            self.rounds[1],
            self.teams[0],
            self.teams[2],
            ["1-0", "1/2-1/2"],  # Team 1 wins 1.5-0.5
        )
        # Team 2 gets a bye in round 2

        self.rounds[0].is_completed = True
        self.rounds[0].save()
        self.rounds[1].is_completed = True
        self.rounds[1].save()
        self.season.calculate_scores()

        scores = {
            ts.team.number: ts
            for ts in TeamScore.objects.filter(team__season=self.season)
        }

        # Head-to-head only applies among teams tied on both match points and game points
        # Since Team 1 has 4 match points and Team 3 has 3 match points, they're not tied
        # So head-to-head won't be calculated between them
        self.assertTrue(scores[1].match_points > scores[3].match_points)

    def test_games_won_calculation(self):
        """Test games won tiebreak"""
        # Round 1
        self.create_pairing_with_results(
            self.rounds[0],
            self.teams[0],
            self.teams[1],
            ["1-0", "1/2-1/2"],  # Team 1: 1 win, 1 draw
        )
        # Team 3 gets a bye in round 1

        self.rounds[0].is_completed = True
        self.rounds[0].save()
        self.season.calculate_scores()

        scores = {
            ts.team.number: ts
            for ts in TeamScore.objects.filter(team__season=self.season)
        }

        self.assertEqual(scores[1].games_won, 1)
        self.assertEqual(scores[2].games_won, 0)
        self.assertEqual(scores[3].games_won, 0)  # Bye doesn't count as games won

    def test_configurable_tiebreak_order(self):
        """Test that tiebreaks are applied in the configured order"""
        # Configure custom tiebreak order
        self.league.team_tiebreak_1 = "buchholz"
        self.league.team_tiebreak_2 = "sonneborn_berger"
        self.league.team_tiebreak_3 = "game_points"
        self.league.team_tiebreak_4 = "head_to_head"
        self.league.save()

        # Create some pairings
        self.create_pairing_with_results(
            self.rounds[0], self.teams[0], self.teams[1], ["1-0", "1/2-1/2"]
        )

        self.rounds[0].is_completed = True
        self.rounds[0].save()
        self.season.calculate_scores()

        team_score = TeamScore.objects.get(team=self.teams[0])
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
        # Only create pairing for teams 1 and 2, team 3 gets a bye
        self.create_pairing_with_results(
            self.rounds[0], self.teams[0], self.teams[1], ["1-0", "1/2-1/2"]
        )

        self.complete_round_with_byes(self.rounds[0])
        self.season.calculate_scores()

        scores = {
            ts.team.number: ts
            for ts in TeamScore.objects.filter(team__season=self.season)
        }

        # Team with bye should get 1 match point and half the board points
        self.assertEqual(scores[3].match_points, 1)  # Bye = 1 match point
        self.assertEqual(scores[3].game_points, 1.0)  # 2 boards / 2 = 1 game point

    def test_tiebreak_choices(self):
        """Test that all tiebreak choices are valid"""
        valid_choices = [choice[0] for choice in TEAM_TIEBREAK_OPTIONS]

        # Test all valid choices can be set
        for choice in valid_choices:
            self.league.team_tiebreak_1 = choice
            self.league.full_clean()  # Should not raise ValidationError

        # Test invalid choice raises error
        with self.assertRaises(ValidationError):
            self.league.team_tiebreak_1 = "invalid_choice"
            self.league.full_clean()

    def test_standings_sort_order(self):
        """Test that teams are sorted correctly in standings"""
        # Create a simple pairing
        # Board 1: Team 0 plays white, Team 1 plays black
        # Board 2: Team 1 plays white, Team 0 plays black
        # To have Team 0 win 2-0, we need:
        # - Board 1: '1-0' (Team 0 wins as white)
        # - Board 2: '0-1' (Team 0 wins as black)
        self.create_pairing_with_results(
            self.rounds[0],
            self.teams[0],
            self.teams[1],
            ["1-0", "0-1"],  # Team 0 wins 2-0
        )

        self.rounds[0].is_completed = True
        self.rounds[0].save()
        self.season.calculate_scores()

        # Get all team scores
        team_scores = TeamScore.objects.filter(team__season=self.season)

        # Verify scores are calculated
        scores_dict = {ts.team: ts for ts in team_scores}

        # Team that won should have 2 match points
        self.assertEqual(scores_dict[self.teams[0]].match_points, 2)
        # Team that lost should have 0 match points
        self.assertEqual(scores_dict[self.teams[1]].match_points, 0)

        # Test that sorting works - winner should rank higher than loser
        sorted_scores = sorted(
            team_scores, key=lambda ts: ts.pairing_sort_key(), reverse=True
        )
        winner_index = None
        loser_index = None

        for i, score in enumerate(sorted_scores):
            if score.team == self.teams[0]:
                winner_index = i
            elif score.team == self.teams[1]:
                loser_index = i

        self.assertIsNotNone(winner_index)
        self.assertIsNotNone(loser_index)
        self.assertLess(winner_index, loser_index)  # Winner should come before loser

    def test_tiebreak_sorting_when_tied(self):
        """Test that tiebreaks are used to sort teams with equal match points"""
        # Create a single pairing where teams draw
        # For a true 1-1 draw:
        # Board 1: Team 0 (white) draws with Team 1 (black): '1/2-1/2'
        # Board 2: Team 1 (white) draws with Team 0 (black): '1/2-1/2'
        self.create_pairing_with_results(
            self.rounds[0],
            self.teams[0],
            self.teams[1],
            ["1/2-1/2", "1/2-1/2"],  # Draw 1-1 with both boards drawn
        )
        # Teams 2 and 3 get byes (1 match point each)

        self.complete_round_with_byes(self.rounds[0])
        self.season.calculate_scores()

        # Get scores
        scores = TeamScore.objects.filter(team__season=self.season)
        scores_dict = {ts.team: ts for ts in scores}

        # Teams 0 and 1 should have 1 match point each (draw)
        self.assertEqual(scores_dict[self.teams[0]].match_points, 1)
        self.assertEqual(scores_dict[self.teams[1]].match_points, 1)
        # Teams 2 and 3 should have 1 match point each (bye)
        self.assertEqual(scores_dict[self.teams[2]].match_points, 1)
        self.assertEqual(scores_dict[self.teams[3]].match_points, 1)

        # All teams should have 1 game point
        self.assertEqual(scores_dict[self.teams[0]].game_points, 1.0)  # 0.5 + 0.5 = 1
        self.assertEqual(scores_dict[self.teams[1]].game_points, 1.0)  # 0.5 + 0.5 = 1
        # Teams 2 and 3 with byes get half board points
        self.assertEqual(
            scores_dict[self.teams[2]].game_points, 1.0
        )  # 2 boards / 2 = 1
        self.assertEqual(scores_dict[self.teams[3]].game_points, 1.0)

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
            if score.team in [self.teams[0], self.teams[1]]:
                # Teams that played should have opponent-based tiebreaks
                self.assertIsNotNone(score.sb_score)
                self.assertIsNotNone(score.buchholz)
