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
    white_points = 0.0
    black_points = 0.0
    white_wins = 0
    black_wins = 0

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
        # Get the piece-level scores first
        white_score = board_pairing.white_score() or 0
        black_score = board_pairing.black_score() or 0

        # Skip boards with no result
        if white_score == 0 and black_score == 0:
            continue

        # Handle forfeit cases where one player might be None
        if not board_pairing.white_id and not board_pairing.black_id:
            continue  # Skip completely empty boards

        # Determine team assignments for non-None players
        white_piece_player_on_white_team = (
            board_pairing.white_id and board_pairing.white_id in white_team_player_ids
        )
        white_piece_player_on_black_team = (
            board_pairing.white_id and board_pairing.white_id in black_team_player_ids
        )
        black_piece_player_on_white_team = (
            board_pairing.black_id and board_pairing.black_id in white_team_player_ids
        )
        black_piece_player_on_black_team = (
            board_pairing.black_id and board_pairing.black_id in black_team_player_ids
        )

        # For forfeit cases, determine team assignment from the non-None player
        if not board_pairing.white_id:  # White piece player forfeited
            if black_piece_player_on_white_team:
                # Black piece player is on white team, so white team gets black_score
                white_points += black_score
                black_points += white_score
                if black_score == 1:
                    white_wins += 1
                if white_score == 1:
                    black_wins += 1
            elif black_piece_player_on_black_team:
                # Black piece player is on black team, so black team gets black_score
                white_points += white_score
                black_points += black_score
                if white_score == 1:
                    white_wins += 1
                if black_score == 1:
                    black_wins += 1
        elif not board_pairing.black_id:  # Black piece player forfeited
            if white_piece_player_on_white_team:
                # White piece player is on white team, so white team gets white_score
                white_points += white_score
                black_points += black_score
                if white_score == 1:
                    white_wins += 1
                if black_score == 1:
                    black_wins += 1
            elif white_piece_player_on_black_team:
                # White piece player is on black team, so black team gets white_score
                white_points += black_score
                black_points += white_score
                if black_score == 1:
                    white_wins += 1
                if white_score == 1:
                    black_wins += 1
        else:
            # Normal case: both players present
            if white_piece_player_on_white_team and black_piece_player_on_black_team:
                # Normal case: white team player has white pieces
                white_points += white_score
                black_points += black_score
                if white_score == 1:
                    white_wins += 1
                if black_score == 1:
                    black_wins += 1
            elif white_piece_player_on_black_team and black_piece_player_on_white_team:
                # Swapped case: white team player has black pieces
                white_points += black_score
                black_points += white_score
                if black_score == 1:
                    white_wins += 1
                if white_score == 1:
                    black_wins += 1
            # else: Skip if we can't determine team assignments

    return white_points, black_points, white_wins, black_wins


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
                if not board_pairing.white_id or not board_pairing.black_id:
                    continue  # Skip empty boards

                game_result = _result_to_game_result(
                    board_pairing.result, board_pairing.colors_reversed
                )
                if game_result is None:
                    continue  # Skip games without results

                # For team matches, ensure player1 is from white_team, player2 is from black_team
                # Check actual team membership like the updated refresh_points() does

                white_team_player_ids = set(
                    team_pairing.white_team.teammember_set.values_list(
                        "player_id", flat=True
                    )
                )
                black_team_player_ids = set(
                    team_pairing.black_team.teammember_set.values_list(
                        "player_id", flat=True
                    )
                )

                # Determine which team each player belongs to
                white_piece_player_on_white_team = (
                    board_pairing.white_id in white_team_player_ids
                )
                white_piece_player_on_black_team = (
                    board_pairing.white_id in black_team_player_ids
                )
                black_piece_player_on_white_team = (
                    board_pairing.black_id in white_team_player_ids
                )
                black_piece_player_on_black_team = (
                    board_pairing.black_id in black_team_player_ids
                )

                if (
                    white_piece_player_on_white_team
                    and black_piece_player_on_black_team
                ):
                    # Normal case: white team player has white pieces
                    player1_id = board_pairing.white_id  # white_team player
                    player2_id = board_pairing.black_id  # black_team player
                    # game_result is correct as-is
                elif (
                    white_piece_player_on_black_team
                    and black_piece_player_on_white_team
                ):
                    # Swapped case: colors are reversed
                    player1_id = (
                        board_pairing.black_id
                    )  # white_team player (playing black)
                    player2_id = (
                        board_pairing.white_id
                    )  # black_team player (playing white)
                    # Swap the result since we swapped the players
                    if game_result == GameResult.P1_WIN:
                        game_result = GameResult.P2_WIN
                    elif game_result == GameResult.P2_WIN:
                        game_result = GameResult.P1_WIN
                    elif game_result == GameResult.P1_FORFEIT_WIN:
                        game_result = GameResult.P2_FORFEIT_WIN
                    elif game_result == GameResult.P2_FORFEIT_WIN:
                        game_result = GameResult.P1_FORFEIT_WIN
                else:
                    # Skip if we can't determine team assignments
                    continue

                board_results.append((player1_id, player2_id, game_result))

            if board_results:
                match = create_team_match(
                    team_pairing.white_team_id,
                    team_pairing.black_team_id,
                    board_results,
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
