"""
Convert tournament_core structures to database objects.

This module provides functions to convert pure tournament structures created by
the TournamentBuilder into Django database models for persistence.
"""

from heltour.tournament_core.builder import TournamentBuilder


def structure_to_db(builder: TournamentBuilder):
    """Convert a TournamentBuilder's structure to database objects.

    This function creates all necessary database objects including:
    - League and Season
    - Teams/Players and registrations
    - Rounds and pairings with board results
    - Byes for teams/players without pairings

    Args:
        builder: A TournamentBuilder instance with tournament structure and metadata

    Returns:
        dict: A dictionary containing the created database objects:
            - 'league': The League instance
            - 'season': The Season instance
            - 'teams': Dict mapping team names to Team instances
            - 'players': Dict mapping player names to Player instances
            - 'rounds': List of Round instances
    """
    from heltour.tournament.models import (
        League,
        Season,
        Round,
        Team,
        Player,
        SeasonPlayer,
        TeamMember,
        TeamScore,
        LonePlayerScore,
        TeamPairing,
        TeamPlayerPairing,
        LonePlayerPairing,
        Registration,
        TeamBye,
        PlayerBye,
    )

    tournament = builder.tournament
    metadata = builder.metadata

    # Create League
    league_data = {
        "name": metadata.league_name or "Test League",
        "tag": metadata.league_tag or "TL",
        "competitor_type": metadata.competitor_type,
        "rating_type": metadata.league_settings.get("rating_type", "standard"),
        "pairing_type": metadata.league_settings.get("pairing_type", "swiss-dutch"),
        "theme": metadata.league_settings.get("theme", "blue"),
    }
    # Add any additional league settings
    for key, value in metadata.league_settings.items():
        if key not in league_data:
            league_data[key] = value

    league = League.objects.create(**league_data)

    # Create Season
    season_data = {
        "league": league,
        "name": metadata.season_name or "Test Season",
        "rounds": metadata.season_settings.get("rounds", len(tournament.rounds)) or 1,
        "boards": metadata.boards if metadata.competitor_type == "team" else None,
    }
    # Add any additional season settings
    for key, value in metadata.season_settings.items():
        if key not in season_data:
            season_data[key] = value

    season = Season.objects.create(**season_data)

    # Track created objects
    db_players = {}  # player_id -> Player instance
    db_teams = {}  # team_name -> Team instance
    db_rounds = []  # List of Round instances

    if metadata.competitor_type == "team":
        # Create teams and players
        for team_name, team_info in metadata.teams.items():
            # Calculate seed rating as average of player ratings if not provided
            if "seed_rating" not in team_info and team_info["players"]:
                total_rating = sum(p.get("rating", 1500) for p in team_info["players"])
                seed_rating = total_rating / len(team_info["players"])
            else:
                seed_rating = team_info.get("seed_rating", 1500)

            # Create team
            team = Team.objects.create(
                season=season,
                name=team_name,
                number=team_info["id"],
                is_active=True,
                seed_rating=seed_rating,
            )
            TeamScore.objects.create(team=team)
            db_teams[team_name] = team

            # Create players and team members
            for i, player_info in enumerate(team_info["players"], 1):
                player_name = player_info["name"]
                player_id = player_info["id"]
                rating = player_info.get("rating", 1500)

                # Create or get player
                if player_id not in db_players:
                    player = Player.objects.create(
                        lichess_username=player_name,
                        rating=rating,
                        profile={
                            "perfs": {
                                "standard": {
                                    "rating": rating,
                                    "games": 100,
                                    "prov": False,
                                },
                                "classical": {
                                    "rating": rating,
                                    "games": 100,
                                    "prov": False,
                                },
                            }
                        },
                    )
                    db_players[player_id] = player
                else:
                    player = db_players[player_id]

                # Create season player
                SeasonPlayer.objects.create(
                    season=season, player=player, seed_rating=rating, is_active=True
                )

                # Create team member
                TeamMember.objects.create(team=team, player=player, board_number=i)
    else:
        # Create individual players
        for player_name, player_id in metadata.players.items():
            rating = 1500  # Default rating

            # Create player
            player = Player.objects.create(
                lichess_username=player_name,
                rating=rating,
                profile={
                    "perfs": {
                        "standard": {"rating": rating, "games": 100, "prov": False},
                        "classical": {"rating": rating, "games": 100, "prov": False},
                    }
                },
            )
            db_players[player_id] = player

            # Create registration
            Registration.objects.create(
                season=season,
                player=player,
                status="approved",
                has_played_20_games=True,
                can_commit=True,
                agreed_to_rules=True,
                agreed_to_tos=True,
            )

            # Create season player
            sp = SeasonPlayer.objects.create(
                season=season, player=player, seed_rating=rating, is_active=True
            )
            LonePlayerScore.objects.create(season_player=sp)

    # Create rounds and pairings
    for round_struct in tournament.rounds:
        # Create round (initially not completed)
        round_obj = Round.objects.create(
            season=season, number=round_struct.number, is_completed=False
        )
        db_rounds.append(round_obj)

        # Track who played in this round and who has byes
        competitors_played = set()
        competitors_with_byes = set()

        # Create pairings
        pairing_order = 0
        for match in round_struct.matches:
            pairing_order += 1

            if match.is_bye:
                # Handle bye
                competitors_with_byes.add(match.competitor1_id)
                if metadata.competitor_type == "team":
                    # Find team by ID
                    team = next(
                        (
                            t
                            for t in db_teams.values()
                            if t.number == match.competitor1_id
                        ),
                        None,
                    )
                    if team:
                        # Use get_or_create to avoid duplicates
                        TeamBye.objects.get_or_create(
                            round=round_obj,
                            team=team,
                            defaults={"type": "full-point-pairing-bye"},
                        )
                else:
                    # Find player by ID
                    player = db_players.get(match.competitor1_id)
                    if player:
                        # Use get_or_create to avoid duplicates
                        PlayerBye.objects.get_or_create(
                            round=round_obj,
                            player=player,
                            defaults={"type": "full-point-pairing-bye"},
                        )
            else:
                competitors_played.add(match.competitor1_id)
                competitors_played.add(match.competitor2_id)

                if metadata.competitor_type == "team":
                    # Create team pairing
                    team1 = next(
                        (
                            t
                            for t in db_teams.values()
                            if t.number == match.competitor1_id
                        ),
                        None,
                    )
                    team2 = next(
                        (
                            t
                            for t in db_teams.values()
                            if t.number == match.competitor2_id
                        ),
                        None,
                    )

                    if team1 and team2:
                        team_pairing = TeamPairing.objects.create(
                            round=round_obj,
                            white_team=team1,
                            black_team=team2,
                            pairing_order=pairing_order,
                        )

                        # Create board pairings
                        for board_num, game in enumerate(match.games, 1):
                            # Get players
                            white_player = db_players.get(game.player1_id)
                            black_player = db_players.get(game.player2_id)

                            if white_player and black_player:
                                # Convert result
                                result_str = _game_result_to_string(game.result)

                                TeamPlayerPairing.objects.create(
                                    team_pairing=team_pairing,
                                    board_number=board_num,
                                    white=white_player,
                                    black=black_player,
                                    result=result_str,
                                )

                        # Update pairing points
                        team_pairing.refresh_points()
                        team_pairing.save()
                else:
                    # Create individual pairing
                    player1 = db_players.get(match.competitor1_id)
                    player2 = db_players.get(match.competitor2_id)

                    if player1 and player2 and match.games:
                        game = match.games[0]
                        result_str = _game_result_to_string(game.result)

                        LonePlayerPairing.objects.create(
                            round=round_obj,
                            white=player1,
                            black=player2,
                            result=result_str,
                            pairing_order=pairing_order,
                        )

        # Create byes for competitors who didn't play and don't already have byes
        if metadata.competitor_type == "team":
            all_team_ids = set(t.number for t in db_teams.values())
            teams_without_pairing = (
                all_team_ids - competitors_played - competitors_with_byes
            )

            for team_id in teams_without_pairing:
                team = next((t for t in db_teams.values() if t.number == team_id), None)
                if team:
                    # Use get_or_create to avoid duplicates
                    TeamBye.objects.get_or_create(
                        round=round_obj,
                        team=team,
                        defaults={"type": "full-point-pairing-bye"},
                    )

        # Mark round as completed
        round_obj.is_completed = True
        round_obj.save()

    # Calculate scores
    season.calculate_scores()

    return {
        "league": league,
        "season": season,
        "teams": db_teams,
        "players": {name: db_players[pid] for name, pid in metadata.players.items()},
        "rounds": db_rounds,
    }


def _game_result_to_string(result) -> str:
    """Convert GameResult enum to database string format."""
    from heltour.tournament_core.structure import GameResult

    result_map = {
        GameResult.P1_WIN: "1-0",
        GameResult.DRAW: "1/2-1/2",
        GameResult.P2_WIN: "0-1",
        GameResult.P1_FORFEIT_WIN: "1X-0F",
        GameResult.P2_FORFEIT_WIN: "0F-1X",
        GameResult.DOUBLE_FORFEIT: "0F-0F",
    }

    return result_map.get(result, "")
