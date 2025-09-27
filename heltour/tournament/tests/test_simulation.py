"""
Tournament simulation framework for clean, Pythonic testing.

This module provides a clean API for simulating tournaments that mirrors
the tournament_core structure while making it easy to set up test scenarios.
"""

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple, Union
from enum import Enum
import random

from django.test import TestCase
from heltour.tournament.models import (
    League,
    Season,
    Round,
    Team,
    Player,
    SeasonPlayer,
    TeamMember,
    TeamScore,
    LonePlayerScore,
    TeamPairing,
    TeamPlayerPairing,
    LonePlayerPairing,
)
from heltour.tournament.db_to_structure import season_to_tournament_structure


class PairingStrategy(Enum):
    """Different pairing strategies for tournaments."""

    ROUND_ROBIN = "round_robin"
    SWISS = "swiss"
    MANUAL = "manual"


@dataclass
class SimulatedPlayer:
    """A player in the simulation."""

    name: str
    rating: int = 1500
    db_player: Optional[Player] = None

    def __post_init__(self):
        """Create database player if needed."""
        if not self.db_player:
            self.db_player = Player.objects.create(lichess_username=self.name)
            # Set rating in profile if needed
            self.db_player.profile = {"perfs": {"standard": {"rating": self.rating}}}
            self.db_player.save()


@dataclass
class SimulatedTeam:
    """A team in the simulation."""

    name: str
    players: List[SimulatedPlayer] = field(default_factory=list)
    db_team: Optional[Team] = None

    def add_player(
        self, name: str, rating: int = 1500, board: Optional[int] = None
    ) -> SimulatedPlayer:
        """Add a player to the team."""
        player = SimulatedPlayer(name=name, rating=rating)
        if board is not None:
            self.players.insert(board - 1, player)
        else:
            self.players.append(player)
        return player


@dataclass
class GameResult:
    """Result of a single game."""

    white: Union[SimulatedPlayer, SimulatedTeam]
    black: Union[SimulatedPlayer, SimulatedTeam]
    result: str  # "1-0", "1/2-1/2", "0-1", etc.
    board: Optional[int] = None  # For team tournaments


