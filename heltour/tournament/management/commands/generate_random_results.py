"""
Management command to generate random results for the current round of a season.

This command takes a season ID and generates random results for all pairings 
in the current round that don't already have results.
"""

import random
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from heltour.tournament.models import Season, Round, TeamPlayerPairing, LonePlayerPairing
from heltour.tournament.builder import simulate_game_result


class Command(BaseCommand):
    help = "Generate random results for current round pairings in a season"

    def add_arguments(self, parser):
        parser.add_argument(
            "season_id",
            type=int,
            help="Season ID to generate results for",
        )
        parser.add_argument(
            "--round-number",
            type=int,
            help="Specific round number (default: current/latest round)",
        )
        parser.add_argument(
            "--forfeit-rate",
            type=float,
            default=0.05,
            help="Probability of forfeit results (default: 0.05 = 5%%)",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Show what would be done without making changes",
        )
        parser.add_argument(
            "--overwrite",
            action="store_true", 
            help="Overwrite existing results (default: skip games with results)",
        )

    def handle(self, *args, **options):
        season_id = options["season_id"]
        round_number = options.get("round_number")
        forfeit_rate = options["forfeit_rate"]
        dry_run = options["dry_run"]
        overwrite = options["overwrite"]

        try:
            season = Season.objects.get(id=season_id)
        except Season.DoesNotExist:
            raise CommandError(f"Season with ID {season_id} does not exist")

        self.stdout.write(f"Processing season: {season.name} ({season.league.name})")
        
        # Find the target round
        if round_number:
            try:
                target_round = Round.objects.get(season=season, number=round_number)
            except Round.DoesNotExist:
                raise CommandError(
                    f"Round {round_number} does not exist for season {season_id}"
                )
        else:
            # Use the latest round
            target_round = Round.objects.filter(season=season).order_by('-number').first()
            if not target_round:
                raise CommandError(f"No rounds found for season {season_id}")

        self.stdout.write(f"Target round: {target_round.number}")
        
        # Generate results based on league type
        if season.league.competitor_type == "team":
            results_generated = self._generate_team_results(
                target_round, forfeit_rate, dry_run, overwrite
            )
        else:
            results_generated = self._generate_lone_results(
                target_round, forfeit_rate, dry_run, overwrite  
            )

        if dry_run:
            self.stdout.write(
                self.style.WARNING(f"DRY RUN: Would generate {results_generated} results")
            )
        else:
            if results_generated > 0:
                self.stdout.write(
                    self.style.SUCCESS(f"✓ Generated {results_generated} random results")
                )
                
                # Update team/player scores
                season.calculate_scores()
                self.stdout.write("✓ Scores updated")
            else:
                self.stdout.write("No results generated (all games already have results)")

    def _generate_team_results(self, round_obj, forfeit_rate, dry_run, overwrite):
        """Generate results for team tournament board pairings."""
        from heltour.tournament.models import TeamPairing
        
        results_generated = 0
        
        team_pairings = TeamPairing.objects.filter(round=round_obj).prefetch_related(
            'teamplayerpairing_set__white',
            'teamplayerpairing_set__black'
        )
        
        self.stdout.write(f"Found {team_pairings.count()} team pairings")
        
        for team_pairing in team_pairings:
            board_pairings = team_pairing.teamplayerpairing_set.order_by('board_number')
            
            pairing_results = []
            boards_processed = 0
            
            for board_pairing in board_pairings:
                # Skip if result already exists and not overwriting
                if board_pairing.result and not overwrite:
                    continue
                
                # Handle missing players (assign forfeit results)
                if board_pairing.white is None and board_pairing.black is None:
                    result = "0F-0F"  # Double forfeit
                elif board_pairing.white is None:
                    result = "0F-1X"  # Black wins by forfeit
                elif board_pairing.black is None:
                    result = "1X-0F"  # White wins by forfeit
                else:
                    # Generate result for normal pairing
                    white_rating = board_pairing.white.rating or 1500
                    black_rating = board_pairing.black.rating or 1500
                    result = simulate_game_result(
                        white_rating, 
                        black_rating, 
                        allow_forfeit=True,
                        forfeit_rate=forfeit_rate
                    )
                
                pairing_results.append({
                    'board': board_pairing.board_number,
                    'white': board_pairing.white.lichess_username if board_pairing.white else "MISSING",
                    'black': board_pairing.black.lichess_username if board_pairing.black else "MISSING", 
                    'result': result,
                    'pairing': board_pairing
                })
                boards_processed += 1
            
            if boards_processed > 0:
                self.stdout.write(
                    f"  {team_pairing.white_team.name} vs {team_pairing.black_team.name}:"
                )
                
                for result_info in pairing_results:
                    self.stdout.write(
                        f"    Board {result_info['board']}: "
                        f"{result_info['white']} vs {result_info['black']} = "
                        f"{result_info['result']}"
                    )
                    
                    if not dry_run:
                        result_info['pairing'].result = result_info['result']
                        result_info['pairing'].save()
                        
                results_generated += boards_processed
                
        # Update all team pairing points for this round (not just current one)
        if not dry_run and results_generated > 0:
            for tp in team_pairings:
                tp.refresh_points()
                tp.save()
        
        return results_generated

    def _generate_lone_results(self, round_obj, forfeit_rate, dry_run, overwrite):
        """Generate results for individual tournament pairings."""
        results_generated = 0
        
        lone_pairings = LonePlayerPairing.objects.filter(round=round_obj).select_related(
            'white', 'black'
        )
        
        self.stdout.write(f"Found {lone_pairings.count()} individual pairings")
        
        for pairing in lone_pairings:
            # Skip if result already exists and not overwriting
            if pairing.result and not overwrite:
                continue
                
            # Generate result
            white_rating = pairing.white.rating or 1500
            black_rating = pairing.black.rating or 1500
            result = simulate_game_result(
                white_rating,
                black_rating,
                allow_forfeit=True, 
                forfeit_rate=forfeit_rate
            )
            
            self.stdout.write(
                f"  {pairing.white.lichess_username} vs "
                f"{pairing.black.lichess_username} = {result}"
            )
            
            if not dry_run:
                pairing.result = result
                pairing.save()
                
            results_generated += 1
        
        return results_generated