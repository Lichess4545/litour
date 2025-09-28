"""
Tiebreak calculation functions for tournaments.

These functions calculate various tiebreak scores used to determine standings
when competitors have equal match points. They are designed to work with both
team and individual tournaments.
"""

from typing import Dict, List, Tuple, Optional, Set
from dataclasses import dataclass, field


@dataclass(frozen=True)
class MatchResult:
    """Represents the result of a single match for a competitor."""

    opponent_id: Optional[int]  # None for byes
    game_points: float  # Game points scored in this match
    opponent_game_points: float  # Game points opponent scored
    match_points: int  # Match points earned (2 for win, 1 for draw, 0 for loss)
    games_won: int = 0  # Number of individual games won (for team tournaments)
    is_bye: bool = False  # Whether this was a bye


@dataclass(frozen=True)
class CompetitorScore:
    """Final scores and match history for a competitor."""

    competitor_id: int
    match_points: int
    game_points: float
    match_results: List[MatchResult] = field(default_factory=list)


def calculate_sonneborn_berger(
    competitor_score: CompetitorScore, all_scores: Dict[int, CompetitorScore]
) -> float:
    """
    Calculate Sonneborn-Berger score.

    The Sonneborn-Berger score is the sum of defeated opponents' scores plus
    half the sum of drawn opponents' scores.

    Args:
        competitor_score: The competitor's score data
        all_scores: Dictionary mapping competitor IDs to their final scores

    Returns:
        The Sonneborn-Berger score
    """
    sb_score = 0.0

    for result in competitor_score.match_results:
        if result.is_bye or result.opponent_id is None:
            continue

        opponent_score = all_scores.get(result.opponent_id)
        if opponent_score is None:
            continue

        if result.match_points == 2:  # Win
            sb_score += opponent_score.match_points
        elif result.match_points == 1:  # Draw
            sb_score += opponent_score.match_points / 2.0

    return sb_score


def calculate_buchholz(
    competitor_score: CompetitorScore, all_scores: Dict[int, CompetitorScore]
) -> float:
    """
    Calculate Buchholz score.

    The Buchholz score is the sum of all opponents' match points.

    Args:
        competitor_score: The competitor's score data
        all_scores: Dictionary mapping competitor IDs to their final scores

    Returns:
        The Buchholz score
    """
    buchholz = 0.0

    for result in competitor_score.match_results:
        if result.is_bye or result.opponent_id is None:
            continue

        opponent_score = all_scores.get(result.opponent_id)
        if opponent_score is None:
            continue

        buchholz += opponent_score.match_points

    return buchholz


def calculate_head_to_head(
    competitor_score: CompetitorScore,
    tied_competitors: Set[int],
    all_scores: Dict[int, CompetitorScore],
) -> int:
    """
    Calculate head-to-head score among tied competitors.

    The head-to-head score is the sum of match points earned against
    other competitors who are tied on both match points and game points.

    Args:
        competitor_score: The competitor's score data
        tied_competitors: Set of competitor IDs that are tied with this competitor
        all_scores: Dictionary mapping competitor IDs to their final scores

    Returns:
        The head-to-head score
    """
    h2h_score = 0

    for result in competitor_score.match_results:
        if result.is_bye or result.opponent_id is None:
            continue

        if result.opponent_id in tied_competitors:
            h2h_score += result.match_points

    return h2h_score


def calculate_games_won(competitor_score: CompetitorScore) -> int:
    """
    Calculate total games won.

    This is primarily used for team tournaments where each match consists
    of multiple games (boards).

    Args:
        competitor_score: The competitor's score data

    Returns:
        The total number of games won
    """
    return sum(result.games_won for result in competitor_score.match_results)


def build_competitor_scores(
    score_dict: Dict[Tuple[int, int], any],
    last_round_number: int,
    boards_per_match: Optional[int] = None,
) -> Dict[int, CompetitorScore]:
    """
    Build CompetitorScore objects from the raw score dictionary.

    Args:
        score_dict: Dictionary mapping (competitor_id, round_number) to score state
        last_round_number: The number of the last completed round
        boards_per_match: Number of boards per match (for team tournaments)

    Returns:
        Dictionary mapping competitor IDs to CompetitorScore objects
    """
    competitor_scores = {}

    # Get all unique competitor IDs
    competitor_ids = set()
    for (comp_id, round_num), _ in score_dict.items():
        competitor_ids.add(comp_id)

    for comp_id in competitor_ids:
        match_results = []
        previous_games_won = 0

        # Build match results for each round
        for round_num in range(1, last_round_number + 1):
            state = score_dict.get((comp_id, round_num))
            if state is None:
                continue

            # Only create a match result if there was actually a match/bye
            # Check if this round had any activity (match points > 0 or it was a bye)
            if not hasattr(state, "round_opponent"):
                continue

            # Calculate games won in this round
            current_games_won = state.games_won
            round_games_won = current_games_won - previous_games_won
            previous_games_won = current_games_won

            # Create match result
            is_bye = state.round_opponent is None
            match_result = MatchResult(
                opponent_id=state.round_opponent,
                game_points=state.round_points,
                opponent_game_points=state.round_opponent_points,
                match_points=state.round_match_points,
                games_won=round_games_won,
                is_bye=is_bye,
            )
            match_results.append(match_result)

        # Get final scores from the last round
        final_state = score_dict.get((comp_id, last_round_number))
        if final_state:
            competitor_scores[comp_id] = CompetitorScore(
                competitor_id=comp_id,
                match_points=final_state.match_points,
                game_points=final_state.game_points,
                match_results=match_results,
            )

    return competitor_scores


def calculate_all_tiebreaks(
    competitor_scores: Dict[int, CompetitorScore], tiebreak_order: List[str]
) -> Dict[int, Dict[str, float]]:
    """
    Calculate all tiebreak scores for all competitors.

    Args:
        competitor_scores: Dictionary mapping competitor IDs to CompetitorScore objects
        tiebreak_order: List of tiebreak names to calculate

    Returns:
        Dictionary mapping competitor IDs to dictionaries of tiebreak scores
    """
    # Group competitors by match points and game points for head-to-head
    tied_groups = {}
    for comp_id, score in competitor_scores.items():
        key = (score.match_points, score.game_points)
        if key not in tied_groups:
            tied_groups[key] = set()
        tied_groups[key].add(comp_id)

    # Calculate tiebreaks for each competitor
    tiebreak_scores = {}
    for comp_id, score in competitor_scores.items():
        tiebreaks = {}

        for tiebreak_name in tiebreak_order:
            if tiebreak_name == "sonneborn_berger":
                tiebreaks["sonneborn_berger"] = calculate_sonneborn_berger(
                    score, competitor_scores
                )
            elif tiebreak_name == "buchholz":
                tiebreaks["buchholz"] = calculate_buchholz(score, competitor_scores)
            elif tiebreak_name == "head_to_head":
                tied_set = tied_groups.get(
                    (score.match_points, score.game_points), set()
                )
                tiebreaks["head_to_head"] = calculate_head_to_head(
                    score, tied_set, competitor_scores
                )
            elif tiebreak_name == "games_won":
                tiebreaks["games_won"] = calculate_games_won(score)
            elif tiebreak_name == "game_points":
                tiebreaks["game_points"] = score.game_points

        tiebreak_scores[comp_id] = tiebreaks

    return tiebreak_scores
