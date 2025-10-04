"""
Fluent assertion interface for testing tournament standings.

This module provides a clean, fluent way to assert tournament results and standings
for testing purposes. It works with the pure Python tournament_core structures.
"""

from typing import Dict, Optional, Union
from dataclasses import dataclass
from heltour.tournament_core.structure import Tournament
from heltour.tournament_core.tiebreaks import CompetitorScore, calculate_all_tiebreaks


class AssertionError(Exception):
    """Custom assertion error for tournament assertions."""

    pass


@dataclass
class StandingsAssertion:
    """Fluent interface for asserting tournament standings."""

    tournament: Tournament
    competitor_name: Optional[str] = None
    competitor_id: Optional[int] = None
    _name_to_id: Optional[Dict[str, int]] = None
    _id_to_name: Optional[Dict[int, str]] = None
    _results: Optional[Dict[int, CompetitorScore]] = None
    _tiebreaks: Optional[Dict[int, Dict[str, float]]] = None

    def __post_init__(self):
        """Calculate results once on initialization."""
        if self._results is None:
            self._results = self.tournament.calculate_results()

    def _ensure_mappings(self):
        """Ensure name to ID mappings are available."""
        if self._name_to_id is None:
            # In a real implementation, we'd need a way to map names to IDs
            # For now, we'll assume the tournament builder provides this mapping
            if hasattr(self.tournament, "name_to_id"):
                self._name_to_id = self.tournament.name_to_id
                self._id_to_name = {v: k for k, v in self._name_to_id.items()}
            else:
                # Default: treat competitor IDs as integers that can be used as names
                self._name_to_id = {
                    str(cid): cid for cid in self.tournament.competitors
                }
                self._id_to_name = {
                    cid: str(cid) for cid in self.tournament.competitors
                }

    def _get_competitor_id(self, name: str) -> int:
        """Convert competitor name to ID."""
        self._ensure_mappings()
        if name not in self._name_to_id:
            raise AssertionError(f"Competitor '{name}' not found in tournament")
        return self._name_to_id[name]

    def _get_competitor_score(self) -> CompetitorScore:
        """Get the score for the current competitor."""
        if self.competitor_id is None:
            raise AssertionError("No competitor selected for assertion")
        if self.competitor_id not in self._results:
            raise AssertionError(
                f"Competitor ID {self.competitor_id} not found in results"
            )
        return self._results[self.competitor_id]

    def _get_competitor_name(self) -> str:
        """Get the name of the current competitor."""
        self._ensure_mappings()
        if self.competitor_id is None:
            return "Unknown"
        return self._id_to_name.get(self.competitor_id, f"ID:{self.competitor_id}")

    def team(self, name: str) -> "CompetitorAssertion":
        """Select a team by name for assertions."""
        competitor_id = self._get_competitor_id(name)
        return CompetitorAssertion(
            tournament=self.tournament,
            competitor_name=name,
            competitor_id=competitor_id,
            _name_to_id=self._name_to_id,
            _id_to_name=self._id_to_name,
            _results=self._results,
            _tiebreaks=self._tiebreaks,
        )

    def player(self, name: str) -> "CompetitorAssertion":
        """Select a player by name for assertions (alias for team)."""
        return self.team(name)


class CompetitorAssertion(StandingsAssertion):
    """Assertions for a specific competitor."""

    def assert_(self) -> "CompetitorResultAssertion":
        """Start a chain of assertions for this competitor."""
        return CompetitorResultAssertion(
            tournament=self.tournament,
            competitor_name=self.competitor_name,
            competitor_id=self.competitor_id,
            _name_to_id=self._name_to_id,
            _id_to_name=self._id_to_name,
            _results=self._results,
            _tiebreaks=self._tiebreaks,
        )


