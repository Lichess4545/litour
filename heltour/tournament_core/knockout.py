"""
Knockout tournament utilities for bracket generation and advancement calculation.

This module provides functionality for:
- Validating bracket sizes (must be power of 2)
- Generating initial knockout brackets with different seeding patterns
- Calculating match winners and tournament advancement
- Handling multi-game matches and manual tiebreaks
"""

from typing import List, Optional, Tuple
import math

from heltour.tournament_core.structure import Match, Round, Tournament, TournamentFormat
from heltour.tournament_core.scoring import ScoringSystem, STANDARD_SCORING


def validate_bracket_size(team_count: int) -> bool:
    """Check if team count is a valid power of 2 for knockout tournaments."""
    return team_count > 1 and (team_count & (team_count - 1)) == 0


def calculate_rounds_needed(team_count: int) -> int:
    """Calculate number of rounds needed for a knockout tournament."""
    if not validate_bracket_size(team_count):
        raise ValueError(f"Team count {team_count} is not a power of 2")
    return int(math.log2(team_count))


def get_knockout_stage_name(teams_remaining: int) -> str:
    """Get the standard name for a knockout stage based on teams remaining."""
    stage_names = {
        2: "finals",
        4: "semifinals",
        8: "quarterfinals",
        16: "round-of-16",
        32: "round-of-32",
        64: "round-of-64",
    }

    if teams_remaining in stage_names:
        return stage_names[teams_remaining]
    else:
        return f"round-of-{teams_remaining}"


def generate_knockout_seedings_adjacent(team_ids: List[int]) -> List[Tuple[int, int]]:
    """Generate knockout bracket with adjacent seedings (1v2, 3v4, 5v6, etc.).

    Args:
        team_ids: List of team IDs in seeding order (1st seed first)

    Returns:
        List of (team1_id, team2_id) tuples for first round matches
    """
    if not validate_bracket_size(len(team_ids)):
        raise ValueError(f"Team count {len(team_ids)} is not a power of 2")

    pairings = []
    for i in range(0, len(team_ids), 2):
        pairings.append((team_ids[i], team_ids[i + 1]))

    return pairings


