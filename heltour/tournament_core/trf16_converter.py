"""
Converter from TRF16 format to tournament structure.

This module provides functionality to convert parsed TRF16 data into
our tournament_core structures, suitable for use with TournamentBuilder.
"""

from typing import Dict, List, Tuple, Optional
from heltour.tournament_core.trf16 import (
    TRF16Parser,
    TRF16Header,
    TRF16Player,
    TRF16Team,
    TRF16Pairing,
)
from heltour.tournament_core.builder import TournamentBuilder


class TRF16Converter:
    """Convert TRF16 data to tournament structures."""

    def __init__(self, trf16_content: str):
        """Initialize with TRF16 content."""
        self.parser = TRF16Parser(trf16_content)
        self.header: Optional[TRF16Header] = None
        self.players: Dict[int, TRF16Player] = {}
        self.teams: Dict[str, TRF16Team] = {}

    def parse(self):
        """Parse the TRF16 content."""
        self.header, self.players, self.teams = self.parser.parse_all()
        self.parser.update_board_numbers()

    def create_tournament_builder(self, league_tag: str = "TRF16") -> TournamentBuilder:
        """Create a TournamentBuilder with teams and players from TRF16.

        Args:
            league_tag: Tag for the league (default: "TRF16")
        """
        if not self.header:
            self.parse()

        builder = TournamentBuilder()

        # Set up league and season
        league_name = self.header.tournament_name

        # Configure tiebreaks based on TRF16 format
        # EGGSB BH:MP = Extended Game-Game Sonneborn-Berger, Buchholz, Match Points
        builder.league(
            name=league_name,
            tag=league_tag,
            type="team",  # TRF16 team format
            # Tiebreaks: Match points primary, then Game points, EGGSB, Buchholz
            team_tiebreak_1="game_points",  # After match points, use game points
            team_tiebreak_2="eggsb",  # EGGSB - Extended Game-Game Sonneborn-Berger
            team_tiebreak_3="buchholz",  # BH - Buchholz
            team_tiebreak_4="head_to_head",  # Additional tiebreak
        )

        # Determine boards per team
        max_boards = max(len(team.player_ids) for team in self.teams.values())

        builder.season(
            league_tag=league_tag,
            name=f"{league_name} {self.header.start_date.year}",
            rounds=self.header.num_rounds,
            boards=max_boards,
        )

        # Add teams and players
        self._add_teams_and_players(builder)

        return builder

    def add_rounds_to_builder(
        self, builder: TournamentBuilder, rounds_to_add: Optional[List[int]] = None
    ):
        """Add round pairings and results to the builder.

        Args:
            builder: TournamentBuilder instance
            rounds_to_add: List of round numbers to add. If None, adds all rounds.
        """
        if rounds_to_add is None:
            rounds_to_add = list(range(1, self.header.num_rounds + 1))

        for round_num in rounds_to_add:
            self._add_round(builder, round_num)

    def _add_teams_and_players(self, builder: TournamentBuilder):
        """Add all teams and their players to the builder."""
        # Create mapping of player line numbers to player data
        player_by_line = self.players

        # Add each team
        for team_name, team in self.teams.items():
            # Collect players for this team
            team_players = []

            for player_id in team.player_ids:
                if player_id in player_by_line:
                    player = player_by_line[player_id]
                    # Add as (name, rating) tuple
                    team_players.append((player.name, player.rating))

            # Add team with all its players
            if team_players:
                builder.team(team_name, *team_players)

    def _add_round(self, builder: TournamentBuilder, round_number: int):
        """Add a single round's pairings and results."""
        builder.round(round_number)

        # Get pairings for this round
        pairings = self.parser.parse_round_pairings(round_number)

        # Group pairings by teams
        team_matches = self._group_pairings_by_teams(pairings, round_number)

        # Add each team match
        for (white_team, black_team), board_results in team_matches.items():
            # Sort by board number
            board_results.sort(key=lambda x: x[0])

            # Extract just the results
            results = [result for _, result in board_results]

            if results:
                builder.match(white_team, black_team, *results)

        builder.complete()

    def _group_pairings_by_teams(
        self, pairings: List[TRF16Pairing], round_number: int = 1
    ) -> Dict[Tuple[str, str], List[Tuple[int, str]]]:
        """Group individual pairings into team matches.

        Args:
            pairings: List of individual pairings
            round_number: Round number (needed for forfeit handling)

        Returns:
            Dict mapping (white_team, black_team) to list of (board_number, result)
        """
        # First, collect all games by teams involved
        team_games = {}  # (team1, team2) -> list of games

        for pairing in pairings:
            white_player = self.players.get(pairing.white_player_id)
            black_player = self.players.get(pairing.black_player_id)

            # Handle forfeit wins (opponent ID is 0)
            is_forfeit_win = pairing.black_player_id == 0 and pairing.result == "1X-0F"

            if not white_player:
                continue

            if not black_player and not is_forfeit_win:
                continue

            # Find teams for each player
            white_team_name = self._find_player_team(pairing.white_player_id)
            black_team_name = (
                self._find_player_team(pairing.black_player_id)
                if not is_forfeit_win
                else None
            )

            if white_team_name and black_team_name:
                # Normalize team order - always put teams in alphabetical order
                teams = tuple(sorted([white_team_name, black_team_name]))

                if teams not in team_games:
                    team_games[teams] = []

                # Store the game with info about which team had white
                team_games[teams].append(
                    {
                        "white_team": white_team_name,
                        "black_team": black_team_name,
                        "white_player": white_player,
                        "black_player": black_player,
                        "board": white_player.board_number,
                        "result": pairing.result,
                    }
                )

        # Now organize into proper team matches
        team_matches = {}

        for teams, games in team_games.items():
            if len(games) > 0:
                # Determine which team should be considered "white" for the match
                # Use the team that has white on board 1
                board1_game = next((g for g in games if g["board"] == 1), games[0])
                match_white_team = board1_game["white_team"]
                match_black_team = board1_game["black_team"]

                match_key = (match_white_team, match_black_team)
                team_matches[match_key] = []

                # Add all games for this match
                for game in sorted(games, key=lambda g: g["board"]):
                    # Adjust result if the game colors don't match the match colors
                    result = game["result"]
                    if game["white_team"] != match_white_team:
                        # Flip the result
                        if result == "1-0":
                            result = "0-1"
                        elif result == "0-1":
                            result = "1-0"

                    team_matches[match_key].append((game["board"], result))

        # Second pass: Handle forfeit wins
        # Find all forfeit wins that weren't assigned to a team match
        forfeit_wins = []
        for pairing in pairings:
            if pairing.black_player_id == 0 and pairing.result == "1X-0F":
                # Note: white_player_id here is just the winner, not necessarily white
                winner = self.players.get(pairing.white_player_id)
                if winner:
                    winner_team_name = self._find_player_team(pairing.white_player_id)
                    if winner_team_name:
                        forfeit_wins.append(
                            {
                                "winner_id": pairing.white_player_id,
                                "winner": winner,
                                "winner_team": winner_team_name,
                                "board": winner.board_number,
                            }
                        )

        # For each forfeit win, find which team match it belongs to
        for forfeit in forfeit_wins:
            winner_team = forfeit["winner_team"]
            board = forfeit["board"]

            # Find the team match that includes this team
            matched = False
            for match_key, boards in team_matches.items():
                match_white_team, match_black_team = match_key

                # Check if this forfeit belongs to this match
                if winner_team == match_white_team or winner_team == match_black_team:
                    # Check if this board is already filled
                    board_numbers = [b[0] for b in boards]
                    if board not in board_numbers:
                        # Determine what color the winner actually had in this match
                        if winner_team == match_white_team:
                            # Winner was playing white in this match
                            boards.append((board, "1X-0F"))  # White wins by forfeit
                        else:
                            # Winner was playing black in this match
                            boards.append((board, "0F-1X"))  # Black wins by forfeit
                        # Sort boards by board number
                        boards.sort(key=lambda x: x[0])
                        matched = True
                        break

            # If we didn't find a match in existing team_matches, we need to create one
            if not matched:
                # Find the opponent team based on board assignments
                opponent_team = None
                opponent_player = None

                # Look through all teams to find who should have played on this board
                for team_name, team in self.teams.items():
                    if team_name != winner_team:
                        # Check if this team has a player on the same board
                        for pid in team.player_ids:
                            if (
                                pid in self.players
                                and self.players[pid].board_number == board
                            ):
                                # Check if this player didn't play in this round
                                if round_number <= len(self.players[pid].results):
                                    opp_id, color, result = self.players[pid].results[
                                        round_number - 1
                                    ]
                                    if opp_id == 0 and color == "-" and result == "-":
                                        # This player didn't play - likely the forfeit opponent
                                        opponent_team = team_name
                                        opponent_player = self.players[pid]
                                        break
                        if opponent_team:
                            break

                if opponent_team:
                    # Check if there's already a match between these teams
                    existing_match = None
                    for mk in team_matches:
                        if set(mk) == {winner_team, opponent_team}:
                            existing_match = mk
                            break

                    if existing_match:
                        # Use the existing match orientation
                        match_key = existing_match
                        boards = team_matches[match_key]

                        # Add the forfeit with correct orientation
                        if existing_match[0] == winner_team:
                            # winner is on white team
                            boards.append((board, "1X-0F"))  # White wins by forfeit
                        else:
                            # winner is on black team
                            boards.append((board, "0F-1X"))  # Black wins by forfeit
                        boards.sort(key=lambda x: x[0])
                    else:
                        # No existing match, create new one
                        # Determine match orientation - alphabetically first team is "white"
                        if winner_team < opponent_team:
                            match_key = (winner_team, opponent_team)
                            team_matches[match_key] = [(board, "1X-0F")]
                        else:
                            match_key = (opponent_team, winner_team)
                            team_matches[match_key] = [(board, "0F-1X")]

        return team_matches

    def _find_player_team(self, player_id: int) -> Optional[str]:
        """Find which team a player belongs to."""
        for team_name, team in self.teams.items():
            if player_id in team.player_ids:
                return team_name
        return None

    def get_team_standings_after_round(
        self, round_number: int
    ) -> Dict[str, Dict[str, float]]:
        """Calculate team standings after a specific round.

        Returns:
            Dict mapping team name to {'match_points': float, 'game_points': float}
        """
        # This would calculate standings based on parsed results
        # Useful for validating against TRF16's reported standings
        standings = {}

        # Initialize standings for each team
        for team_name in self.teams:
            standings[team_name] = {"match_points": 0.0, "game_points": 0.0}

        # Process results up to the specified round
        # Implementation would go here

        return standings
