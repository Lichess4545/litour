"""
Simple unit tests for tiebreak calculation functions.
No database, no Django models - just pure function tests.
"""

import unittest
from heltour.tournament_core.structure import (
    Game,
    GameResult,
    Match,
    create_single_game_match,
    create_bye_match,
    create_team_match,
    create_tournament_from_matches,
)
from heltour.tournament_core.tiebreaks import (
    calculate_sonneborn_berger,
    calculate_buchholz,
    calculate_head_to_head,
    calculate_games_won,
)
from heltour.tournament_core.scoring import STANDARD_SCORING


class SimpleTiebreakTests(unittest.TestCase):
    """Test tiebreak calculations with simple, clear scenarios."""

    def test_sonneborn_berger_basic(self):
        """Test SB calculation: sum of defeated opponents' scores + half of drawn opponents' scores."""
        # Define tournament with clear match results
        players = [1, 2, 3]
        matches_with_rounds = [
            # Round 1: Player 1 beats Player 2, Player 3 has bye
            (1, create_single_game_match(1, 2, GameResult.P1_WIN)),
            (1, create_bye_match(3)),
            # Round 2: Player 1 draws Player 3, Player 2 has bye
            (2, create_single_game_match(1, 3, GameResult.DRAW)),
            (2, create_bye_match(2)),
            # Round 3: Player 2 beats Player 3, Player 1 has bye
            (3, create_single_game_match(2, 3, GameResult.P1_WIN)),
            (3, create_bye_match(1)),
        ]

        # Create tournament and calculate results
        tournament = create_tournament_from_matches(
            players, matches_with_rounds, STANDARD_SCORING
        )
        results = tournament.calculate_results()

        # Expected match points:
        # Player 1: Win(2) + Draw(1) + Bye(1) = 4 MP
        # Player 2: Loss(0) + Bye(1) + Win(2) = 3 MP
        # Player 3: Bye(1) + Draw(1) + Loss(0) = 2 MP

        # Calculate Sonneborn-Berger for each player
        # Player 1 SB: Beat P2 (3 MP) = 3, Drew P3 (2 MP) = 1, Total = 4
        self.assertEqual(calculate_sonneborn_berger(results[1], results), 4.0)

        # Player 2 SB: Lost to P1 (4 MP) = 0, Beat P3 (2 MP) = 2, Total = 2
        self.assertEqual(calculate_sonneborn_berger(results[2], results), 2.0)

        # Player 3 SB: Drew P1 (4 MP) = 2, Lost to P2 (3 MP) = 0, Total = 2
        self.assertEqual(calculate_sonneborn_berger(results[3], results), 2.0)

    def test_sonneborn_berger_with_bye(self):
        """Test SB calculation with byes (byes don't count)."""
        players = [1, 2]
        matches_with_rounds = [
            # Round 1: Player 1 has bye, Player 2 doesn't play
            (1, create_bye_match(1)),
            # Round 2: Player 1 beats Player 2
            (2, create_single_game_match(1, 2, GameResult.P1_WIN)),
        ]

        tournament = create_tournament_from_matches(
            players, matches_with_rounds, STANDARD_SCORING
        )
        results = tournament.calculate_results()

        # Player 1: Bye(1) + Win(2) = 3 MP
        # Player 2: Loss(0) = 0 MP

        # SB should only count the win against opponent (0 MP), not the bye
        self.assertEqual(calculate_sonneborn_berger(results[1], results), 0)

    def test_buchholz_basic(self):
        """Test Buchholz: sum of all opponents' match points."""
        players = [1, 2, 3]
        matches_with_rounds = [
            # Round 1: P1 beats P2, P3 has bye
            (1, create_single_game_match(1, 2, GameResult.P1_WIN)),
            (1, create_bye_match(3)),
            # Round 2: P1 draws P3, P2 has bye
            (2, create_single_game_match(1, 3, GameResult.DRAW)),
            (2, create_bye_match(2)),
        ]

        tournament = create_tournament_from_matches(
            players, matches_with_rounds, STANDARD_SCORING
        )
        results = tournament.calculate_results()

        # Player 1: Win(2) + Draw(1) = 3 MP
        # Player 2: Loss(0) + Bye(1) = 1 MP
        # Player 3: Bye(1) + Draw(1) = 2 MP

        # Player 1 Buchholz: Opponents P2 (1 MP) + P3 (2 MP) = 3
        self.assertEqual(calculate_buchholz(results[1], results), 3)

    def test_buchholz_missing_opponent(self):
        """Test Buchholz when opponent is not in scores (shouldn't crash)."""
        # Create a match with player 99 who isn't in the tournament
        # Need to include player 99 in the competitor list to avoid KeyError
        players = [1, 99]
        matches_with_rounds = [
            (1, Match(1, 99, [Game(1, 99, GameResult.P1_WIN)])),
        ]

        tournament = create_tournament_from_matches(
            players, matches_with_rounds, STANDARD_SCORING
        )
        results = tournament.calculate_results()

        # Player 99 has 0 match points (lost), so Player 1's Buchholz is 0
        self.assertEqual(calculate_buchholz(results[1], results), 0)

    def test_head_to_head_basic(self):
        """Test head-to-head among tied competitors."""
        # Create a scenario where all players are tied
        players = [1, 2, 3]
        matches_with_rounds = [
            # Round 1: P1 beats P2
            (1, create_single_game_match(1, 2, GameResult.P1_WIN)),
            # Round 2: P2 beats P3
            (2, create_single_game_match(2, 3, GameResult.P1_WIN)),
            # Round 3: P3 beats P1
            (3, create_single_game_match(3, 1, GameResult.P1_WIN)),
        ]

        tournament = create_tournament_from_matches(
            players, matches_with_rounds, STANDARD_SCORING
        )
        results = tournament.calculate_results()

        # All three players have 2 MP (1 win, 1 loss each)
        tied_set = {1, 2, 3}

        # Each player beat one other in the tied set:
        # P1 beat P2, P2 beat P3, P3 beat P1
        self.assertEqual(calculate_head_to_head(results[1], tied_set, results), 2)
        self.assertEqual(calculate_head_to_head(results[2], tied_set, results), 2)
        self.assertEqual(calculate_head_to_head(results[3], tied_set, results), 2)

    def test_head_to_head_no_games_against_tied(self):
        """Test H2H when player hasn't played anyone in the tied set."""
        players = [1, 2, 3, 4, 5, 6]
        matches_with_rounds = [
            # Player 1 only plays 5 and 6
            (1, create_single_game_match(1, 5, GameResult.P1_WIN)),
            (2, create_single_game_match(1, 6, GameResult.P1_WIN)),
            # Players 2, 3, 4 play among themselves
            (1, create_single_game_match(2, 3, GameResult.DRAW)),
            (2, create_single_game_match(3, 4, GameResult.DRAW)),
            (3, create_single_game_match(2, 4, GameResult.DRAW)),
        ]

        tournament = create_tournament_from_matches(
            players, matches_with_rounds, STANDARD_SCORING
        )
        results = tournament.calculate_results()

        tied_set = {2, 3, 4}  # Player 1 hasn't played any of these

        self.assertEqual(calculate_head_to_head(results[1], tied_set, results), 0)

    def test_games_won_team_tournament(self):
        """Test games won calculation for team tournaments."""
        teams = [1, 2, 3, 4]
        matches_with_rounds = [
            # Round 1: Team 1 sweeps Team 2 (4-0)
            (
                1,
                create_team_match(
                    1,
                    2,
                    [
                        (101, 201, GameResult.P1_WIN),
                        (102, 202, GameResult.P1_WIN),
                        (103, 203, GameResult.P1_WIN),
                        (104, 204, GameResult.P1_WIN),
                    ],
                ),
            ),
            # Round 2: Team 1 draws Team 3 (2-2)
            (
                2,
                create_team_match(
                    1,
                    3,
                    [
                        (101, 301, GameResult.P1_WIN),
                        (102, 302, GameResult.P2_WIN),
                        (103, 303, GameResult.P1_WIN),
                        (104, 304, GameResult.P2_WIN),
                    ],
                ),
            ),
            # Round 3: Team 1 wins vs Team 4 (5-3 in 8 boards)
            (
                3,
                create_team_match(
                    1,
                    4,
                    [
                        (101, 401, GameResult.P1_WIN),
                        (102, 402, GameResult.P1_WIN),
                        (103, 403, GameResult.P2_WIN),
                        (104, 404, GameResult.P1_WIN),
                        (105, 405, GameResult.P2_WIN),
                        (106, 406, GameResult.P1_WIN),
                        (107, 407, GameResult.P2_WIN),
                        (108, 408, GameResult.P1_WIN),
                    ],
                ),
            ),
        ]

        tournament = create_tournament_from_matches(
            teams, matches_with_rounds, STANDARD_SCORING
        )
        results = tournament.calculate_results()

        # Total games won by Team 1: 4 + 2 + 5 = 11
        self.assertEqual(calculate_games_won(results[1]), 11)

    def test_games_won_individual_tournament(self):
        """Test games won for individual tournament (should be 0 or match wins)."""
        players = [1, 2, 3, 4]
        matches_with_rounds = [
            # Individual matches - single game per match
            (1, create_single_game_match(1, 2, GameResult.P1_WIN)),
            (2, create_single_game_match(1, 3, GameResult.DRAW)),
            (3, create_single_game_match(1, 4, GameResult.DRAW)),
        ]

        tournament = create_tournament_from_matches(
            players, matches_with_rounds, STANDARD_SCORING
        )
        results = tournament.calculate_results()

        # For individuals with single-game matches, games_won counts actual game wins
        # Player 1 won 1 game, drew 2 games
        self.assertEqual(calculate_games_won(results[1]), 1)

    def test_all_tiebreaks_empty_tournament(self):
        """Test edge case: no games played."""
        players = [1]
        matches_with_rounds = []  # No matches played

        tournament = create_tournament_from_matches(
            players, matches_with_rounds, STANDARD_SCORING
        )
        results = tournament.calculate_results()

        tied_set = {1}

        self.assertEqual(calculate_sonneborn_berger(results[1], results), 0)
        self.assertEqual(calculate_buchholz(results[1], results), 0)
        self.assertEqual(calculate_head_to_head(results[1], tied_set, results), 0)
        self.assertEqual(calculate_games_won(results[1]), 0)

    def test_complete_round_robin_with_all_tiebreaks(self):
        """Test a complete round robin demonstrating all tiebreak calculations."""
        # 4-player round robin where final standings need multiple tiebreaks
        players = [1, 2, 3, 4]
        matches_with_rounds = [
            # Round 1
            (1, create_single_game_match(1, 2, GameResult.P1_WIN)),  # P1 beats P2
            (1, create_single_game_match(3, 4, GameResult.DRAW)),  # P3 draws P4
            # Round 2
            (2, create_single_game_match(1, 3, GameResult.P2_WIN)),  # P3 beats P1
            (2, create_single_game_match(2, 4, GameResult.P1_WIN)),  # P2 beats P4
            # Round 3
            (3, create_single_game_match(1, 4, GameResult.DRAW)),  # P1 draws P4
            (3, create_single_game_match(2, 3, GameResult.P2_WIN)),  # P3 beats P2
        ]

        tournament = create_tournament_from_matches(
            players, matches_with_rounds, STANDARD_SCORING
        )
        results = tournament.calculate_results()

        # Final standings:
        # P1: Win + Loss + Draw = 2+0+1 = 3 MP, 1.5 game points
        # P2: Loss + Win + Loss = 0+2+0 = 2 MP, 1 game point
        # P3: Draw + Win + Win = 1+2+2 = 5 MP, 2.5 game points
        # P4: Draw + Loss + Draw = 1+0+1 = 2 MP, 1 game point

        self.assertEqual(results[1].match_points, 3)
        self.assertEqual(results[2].match_points, 2)
        self.assertEqual(results[3].match_points, 5)
        self.assertEqual(results[4].match_points, 2)

        # P2 and P4 are tied at 2 MP, 1 game point
        tied_set = {2, 4}

        # Head-to-head: P2 beat P4 in round 2
        self.assertEqual(calculate_head_to_head(results[2], tied_set, results), 2)
        self.assertEqual(calculate_head_to_head(results[4], tied_set, results), 0)

        # Sonneborn-Berger calculations
        # P1: Beat P2 (2 MP) = 2, Drew P4 (2 MP) = 1, Total = 3
        self.assertEqual(calculate_sonneborn_berger(results[1], results), 3.0)

        # P3: Drew P4 (2 MP) = 1, Beat P1 (3 MP) = 3, Beat P2 (2 MP) = 2, Total = 6
        self.assertEqual(calculate_sonneborn_berger(results[3], results), 6.0)


if __name__ == "__main__":
    unittest.main()