class TournamentSimulator:
    """Main simulator for creating and running tournaments."""

    def __init__(self, name: str = "Test Tournament"):
        self.name = name
        self.leagues: Dict[str, League] = {}
        self.seasons: Dict[str, Season] = {}
        self.current_season: Optional[Season] = None

    def create_league(
        self, name: str, tag: str, competitor_type: str = "lone"
    ) -> League:
        """Create a league."""
        league = League.objects.create(
            name=name, tag=tag, competitor_type=competitor_type, rating_type="standard"
        )
        self.leagues[tag] = league
        return league

    def create_season(
        self, league_tag: str, name: str, rounds: int = 3, boards: Optional[int] = None
    ) -> Season:
        """Create a season for a league."""
        league = self.leagues[league_tag]
        season = Season.objects.create(
            league=league,
            name=name,
            rounds=rounds,
            boards=boards if league.competitor_type == "team" else None,
        )
        self.seasons[name] = season
        self.current_season = season
        return season

    def add_team(self, team_name: str, player_names: List[str] = None) -> SimulatedTeam:
        """Add a team to the current season."""
        if (
            not self.current_season
            or self.current_season.league.competitor_type != "team"
        ):
            raise ValueError("Must have a team season active")

        team = SimulatedTeam(name=team_name)
        team.db_team = Team.objects.create(
            season=self.current_season,
            name=team_name,
            number=Team.objects.filter(season=self.current_season).count() + 1,
        )
        TeamScore.objects.create(team=team.db_team)

        # Add players if provided
        if player_names:
            for i, name in enumerate(player_names, 1):
                player = team.add_player(name, board=i)
                SeasonPlayer.objects.create(
                    season=self.current_season, player=player.db_player
                )
                TeamMember.objects.create(
                    team=team.db_team, player=player.db_player, board_number=i
                )

        return team

    def add_player(self, name: str, rating: int = 1500) -> SimulatedPlayer:
        """Add a player to the current season (for lone tournaments)."""
        if (
            not self.current_season
            or self.current_season.league.competitor_type != "lone"
        ):
            raise ValueError("Must have a lone season active")

        player = SimulatedPlayer(name=name, rating=rating)
        sp = SeasonPlayer.objects.create(
            season=self.current_season, player=player.db_player
        )
        LonePlayerScore.objects.create(season_player=sp)
        return player

    def start_round(self, round_number: int) -> Round:
        """Start a new round."""
        if not self.current_season:
            raise ValueError("No active season")

        round_obj = Round.objects.create(
            season=self.current_season, number=round_number, is_completed=False
        )
        return round_obj

    def play_game(
        self,
        round_obj: Round,
        white: SimulatedPlayer,
        black: SimulatedPlayer,
        result: str,
    ) -> LonePlayerPairing:
        """Play a game in a lone tournament."""
        pairing = LonePlayerPairing.objects.create(
            round=round_obj,
            white=white.db_player,
            black=black.db_player,
            result=result,
            pairing_order=LonePlayerPairing.objects.filter(round=round_obj).count() + 1,
        )
        return pairing

    def play_match(
        self,
        round_obj: Round,
        white_team: SimulatedTeam,
        black_team: SimulatedTeam,
        board_results: List[str],
    ) -> TeamPairing:
        """Play a match in a team tournament."""
        # Create the team pairing
        pairing = TeamPairing.objects.create(
            round=round_obj,
            white_team=white_team.db_team,
            black_team=black_team.db_team,
            pairing_order=TeamPairing.objects.filter(round=round_obj).count() + 1,
        )

        # Play each board
        for board_num, result in enumerate(board_results, 1):
            # Get players for this board
            white_member = white_team.players[board_num - 1]
            black_member = black_team.players[board_num - 1]

            # Alternate colors by board
            if board_num % 2 == 1:  # Odd boards: white team gets white
                white_player = white_member.db_player
                black_player = black_member.db_player
            else:  # Even boards: black team gets white
                white_player = black_member.db_player
                black_player = white_member.db_player
                # Flip result if colors are swapped
                if result == "1-0":
                    result = "0-1"
                elif result == "0-1":
                    result = "1-0"

            TeamPlayerPairing.objects.create(
                team_pairing=pairing,
                board_number=board_num,
                white=white_player,
                black=black_player,
                result=result,
            )

        # Update pairing points
        pairing.refresh_points()
        pairing.save()
        return pairing

    def complete_round(self, round_obj: Round):
        """Mark a round as completed."""
        round_obj.is_completed = True
        round_obj.save()

    def calculate_standings(self):
        """Calculate current standings."""
        if self.current_season:
            self.current_season.calculate_scores()


# Convenience builder for even cleaner syntax
class TournamentBuilder:
    """Fluent interface for building tournaments."""

    def __init__(self):
        self.simulator = TournamentSimulator()
        self.current_round = None

    def league(self, name: str, tag: str, type: str = "lone") -> "TournamentBuilder":
        """Create a league."""
        self.simulator.create_league(name, tag, type)
        return self

    def season(
        self, league_tag: str, name: str, rounds: int = 3, boards: int = None
    ) -> "TournamentBuilder":
        """Create a season."""
        self.simulator.create_season(league_tag, name, rounds, boards)
        return self

    def team(self, name: str, *players: str) -> "TournamentBuilder":
        """Add a team with players."""
        self.simulator.add_team(name, list(players) if players else None)
        return self

    def player(self, name: str, rating: int = 1500) -> "TournamentBuilder":
        """Add a player."""
        self.simulator.add_player(name, rating)
        return self

    def round(self, number: int) -> "TournamentBuilder":
        """Start a round."""
        self.current_round = self.simulator.start_round(number)
        return self

    def game(
        self, white_name: str, black_name: str, result: str
    ) -> "TournamentBuilder":
        """Play a game."""
        # Find players by name
        white = next(p for p in Player.objects.filter(lichess_username=white_name))
        black = next(p for p in Player.objects.filter(lichess_username=black_name))
        white_sim = SimulatedPlayer(white_name, db_player=white)
        black_sim = SimulatedPlayer(black_name, db_player=black)
        self.simulator.play_game(self.current_round, white_sim, black_sim, result)
        return self

    def match(
        self, white_team: str, black_team: str, *results: str
    ) -> "TournamentBuilder":
        """Play a team match."""
        # Find teams by name
        white_t = Team.objects.get(
            name=white_team, season=self.simulator.current_season
        )
        black_t = Team.objects.get(
            name=black_team, season=self.simulator.current_season
        )

        # Create simulated teams
        white_sim = SimulatedTeam(white_team, db_team=white_t)
        white_sim.players = [
            SimulatedPlayer(tm.player.lichess_username, db_player=tm.player)
            for tm in white_t.teammember_set.order_by("board_number")
        ]

        black_sim = SimulatedTeam(black_team, db_team=black_t)
        black_sim.players = [
            SimulatedPlayer(tm.player.lichess_username, db_player=tm.player)
            for tm in black_t.teammember_set.order_by("board_number")
        ]

        self.simulator.play_match(
            self.current_round, white_sim, black_sim, list(results)
        )
        return self

    def complete(self) -> "TournamentBuilder":
        """Complete the current round."""
        self.simulator.complete_round(self.current_round)
        return self

    def calculate(self) -> "TournamentBuilder":
        """Calculate standings."""
        self.simulator.calculate_standings()
        return self

    def build(self) -> TournamentSimulator:
        """Return the simulator."""
        return self.simulator


