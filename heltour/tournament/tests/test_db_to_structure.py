"""
Tests for database to tournament_core structure transformations.
"""

from django.test import TestCase
from heltour.tournament.models import (
    League,
    Season,
    Round,
    Team,
    Player,
    SeasonPlayer,
    TeamPairing,
    TeamPlayerPairing,
    LonePlayerPairing,
    TeamMember,
)
from heltour.tournament.db_to_structure import (
    _result_to_game_result,
    team_tournament_to_structure,
    lone_tournament_to_structure,
    season_to_tournament_structure,
)
from heltour.tournament_core.structure import GameResult
from heltour.tournament_core.scoring import THREE_ONE_ZERO_SCORING


class DbToStructureTests(TestCase):
    """Test conversion of database models to tournament_core structure."""

    def test_result_to_game_result(self):
        """Test conversion of result strings to GameResult enum."""
        # Normal results
        self.assertEqual(_result_to_game_result("1-0"), GameResult.P1_WIN)
        self.assertEqual(_result_to_game_result("1/2-1/2"), GameResult.DRAW)
        self.assertEqual(_result_to_game_result("0-1"), GameResult.P2_WIN)

        # Forfeit results
        self.assertEqual(_result_to_game_result("1X-0F"), GameResult.P1_FORFEIT_WIN)
        self.assertEqual(_result_to_game_result("0F-1X"), GameResult.P2_FORFEIT_WIN)
        self.assertEqual(_result_to_game_result("0F-0F"), GameResult.DOUBLE_FORFEIT)

        # Empty/invalid results
        self.assertIsNone(_result_to_game_result(""))
        self.assertIsNone(_result_to_game_result(None))
        self.assertIsNone(_result_to_game_result("invalid"))

        # Colors reversed
        self.assertEqual(
            _result_to_game_result("1-0", colors_reversed=True), GameResult.P2_WIN
        )
        self.assertEqual(
            _result_to_game_result("0-1", colors_reversed=True), GameResult.P1_WIN
        )
        self.assertEqual(
            _result_to_game_result("1/2-1/2", colors_reversed=True), GameResult.DRAW
        )
        self.assertEqual(
            _result_to_game_result("1X-0F", colors_reversed=True),
            GameResult.P2_FORFEIT_WIN,
        )
        self.assertEqual(
            _result_to_game_result("0F-1X", colors_reversed=True),
            GameResult.P1_FORFEIT_WIN,
        )

    def test_lone_tournament_to_structure(self):
        """Test conversion of individual tournament to structure."""
        # Create a simple individual tournament
        league = League.objects.create(
            name="Test Individual League",
            tag="TIL",
            competitor_type="individual",
            rating_type="standard",
        )
        season = Season.objects.create(
            league=league,
            name="Test Season",
            rounds=3,
        )

        # Create players
        player1 = Player.objects.create(lichess_username="player1")
        player2 = Player.objects.create(lichess_username="player2")
        player3 = Player.objects.create(lichess_username="player3")

        sp1 = SeasonPlayer.objects.create(season=season, player=player1)
        sp2 = SeasonPlayer.objects.create(season=season, player=player2)
        sp3 = SeasonPlayer.objects.create(season=season, player=player3)

        # Create rounds and pairings
        round1 = Round.objects.create(season=season, number=1, is_completed=True)
        LonePlayerPairing.objects.create(
            round=round1, white=player1, black=player2, result="1-0", pairing_order=1
        )

        round2 = Round.objects.create(season=season, number=2, is_completed=True)
        LonePlayerPairing.objects.create(
            round=round2,
            white=player3,
            black=player1,
            result="1/2-1/2",
            pairing_order=1,
        )

        # Convert to structure
        tournament = lone_tournament_to_structure(season)

        # Verify structure
        self.assertEqual(len(tournament.competitors), 3)
        self.assertIn(player1.id, tournament.competitors)
        self.assertIn(player2.id, tournament.competitors)
        self.assertIn(player3.id, tournament.competitors)

        self.assertEqual(len(tournament.rounds), 2)

        # Round 1: P1 vs P2, P3 gets bye
        round1_matches = tournament.rounds[0].matches
        self.assertEqual(len(round1_matches), 2)  # 1 game + 1 bye

        # Find the actual game
        game_match = next(m for m in round1_matches if not m.is_bye)
        self.assertEqual(game_match.competitor1_id, player1.id)
        self.assertEqual(game_match.competitor2_id, player2.id)
        self.assertEqual(len(game_match.games), 1)
        self.assertEqual(game_match.games[0].result, GameResult.P1_WIN)

        # Find the bye
        bye_match = next(m for m in round1_matches if m.is_bye)
        self.assertEqual(bye_match.competitor1_id, player3.id)

        # Calculate results
        results = tournament.calculate_results()
        self.assertEqual(results[player1.id].match_points, 3)  # Win + Draw
        self.assertEqual(results[player2.id].match_points, 1)  # Loss + Bye
        self.assertEqual(results[player3.id].match_points, 2)  # Bye + Draw

    def test_team_tournament_to_structure(self):
        """Test conversion of team tournament to structure."""
        # Create a team tournament
        league = League.objects.create(
            name="Test Team League",
            tag="TTL",
            competitor_type="team",
            rating_type="standard",
        )
        season = Season.objects.create(
            league=league,
            name="Test Season",
            rounds=2,
            boards=4,
        )

        # Create teams and players
        team1 = Team.objects.create(season=season, name="Team 1", number=1)
        team2 = Team.objects.create(season=season, name="Team 2", number=2)

        players_t1 = []
        players_t2 = []
        for i in range(1, 5):
            p1 = Player.objects.create(lichess_username=f"t1_player{i}")
            p2 = Player.objects.create(lichess_username=f"t2_player{i}")
            players_t1.append(p1)
            players_t2.append(p2)
            SeasonPlayer.objects.create(season=season, player=p1)
            SeasonPlayer.objects.create(season=season, player=p2)
            TeamMember.objects.create(team=team1, player=p1, board_number=i)
            TeamMember.objects.create(team=team2, player=p2, board_number=i)

        # Create a round with team pairing
        round1 = Round.objects.create(season=season, number=1, is_completed=False)
        team_pairing = TeamPairing(
            round=round1,
            white_team=team1,
            black_team=team2,
            pairing_order=1,
            white_points=2.5,
            black_points=1.5,
            white_wins=2,
            black_wins=1,
        )
        # Save without triggering calculate_scores
        team_pairing.save()

        # Create board pairings
        # Board 1: Team1 gets white, Team1 wins
        TeamPlayerPairing.objects.create(
            team_pairing=team_pairing,
            board_number=1,
            white=players_t1[0],
            black=players_t2[0],
            result="1-0",
        )
        # Board 2: Team2 gets white (colors alternate), Team2 wins
        TeamPlayerPairing.objects.create(
            team_pairing=team_pairing,
            board_number=2,
            white=players_t2[1],
            black=players_t1[1],
            result="1-0",
        )
        # Board 3: Team1 gets white, Draw
        TeamPlayerPairing.objects.create(
            team_pairing=team_pairing,
            board_number=3,
            white=players_t1[2],
            black=players_t2[2],
            result="1/2-1/2",
        )
        # Board 4: Team2 gets white, Team1 wins
        TeamPlayerPairing.objects.create(
            team_pairing=team_pairing,
            board_number=4,
            white=players_t2[3],
            black=players_t1[3],
            result="0-1",
        )

        # Mark round as completed before conversion
        round1.is_completed = True
        round1.save()

        # Convert to structure
        tournament = team_tournament_to_structure(season)

        # Verify structure
        self.assertEqual(len(tournament.competitors), 2)
        self.assertIn(team1.id, tournament.competitors)
        self.assertIn(team2.id, tournament.competitors)

        self.assertEqual(len(tournament.rounds), 1)
        self.assertEqual(len(tournament.rounds[0].matches), 1)

        match = tournament.rounds[0].matches[0]
        self.assertEqual(match.competitor1_id, team1.id)
        self.assertEqual(match.competitor2_id, team2.id)
        self.assertEqual(len(match.games), 4)

        # Verify game results and player ordering
        # Board 1: T1 player wins as white
        self.assertEqual(match.games[0].player1_id, players_t1[0].id)
        self.assertEqual(match.games[0].player2_id, players_t2[0].id)
        self.assertEqual(match.games[0].result, GameResult.P1_WIN)

        # Board 2: T2 player wins as white (but we flip to maintain T1 as player1)
        self.assertEqual(match.games[1].player1_id, players_t1[1].id)
        self.assertEqual(match.games[1].player2_id, players_t2[1].id)
        self.assertEqual(match.games[1].result, GameResult.P2_WIN)

        # Board 3: Draw
        self.assertEqual(match.games[2].player1_id, players_t1[2].id)
        self.assertEqual(match.games[2].player2_id, players_t2[2].id)
        self.assertEqual(match.games[2].result, GameResult.DRAW)

        # Board 4: T1 player wins as black (we flip to maintain T1 as player1)
        self.assertEqual(match.games[3].player1_id, players_t1[3].id)
        self.assertEqual(match.games[3].player2_id, players_t2[3].id)
        self.assertEqual(match.games[3].result, GameResult.P1_WIN)

        # Calculate and verify match result
        results = tournament.calculate_results()
        self.assertEqual(results[team1.id].match_points, 2)  # Team1 won 2.5-1.5
        self.assertEqual(results[team1.id].game_points, 2.5)
        self.assertEqual(results[team2.id].match_points, 0)  # Team2 lost
        self.assertEqual(results[team2.id].game_points, 1.5)

    def test_season_to_tournament_with_custom_scoring(self):
        """Test conversion with custom scoring system."""
        # Create a simple tournament
        league = League.objects.create(
            name="Test League",
            tag="TL",
            competitor_type="individual",
            rating_type="standard",
        )
        season = Season.objects.create(
            league=league,
            name="Test Season",
            rounds=1,
        )

        player1 = Player.objects.create(lichess_username="player1")
        player2 = Player.objects.create(lichess_username="player2")
        SeasonPlayer.objects.create(season=season, player=player1)
        SeasonPlayer.objects.create(season=season, player=player2)

        round1 = Round.objects.create(season=season, number=1, is_completed=True)
        LonePlayerPairing.objects.create(
            round=round1, white=player1, black=player2, result="1-0", pairing_order=1
        )

        # Convert with custom scoring (3-1-0 system)
        tournament = season_to_tournament_structure(season, THREE_ONE_ZERO_SCORING)

        # Verify custom scoring is applied
        results = tournament.calculate_results()
        self.assertEqual(results[player1.id].match_points, 3)  # Win = 3 points
        self.assertEqual(results[player2.id].match_points, 0)  # Loss = 0 points

    def test_incomplete_rounds_ignored(self):
        """Test that incomplete rounds are not included in the structure."""
        league = League.objects.create(
            name="Test League",
            tag="TL",
            competitor_type="individual",
            rating_type="standard",
        )
        season = Season.objects.create(
            league=league,
            name="Test Season",
            rounds=3,
        )

        player1 = Player.objects.create(lichess_username="player1")
        player2 = Player.objects.create(lichess_username="player2")
        SeasonPlayer.objects.create(season=season, player=player1)
        SeasonPlayer.objects.create(season=season, player=player2)

        # Create one complete and one incomplete round
        round1 = Round.objects.create(season=season, number=1, is_completed=True)
        LonePlayerPairing.objects.create(
            round=round1, white=player1, black=player2, result="1-0", pairing_order=1
        )

        round2 = Round.objects.create(season=season, number=2, is_completed=False)
        LonePlayerPairing.objects.create(
            round=round2,
            white=player2,
            black=player1,
            result="1-0",  # Result exists but round not completed
            pairing_order=1,
        )

        # Convert to structure
        tournament = lone_tournament_to_structure(season)

        # Only completed round should be included
        self.assertEqual(len(tournament.rounds), 1)
        self.assertEqual(tournament.rounds[0].number, 1)

    def test_tournament_builder_with_existing_league_sets_boards(self):
        """Test that boards are properly set when using TournamentBuilder with an existing league."""
        from heltour.tournament.builder import TournamentBuilder
        
        # Create an existing team league
        league = League.objects.create(
            name="Test Team League",
            tag="TTL",
            competitor_type="team",
            rating_type="standard",
        )
        
        # Use TournamentBuilder with existing league
        builder = TournamentBuilder()
        builder._existing_league = league
        
        # Create a season with boards
        builder.season("TTL", "Test Season", rounds=3, boards=4, tag="test-season")
        
        # Add teams
        builder.team("Team A", ("player1", 2000), ("player2", 1900), ("player3", 1800), ("player4", 1700))
        builder.team("Team B", ("player5", 1950), ("player6", 1850), ("player7", 1750), ("player8", 1650))
        
        # Build the structure
        builder.build()
        
        # Check that the season has boards set
        season = builder.current_season
        self.assertIsNotNone(season.boards, "Season boards should not be None for team tournament")
        self.assertEqual(season.boards, 4, "Season boards should be 4")
        
        # Ensure league type is correctly set in metadata
        self.assertEqual(builder.core_builder.metadata.competitor_type, "team")
        self.assertEqual(builder.core_builder.metadata.boards, 4)

