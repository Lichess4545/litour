"""
Tournament simulation framework for clean, Pythonic testing.

This module provides a clean API for simulating tournaments that mirrors
the tournament_core structure while making it easy to set up test scenarios.
"""

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple, Union
from enum import Enum
import random

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
    Registration,
    TeamBye,
)
from heltour.tournament.pairinggen import generate_pairings
from heltour.tournament_core.builder import TournamentBuilder as CoreTournamentBuilder
from heltour.tournament.structure_to_db import structure_to_db


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
            self.db_player.profile = {
                "perfs": {
                    "standard": {"rating": self.rating, "games": 100, "prov": False},
                    "classical": {"rating": self.rating, "games": 100, "prov": False},
                }
            }
            # Also set the direct rating field
            self.db_player.rating = self.rating
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


class TournamentSimulator:
    """Main simulator for creating and running tournaments."""

    def __init__(self, name: str = "Test Tournament"):
        self.name = name
        self.leagues: Dict[str, League] = {}
        self.seasons: Dict[str, Season] = {}
        self.current_season: Optional[Season] = None
        self.current_league: Optional[League] = None

    def create_league(
        self, name: str, tag: str, competitor_type: str = "lone", **kwargs
    ) -> League:
        """Create a league with optional configuration."""
        league_data = {
            "name": name,
            "tag": tag,
            "competitor_type": competitor_type,
            "rating_type": "standard",
            "pairing_type": "swiss-dutch",
            "theme": "blue",
        }
        # Add any additional league configuration
        league_data.update(kwargs)

        league = League.objects.create(**league_data)
        self.leagues[tag] = league
        self.current_league = league
        return league

    def create_season(
        self,
        league_tag: str,
        name: str,
        rounds: int = 3,
        boards: Optional[int] = None,
        **kwargs,
    ) -> Season:
        """Create a season for a league with optional configuration."""
        league = self.leagues[league_tag]
        season_data = {
            "league": league,
            "name": name,
            "rounds": rounds,
            "boards": boards if league.competitor_type == "team" else None,
        }
        # Add any additional season configuration
        season_data.update(kwargs)

        season = Season.objects.create(**season_data)
        self.seasons[name] = season
        self.current_season = season
        return season

    def add_team(
        self, team_name: str, player_data: List[Tuple[str, int]] = None, **kwargs
    ) -> SimulatedTeam:
        """Add a team to the current season with players and ratings."""
        if (
            not self.current_season
            or self.current_season.league.competitor_type != "team"
        ):
            raise ValueError("Must have a team season active")

        team_data = {
            "season": self.current_season,
            "name": team_name,
            "number": Team.objects.filter(season=self.current_season).count() + 1,
            "is_active": True,
        }
        # Calculate average rating if we have player data
        if player_data:
            avg_rating = sum(rating for _, rating in player_data) / len(player_data)
            team_data["seed_rating"] = avg_rating

        team_data.update(kwargs)

        team = SimulatedTeam(name=team_name)
        team.db_team = Team.objects.create(**team_data)
        TeamScore.objects.create(team=team.db_team)

        # Add players if provided
        if player_data:
            for i, (player_name, rating) in enumerate(player_data, 1):
                player = team.add_player(player_name, rating, board=i)
                SeasonPlayer.objects.create(
                    season=self.current_season,
                    player=player.db_player,
                    seed_rating=rating,
                    is_active=True,
                )
                TeamMember.objects.create(
                    team=team.db_team, player=player.db_player, board_number=i
                )

        return team

    def add_player(
        self, name: str, rating: int = 1500, register: bool = True, **kwargs
    ) -> SimulatedPlayer:
        """Add a player to the current season (for lone tournaments)."""
        if (
            not self.current_season
            or self.current_season.league.competitor_type != "lone"
        ):
            raise ValueError("Must have a lone season active")

        player = SimulatedPlayer(name=name, rating=rating)

        # Create registration if requested
        if register:
            Registration.objects.create(
                season=self.current_season,
                player=player.db_player,
                status="approved",
                has_played_20_games=True,
                can_commit=True,
                agreed_to_rules=True,
                agreed_to_tos=True,
            )

        sp_data = {
            "season": self.current_season,
            "player": player.db_player,
            "seed_rating": rating,
            "is_active": True,
        }
        sp_data.update(kwargs)

        sp = SeasonPlayer.objects.create(**sp_data)
        LonePlayerScore.objects.create(season_player=sp)
        return player

    def start_round(
        self, round_number: int, generate_pairings_auto: bool = False
    ) -> Round:
        """Start a new round, optionally generating pairings."""
        if not self.current_season:
            raise ValueError("No active season")

        round_obj = Round.objects.create(
            season=self.current_season, number=round_number, is_completed=False
        )

        if generate_pairings_auto:
            try:
                # Wrap in reversion context for pairing generation
                import reversion

                with reversion.create_revision():
                    reversion.set_comment("Test pairing generation")
                    generate_pairings(round_obj)
            except Exception as e:
                print(f"Failed to generate pairings: {e}")

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

    def simulate_round_results(self, round_obj: Round):
        """Simulate realistic results for all pairings in a round."""
        if self.current_season.league.competitor_type == "team":
            for pairing in TeamPairing.objects.filter(round=round_obj):
                board_results = []
                for board_pairing in pairing.teamplayerpairing_set.order_by(
                    "board_number"
                ):
                    white_rating = board_pairing.white.rating or 1500
                    black_rating = board_pairing.black.rating or 1500
                    result = self.simulate_game_result(white_rating, black_rating)
                    board_pairing.result = result
                    board_pairing.save()
                pairing.refresh_points()
                pairing.save()
        else:
            for pairing in LonePlayerPairing.objects.filter(round=round_obj):
                white_rating = pairing.white.rating or 1500
                black_rating = pairing.black.rating or 1500
                result = self.simulate_game_result(white_rating, black_rating)
                pairing.result = result
                pairing.save()

    def simulate_game_result(self, white_rating, black_rating):
        """Simulate a game result based on ratings."""
        # Calculate expected score using simple Elo formula
        exp_white = 1 / (1 + 10 ** ((black_rating - white_rating) / 400))

        # Add some randomness
        rand = random.random()

        # Adjust probabilities for more realistic results
        if rand < exp_white - 0.1:
            return "1-0"
        elif rand < exp_white + 0.1:
            return "1/2-1/2"
        else:
            return "0-1"

    def complete_round(self, round_obj: Round):
        """Mark a round as completed."""
        # Create TeamBye records for teams that didn't play
        # Only needed when matches are created manually (not via generate_pairings)
        if self.current_season and self.current_season.league.competitor_type == "team":
            teams_that_played = set()
            for pairing in TeamPairing.objects.filter(round=round_obj):
                teams_that_played.add(pairing.white_team_id)
                teams_that_played.add(pairing.black_team_id)

            all_teams = set(
                Team.objects.filter(
                    season=self.current_season, is_active=True
                ).values_list("id", flat=True)
            )
            teams_without_pairing = all_teams - teams_that_played

            # Only create TeamBye if it doesn't already exist (in case generate_pairings was used)
            for team_id in teams_without_pairing:
                TeamBye.objects.get_or_create(
                    round=round_obj,
                    team_id=team_id,
                    defaults={"type": "full-point-pairing-bye"},
                )

        round_obj.is_completed = True
        round_obj.save()

    def calculate_standings(self):
        """Calculate current standings."""
        if self.current_season:
            self.current_season.calculate_scores()


