"""
Transform database models to tournament_core structure representation.

This module provides functions to convert Django ORM models from heltour.tournament
into the clean tournament_core structure for tiebreak calculations and analysis.
"""

from typing import Optional
from heltour.tournament_core.structure import (
    Game,
    GameResult,
    Match,
    Round,
    Tournament,
    create_single_game_match,
    create_bye_match,
    create_team_match,
)
from heltour.tournament_core.scoring import STANDARD_SCORING, ScoringSystem


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

                # Ensure correct player ordering for team matches
                # player1 should always be from team1 (white_team)
                # player2 should always be from team2 (black_team)
                if board_pairing.board_number % 2 == 1:
                    # Odd board: white_team gets white
                    player1_id = board_pairing.white_id
                    player2_id = board_pairing.black_id
                else:
                    # Even board: black_team gets white (colors alternate)
                    # We need to swap players and adjust the result
                    player1_id = board_pairing.black_id
                    player2_id = board_pairing.white_id
                    # Reverse the result since we swapped players
                    if game_result == GameResult.P1_WIN:
                        game_result = GameResult.P2_WIN
                    elif game_result == GameResult.P2_WIN:
                        game_result = GameResult.P1_WIN
                    elif game_result == GameResult.P1_FORFEIT_WIN:
                        game_result = GameResult.P2_FORFEIT_WIN
                    elif game_result == GameResult.P2_FORFEIT_WIN:
                        game_result = GameResult.P1_FORFEIT_WIN

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
            matches.append(create_bye_match(team_bye.team_id, season.boards or 1))

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
