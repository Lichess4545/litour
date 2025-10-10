"""
Transform database models to tournament_core structure representation.

This module provides functions to convert Django ORM models from heltour.tournament
into the clean tournament_core structure for tiebreak calculations and analysis.
"""

from typing import Optional
from heltour.tournament_core.structure import (
    GameResult,
    Round,
    Tournament,
    create_single_game_match,
    create_bye_match,
    create_team_match,
)
from heltour.tournament_core.scoring import STANDARD_SCORING, ScoringSystem


def calculate_team_pairing_scores(team_pairing):
    """Calculate the correct scores for a team pairing based on board results.

    This is the single source of truth for team pairing score calculation.
    Used by both db_to_structure conversion and TeamPairing.refresh_points().

    Args:
        team_pairing: A TeamPairing model instance

    Returns:
        tuple: (white_points, black_points, white_wins, black_wins)
    """
    white_team_points = 0.0
    black_team_points = 0.0
    white_team_wins = 0
    black_team_wins = 0

    # Get team member player IDs for efficient lookup
    white_team_player_ids = set(
        team_pairing.white_team.teammember_set.values_list("player_id", flat=True)
    )
    black_team_player_ids = set(
        team_pairing.black_team.teammember_set.values_list("player_id", flat=True)
    )

    for board_pairing in (
        team_pairing.teamplayerpairing_set.all().nocache().order_by("board_number")
    ):
        # Skip boards with no result
        if not board_pairing.result:
            continue

        # Get the piece-color scores (white's perspective)
        white_score = board_pairing.white_score() or 0
        black_score = board_pairing.black_score() or 0

        # Skip if no actual score (both 0)
        if white_score == 0 and black_score == 0:
            continue

        # For each non-None player, determine which team they're on
        if board_pairing.white_id:
            if board_pairing.white_id in white_team_player_ids:
                # White pieces player is on white team
                white_team_points += white_score
                if white_score == 1:
                    white_team_wins += 1
            elif board_pairing.white_id in black_team_player_ids:
                # White pieces player is on black team
                black_team_points += white_score
                if white_score == 1:
                    black_team_wins += 1

        if board_pairing.black_id:
            if board_pairing.black_id in white_team_player_ids:
                # Black pieces player is on white team
                white_team_points += black_score
                if black_score == 1:
                    white_team_wins += 1
            elif board_pairing.black_id in black_team_player_ids:
                # Black pieces player is on black team
                black_team_points += black_score
                if black_score == 1:
                    black_team_wins += 1

    return white_team_points, black_team_points, white_team_wins, black_team_wins


def _result_to_game_result(
    result_str: str, colors_reversed: bool = False
) -> Optional[GameResult]:
    """Convert database result string to GameResult enum.

    Args:
        result_str: The result string from the database (e.g., '1-0', '1/2-1/2', '0-1')
        colors_reversed: Whether the colors are reversed in the pairing

    Returns:
        GameResult enum value or None if result is empty/invalid
    """
    if not result_str:
        return None

    # Map database results to GameResult enum
    result_map = {
        "1-0": GameResult.P1_WIN,
        "1/2-1/2": GameResult.DRAW,
        "0-1": GameResult.P2_WIN,
        "1X-0F": GameResult.P1_FORFEIT_WIN,
        "0F-1X": GameResult.P2_FORFEIT_WIN,
        "0F-0F": GameResult.DOUBLE_FORFEIT,
    }

    game_result = result_map.get(result_str)
    if game_result is None:
        return None

    # Reverse the result if colors are reversed
    if colors_reversed:
        if game_result == GameResult.P1_WIN:
            game_result = GameResult.P2_WIN
        elif game_result == GameResult.P2_WIN:
            game_result = GameResult.P1_WIN
        elif game_result == GameResult.P1_FORFEIT_WIN:
            game_result = GameResult.P2_FORFEIT_WIN
        elif game_result == GameResult.P2_FORFEIT_WIN:
            game_result = GameResult.P1_FORFEIT_WIN

    return game_result


