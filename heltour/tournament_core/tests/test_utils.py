"""
Test utilities for creating tournament structures easily.

These utilities create pure tournament_core structures without database dependencies,
making it easy to test tournament logic, tiebreaks, and calculations.
"""

from typing import List, Tuple, Optional
from heltour.tournament_core.structure import Tournament
from heltour.tournament_core.builder import TournamentBuilder


# Convenience functions for common test scenarios


def create_simple_round_robin(num_players: int = 4) -> Tournament:
    """Create a simple round robin tournament."""
    players = list(range(1, num_players + 1))
    builder = TournamentBuilder(players)

    # Simple pairing for round robin
    for round_num in range(1, num_players):
        builder.add_round(round_num)

        # Pair players in a round robin fashion
        for i in range(num_players // 2):
            if round_num == 1:
                p1 = players[i]
                p2 = players[num_players - 1 - i]
            else:
                # Rotate players for subsequent rounds
                rotated = [players[0]] + players[2:] + [players[1]]
                p1 = rotated[i]
                p2 = rotated[num_players - 1 - i]

            # Alternate results for variety
            result = (
                "1-0"
                if (i + round_num) % 3 == 0
                else ("1/2-1/2" if (i + round_num) % 3 == 1 else "0-1")
            )
            builder.add_game(p1, p2, result)

        # Add bye if odd number of players
        if num_players % 2 == 1:
            builder.auto_byes()

    return builder.build()


def create_simple_team_tournament(
    num_teams: int = 4, boards_per_team: int = 4
) -> Tournament:
    """Create a simple team tournament."""
    teams = list(range(1, num_teams + 1))
    builder = TournamentBuilder(teams)

    # Create a simple 2-round tournament
    builder.add_round(1)

    # Round 1: 1v2, 3v4
    if num_teams >= 4:
        # Team 1 vs Team 2
        board_results = []
        for board in range(1, boards_per_team + 1):
            p1 = 100 + board  # Team 1 players: 101, 102, 103, 104
            p2 = 200 + board  # Team 2 players: 201, 202, 203, 204
            result = "1-0" if board % 2 == 1 else "0-1"  # Alternating wins
            board_results.append((p1, p2, result))
        builder.add_team_match(1, 2, board_results)

        # Team 3 vs Team 4
        board_results = []
        for board in range(1, boards_per_team + 1):
            p1 = 300 + board  # Team 3 players
            p2 = 400 + board  # Team 4 players
            result = "1/2-1/2"  # All draws
            board_results.append((p1, p2, result))
        builder.add_team_match(3, 4, board_results)

    return builder.build()

