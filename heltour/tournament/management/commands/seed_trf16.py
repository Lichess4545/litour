"""
Django management command to seed tournament data from TRF16.
"""

from django.core.management.base import BaseCommand
from heltour.tournament.seeders.trf16_seeder import (
    seed_teams_only,
    seed_complete_tournament,
    seed_progressive_tournament,
)


class Command(BaseCommand):
    help = "Seed tournament data from embedded TRF16 file"

    def add_arguments(self, parser):
        parser.add_argument(
            "--mode",
            type=str,
            default="complete",
            choices=["teams-only", "complete", "progressive"],
            help="Seeding mode: teams-only, complete, or progressive",
        )

        parser.add_argument(
            "--rounds",
            type=int,
            default=7,
            help="Number of rounds to seed (for progressive mode)",
        )

        parser.add_argument(
            "--with-results",
            action="store_true",
            help="Include results when seeding rounds (for progressive mode)",
        )

    def handle(self, *args, **options):
        mode = options["mode"]

        try:
            if mode == "teams-only":
                self.stdout.write("Seeding teams only...")
                season = seed_teams_only()
                self.stdout.write(self.style.SUCCESS("Successfully created teams"))

            elif mode == "complete":
                self.stdout.write("Seeding complete tournament...")
                season = seed_complete_tournament()
                self.stdout.write(
                    self.style.SUCCESS("Successfully created complete tournament")
                )

            elif mode == "progressive":
                rounds = options["rounds"]
                with_results = options["with_results"]

                self.stdout.write(
                    f'Seeding first {rounds} rounds {"with results" if with_results else "(pairings only)"}...'
                )
                season = seed_progressive_tournament(
                    rounds, include_results=with_results
                )

                self.stdout.write(
                    self.style.SUCCESS(f"Successfully created {rounds} rounds")
                )

        except Exception as e:
            self.stdout.write(self.style.ERROR(f"Error: {str(e)}"))
            raise
