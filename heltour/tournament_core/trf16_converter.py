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

    def create_tournament_builder(self) -> TournamentBuilder:
        """Create a TournamentBuilder with teams and players from TRF16."""
        if not self.header:
            self.parse()

        builder = TournamentBuilder()

        # Set up league and season
        league_name = self.header.tournament_name
        league_tag = self._generate_league_tag(league_name)

        builder.league(
            name=league_name, tag=league_tag, type="team"  # TRF16 team format
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
        team_matches = self._group_pairings_by_teams(pairings)

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
        self, pairings: List[TRF16Pairing]
    ) -> Dict[Tuple[str, str], List[Tuple[int, str]]]:
        """Group individual pairings into team matches.

        Returns:
            Dict mapping (white_team, black_team) to list of (board_number, result)
        """
        # First, collect all games by teams involved
        team_games = {}  # (team1, team2) -> list of games

        for pairing in pairings:
            white_player = self.players.get(pairing.white_player_id)
            black_player = self.players.get(pairing.black_player_id)

            if not white_player or not black_player:
                continue

            # Find teams for each player
            white_team_name = self._find_player_team(pairing.white_player_id)
            black_team_name = self._find_player_team(pairing.black_player_id)

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

        return team_matches

    def _find_player_team(self, player_id: int) -> Optional[str]:
        """Find which team a player belongs to."""
        for team_name, team in self.teams.items():
            if player_id in team.player_ids:
                return team_name
        return None

    def _generate_league_tag(self, league_name: str) -> str:
        """Generate a short tag from league name."""
        # Take first letters of each word, up to 4 characters
        words = league_name.split()
        if len(words) >= 2:
            tag = "".join(word[0].upper() for word in words[:4])
        else:
            tag = league_name[:4].upper()
        return tag

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