# Convenience builder for even cleaner syntax
class TournamentBuilder:
    """Fluent interface for building tournaments.

    This is a wrapper around the core TournamentBuilder that adds database persistence.
    It maintains the same API but creates database objects as needed.
    """

    def __init__(self):
        self.core_builder = CoreTournamentBuilder()
        self._db_objects = None
        self.current_round = None
        self._round_number = 0
        self._completed_rounds = set()  # Track which rounds have been completed

    def league(
        self, name: str, tag: str, type: str = "lone", **kwargs
    ) -> "TournamentBuilder":
        """Create a league with additional configuration."""
        self.core_builder.league(name, tag, type, **kwargs)
        return self

    def season(
        self, league_tag: str, name: str, rounds: int = 3, boards: int = None, **kwargs
    ) -> "TournamentBuilder":
        """Create a season with additional configuration."""
        self.core_builder.season(league_tag, name, rounds, boards, **kwargs)
        return self

    def team(
        self, name: str, *players: Union[str, Tuple[str, int]], **kwargs
    ) -> "TournamentBuilder":
        """Add a team with players (either names or (name, rating) tuples)."""
        self.core_builder.team(name, *players, **kwargs)
        return self

    def player(self, name: str, rating: int = 1500, **kwargs) -> "TournamentBuilder":
        """Add a player with optional registration."""
        self.core_builder.player(name, rating, **kwargs)
        return self

    def round(self, number: int, auto_pair: bool = False) -> "TournamentBuilder":
        """Start a round with optional automatic pairing."""
        self.core_builder.round(number, auto_pair)
        self._round_number = number
        # Don't build DB objects yet - wait until complete() or build()
        return self

    def game(
        self, white_name: str, black_name: str, result: str
    ) -> "TournamentBuilder":
        """Play a game."""
        self.core_builder.game(white_name, black_name, result)
        return self

    def match(
        self, white_team: str, black_team: str, *results: str
    ) -> "TournamentBuilder":
        """Play a team match."""
        self.core_builder.match(white_team, black_team, *results)
        return self

    def simulate_results(self) -> "TournamentBuilder":
        """Simulate realistic results for the current round."""
        # For compatibility - no-op since we don't simulate in pure structure
        return self

    def complete(self) -> "TournamentBuilder":
        """Complete the current round."""
        self.core_builder.complete()
        self._completed_rounds.add(self._round_number)
        return self

    def calculate(self) -> "TournamentBuilder":
        """Calculate standings."""
        self.core_builder.calculate()
        # Ensure DB objects are built before calculating
        if self._db_objects is None:
            self._build_db_objects()
        # Recalculate scores in database
        self._db_objects["season"].calculate_scores()
        return self

    def build(self) -> "TournamentBuilder":
        """Return self for chaining or direct use."""
        # Ensure DB objects are built
        if self._db_objects is None:
            self._build_db_objects()
        return self

    def _build_db_objects(self):
        """Build database objects from the core structure."""
        # Only build once to avoid duplicate key errors
        if self._db_objects is not None:
            return

        # Build the tournament structure first
        tournament = self.core_builder.build()
        # Convert to database objects
        self._db_objects = structure_to_db(self.core_builder)
        # Update current round reference
        if self._round_number > 0 and self._round_number <= len(
            self._db_objects["rounds"]
        ):
            self.current_round = self._db_objects["rounds"][self._round_number - 1]

    # Delegate methods to maintain compatibility
    def start_round(
        self, round_number: int, generate_pairings_auto: bool = False
    ) -> Round:
        """Start a round (for compatibility)."""
        # Ensure DB objects exist
        if self._db_objects is None:
            self._build_db_objects()

        # Create a new round in the database
        round_obj = Round.objects.create(
            season=self._db_objects["season"], number=round_number, is_completed=False
        )

        # Generate pairings if requested
        if generate_pairings_auto:
            try:
                # Wrap in reversion context for pairing generation
                import reversion

                with reversion.create_revision():
                    reversion.set_comment("Test pairing generation")
                    from heltour.tournament.pairinggen import generate_pairings

                    generate_pairings(round_obj)
            except Exception as e:
                import traceback

                print(f"Failed to generate pairings: {e}")
                traceback.print_exc()

        self.current_round = round_obj
        self._round_number = round_number
        return round_obj

    def simulate_round_results(self, round_obj: Round):
        """Simulate results for a round."""
        if not self._db_objects:
            return

        season = self._db_objects["season"]
        if season.league.competitor_type == "team":
            for pairing in TeamPairing.objects.filter(round=round_obj):
                for board_pairing in pairing.teamplayerpairing_set.order_by(
                    "board_number"
                ):
                    white_rating = board_pairing.white.rating or 1500
                    black_rating = board_pairing.black.rating or 1500
                    result = self._simulate_game_result(white_rating, black_rating)
                    board_pairing.result = result
                    board_pairing.save()
                pairing.refresh_points()
                pairing.save()
        else:
            for pairing in LonePlayerPairing.objects.filter(round=round_obj):
                white_rating = pairing.white.rating or 1500
                black_rating = pairing.black.rating or 1500
                result = self._simulate_game_result(white_rating, black_rating)
                pairing.result = result
                pairing.save()

    def _simulate_game_result(self, white_rating, black_rating):
        """Simulate a game result based on ratings."""
        import random

        # Calculate expected score using simple Elo formula
        exp_white = 1 / (1 + 10 ** ((black_rating - white_rating) / 400))

        # Add some randomness
        rand = random.random()

        # Adjust probabilities for more realistic results
        if rand < exp_white - 0.1:
            return "1-0"
        elif rand < exp_white + 0.1:
            return "1/2-1/2"
        else:
            return "0-1"

    def complete_round(self, round_obj: Round):
        """Complete a round (for compatibility)."""
        # If there are pairings without results, simulate them
        if self._db_objects and self._db_objects.get("season"):
            season = self._db_objects["season"]
            if season.league.competitor_type == "team":
                # Check if any pairings lack results
                pairings_without_results = (
                    TeamPairing.objects.filter(round=round_obj)
                    .filter(teamplayerpairing__result="")
                    .distinct()
                )
                if pairings_without_results.exists():
                    self.simulate_round_results(round_obj)

        # Mark the round as completed
        round_obj.is_completed = True
        round_obj.save()

        # Calculate scores after completing the round
        if self._db_objects and self._db_objects.get("season"):
            self._db_objects["season"].calculate_scores()

    def calculate_standings(self):
        """Calculate standings (for compatibility)."""
        self.calculate()

    @property
    def seasons(self):
        """Access seasons (for compatibility)."""
        if self._db_objects is None:
            self._build_db_objects()
        return {self.core_builder.metadata.season_name: self._db_objects["season"]}

    @property
    def current_season(self):
        """Access current season (for compatibility)."""
        if self._db_objects is None:
            self._build_db_objects()
        return self._db_objects["season"]

    @property
    def simulator(self):
        """Access simulator-like properties (for compatibility)."""
        if self._db_objects is None:
            self._build_db_objects()

        # Return an object that has leagues and seasons properties
        class SimulatorCompat:
            def __init__(self, db_objects, metadata):
                self.db_objects = db_objects
                self.metadata = metadata

            @property
            def leagues(self):
                return {self.metadata.league_tag: self.db_objects["league"]}

            @property
            def seasons(self):
                return {self.metadata.season_name: self.db_objects["season"]}

            @property
            def current_season(self):
                return self.db_objects["season"]

        return SimulatorCompat(self._db_objects, self.core_builder.metadata)
