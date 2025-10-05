"""
Tournament utilities for representing and calculating tournament results.

This module provides a simple, clean way to represent tournaments with:
- Competitors (players or teams)
- Matches between competitors
- Games within matches
- Scoring functions to convert game results to match points
"""

from typing import Dict, List, Tuple, Optional
from dataclasses import dataclass, field
from enum import Enum
from collections import defaultdict

from heltour.tournament_core.tiebreaks import MatchResult, CompetitorScore
from heltour.tournament_core.scoring import ScoringSystem, STANDARD_SCORING


class GameResult(Enum):
    """Result of a single game."""

    P1_WIN = "1-0"
    DRAW = "1/2-1/2"
    P2_WIN = "0-1"
    P1_FORFEIT_WIN = "1X-0F"
    P2_FORFEIT_WIN = "0F-1X"
    DOUBLE_FORFEIT = "0F-0F"


@dataclass(frozen=True)
class Game:
    """A single game between two competitors."""

    player1_id: int
    player2_id: int
    result: GameResult

    def points(self, scoring: ScoringSystem = STANDARD_SCORING) -> Tuple[float, float]:
        """Return (player1_points, player2_points) for this game."""
        if self.result == GameResult.P1_WIN:
            return (scoring.game_win_points, scoring.game_loss_points)
        elif self.result == GameResult.P2_WIN:
            return (scoring.game_loss_points, scoring.game_win_points)
        elif self.result == GameResult.DRAW:
            return (scoring.game_draw_points, scoring.game_draw_points)
        elif self.result == GameResult.P1_FORFEIT_WIN:
            return (scoring.game_win_points, scoring.game_loss_points)
        elif self.result == GameResult.P2_FORFEIT_WIN:
            return (scoring.game_loss_points, scoring.game_win_points)
        else:  # DOUBLE_FORFEIT
            return (0.0, 0.0)

    def winner_id(self) -> Optional[int]:
        """Return the ID of the winner, or None if draw/double forfeit."""
        if self.result in (GameResult.P1_WIN, GameResult.P1_FORFEIT_WIN):
            return self.player1_id
        elif self.result in (GameResult.P2_WIN, GameResult.P2_FORFEIT_WIN):
            return self.player2_id
        return None


@dataclass(frozen=True)
class Match:
    """A match consisting of one or more games between two competitors.

    For team matches, the games represent individual boards where the player IDs
    are the individual players, but the match is between the teams (competitors).
    The games should be ordered such that the first player in each game belongs
    to competitor1's team.
    """

    competitor1_id: int
    competitor2_id: int
    games: List[Game] = field(default_factory=list)
    is_bye: bool = False

    def game_points(
        self, scoring: ScoringSystem = STANDARD_SCORING
    ) -> Tuple[float, float]:
        """Return total (competitor1_game_points, competitor2_game_points)."""
        if self.is_bye:
            # In a bye, the player gets the configured fraction of maximum possible points
            max_points = (
                scoring.game_win_points * len(self.games)
                if self.games
                else scoring.game_win_points
            )
            return (max_points * scoring.bye_game_points_factor, 0.0)

        c1_points = 0.0
        c2_points = 0.0
        for game in self.games:
            p1_pts, p2_pts = game.points(scoring)
            # The convention is that games are ordered such that:
            # - For individual tournaments: player1 in game matches competitor1 in match
            # - For team tournaments: player1 in game belongs to competitor1's team
            # This is enforced by the match creation functions
            c1_points += p1_pts
            c2_points += p2_pts
        return (c1_points, c2_points)

    def games_won(self) -> Tuple[int, int]:
        """Return (competitor1_games_won, competitor2_games_won)."""
        if self.is_bye:
            return (0, 0)

        c1_wins = 0
        c2_wins = 0
        for game in self.games:
            if game.result in (GameResult.P1_WIN, GameResult.P1_FORFEIT_WIN):
                c1_wins += 1
            elif game.result in (GameResult.P2_WIN, GameResult.P2_FORFEIT_WIN):
                c2_wins += 1
            # Draws don't count as wins
        return (c1_wins, c2_wins)


@dataclass(frozen=True)
class Round:
    """A round in a tournament containing multiple matches."""

    number: int
    matches: List[Match] = field(default_factory=list)

    def add_match(self, match: Match) -> "Round":
        """Return a new Round with the match added (immutable pattern)."""
        return Round(self.number, self.matches + [match])