class TournamentSimulationTests(TestCase):
    """Demonstrate the clean API for tournament simulation."""

    def test_simple_lone_tournament(self):
        """Demonstrate a simple individual tournament."""
        # Build a tournament with fluent syntax
        tournament = (
            TournamentBuilder()
            .league("Weekend Blitz", "WB", "lone")
            .season("WB", "January 2024", rounds=3)
            .player("Magnus", 2850)
            .player("Hikaru", 2800)
            .player("Ding", 2780)
            .player("Nepo", 2760)
            # Round 1
            .round(1)
            .game("Magnus", "Hikaru", "1-0")
            .game("Ding", "Nepo", "1/2-1/2")
            .complete()
            # Round 2
            .round(2)
            .game("Magnus", "Ding", "1/2-1/2")
            .game("Hikaru", "Nepo", "1-0")
            .complete()
            # Round 3
            .round(3)
            .game("Magnus", "Nepo", "1-0")
            .game("Hikaru", "Ding", "1/2-1/2")
            .complete()
            .calculate()
            .build()
        )

        # Verify standings
        season = tournament.seasons["January 2024"]
        scores = {
            sp.player.lichess_username: sp.loneplayerscore
            for sp in season.seasonplayer_set.all()
        }

        # Magnus: 2.5/3 (W, D, W)
        self.assertEqual(scores["Magnus"].points, 2.5)
        # Hikaru: 1.5/3 (L, W, D)
        self.assertEqual(scores["Hikaru"].points, 1.5)
        # Ding: 1.5/3 (D, D, D)
        self.assertEqual(scores["Ding"].points, 1.5)
        # Nepo: 0.5/3 (D, L, L)
        self.assertEqual(scores["Nepo"].points, 0.5)

    def test_simple_team_tournament(self):
        """Demonstrate a simple team tournament."""
        # Build a team tournament
        tournament = (
            TournamentBuilder()
            .league("Team Battle", "TB", "team")
            .season("TB", "Spring 2024", rounds=2, boards=4)
            # Teams with players
            .team(
                "Dragons",
                "DragonPlayer1",
                "DragonPlayer2",
                "DragonPlayer3",
                "DragonPlayer4",
            )
            .team(
                "Knights",
                "KnightPlayer1",
                "KnightPlayer2",
                "KnightPlayer3",
                "KnightPlayer4",
            )
            .team(
                "Wizards",
                "WizardPlayer1",
                "WizardPlayer2",
                "WizardPlayer3",
                "WizardPlayer4",
            )
            # Round 1
            .round(1)
            .match(
                "Dragons", "Knights", "1-0", "0-1", "1/2-1/2", "1-0"
            )  # Dragons win 2.5-1.5
            .complete()
            # Round 2
            .round(2)
            .match(
                "Knights", "Wizards", "1-0", "1-0", "0-1", "1/2-1/2"
            )  # Knights win 2.5-1.5
            .match(
                "Wizards", "Dragons", "1/2-1/2", "1/2-1/2", "1/2-1/2", "1/2-1/2"
            )  # Draw 2-2
            .complete()
            .calculate()
            .build()
        )

        # Verify team standings
        season = tournament.seasons["Spring 2024"]
        scores = {team.name: team.teamscore for team in season.team_set.all()}

        # Note: Teams get automatic byes when they don't play in a round
        # Round 1: Dragons beat Knights, Wizards gets bye
        # Round 2: Knights beat Wizards, Wizards draw Dragons (so Dragons also plays)

        # Dragons: Win vs Knights (2), Draw vs Wizards (1) = 3 match points
        self.assertEqual(scores["Dragons"].match_points, 3)
        self.assertEqual(scores["Dragons"].game_points, 4.5)  # 2.5 + 2

        # Knights: Loss vs Dragons (0), Win vs Wizards (2) = 2 match points
        self.assertEqual(scores["Knights"].match_points, 2)
        self.assertEqual(scores["Knights"].game_points, 4.0)  # 1.5 + 2.5

        # Wizards: Bye round 1 (1), Loss vs Knights (0), Draw vs Dragons (1) = 2 match points
        self.assertEqual(scores["Wizards"].match_points, 2)
        self.assertEqual(scores["Wizards"].game_points, 5.5)  # 2.0 (bye) + 1.5 + 2

    def test_alternative_api_style(self):
        """Show alternative API usage for more control."""
        # Create simulator directly
        sim = TournamentSimulator("Classical Championship")

        # Set up league and season
        league = sim.create_league("Classical Masters", "CM", "lone")
        season = sim.create_season("CM", "Final Stage", rounds=2)

        # Add players
        carlsen = sim.add_player("Carlsen", 2830)
        caruana = sim.add_player("Caruana", 2800)

        # Play rounds with explicit control
        round1 = sim.start_round(1)
        sim.play_game(round1, carlsen, caruana, "1-0")
        sim.complete_round(round1)

        round2 = sim.start_round(2)
        sim.play_game(round2, caruana, carlsen, "1/2-1/2")
        sim.complete_round(round2)

        sim.calculate_standings()

        # Verify
        scores = {
            sp.player.lichess_username: sp.loneplayerscore
            for sp in season.seasonplayer_set.all()
        }
        self.assertEqual(scores["Carlsen"].points, 1.5)
        self.assertEqual(scores["Caruana"].points, 0.5)

    def test_simulation_with_db_to_structure(self):
        """Test that simulation properly populates database for db_to_structure."""
        # Build a comprehensive team tournament
        tournament = (
            TournamentBuilder()
            .league("Champions League", "CL", "team")
            .season("CL", "2024 Finals", rounds=3, boards=2)
            # Create 4 teams
            .team("Alpha", "AlphaBoard1", "AlphaBoard2")
            .team("Beta", "BetaBoard1", "BetaBoard2")
            .team("Gamma", "GammaBoard1", "GammaBoard2")
            .team("Delta", "DeltaBoard1", "DeltaBoard2")
            # Round 1: Alpha vs Beta, Gamma vs Delta
            .round(1)
            .match("Alpha", "Beta", "1-0", "1-0")  # Alpha wins 2-0
            .match("Gamma", "Delta", "1/2-1/2", "1/2-1/2")  # Draw 1-1
            .complete()
            # Round 2: Alpha vs Gamma, Beta vs Delta
            .round(2)
            .match("Alpha", "Gamma", "1-0", "1/2-1/2")  # Alpha wins 1.5-0.5
            .match("Beta", "Delta", "0-1", "1-0")  # Draw 1-1
            .complete()
            # Round 3: Alpha vs Delta, Beta vs Gamma
            .round(3)
            .match("Alpha", "Delta", "1/2-1/2", "1/2-1/2")  # Draw 1-1
            .match("Beta", "Gamma", "1-0", "0-1")  # Draw 1-1
            .complete()
            .calculate()
            .build()
        )

        # Get the season
        season = tournament.seasons["2024 Finals"]

        # Convert to tournament structure
        tournament_structure = season_to_tournament_structure(season)

        # Calculate results using tournament_core
        results = tournament_structure.calculate_results()

        # Verify the structure was created correctly
        self.assertEqual(len(tournament_structure.competitors), 4)
        self.assertEqual(len(tournament_structure.rounds), 3)

        # Get team IDs for verification
        teams = {team.name: team for team in season.team_set.all()}

        # Verify match points from tournament_core
        # Alpha: 3 wins (2 + 2 + 1) = 5 match points
        self.assertEqual(results[teams["Alpha"].id].match_points, 5)
        # Beta: 1 win, 2 draws (0 + 1 + 1) = 2 match points
        self.assertEqual(results[teams["Beta"].id].match_points, 2)
        # Gamma: 2 draws, 1 loss (1 + 0 + 1) = 2 match points
        self.assertEqual(results[teams["Gamma"].id].match_points, 2)
        # Delta: 2 draws, 1 loss (1 + 1 + 1) = 3 match points
        self.assertEqual(results[teams["Delta"].id].match_points, 3)

        # Verify game points (no byes in this tournament - all teams play all rounds)
        self.assertEqual(results[teams["Alpha"].id].game_points, 4.5)  # 2 + 1.5 + 1
        self.assertEqual(results[teams["Beta"].id].game_points, 2.0)  # 0 + 1 + 1
        self.assertEqual(results[teams["Gamma"].id].game_points, 2.5)  # 1 + 0.5 + 1
        self.assertEqual(results[teams["Delta"].id].game_points, 3.0)  # 1 + 1 + 1

        # Verify tiebreaks can be calculated from the results
        from heltour.tournament_core.tiebreaks import calculate_sonneborn_berger

        alpha_sb = calculate_sonneborn_berger(results[teams["Alpha"].id], results)
        self.assertIsNotNone(alpha_sb)
        self.assertGreater(alpha_sb, 0)

        # Verify database scores match
        db_scores = {team.name: team.teamscore for team in season.team_set.all()}
        for team_name, team in teams.items():
            self.assertEqual(
                db_scores[team_name].match_points,
                results[team.id].match_points,
                f"{team_name} match points mismatch between DB and structure",
            )

    def test_lone_tournament_with_byes(self):
        """Test individual tournament with byes using db_to_structure."""
        # Odd number of players to force byes
        tournament = (
            TournamentBuilder()
            .league("Open Swiss", "OS", "lone")
            .season("OS", "March 2024", rounds=3)
            .player("Alice", 2000)
            .player("Bob", 1950)
            .player("Charlie", 1900)
            .player("Diana", 1850)
            .player("Eve", 1800)
            # Round 1: 5 players, so one gets a bye
            .round(1)
            .game("Alice", "Bob", "1-0")
            .game("Charlie", "Diana", "1/2-1/2")
            # Eve gets automatic bye
            .complete()
            # Round 2
            .round(2)
            .game("Eve", "Alice", "0-1")
            .game("Bob", "Charlie", "1-0")
            # Diana gets bye
            .complete()
            # Round 3
            .round(3)
            .game("Alice", "Diana", "1-0")
            .game("Bob", "Eve", "1/2-1/2")
            # Charlie gets bye
            .complete()
            .calculate()
            .build()
        )

        season = tournament.seasons["March 2024"]

        # Convert and verify structure
        tournament_structure = season_to_tournament_structure(season)
        results = tournament_structure.calculate_results()

        # Get player IDs
        players = {
            sp.player.lichess_username: sp.player.id
            for sp in season.seasonplayer_set.all()
        }

        # Individual tournaments use match scoring (2-1-0) not game scoring
        # Alice: 3 wins = 6 match points (3 * 2)
        self.assertEqual(results[players["Alice"]].match_points, 6)
        # Bob: 1 win (2 pts), 1 draw (1 pt), 1 loss (0 pt) = 3 match points
        self.assertEqual(results[players["Bob"]].match_points, 3)
        # Charlie: 1 draw (1 pt), 1 loss (0 pt), 1 bye (1 pt) = 2 match points
        self.assertEqual(results[players["Charlie"]].match_points, 2)
        # Diana: 1 draw (1 pt), 1 loss (0 pt), 1 bye (1 pt) = 2 match points
        self.assertEqual(results[players["Diana"]].match_points, 2)
        # Eve: 1 draw (1 pt), 1 loss (0 pt), 1 bye (1 pt) = 2 match points
        self.assertEqual(results[players["Eve"]].match_points, 2)
