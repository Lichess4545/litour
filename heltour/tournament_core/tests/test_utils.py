"""
Test utilities for creating tournament structures easily.

These utilities create pure tournament_core structures without database dependencies,
making it easy to test tournament logic, tiebreaks, and calculations.
"""

from typing import List, Tuple, Optional
from heltour.tournament_core.structure import (
    Tournament, Round, Match, Game, GameResult,
    create_single_game_match, create_team_match, create_bye_match,
)
from heltour.tournament_core.scoring import ScoringSystem, STANDARD_SCORING


class TournamentBuilder:
    """Builder for creating tournament structures easily in tests."""
    
    def __init__(self, competitors: List[int], scoring: ScoringSystem = STANDARD_SCORING):
        """Initialize with list of competitor IDs."""
        self.tournament = Tournament(competitors=competitors, scoring=scoring)
        self.current_round = None
        
    def add_round(self, round_number: int) -> 'TournamentBuilder':
        """Add a new round to the tournament."""
        self.current_round = Round(number=round_number)
        self.tournament.rounds.append(self.current_round)
        return self
        
    def add_game(self, player1_id: int, player2_id: int, result: str) -> 'TournamentBuilder':
        """Add a single game match to the current round.
        
        Args:
            player1_id: First player ID
            player2_id: Second player ID  
            result: Result string like '1-0', '1/2-1/2', '0-1'
        """
        if not self.current_round:
            raise ValueError("Must add a round before adding games")
            
        result_map = {
            '1-0': GameResult.P1_WIN,
            '1/2-1/2': GameResult.DRAW,
            '0-1': GameResult.P2_WIN,
            '1X-0F': GameResult.P1_FORFEIT_WIN,
            '0F-1X': GameResult.P2_FORFEIT_WIN,
            '0F-0F': GameResult.DOUBLE_FORFEIT,
        }
        
        game_result = result_map.get(result)
        if not game_result:
            raise ValueError(f"Invalid result: {result}")
            
        match = create_single_game_match(player1_id, player2_id, game_result)
        self.current_round.matches.append(match)
        return self
        
    def add_team_match(
        self, 
        team1_id: int, 
        team2_id: int, 
        board_results: List[Tuple[int, int, str]]
    ) -> 'TournamentBuilder':
        """Add a team match to the current round.
        
        Args:
            team1_id: First team ID
            team2_id: Second team ID
            board_results: List of (player1_id, player2_id, result_str) for each board
        """
        if not self.current_round:
            raise ValueError("Must add a round before adding matches")
            
        result_map = {
            '1-0': GameResult.P1_WIN,
            '1/2-1/2': GameResult.DRAW,
            '0-1': GameResult.P2_WIN,
            '1X-0F': GameResult.P1_FORFEIT_WIN,
            '0F-1X': GameResult.P2_FORFEIT_WIN,
            '0F-0F': GameResult.DOUBLE_FORFEIT,
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
        
    def add_bye(self, competitor_id: int, games_per_match: int = 1) -> 'TournamentBuilder':
        """Add a bye for a competitor in the current round."""
        if not self.current_round:
            raise ValueError("Must add a round before adding byes")
            
        match = create_bye_match(competitor_id, games_per_match)
        self.current_round.matches.append(match)
        return self
        
    def auto_byes(self, games_per_match: int = 1) -> 'TournamentBuilder':
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


# Convenience functions for common test scenarios

def create_simple_round_robin(num_players: int = 4) -> Tournament:
    """Create a simple round robin tournament."""
    players = list(range(1, num_players + 1))
    builder = TournamentBuilder(players)
    
    # Simple pairing for round robin
    for round_num in range(1, num_players):
        builder.add_round(round_num)
        
        # Pair players in a round robin fashion
        for i in range(num_players // 2):
            if round_num == 1:
                p1 = players[i]
                p2 = players[num_players - 1 - i]
            else:
                # Rotate players for subsequent rounds
                rotated = [players[0]] + players[2:] + [players[1]]
                p1 = rotated[i] 
                p2 = rotated[num_players - 1 - i]
                
            # Alternate results for variety
            result = '1-0' if (i + round_num) % 3 == 0 else ('1/2-1/2' if (i + round_num) % 3 == 1 else '0-1')
            builder.add_game(p1, p2, result)
            
        # Add bye if odd number of players
        if num_players % 2 == 1:
            builder.auto_byes()
            
    return builder.build()


def create_simple_team_tournament(num_teams: int = 4, boards_per_team: int = 4) -> Tournament:
    """Create a simple team tournament."""
    teams = list(range(1, num_teams + 1))
    builder = TournamentBuilder(teams)
    
    # Create a simple 2-round tournament
    builder.add_round(1)
    
    # Round 1: 1v2, 3v4
    if num_teams >= 4:
        # Team 1 vs Team 2
        board_results = []
        for board in range(1, boards_per_team + 1):
            p1 = 100 + board  # Team 1 players: 101, 102, 103, 104
            p2 = 200 + board  # Team 2 players: 201, 202, 203, 204
            result = '1-0' if board % 2 == 1 else '0-1'  # Alternating wins
            board_results.append((p1, p2, result))
        builder.add_team_match(1, 2, board_results)
        
        # Team 3 vs Team 4  
        board_results = []
        for board in range(1, boards_per_team + 1):
            p1 = 300 + board  # Team 3 players
            p2 = 400 + board  # Team 4 players
            result = '1/2-1/2'  # All draws
            board_results.append((p1, p2, result))
        builder.add_team_match(3, 4, board_results)
        
    return builder.build()