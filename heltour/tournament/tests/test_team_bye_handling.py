"""
Test team bye handling in pairing generation.

This test isolates the issue with odd numbers of teams in JavaFo pairings.
"""

from unittest import skipUnless
from django.test import TestCase
from django.conf import settings

from heltour.tournament.models import (
    League,
    Season,
    Round,
    Team,
    TeamScore,
    Player,
    SeasonPlayer,
    TeamMember,
    TeamPairing,
    TeamBye,
)
from heltour.tournament.pairinggen import generate_pairings
from heltour.tournament.db_to_structure import season_to_tournament_structure


def can_run_javafo():
    """Check if we can run JavaFo tests."""
    if not hasattr(settings, "JAVAFO_COMMAND"):
        return False
    try:
        import subprocess

        result = subprocess.run(["java", "-version"], capture_output=True)
        return result.returncode == 0
    except:
        return False


@skipUnless(can_run_javafo(), "JavaFo environment not available")
class TeamByeHandlingTest(TestCase):
    """Test that team byes are handled correctly in pairing generation."""

    def setUp(self):
        """Set up JavaFo settings."""
        if not hasattr(settings, "JAVAFO_COMMAND"):
            settings.JAVAFO_COMMAND = "java -jar /media/lakin/data/personal-repos/litour/thirdparty/javafo.jar"

    def test_minimal_team_bye_scenario(self):
        """Test pairing generation with 3 teams (one must get a bye)."""
        # Create league
        league = League.objects.create(
            name="Test Team League",
            tag="TTL",
            competitor_type="team",
            rating_type="standard",
            pairing_type="swiss-dutch",
            theme="blue",
        )

        # Create season
        season = Season.objects.create(
            league=league,
            name="Test Season",
            tag="test-s1",
            rounds=2,
            boards=2,
            is_active=True,
        )

        # Create 3 teams with players
        teams = []
        for i in range(3):
            team = Team.objects.create(
                season=season,
                number=i + 1,
                name=f"Team {i + 1}",
                is_active=True,
                seed_rating=2000 - i * 100,
            )
            TeamScore.objects.create(team=team)
            teams.append(team)

            # Add players to each team
            for board in range(1, 3):  # 2 boards
                player = Player.objects.create(
                    lichess_username=f"Team{i+1}Player{board}",
                    rating=2000 - i * 50 - board * 50,
                )
                SeasonPlayer.objects.create(
                    season=season,
                    player=player,
                    seed_rating=player.rating,
                    is_active=True,
                )
                TeamMember.objects.create(
                    team=team,
                    player=player,
                    board_number=board,
                )

        # Create round
        round1 = Round.objects.create(
            season=season,
            number=1,
            is_completed=False,
        )

        # Generate pairings
        import reversion

        with reversion.create_revision():
            reversion.set_comment("Test pairing generation")
            generate_pairings(round1)

        # Check what was created
        pairings = TeamPairing.objects.filter(round=round1)

        # With 3 teams, we expect 1 pairing (2 teams play, 1 gets bye)
        self.assertEqual(pairings.count(), 1, "Should have 1 pairing with 3 teams")

        # Check which teams played
        teams_that_played = set()
        for pairing in pairings:
            teams_that_played.add(pairing.white_team_id)
            teams_that_played.add(pairing.black_team_id)

        # Check TeamBye was created
        team_byes = TeamBye.objects.filter(round=round1)
        self.assertEqual(team_byes.count(), 1, "Should have 1 TeamBye record")

        # The TeamBye should be for the team that didn't play
        bye_team = team_byes.first().team
        self.assertNotIn(
            bye_team.id, teams_that_played, "Team with bye should not have a pairing"
        )

        # Mark round as completed
        round1.is_completed = True
        round1.save()

        # Convert to tournament structure and verify bye handling
        tournament_structure = season_to_tournament_structure(season)
        results = tournament_structure.calculate_results()

        # Team with bye should have 1 match point
        bye_team_id = team_byes.first().team_id
        score = results[bye_team_id]
        self.assertEqual(
            score.match_points, 1, "Team with bye should have 1 match point"
        )
        self.assertEqual(
            score.game_points,
            1,
            "Team with bye should have 1 game point (0.5 per board)",
        )

    def test_five_teams_two_rounds(self):
        """Test multiple rounds with 5 teams (one gets bye each round)."""
        # Create league
        league = League.objects.create(
            name="Five Team League",
            tag="FTL",
            competitor_type="team",
            rating_type="standard",
            pairing_type="swiss-dutch",
            theme="blue",
        )

        # Create season
        season = Season.objects.create(
            league=league,
            name="Five Team Season",
            tag="five-s1",
            rounds=3,
            boards=1,  # Simple 1-board teams
            is_active=True,
        )

        # Create 5 teams
        teams = []
        for i in range(5):
            team = Team.objects.create(
                season=season,
                number=i + 1,
                name=f"Team {chr(65 + i)}",  # Team A, B, C, D, E
                is_active=True,
                seed_rating=2200 - i * 50,
            )
            TeamScore.objects.create(team=team)
            teams.append(team)

            # Add one player per team
            player = Player.objects.create(
                lichess_username=f"Player{chr(65 + i)}",
                rating=2200 - i * 50,
            )
            SeasonPlayer.objects.create(
                season=season,
                player=player,
                seed_rating=player.rating,
                is_active=True,
            )
            TeamMember.objects.create(
                team=team,
                player=player,
                board_number=1,
            )

        # Play two rounds
        teams_with_byes_by_round = []

        for round_num in range(1, 3):
            round_obj = Round.objects.create(
                season=season,
                number=round_num,
                is_completed=False,
            )

            # Generate pairings
            import reversion

            with reversion.create_revision():
                reversion.set_comment(f"Round {round_num} pairings")
                generate_pairings(round_obj)

            # Check pairings
            pairings = TeamPairing.objects.filter(round=round_obj)

            teams_that_played = set()
            for p in pairings:
                teams_that_played.add(p.white_team_id)
                teams_that_played.add(p.black_team_id)

            # Check team byes
            team_byes = TeamBye.objects.filter(round=round_obj)
            self.assertEqual(
                team_byes.count(), 1, f"Round {round_num} should have 1 TeamBye"
            )

            teams_with_bye = set(tb.team_id for tb in team_byes)
            teams_with_byes_by_round.append(teams_with_bye)

            self.assertEqual(
                pairings.count(), 2, f"Round {round_num} should have 2 pairings"
            )
            self.assertEqual(
                len(teams_with_bye), 1, f"Round {round_num} should have 1 team with bye"
            )

            # Complete the round (would normally have results)
            round_obj.is_completed = True
            round_obj.save()

        # Check that different teams got byes in different rounds (Swiss principle)
        if len(teams_with_byes_by_round) >= 2:
            # JavaFo should try to give different teams byes
            self.assertNotEqual(
                teams_with_byes_by_round[0],
                teams_with_byes_by_round[1],
                "Different teams should get byes in different rounds (Swiss principle)",
            )