def team_tournament_to_structure(season) -> Tournament:
    """Convert a team tournament season to tournament_core structure.

    Args:
        season: A Season model instance from the database

    Returns:
        Tournament object with all rounds, matches, and games
    """
    from heltour.tournament.models import Team, TeamPairing, TeamBye

    # Get all teams in the season
    teams = list(Team.objects.filter(season=season).values_list("id", flat=True))

    # Get all completed rounds ordered by number
    rounds = []
    for round_obj in season.round_set.filter(is_completed=True).order_by("number"):
        matches = []

        # Get all team pairings for this round
        for team_pairing in (
            TeamPairing.objects.filter(round=round_obj)
            .select_related("white_team", "black_team")
            .prefetch_related("teamplayerpairing_set")
        ):

            # Get all board pairings for this team match
            board_results = []
            board_pairings = list(
                team_pairing.teamplayerpairing_set.all().order_by("board_number")
            )

            # Team tournaments must have board pairings to calculate results
            if not board_pairings:
                raise ValueError(
                    f"TeamPairing between {team_pairing.white_team} and {team_pairing.black_team} "
                    f"in round {round_obj.number} has no board pairings. "
                    "Team tournaments require individual board results."
                )

            for board_pairing in board_pairings:
                # Handle forfeit wins where one player is missing
                if not board_pairing.white_id and not board_pairing.black_id:
                    continue  # Skip completely empty boards

                game_result = _result_to_game_result(
                    board_pairing.result, board_pairing.colors_reversed
                )
                if game_result is None:
                    continue  # Skip games without results

                # Simply use the white/black player IDs as they are
                # Player1 is whoever has white pieces, Player2 has black pieces
                player1_id = board_pairing.white_id or -1  # -1 for forfeit
                player2_id = board_pairing.black_id or -1  # -1 for forfeit

                board_results.append((player1_id, player2_id, game_result))

            if board_results:
                # Build player to team mapping
                player_team_mapping = {}

                # Get all team members
                for tm in team_pairing.white_team.teammember_set.all():
                    player_team_mapping[tm.player_id] = team_pairing.white_team_id

                for tm in team_pairing.black_team.teammember_set.all():
                    player_team_mapping[tm.player_id] = team_pairing.black_team_id

                match = create_team_match(
                    team_pairing.white_team_id,
                    team_pairing.black_team_id,
                    board_results,
                    player_team_mapping,
                )
                matches.append(match)

        # Add bye matches for teams with TeamBye records
        for team_bye in TeamBye.objects.filter(round=round_obj).select_related("team"):
            # Team tournaments must have a valid boards count
            boards = season.boards
            if not boards or boards <= 0:
                raise ValueError(
                    f"Season {season} has invalid boards count: {boards}. "
                    "Team tournaments require a positive boards count."
                )
            matches.append(create_bye_match(team_bye.team_id, boards))

        if matches:
            rounds.append(Round(round_obj.number, matches))

    # Create the tournament with standard scoring
    return Tournament(teams, rounds, STANDARD_SCORING)


def lone_tournament_to_structure(season) -> Tournament:
    """Convert an individual (lone) tournament season to tournament_core structure.

    Args:
        season: A Season model instance from the database

    Returns:
        Tournament object with all rounds, matches, and games
    """
    from heltour.tournament.models import SeasonPlayer, LonePlayerPairing

    # Get all players in the season
    players = list(
        SeasonPlayer.objects.filter(season=season).values_list("player_id", flat=True)
    )

    # Get all completed rounds ordered by number
    rounds = []
    for round_obj in season.round_set.filter(is_completed=True).order_by("number"):
        matches = []

        # Get all player pairings for this round
        for pairing in LonePlayerPairing.objects.filter(round=round_obj).select_related(
            "white", "black"
        ):
            if not pairing.white_id or not pairing.black_id:
                continue  # Skip empty pairings

            game_result = _result_to_game_result(
                pairing.result, pairing.colors_reversed
            )
            if game_result is None:
                continue  # Skip games without results

            match = create_single_game_match(
                pairing.white_id, pairing.black_id, game_result
            )
            matches.append(match)

        # Add byes for players that didn't play
        players_that_played = set()
        for match in matches:
            players_that_played.add(match.competitor1_id)
            players_that_played.add(match.competitor2_id)

        for player_id in players:
            if player_id not in players_that_played:
                matches.append(create_bye_match(player_id))

        if matches:
            rounds.append(Round(round_obj.number, matches))

    # Create the tournament with standard scoring
    return Tournament(players, rounds, STANDARD_SCORING)


def season_to_tournament_structure(
    season, scoring: Optional[ScoringSystem] = None
) -> Tournament:
    """Convert any season (team or individual) to tournament_core structure.

    This is the main entry point for converting database models to the clean
    tournament structure used for calculations.

    Args:
        season: A Season model instance from the database
        scoring: Optional custom scoring system (defaults to STANDARD_SCORING)

    Returns:
        Tournament object with all rounds, matches, and games
    """
    if season.league.is_team_league():
        tournament = team_tournament_to_structure(season)
    else:
        tournament = lone_tournament_to_structure(season)

    # Override scoring if provided
    if scoring:
        tournament.scoring = scoring

    return tournament