class CompetitorResultAssertion(StandingsAssertion):
    """Fluent interface for asserting competitor results."""

    def wins(self, expected: int) -> "CompetitorResultAssertion":
        """Assert the number of wins."""
        score = self._get_competitor_score()
        actual_wins = sum(
            1 for mr in score.match_results if mr.match_points == 2 and not mr.is_bye
        )
        if actual_wins != expected:
            raise AssertionError(
                f"{self._get_competitor_name()} expected {expected} wins, got {actual_wins}"
            )
        return self

    def losses(self, expected: int) -> "CompetitorResultAssertion":
        """Assert the number of losses."""
        score = self._get_competitor_score()
        actual_losses = sum(
            1 for mr in score.match_results if mr.match_points == 0 and not mr.is_bye
        )
        if actual_losses != expected:
            raise AssertionError(
                f"{self._get_competitor_name()} expected {expected} losses, got {actual_losses}"
            )
        return self

    def draws(self, expected: int) -> "CompetitorResultAssertion":
        """Assert the number of draws."""
        score = self._get_competitor_score()
        actual_draws = sum(
            1 for mr in score.match_results if mr.match_points == 1 and not mr.is_bye
        )
        if actual_draws != expected:
            raise AssertionError(
                f"{self._get_competitor_name()} expected {expected} draws, got {actual_draws}"
            )
        return self

    def byes(self, expected: int) -> "CompetitorResultAssertion":
        """Assert the number of byes."""
        score = self._get_competitor_score()
        actual_byes = sum(1 for mr in score.match_results if mr.is_bye)
        if actual_byes != expected:
            raise AssertionError(
                f"{self._get_competitor_name()} expected {expected} byes, got {actual_byes}"
            )
        return self

    def match_points(self, expected: Union[int, float]) -> "CompetitorResultAssertion":
        """Assert the total match points."""
        score = self._get_competitor_score()
        if score.match_points != expected:
            raise AssertionError(
                f"{self._get_competitor_name()} expected {expected} match points, got {score.match_points}"
            )
        return self

    def game_points(self, expected: Union[int, float]) -> "CompetitorResultAssertion":
        """Assert the total game points."""
        score = self._get_competitor_score()
        # Allow small floating point differences
        if abs(score.game_points - expected) > 0.0001:
            raise AssertionError(
                f"{self._get_competitor_name()} expected {expected} game points, got {score.game_points}"
            )
        return self

    def games_won(self, expected: int) -> "CompetitorResultAssertion":
        """Assert the total number of games won (for team tournaments)."""
        score = self._get_competitor_score()
        actual_games_won = sum(mr.games_won for mr in score.match_results)
        if actual_games_won != expected:
            raise AssertionError(
                f"{self._get_competitor_name()} expected {expected} games won, got {actual_games_won}"
            )
        return self

    def tiebreak(
        self, name: str, expected: Union[int, float]
    ) -> "CompetitorResultAssertion":
        """Assert a specific tiebreak value."""
        # Calculate tiebreaks if not already done
        if self._tiebreaks is None:
            # Default tiebreak order
            tiebreak_order = [
                "sonneborn_berger",
                "buchholz",
                "head_to_head",
                "games_won",
                "game_points",
            ]
            self._tiebreaks = calculate_all_tiebreaks(self._results, tiebreak_order)

        if self.competitor_id not in self._tiebreaks:
            raise AssertionError(
                f"No tiebreak scores found for {self._get_competitor_name()}"
            )

        competitor_tiebreaks = self._tiebreaks[self.competitor_id]
        if name not in competitor_tiebreaks:
            raise AssertionError(
                f"Tiebreak '{name}' not calculated for {self._get_competitor_name()}"
            )

        actual = competitor_tiebreaks[name]
        # Allow small floating point differences
        if abs(actual - expected) > 0.0001:
            raise AssertionError(
                f"{self._get_competitor_name()} expected {expected} for {name} tiebreak, got {actual}"
            )
        return self

    def position(self, expected: int) -> "CompetitorResultAssertion":
        """Assert the final position in standings."""
        # Calculate standings with tiebreaks
        if self._tiebreaks is None:
            tiebreak_order = [
                "sonneborn_berger",
                "buchholz",
                "head_to_head",
                "games_won",
                "game_points",
            ]
            self._tiebreaks = calculate_all_tiebreaks(self._results, tiebreak_order)

        # Sort competitors by match points, game points, then tiebreaks
        standings = []
        for comp_id, score in self._results.items():
            tiebreak_values = []
            if comp_id in self._tiebreaks:
                for tb_name in [
                    "sonneborn_berger",
                    "buchholz",
                    "head_to_head",
                    "games_won",
                ]:
                    tiebreak_values.append(self._tiebreaks[comp_id].get(tb_name, 0))

            standings.append(
                (
                    comp_id,
                    -score.match_points,  # Negative for reverse sort
                    -score.game_points,
                    [-tb for tb in tiebreak_values],  # Negative for reverse sort
                )
            )

        standings.sort(key=lambda x: (x[1], x[2], *x[3]))

        # Find position (1-based)
        actual_position = None
        for i, (comp_id, _, _, _) in enumerate(standings):
            if comp_id == self.competitor_id:
                actual_position = i + 1
                break

        if actual_position is None:
            raise AssertionError(
                f"Could not determine position for {self._get_competitor_name()}"
            )

        if actual_position != expected:
            raise AssertionError(
                f"{self._get_competitor_name()} expected position {expected}, got {actual_position}"
            )
        return self


def assert_tournament(tournament: Tournament) -> StandingsAssertion:
    """Entry point for tournament assertions."""
    return StandingsAssertion(tournament)

