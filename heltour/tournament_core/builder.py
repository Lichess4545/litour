"""
Builder for creating tournament structures with a fluent API.

This module provides a builder class for creating tournament_core structures
with both low-level and high-level fluent APIs. It supports both team and
individual tournaments without database dependencies.
"""

from typing import Dict, List, Tuple, Optional, Union
from dataclasses import dataclass, field
from heltour.tournament_core.structure import (
    Tournament,
    Round,
    Match,
    Game,
    GameResult,
    create_single_game_match,
    create_team_match,
    create_bye_match,
)
from heltour.tournament_core.scoring import ScoringSystem, STANDARD_SCORING


@dataclass
class TournamentMetadata:
    """Metadata for the tournament (not part of core structure)."""
    
    league_name: str = ""
    league_tag: str = ""
    season_name: str = ""
    competitor_type: str = "lone"  # "lone" or "team"
    boards: Optional[int] = None
    
    # For tracking players/teams by name
    teams: Dict[str, Dict] = field(default_factory=dict)  # name -> team info
    players: Dict[str, int] = field(default_factory=dict)  # name -> player id
    
    # League settings (for database compatibility)
    league_settings: Dict = field(default_factory=dict)
    season_settings: Dict = field(default_factory=dict)


class TournamentBuilder:
    """Builder for creating tournament structures easily."""

    def __init__(
        self, competitors: Optional[List[int]] = None, 
        scoring: ScoringSystem = STANDARD_SCORING
    ):
        """Initialize with optional list of competitor IDs."""
        self.competitors = competitors or []
        self.tournament = Tournament(competitors=self.competitors, scoring=scoring)
        self.current_round = None
        self.metadata = TournamentMetadata()
        self._next_player_id = 1
        self._next_team_id = 1

    # High-level fluent API methods (matching database TournamentBuilder)
    
    def league(
        self, name: str, tag: str, type: str = "lone", **kwargs
    ) -> "TournamentBuilder":
        """Define league metadata."""
        self.metadata.league_name = name
        self.metadata.league_tag = tag
        self.metadata.competitor_type = type
        self.metadata.league_settings = kwargs
        return self

    def season(
        self, league_tag: str, name: str, rounds: int = 3, boards: Optional[int] = None, **kwargs
    ) -> "TournamentBuilder":
        """Define season metadata."""
        self.metadata.season_name = name
        self.metadata.boards = boards
        self.metadata.season_settings = {'rounds': rounds, **kwargs}
        return self

    def team(
        self, name: str, *players: Union[str, Tuple[str, int]], **kwargs
    ) -> "TournamentBuilder":
        """Add a team with players."""
        team_id = self._next_team_id
        self._next_team_id += 1
        
        # Store team metadata
        team_info = {
            "id": team_id,
            "name": name,
            "players": [],
            **kwargs
        }
        
        # Process players
        for p in players:
            if isinstance(p, tuple):
                player_name, rating = p
            else:
                player_name = p
                rating = 1500
            
            player_id = self._get_or_create_player_id(player_name)
            team_info["players"].append({
                "name": player_name,
                "id": player_id,
                "rating": rating
            })
        
        self.metadata.teams[name] = team_info
        
        # Add team to competitors
        if team_id not in self.competitors:
            self.competitors.append(team_id)
        if team_id not in self.tournament.competitors:
            self.tournament.competitors.append(team_id)
        
        return self

    def player(self, name: str, rating: int = 1500, **kwargs) -> "TournamentBuilder":
        """Add a player (for lone tournaments)."""
        player_id = self._get_or_create_player_id(name)
        
        # Add to competitors if not already there
        if player_id not in self.competitors:
            self.competitors.append(player_id)
        if player_id not in self.tournament.competitors:
            self.tournament.competitors.append(player_id)
        
        return self

    def round(self, number: int, auto_pair: bool = False) -> "TournamentBuilder":
        """Start a round with optional automatic pairing."""
        return self.add_round(number)

    def game(
        self, white_name: str, black_name: str, result: str
    ) -> "TournamentBuilder":
        """Play a game between two named players."""
        white_id = self.metadata.players.get(white_name)
        black_id = self.metadata.players.get(black_name)
        
        if white_id is None or black_id is None:
            raise ValueError(f"Player not found: {white_name if white_id is None else black_name}")
        
        return self.add_game(white_id, black_id, result)

    def match(
        self, white_team: str, black_team: str, *results: str
    ) -> "TournamentBuilder":
        """Play a team match between two named teams."""
        white_team_info = self.metadata.teams.get(white_team)
        black_team_info = self.metadata.teams.get(black_team)
        
        if not white_team_info or not black_team_info:
            raise ValueError(f"Team not found: {white_team if not white_team_info else black_team}")
        
        # Build board results
        board_results = []
        for i, result in enumerate(results):
            if i >= len(white_team_info["players"]) or i >= len(black_team_info["players"]):
                break
                
            # Alternate colors by board
            if i % 2 == 0:  # Even boards (0, 2, 4...): white team gets white
                white_player = white_team_info["players"][i]["id"]
                black_player = black_team_info["players"][i]["id"]
            else:  # Odd boards (1, 3, 5...): black team gets white
                white_player = black_team_info["players"][i]["id"]
                black_player = white_team_info["players"][i]["id"]
                # Flip result if colors are swapped
                if result == "1-0":
                    result = "0-1"
                elif result == "0-1":
                    result = "1-0"
            
            board_results.append((white_player, black_player, result))
        
        return self.add_team_match(white_team_info["id"], black_team_info["id"], board_results)

    def complete(self) -> "TournamentBuilder":
        """Complete the current round (for API compatibility)."""
        # Add automatic byes if configured
        if self.current_round and self.metadata.boards:
            self.auto_byes(self.metadata.boards)
        elif self.current_round:
            self.auto_byes()
        return self

    def calculate(self) -> "TournamentBuilder":
        """Calculate standings (no-op for pure structures)."""
        return self

    def simulate_results(self) -> "TournamentBuilder":
        """Simulate results (no-op for pure structures)."""
        return self

    # Low-level API methods (original TournamentBuilder interface)
    
    def add_round(self, round_number: int) -> "TournamentBuilder":
        """Add a new round to the tournament."""
        self.current_round = Round(number=round_number)
        self.tournament.rounds.append(self.current_round)
        return self

    def add_game(
        self, player1_id: int, player2_id: int, result: str
    ) -> "TournamentBuilder":
        """Add a single game match to the current round.

        Args:
            player1_id: First player ID
            player2_id: Second player ID
            result: Result string like '1-0', '1/2-1/2', '0-1'
        """
        if not self.current_round:
            raise ValueError("Must add a round before adding games")

        result_map = {
            "1-0": GameResult.P1_WIN,
            "1/2-1/2": GameResult.DRAW,
            "0-1": GameResult.P2_WIN,
            "1X-0F": GameResult.P1_FORFEIT_WIN,
            "0F-1X": GameResult.P2_FORFEIT_WIN,
            "0F-0F": GameResult.DOUBLE_FORFEIT,
        }

        game_result = result_map.get(result)
        if not game_result:
            raise ValueError(f"Invalid result: {result}")

        match = create_single_game_match(player1_id, player2_id, game_result)
        self.current_round.matches.append(match)
        return self

    def add_team_match(
        self, team1_id: int, team2_id: int, board_results: List[Tuple[int, int, str]]
    ) -> "TournamentBuilder":
        """Add a team match to the current round.

        Args:
            team1_id: First team ID
            team2_id: Second team ID
            board_results: List of (player1_id, player2_id, result_str) for each board
        """
        if not self.current_round:
            raise ValueError("Must add a round before adding matches")

        result_map = {
            "1-0": GameResult.P1_WIN,
            "1/2-1/2": GameResult.DRAW,
            "0-1": GameResult.P2_WIN,
            "1X-0F": GameResult.P1_FORFEIT_WIN,
            "0F-1X": GameResult.P2_FORFEIT_WIN,
            "0F-0F": GameResult.DOUBLE_FORFEIT,
        }

        # Convert string results to GameResult enums
        converted_results = []
        for p1_id, p2_id, result_str in board_results:
            game_result = result_map.get(result_str)
            if not game_result:
                raise ValueError(f"Invalid result: {result_str}")
            converted_results.append((p1_id, p2_id, game_result))

        match = create_team_match(team1_id, team2_id, converted_results)
        self.current_round.matches.append(match)
        return self

    def add_bye(
        self, competitor_id: int, games_per_match: int = 1
    ) -> "TournamentBuilder":
        """Add a bye for a competitor in the current round."""
        if not self.current_round:
            raise ValueError("Must add a round before adding byes")

        match = create_bye_match(competitor_id, games_per_match)
        self.current_round.matches.append(match)
        return self

    def auto_byes(self, games_per_match: int = 1) -> "TournamentBuilder":
        """Automatically add byes for competitors who haven't played in current round."""
        if not self.current_round:
            raise ValueError("Must add a round before adding byes")

        # Find who has already played
        played = set()
        for match in self.current_round.matches:
            played.add(match.competitor1_id)
            if match.competitor2_id != -1:  # -1 is bye opponent
                played.add(match.competitor2_id)

        # Add byes for those who haven't played
        for comp_id in self.tournament.competitors:
            if comp_id not in played:
                self.add_bye(comp_id, games_per_match)

        return self

    def build(self) -> Tournament:
        """Return the built tournament."""
        return self.tournament

    # Helper methods
    
    def _get_or_create_player_id(self, name: str) -> int:
        """Get or create a player ID for a named player."""
        if name not in self.metadata.players:
            self.metadata.players[name] = self._next_player_id
            self._next_player_id += 1
        return self.metadata.players[name]