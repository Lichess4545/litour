"""
Management command to generate random results for the current round of a season.

This command takes a season ID and generates random results for all pairings
in the current round that don't already have results.
"""

import random
from django.core.management.base import BaseCommand, CommandError

from heltour.tournament.models import (
    Season,
    Round,
    LonePlayerPairing,
)
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
            target_round = (
                Round.objects.filter(season=season).order_by("-number").first()
            )
            if not target_round:
                raise CommandError(f"No rounds found for season {season_id}")

        self.stdout.write(f"Target round: {target_round.number}")

        # Check if this is a knockout tournament
        is_knockout = season.league.pairing_type.startswith("knockout")

        # Generate results based on league type and tournament format
        if season.league.competitor_type == "team":
            results_generated = self._generate_team_results(
                target_round, forfeit_rate, dry_run, overwrite, is_knockout
            )
        else:
            results_generated = self._generate_lone_results(
                target_round, forfeit_rate, dry_run, overwrite, is_knockout
            )

        if dry_run:
            self.stdout.write(
                self.style.WARNING(
                    f"DRY RUN: Would generate {results_generated} results"
                )
            )
        else:
            if results_generated > 0:
                self.stdout.write(
                    self.style.SUCCESS(
                        f"✓ Generated {results_generated} random results"
                    )
                )

                # Clear cache and update team/player scores
                from django.core.cache import cache

                cache.clear()
                self.stdout.write("Cache cleared")

                # Update team/player scores
                season.calculate_scores()
                self.stdout.write("✓ Scores updated")

                # For knockout tournaments, try to advance to next round
                if is_knockout:
                    self._try_advance_knockout(target_round, season, dry_run)
            else:
                self.stdout.write(
                    "No results generated (all games already have results)"
                )

    def _generate_team_results(
        self, round_obj, forfeit_rate, dry_run, overwrite, is_knockout=False
    ):
        """Generate results for team tournament board pairings."""
        from heltour.tournament.models import TeamPairing

        results_generated = 0

        team_pairings = TeamPairing.objects.filter(round=round_obj).prefetch_related(
            "teamplayerpairing_set__white", "teamplayerpairing_set__black"
        )

        self.stdout.write(f"Found {team_pairings.count()} team pairings")

        if is_knockout:
            self.stdout.write("  (Knockout tournament - generating decisive results)")

        for team_pairing in team_pairings:
            # Skip bye pairings in knockout
            if is_knockout and team_pairing.black_team_id is None:
                continue
            board_pairings = team_pairing.teamplayerpairing_set.order_by("board_number")

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
                        forfeit_rate=forfeit_rate,
                    )

                pairing_results.append(
                    {
                        "board": board_pairing.board_number,
                        "white": (
                            board_pairing.white.lichess_username
                            if board_pairing.white
                            else "MISSING"
                        ),
                        "black": (
                            board_pairing.black.lichess_username
                            if board_pairing.black
                            else "MISSING"
                        ),
                        "result": result,
                        "pairing": board_pairing,
                    }
                )
                boards_processed += 1

            if boards_processed > 0:
                # For knockout tournaments, ensure decisive results (avoid ties)
                if is_knockout and not dry_run:
                    self._ensure_knockout_decisive_result(team_pairing, pairing_results)

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
                        result_info["pairing"].result = result_info["result"]
                        result_info["pairing"].save()

                results_generated += boards_processed

                # Show team match result for knockout
                if is_knockout:
                    if not dry_run:
                        team_pairing.refresh_points()
                        team_pairing.save()
                    white_points = sum(
                        self._result_to_points(r["result"], True)
                        for r in pairing_results
                    )
                    black_points = sum(
                        self._result_to_points(r["result"], False)
                        for r in pairing_results
                    )
                    winner = (
                        "White"
                        if white_points > black_points
                        else "Black" if black_points > white_points else "TIE"
                    )
                    self.stdout.write(
                        f"    → Match result: {white_points:.1f} - {black_points:.1f} ({winner} wins)"
                    )

                    # Add manual tiebreak if tied
                    if winner == "TIE" and not dry_run:
                        # Randomly assign tiebreak winner
                        tiebreak_winner = random.choice([1.0, -1.0])
                        team_pairing.manual_tiebreak_value = tiebreak_winner
                        team_pairing.save()
                        winner_name = "White" if tiebreak_winner > 0 else "Black"
                        self.stdout.write(
                            f"    → Tiebreak: {winner_name} wins (random tiebreak applied)"
                        )

        # Update all team pairing points for this round (not just current one)
        if not dry_run and results_generated > 0:
            self.stdout.write("Refreshing team pairing points...")
            for tp in team_pairings:
                tp.refresh_points()
                tp.save()
            self.stdout.write(
                f"✓ Refreshed points for {len(team_pairings)} team pairings"
            )

        return results_generated

    def _generate_lone_results(
        self, round_obj, forfeit_rate, dry_run, overwrite, is_knockout=False
    ):
        """Generate results for individual tournament pairings."""
        results_generated = 0

        lone_pairings = LonePlayerPairing.objects.filter(
            round=round_obj
        ).select_related("white", "black")

        self.stdout.write(f"Found {lone_pairings.count()} individual pairings")

        if is_knockout:
            self.stdout.write("  (Knockout tournament - no draws allowed)")

        for pairing in lone_pairings:
            # Skip bye pairings in knockout
            if is_knockout and pairing.black_id is None:
                continue
            # Skip if result already exists and not overwriting
            if pairing.result and not overwrite:
                continue

            # Generate result
            white_rating = pairing.white.rating or 1500
            black_rating = pairing.black.rating or 1500

            if is_knockout:
                # Force decisive results in knockout (no draws)
                result = self._generate_knockout_result(
                    white_rating, black_rating, forfeit_rate
                )
            else:
                result = simulate_game_result(
                    white_rating,
                    black_rating,
                    allow_forfeit=True,
                    forfeit_rate=forfeit_rate,
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

    def _generate_knockout_result(self, white_rating, black_rating, forfeit_rate):
        """Generate a decisive result for knockout tournaments (no draws)."""
        # Small chance of forfeit
        if random.random() < forfeit_rate:
            forfeit_type = random.random()
            if forfeit_type < 0.5:
                return "1X-0F"  # Black forfeits
            else:
                return "0F-1X"  # White forfeits

        # Calculate expected score using Elo formula
        exp_white = 1 / (1 + 10 ** ((black_rating - white_rating) / 400))

        # Force decisive result (no draws in knockout)
        rand = random.random()
        if rand < exp_white:
            return "1-0"  # White wins
        else:
            return "0-1"  # Black wins

    def _result_to_points(self, result, is_white):
        """Convert game result to points for white or black player."""
        if result == "1-0":
            return 1.0 if is_white else 0.0
        elif result == "0-1":
            return 0.0 if is_white else 1.0
        elif result == "1/2-1/2":
            return 0.5
        elif result == "1X-0F":  # White wins by forfeit
            return 1.0 if is_white else 0.0
        elif result == "0F-1X":  # Black wins by forfeit
            return 0.0 if is_white else 1.0
        elif result == "0F-0F":  # Double forfeit
            return 0.0
        else:
            return 0.0

    def _ensure_knockout_decisive_result(self, team_pairing, pairing_results):
        """Ensure team match has a decisive result for knockout tournaments."""
        white_points = sum(
            self._result_to_points(r["result"], True) for r in pairing_results
        )
        black_points = sum(
            self._result_to_points(r["result"], False) for r in pairing_results
        )

        # If tied, change one draw to a win to create decisive result
        if white_points == black_points:
            # Find a draw to convert
            draws = [r for r in pairing_results if r["result"] == "1/2-1/2"]
            if draws:
                # Convert one draw to a win (favor higher-rated player)
                draw_to_change = draws[0]
                pairing_obj = draw_to_change["pairing"]

                if pairing_obj.white and pairing_obj.black:
                    white_rating = pairing_obj.white.rating or 1500
                    black_rating = pairing_obj.black.rating or 1500

                    # Higher rated player wins the "tiebreak"
                    if white_rating >= black_rating:
                        draw_to_change["result"] = "1-0"
                    else:
                        draw_to_change["result"] = "0-1"
                else:
                    # Random if no ratings
                    draw_to_change["result"] = random.choice(["1-0", "0-1"])

    def _try_advance_knockout(self, completed_round, season, dry_run):
        """Try to advance knockout tournament to next round."""
        from heltour.tournament.models import Round

        # Check if round is complete and can advance
        if not completed_round.is_completed:
            # Mark round as completed
            completed_round.is_completed = True
            if not dry_run:
                completed_round.save()
            self.stdout.write(f"✓ Round {completed_round.number} marked as completed")

        # Check if there are more rounds to play
        total_rounds = Round.objects.filter(season=season).count()
        if completed_round.number >= total_rounds:
            self.stdout.write("✓ Tournament complete! All rounds finished.")
            return

        # Try to advance to next round
        try:
            from heltour.tournament.pairinggen import advance_knockout_tournament

            if not dry_run:
                next_round = advance_knockout_tournament(completed_round)
                if next_round:
                    from heltour.tournament_core.knockout import get_knockout_stage_name
                    from heltour.tournament.models import KnockoutBracket

                    try:
                        bracket = KnockoutBracket.objects.get(season=season)
                        teams_remaining = bracket.bracket_size // (
                            2 ** (next_round.number - 1)
                        )
                        stage_name = get_knockout_stage_name(teams_remaining)
                        self.stdout.write(
                            self.style.SUCCESS(
                                f"✓ Advanced to {stage_name} (Round {next_round.number})"
                            )
                        )

                        # Count new pairings
                        if season.league.competitor_type == "team":
                            from heltour.tournament.models import TeamPairing

                            new_pairings = TeamPairing.objects.filter(
                                round=next_round
                            ).count()
                        else:
                            new_pairings = LonePlayerPairing.objects.filter(
                                round=next_round
                            ).count()

                        self.stdout.write(f"  - {new_pairings} new matches created")
                        self.stdout.write(
                            f"  - Use 'generate_random_results {season.id} --round-number {next_round.number}' for next round"
                        )
                    except KnockoutBracket.DoesNotExist:
                        self.stdout.write(f"✓ Advanced to Round {next_round.number}")
                else:
                    self.stdout.write(
                        "Could not advance tournament (check for tied matches needing tiebreaks)"
                    )
            else:
                self.stdout.write(
                    "DRY RUN: Would attempt to advance tournament to next round"
                )

        except Exception as e:
            self.stdout.write(
                self.style.ERROR(f"Failed to advance tournament: {str(e)}")
            )