def generate_knockout_seedings_traditional(
    team_ids: List[int],
) -> List[Tuple[int, int]]:
    """Generate knockout bracket with traditional seedings (1v32, 2v31, 3v30, etc.).

    Args:
        team_ids: List of team IDs in seeding order (1st seed first)

    Returns:
        List of (team1_id, team2_id) tuples for first round matches
    """
    if not validate_bracket_size(len(team_ids)):
        raise ValueError(f"Team count {len(team_ids)} is not a power of 2")

    n = len(team_ids)
    pairings = []

    for i in range(n // 2):
        # Pair seed i+1 with seed n-i
        pairings.append((team_ids[i], team_ids[n - 1 - i]))

    return pairings


def calculate_knockout_advancement(
    matches: List[Match], scoring: ScoringSystem = STANDARD_SCORING
) -> List[int]:
    """Calculate which competitors advance from a knockout round.

    Args:
        matches: List of matches in the round
        scoring: Scoring system to use

    Returns:
        List of advancing competitor IDs

    Raises:
        ValueError: If any match has no clear winner (tied and no manual tiebreak)
    """
    advancing = []

    for match in matches:
        winner = match.winner_id(scoring)
        if winner is None:
            raise ValueError(
                f"Match between {match.competitor1_id} and {match.competitor2_id} "
                "is tied and requires manual tiebreak resolution"
            )
        advancing.append(winner)

    return advancing


def generate_next_round_pairings(advancing_teams: List[int]) -> List[Tuple[int, int]]:
    """Generate pairings for the next knockout round.

    Args:
        advancing_teams: List of team IDs that advanced from previous round

    Returns:
        List of (team1_id, team2_id) tuples for next round matches

    Raises:
        ValueError: If number of advancing teams is not even
    """
    if len(advancing_teams) % 2 != 0:
        raise ValueError(f"Cannot pair {len(advancing_teams)} teams (must be even)")

    pairings = []
    for i in range(0, len(advancing_teams), 2):
        pairings.append((advancing_teams[i], advancing_teams[i + 1]))

    return pairings


def create_knockout_tournament(
    team_ids: List[int],
    seeding_style: str = "traditional",
    games_per_match: int = 1,
    max_rounds: Optional[int] = None,
    scoring: ScoringSystem = STANDARD_SCORING,
) -> Tournament:
    """Create a complete knockout tournament structure (without results).

    Args:
        team_ids: List of team IDs in seeding order
        seeding_style: "traditional" (1v32) or "adjacent" (1v2)
        games_per_match: Number of games per match
        max_rounds: Maximum rounds to play (None = play to completion)
        scoring: Scoring system to use

    Returns:
        Tournament structure with empty matches ready for results
    """
    if not validate_bracket_size(len(team_ids)):
        raise ValueError(f"Team count {len(team_ids)} is not a power of 2")

    total_rounds = calculate_rounds_needed(len(team_ids))
    if max_rounds is not None:
        total_rounds = min(total_rounds, max_rounds)

    # Generate first round pairings
    if seeding_style == "traditional":
        first_round_pairings = generate_knockout_seedings_traditional(team_ids)
    elif seeding_style == "adjacent":
        first_round_pairings = generate_knockout_seedings_adjacent(team_ids)
    else:
        raise ValueError(f"Unknown seeding style: {seeding_style}")

    rounds = []
    current_teams = len(team_ids)

    for round_num in range(1, total_rounds + 1):
        stage_name = get_knockout_stage_name(current_teams)
        matches = []

        if round_num == 1:
            # First round uses the generated pairings
            for team1_id, team2_id in first_round_pairings:
                # Create empty match (no games yet)
                match = Match(
                    competitor1_id=team1_id,
                    competitor2_id=team2_id,
                    games=[],
                    games_per_match=games_per_match,
                )
                matches.append(match)
        else:
            # Later rounds will be filled in as previous rounds complete
            # For now, create placeholder matches
            matches_needed = current_teams // 2
            for i in range(matches_needed):
                # Placeholder matches with dummy IDs
                match = Match(
                    competitor1_id=-1,  # Will be filled from previous round winners
                    competitor2_id=-1,
                    games=[],
                    games_per_match=games_per_match,
                )
                matches.append(match)

        round_obj = Round(number=round_num, matches=matches, knockout_stage=stage_name)
        rounds.append(round_obj)
        current_teams //= 2

    return Tournament(
        competitors=team_ids,
        rounds=rounds,
        scoring=scoring,
        format=TournamentFormat.KNOCKOUT,
    )


def update_knockout_tournament_with_winners(
    tournament: Tournament, round_number: int, winners: List[int]
) -> Tournament:
    """Update knockout tournament with winners from a completed round.

    Args:
        tournament: Current tournament structure
        round_number: Round number that was completed (1-indexed)
        winners: List of winning team IDs from that round

    Returns:
        Updated tournament with next round pairings filled in
    """
    if round_number >= len(tournament.rounds):
        # No more rounds to update
        return tournament

    next_round_idx = round_number  # 0-indexed for list access
    next_round = tournament.rounds[next_round_idx]

    # Generate pairings for next round
    next_pairings = generate_next_round_pairings(winners)

    # Update matches in next round
    updated_matches = []
    for i, (team1_id, team2_id) in enumerate(next_pairings):
        if i < len(next_round.matches):
            # Update existing match
            old_match = next_round.matches[i]
            new_match = Match(
                competitor1_id=team1_id,
                competitor2_id=team2_id,
                games=old_match.games,  # Keep any existing games
                games_per_match=old_match.games_per_match,
                manual_tiebreak_value=old_match.manual_tiebreak_value,
            )
            updated_matches.append(new_match)
        else:
            # This shouldn't happen if tournament structure is correct
            raise ValueError(f"Not enough matches in round {round_number + 1}")

    # Update the round
    updated_round = Round(
        number=next_round.number,
        matches=updated_matches,
        knockout_stage=next_round.knockout_stage,
    )

    # Update tournament
    new_rounds = (
        tournament.rounds[:next_round_idx]
        + [updated_round]
        + tournament.rounds[next_round_idx + 1 :]
    )

    return Tournament(
        competitors=tournament.competitors,
        rounds=new_rounds,
        scoring=tournament.scoring,
        format=tournament.format,
    )


def is_knockout_tournament_complete(tournament: Tournament) -> bool:
    """Check if a knockout tournament is complete (has a winner).

    Returns True if the final round has been played and has a winner.
    """
    if tournament.format != TournamentFormat.KNOCKOUT:
        return False

    if not tournament.rounds:
        return False

    final_round = tournament.rounds[-1]
    if not final_round.matches:
        return False

    # Final round should have exactly one match
    if len(final_round.matches) != 1:
        return False

    final_match = final_round.matches[0]

    # Check if final match has games and a clear winner
    return len(final_match.games) > 0 and final_match.winner_id() is not None


def get_knockout_winner(tournament: Tournament) -> Optional[int]:
    """Get the winner of a completed knockout tournament.

    Returns:
        Winner's competitor ID, or None if tournament is not complete
    """
    if not is_knockout_tournament_complete(tournament):
        return None

    final_match = tournament.rounds[-1].matches[0]
    return final_match.winner_id()
