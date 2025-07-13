"""
Round seeder for creating test rounds.
"""

from typing import List
from django.utils import timezone
from heltour.tournament.models import Round, Season
from .base import BaseSeeder


class RoundSeeder(BaseSeeder):
    """Seeder for creating Round objects."""

    def seed(self, season: Season, **kwargs) -> List[Round]:
        """Create rounds for a season if they don't exist."""
        rounds = []

        # Check if rounds already exist
        existing_rounds = Round.objects.filter(season=season).count()
        if existing_rounds >= season.rounds:
            return list(Round.objects.filter(season=season))

        # Determine how many rounds to create based on season state
        if season.is_completed:
            rounds_to_create = season.rounds
        elif season.is_active:
            # Calculate based on start date
            if season.start_date:
                weeks_elapsed = (timezone.now() - season.start_date).days // 7
                rounds_to_create = min(season.rounds, max(1, weeks_elapsed + 1))
            else:
                rounds_to_create = 1
        else:
            # Future season - no rounds yet
            rounds_to_create = 0

        # Create missing rounds
        for round_num in range(existing_rounds + 1, rounds_to_create + 1):
            # Calculate round dates
            round_start = season.start_date + (round_num - 1) * season.round_duration
            round_end = round_start + season.round_duration
            
            round_data = {
                "season": season,
                "number": round_num,
                "start_date": round_start,
                "end_date": round_end,
                "is_completed": False,
                "publish_pairings": False,
            }

            # Set round states based on season state
            if season.is_completed:
                round_data["is_completed"] = True
                round_data["publish_pairings"] = True
            elif season.is_active:
                if round_num < rounds_to_create:
                    # Past rounds
                    round_data["is_completed"] = True
                    round_data["publish_pairings"] = True
                elif round_num == rounds_to_create:
                    # Current round (not completed but pairings published)
                    round_data["is_completed"] = False
                    round_data["publish_pairings"] = True

            round_data.update(kwargs)

            round_obj = Round.objects.create(**round_data)
            rounds.append(self._track_object(round_obj))

        return rounds
