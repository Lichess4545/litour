"""
Pairing seeder for creating test pairings.
"""

import random
from typing import List, Optional
from django.utils import timezone
from heltour.tournament.models import (
    Round,
    Team,
    TeamPairing,
    TeamPlayerPairing,
    LonePlayerPairing,
    SeasonPlayer,
    PlayerBye,
)
from .base import BaseSeeder


class PairingSeeder(BaseSeeder):
    """Seeder for creating Pairing objects."""

    # Game link patterns for different results
    GAME_LINKS = {
        "win": "https://lichess.org/abcdef123",
        "loss": "https://lichess.org/ghijkl456",
        "draw": "https://lichess.org/mnopqr789",
        "forfeit": "",
    }

    def seed(self, round_obj: Round, **kwargs) -> List:
        """Create pairings for a round."""
        if round_obj.season.league.is_team_league():
            return self.seed_team_pairings(round_obj, **kwargs)
        else:
            return self.seed_lone_pairings(round_obj, **kwargs)

    def seed_team_pairings(self, round_obj: Round, **kwargs) -> List[TeamPairing]:
        """Create team pairings for a round."""
        pairings = []

        # Get active teams
        teams = list(
            Team.objects.filter(season=round_obj.season, is_active=True).order_by(
                "number"
            )
        )

        if len(teams) < 2:
            return pairings

        # Simple pairing: 1v2, 3v4, etc.
        paired_teams = []
        for i in range(0, len(teams) - 1, 2):
            white_team = teams[i]
            black_team = teams[i + 1]

            pairing_data = {
                "round": round_obj,
                "white_team": white_team,
                "black_team": black_team,
                "pairing_order": i // 2 + 1,
            }
            pairing_data.update(kwargs)

            team_pairing = TeamPairing.objects.create(**pairing_data)
            pairings.append(self._track_object(team_pairing))

            paired_teams.extend([white_team, black_team])

            # Create player pairings for each board
            self._create_board_pairings(team_pairing, round_obj)

        # Handle odd team (gets a bye)
        if len(teams) % 2 == 1:
            bye_team = teams[-1]
            # You might want to create a bye pairing here

        return pairings

    def _create_board_pairings(self, team_pairing: TeamPairing, round_obj: Round):
        """Create individual board pairings for a team pairing."""
        boards = round_obj.season.boards or 4

        white_members = team_pairing.white_team.teammember_set.all()
        black_members = team_pairing.black_team.teammember_set.all()

        for board_num in range(1, boards + 1):
            # Get players for this board
            white_member = white_members.filter(board_number=board_num).first()
            black_member = black_members.filter(board_number=board_num).first()

            if not white_member or not black_member:
                continue

            # Determine game result
            result = self._generate_game_result(
                round_obj, white_member.player, black_member.player
            )

            player_pairing = TeamPlayerPairing.objects.create(
                team_pairing=team_pairing,
                board_number=board_num,
                white=white_member.player,
                black=black_member.player,
                result=result["result"],
                game_link=result["game_link"],
                scheduled_time=self._get_scheduled_time(round_obj),
            )

    def seed_lone_pairings(self, round_obj: Round, **kwargs) -> List[LonePlayerPairing]:
        """Create lone player pairings for a round."""
        pairings = []

        # Get active season players
        season_players = list(
            SeasonPlayer.objects.filter(
                season=round_obj.season, is_active=True
            ).select_related("player")
        )

        if len(season_players) < 2:
            return pairings

        # Sort by rating for Swiss pairing simulation
        season_players.sort(
            key=lambda sp: sp.player.rating_for(round_obj.season.league), reverse=True
        )

        # Simple pairing by rating groups
        paired_players = []
        pairing_order = 1

        for i in range(0, len(season_players) - 1, 2):
            white_sp = season_players[i]
            black_sp = season_players[i + 1]

            result = self._generate_game_result(
                round_obj, white_sp.player, black_sp.player
            )

            lone_pairing = LonePlayerPairing.objects.create(
                round=round_obj,
                white=white_sp.player,
                black=black_sp.player,
                pairing_order=pairing_order,
                result=result["result"],
                game_link=result["game_link"],
                scheduled_time=self._get_scheduled_time(round_obj),
                **kwargs,
            )
            pairings.append(self._track_object(lone_pairing))

            paired_players.extend([white_sp, black_sp])
            pairing_order += 1

        # Handle odd player (gets a bye)
        if len(season_players) % 2 == 1:
            bye_player = season_players[-1].player
            PlayerBye.objects.create(
                round=round_obj,
                player=bye_player,
                type="full-point",
            )

        return pairings

    def _generate_game_result(
        self, round_obj: Round, white: "Player", black: "Player"
    ) -> dict:
        """Generate a realistic game result."""
        if not round_obj.is_completed and not round_obj.publish_pairings:
            return {"result": "", "game_link": ""}

        # For current rounds (published but not completed), some games might not be played yet
        if not round_obj.is_completed and self.weighted_bool(0.3):
            return {"result": "", "game_link": ""}

        # Calculate expected score based on rating difference
        white_rating = white.rating_for(round_obj.season.league)
        black_rating = black.rating_for(round_obj.season.league)
        rating_diff = white_rating - black_rating

        # Expected score for white (Elo formula)
        expected_white = 1 / (1 + 10 ** (-rating_diff / 400))

        # Generate result with some randomness
        rand = random.random()

        # Small chance of forfeit
        if rand < 0.05:
            if random.random() < 0.5:
                return {"result": "1X", "game_link": ""}  # White wins by forfeit
            else:
                return {"result": "0F", "game_link": ""}  # Black wins by forfeit

        # Normal game results
        if rand < expected_white - 0.1:  # Slightly favor expected result
            result = "1-0"
            game_type = "win"
        elif rand > expected_white + 0.1:
            result = "0-1"
            game_type = "loss"
        else:
            result = "0.5-0.5"
            game_type = "draw"

        # Generate game link
        game_id = self.fake.lexify("????????")
        game_link = f"https://lichess.org/{game_id}"

        return {"result": result, "game_link": game_link}

    def _get_scheduled_time(self, round_obj: Round) -> Optional[timezone.datetime]:
        """Get scheduled time for a round."""
        if not round_obj.season.start_date:
            return None

        # Calculate round start date
        round_start = (
            round_obj.season.start_date
            + (round_obj.number - 1) * round_obj.season.round_duration
        )

        # Add some random hours for game time (evening/weekend)
        hour = random.choice([18, 19, 20, 21])  # Evening times
        minute = random.choice([0, 30])

        return round_start.replace(hour=hour, minute=minute)
