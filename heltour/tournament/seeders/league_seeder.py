"""
League seeder for creating test leagues.
"""

import random
from datetime import timedelta
from typing import List

from heltour.tournament.models import AlternatesManagerSetting, League, LeagueSetting

from .base import BaseSeeder


class LeagueSeeder(BaseSeeder):
    """Seeder for creating League objects."""

    def seed(self, count: int = 1, **kwargs) -> List[League]:
        """Create test leagues with different configurations."""
        leagues = []

        league_configs = [
            {
                "name": "Team League 4545",
                "tag": "team4545",
                "description": "Classical team league with 45+45 time control",
                "theme": "blue",
                "time_control": "45+45",
                "rating_type": "classical",
                "competitor_type": "team",
                "pairing_type": "swiss",
                "registration_mode": "open",
            },
            {
                "name": "Lone Wolf League",
                "tag": "lonewolf",
                "description": "Individual classical league",
                "theme": "green",
                "time_control": "30+30",
                "rating_type": "classical",
                "competitor_type": "lone",
                "pairing_type": "swiss",
                "registration_mode": "open",
            },
            {
                "name": "Rapid League",
                "tag": "rapid",
                "description": "Fast-paced rapid chess league",
                "theme": "red",
                "time_control": "10+5",
                "rating_type": "rapid",
                "competitor_type": "lone",
                "pairing_type": "swiss",
                "registration_mode": "open",
            },
            {
                "name": "Blitz Mayhem",
                "tag": "blitz",
                "description": "Blitz chess league for speed demons",
                "theme": "yellow",
                "time_control": "3+2",
                "rating_type": "blitz",
                "competitor_type": "lone",
                "pairing_type": "swiss",
                "registration_mode": "open",
            },
            {
                "name": "Elite Team Championship",
                "tag": "elite",
                "description": "Invite-only team championship for top players",
                "theme": "purple",
                "time_control": "60+30",
                "rating_type": "classical",
                "competitor_type": "team",
                "pairing_type": "swiss",
                "registration_mode": "invite_only",
            },
        ]

        for i in range(count):
            config = league_configs[i % len(league_configs)]

            # Modify tag to ensure uniqueness if creating multiple
            if i >= len(league_configs):
                config = config.copy()
                config["tag"] = f"{config['tag']}{i // len(league_configs) + 1}"
                config["name"] = f"{config['name']} {i // len(league_configs) + 1}"

            league_data = {
                "display_order": i,
                "is_active": self.weighted_bool(0.8),
                "is_default": i == 0,
                "enable_notifications": self.weighted_bool(0.7),
            }
            league_data.update(config)
            league_data.update(kwargs)  # Allow overrides

            league = League.objects.create(**league_data)
            
            # Apply minimal registration settings for Elite Team Championship
            if league.tag == "elite":
                league.email_required = False
                league.show_provisional_warning = False
                league.ask_availability = False
                league.save()

            # Create associated LeagueSetting
            league_setting = LeagueSetting.objects.create(
                league=league,
                contact_period=timedelta(hours=random.choice([24, 48, 72])),
                notify_for_comments=self.weighted_bool(0.8),
                notify_for_latereg_and_withdraw=self.weighted_bool(0.9),
                notify_for_forfeits=self.weighted_bool(0.9),
                notify_for_registrations=self.weighted_bool(0.7),
                notify_for_pre_season_registrations=self.weighted_bool(0.5),
            )
            
            # Set board update deadline for team leagues
            if league.is_team_league():
                league_setting.board_update_deadline_minutes = random.choice([30, 60, 120])
                league_setting.save()

            # for team leagues, create associated settings for the alternates manager
            if league.is_team_league():
                AlternatesManagerSetting.objects.create(league=league)

            leagues.append(self._track_object(league))

        return leagues
