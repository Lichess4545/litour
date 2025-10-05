"""Management command to seed championship tournament data."""

from django.core.management.base import BaseCommand
from heltour.tournament.seeders import championship2025_seeder


class Command(BaseCommand):
    help = 'Seed championship tournament data from embedded TRF16 file'

    def add_arguments(self, parser):
        parser.add_argument(
            '--mode',
            type=str,
            default='complete',
            choices=['teams', 'round1', 'round1_results', 'complete'],
            help='Seeding mode: teams only, round 1 pairings, round 1 results, or complete tournament'
        )
        parser.add_argument(
            '--use-existing-league',
            action='store_true',
            help='Use existing league if found'
        )

    def handle(self, *args, **options):
        mode = options['mode']
        use_existing = options['use_existing_league']

        if mode == 'teams':
            season = championship2025_seeder.seed_teams_only(
                existing_league=use_existing if use_existing else None
            )
            self.stdout.write(
                self.style.SUCCESS(f'Successfully seeded teams for {season.name}')
            )
        elif mode == 'round1':
            season = championship2025_seeder.seed_partial_tournament(
                num_rounds=1, 
                include_results=False,
                existing_league=use_existing if use_existing else None
            )
            self.stdout.write(
                self.style.SUCCESS(f'Successfully seeded teams and round 1 pairings for {season.name}')
            )
        elif mode == 'round1_results':
            season = championship2025_seeder.seed_partial_tournament(
                num_rounds=1,
                include_results=True,
                existing_league=use_existing if use_existing else None
            )
            self.stdout.write(
                self.style.SUCCESS(f'Successfully seeded teams and round 1 with results for {season.name}')
            )
        elif mode == 'complete':
            season = championship2025_seeder.seed_complete_tournament(
                existing_league=use_existing if use_existing else None
            )
            self.stdout.write(
                self.style.SUCCESS(f'Successfully seeded complete tournament: {season.name}')
            )