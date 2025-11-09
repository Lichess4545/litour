"""Create demo leagues showcasing registration field flexibility."""
from django.core.management.base import BaseCommand
from django.utils import timezone
from datetime import timedelta
from heltour.tournament.models import League, Season


class Command(BaseCommand):
    help = 'Create demo leagues showcasing flexible registration settings'

    def handle(self, *args, **options):
        demos = [
            {
                'name': 'Minimal Casual League',
                'tag': 'demo-minimal',
                'description': 'Casual tournament - only username needed',
                'require_personal_info': False,
                'require_corporate_info': False,
                'require_fide_id': False,
                'email_required': False,
            },
            {
                'name': 'FIDE Rated League',
                'tag': 'demo-fide',
                'description': 'Rated tournament - FIDE ID required',
                'require_personal_info': False,
                'require_corporate_info': False,
                'require_fide_id': True,
                'email_required': True,
            },
            {
                'name': 'Corporate Championship',
                'tag': 'demo-corporate',
                'description': 'Corporate tournament - full info required',
                'require_personal_info': True,
                'require_corporate_info': True,
                'require_fide_id': True,
                'email_required': True,
            },
            {
                'name': 'Community League',
                'tag': 'demo-community',
                'description': 'Community tournament - names only',
                'require_personal_info': True,
                'require_corporate_info': False,
                'require_fide_id': False,
                'email_required': True,
            },
        ]

        for demo in demos:
            league, created = League.objects.update_or_create(
                tag=demo['tag'],
                defaults={
                    'name': demo['name'],
                    'description': demo['description'],
                    'theme': 'blue',
                    'time_control': '45+45',
                    'rating_type': 'classical',
                    'competitor_type': 'team',
                    'pairing_type': 'swiss',
                    'require_personal_info': demo['require_personal_info'],
                    'require_corporate_info': demo['require_corporate_info'],
                    'require_fide_id': demo['require_fide_id'],
                    'email_required': demo['email_required'],
                    'show_provisional_warning': False,
                    'ask_availability': False,
                    'is_active': True,
                }
            )

            Season.objects.update_or_create(
                league=league,
                tag=f'{demo["tag"]}-s1',
                defaults={
                    'name': f'{demo["name"]} S1',
                    'rounds': 8,
                    'boards': 4,
                    'start_date': timezone.now() + timedelta(days=30),
                    'registration_open': True,
                    'round_duration': timedelta(days=7),
                }
            )

            self.stdout.write(self.style.SUCCESS(
                f'{"Created" if created else "Updated"}: {league.name}'
            ))