@dataclass
class Tournament:
    """Represents a complete tournament organized by rounds."""

    competitors: List[int]  # List of competitor IDs
    rounds: List[Round] = field(default_factory=list)  # List of rounds
    scoring: ScoringSystem = field(default_factory=lambda: STANDARD_SCORING)

    @property
    def matches(self) -> List[Match]:
        """Get all matches across all rounds (for backward compatibility)."""
        all_matches = []
        for round in self.rounds:
            all_matches.extend(round.matches)
        return all_matches

    @property
    def num_rounds(self) -> int:
        """Get the number of rounds in the tournament."""
        return len(self.rounds)

    def calculate_results(self) -> Dict[int, CompetitorScore]:
        """Calculate complete tournament results with match points and game points."""
        # Initialize results for all competitors
        results: Dict[int, List[MatchResult]] = {c: [] for c in self.competitors}

        # Process each round and match
        for round in self.rounds:
            for match in round.matches:
                c1_game_pts, c2_game_pts = match.game_points(self.scoring)
                c1_match_pts, c2_match_pts = self.scoring.match_points(
                    c1_game_pts, c2_game_pts
                )
                c1_games_won, c2_games_won = match.games_won()

                if not match.is_bye:
                    # Add result for competitor 1
                    results[match.competitor1_id].append(
                        MatchResult(
                            opponent_id=match.competitor2_id,
                            game_points=c1_game_pts,
                            opponent_game_points=c2_game_pts,
                            match_points=c1_match_pts,
                            games_won=c1_games_won,
                            is_bye=False,
                        )
                    )

                    # Add result for competitor 2
                    results[match.competitor2_id].append(
                        MatchResult(
                            opponent_id=match.competitor1_id,
                            game_points=c2_game_pts,
                            opponent_game_points=c1_game_pts,
                            match_points=c2_match_pts,
                            games_won=c2_games_won,
                            is_bye=False,
                        )
                    )
                else:
                    # Handle bye
                    results[match.competitor1_id].append(
                        MatchResult(
                            opponent_id=None,
                            game_points=c1_game_pts,
                            opponent_game_points=0,
                            match_points=self.scoring.bye_match_points,
                            games_won=0,
                            is_bye=True,
                        )
                    )

        # Build CompetitorScore objects
        competitor_scores = {}
        for comp_id, match_results in results.items():
            total_match_points = sum(mr.match_points for mr in match_results)
            total_game_points = sum(mr.game_points for mr in match_results)

            competitor_scores[comp_id] = CompetitorScore(
                competitor_id=comp_id,
                match_points=total_match_points,
                game_points=total_game_points,
                match_results=match_results,
            )

        return competitor_scores


# Kept for backwards compatibility - prefer using ScoringSystem directly
def standard_match_points(
    c1_game_points: float, c2_game_points: float
) -> Tuple[int, int]:
    """Standard system: 2 points for win, 1 for draw, 0 for loss."""
    return STANDARD_SCORING.match_points(c1_game_points, c2_game_points)


def three_one_zero_match_points(
    c1_game_points: float, c2_game_points: float
) -> Tuple[int, int]:
    """Alternative system: 3 points for win, 1 for draw, 0 for loss."""
    from heltour.tournament_core.scoring import THREE_ONE_ZERO_SCORING

    return THREE_ONE_ZERO_SCORING.match_points(c1_game_points, c2_game_points)


# Helper functions for common tournament formats
def create_single_game_match(p1_id: int, p2_id: int, result: GameResult) -> Match:
    """Create a match with a single game (common for individual tournaments).

    The player IDs in the game should match the competitor IDs in the match.
    If they don't match (e.g., colors are swapped), you need to swap the result too.
    """
    game = Game(p1_id, p2_id, result)
    return Match(p1_id, p2_id, [game])


def create_bye_match(competitor_id: int, games_per_match: int = 1) -> Match:
    """Create a bye match."""
    # For a bye, we might still need to know how many games would have been played
    # to calculate the appropriate game points
    #
    # For team tournaments: team bye = draw-equivalent scoring (half points)
    # For individual tournaments: player bye = win (full points)
    if games_per_match > 1:
        # Team tournament: bye should give draw-equivalent points (half the boards)
        # Create half wins, half draws to achieve 50% scoring
        games = []
        for i in range(games_per_match):
            if i < games_per_match // 2:
                games.append(Game(competitor_id, -1, GameResult.P1_WIN))
            else:
                games.append(Game(competitor_id, -1, GameResult.DRAW))
    else:
        # Individual tournament: bye = full win
        games = [
            Game(competitor_id, -1, GameResult.P1_WIN) for _ in range(games_per_match)
        ]

    return Match(competitor_id, -1, games, is_bye=True)


def create_team_match(
    team1_id: int,
    team2_id: int,
    board_results: List[Tuple[int, int, GameResult]],
) -> Match:
    """
    Create a team match with multiple boards.

    Args:
        team1_id: First team's ID
        team2_id: Second team's ID
        board_results: List of (player1_id, player2_id, result) for each board
                      IMPORTANT: player1 should belong to team1, player2 to team2
    """
    games = [Game(p1_id, p2_id, result) for p1_id, p2_id, result in board_results]
    return Match(team1_id, team2_id, games)


def create_tournament_from_matches(
    competitors: List[int],
    matches_with_rounds: List[Tuple[int, Match]],
    scoring: ScoringSystem = STANDARD_SCORING,
) -> Tournament:
    """Create a tournament from a list of (round_number, match) tuples.

    This is a convenience function for tests and backward compatibility.
    """
    # Group matches by round
    rounds_dict = defaultdict(list)
    for round_num, match in matches_with_rounds:
        rounds_dict[round_num].append(match)

    # Create Round objects
    rounds = [Round(num, matches) for num, matches in sorted(rounds_dict.items())]

    return Tournament(competitors, rounds, scoring)
