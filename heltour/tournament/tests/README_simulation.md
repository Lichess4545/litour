# Tournament Simulation Framework

This framework provides a clean, Pythonic API for simulating tournaments in tests. It properly populates the Django database so you can use `db_to_structure` and test all tournament features including standings, tiebreaks, and pairings.

## Features

- **Fluent Builder Pattern**: Chain method calls for easy tournament setup
- **Database Integration**: Creates all necessary Django models
- **Works with db_to_structure**: Simulated tournaments can be converted to tournament_core structures
- **Supports Both Tournament Types**: Team and individual tournaments
- **Automatic Bye Handling**: Players/teams without games get byes automatically

## Basic Usage

### Individual Tournament
```python
tournament = (TournamentBuilder()
    .league("Weekend Blitz", "WB", "lone")
    .season("WB", "January 2024", rounds=3)
    .player("Magnus", 2850)
    .player("Hikaru", 2800)
    .round(1)
    .game("Magnus", "Hikaru", "1-0")
    .complete()
    .calculate()
    .build()
)
```

### Team Tournament
```python
tournament = (TournamentBuilder()
    .league("Team Battle", "TB", "team")
    .season("TB", "Spring 2024", rounds=2, boards=4)
    .team("Dragons", "Player1", "Player2", "Player3", "Player4")
    .team("Knights", "Player1", "Player2", "Player3", "Player4")
    .round(1)
    .match("Dragons", "Knights", "1-0", "0-1", "1/2-1/2", "1-0")
    .complete()
    .calculate()
    .build()
)
```

## Testing with db_to_structure

```python
# After building tournament
season = tournament.seasons["Spring 2024"]

# Convert to tournament structure
tournament_structure = season_to_tournament_structure(season)

# Calculate results using tournament_core
results = tournament_structure.calculate_results()

# Test tiebreaks, standings, etc.
assert results[team_id].sonneborn_berger == expected_value
```

## Result Notation

- `"1-0"` - White wins
- `"1/2-1/2"` - Draw  
- `"0-1"` - Black wins
- `"1X-0F"` - White wins by forfeit
- `"0F-1X"` - Black wins by forfeit
- `"0F-0F"` - Double forfeit

## Important Notes

1. **Board Colors**: In team tournaments, board colors alternate (board 1 white for team1, board 2 white for team2, etc.)
2. **Automatic Byes**: Players/teams without games in a round automatically get byes
3. **Database Population**: All Django models are created (Player, Team, TeamMember, Pairings, etc.)
4. **Scoring Calculation**: Call `.calculate()` to run the season's scoring calculations

## Alternative API

For more control, use the TournamentSimulator directly:

```python
sim = TournamentSimulator()
league = sim.create_league("Masters", "M", "lone")
season = sim.create_season("M", "Finals", rounds=2)

carlsen = sim.add_player("Carlsen", 2830)
caruana = sim.add_player("Caruana", 2800)

round1 = sim.start_round(1)
sim.play_game(round1, carlsen, caruana, "1-0")
sim.complete_round(round1)

sim.calculate_standings()
```