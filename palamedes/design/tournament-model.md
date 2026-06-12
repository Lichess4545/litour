# The tournament meta-model

A recursive, data-driven model that can represent — and run — every chess
tournament format we could find: from a single armageddon game to the FIDE
World University Team Championship (two online team-swiss qualifiers → a
32-team online knockout of two-match team series → over-the-board finals with
four double-round-robin groups feeding a knockout with a third-place playoff).

Arbiters author tournament **definitions as data** (JSON, validated by zod).
The engine is a pure fold over an ordered **input log** (pairings, lineups,
game results, arbiter decisions, color draws). The host system feeds results
in and reads out which games to create next (players, colors, clocks), which
decisions are awaited, and live standings.

Code: `src/tournament/`. Interactive visualizations: `/tournaments` in the app.

## Why (lessons from `heltour/tournament_core/`)

The previous pure-Python model failed to generalize because it encoded
*composition* as *flags*:

- `Match` meant three different things — one game, N team boards, a best-of-N
  knockout leg — selected by a `games_per_match` flag.
- Team byes were faked as synthetic half-win/half-draw games.
- Zigzag board colors were hardcoded in the builder.
- Multi-match knockouts were encoded with pairing-order modular arithmetic
  (`multi_match.py`), and "lockstep vs upfront" match generation leaked into
  the data model.

Every one of those is structural here: a team match is a node *containing*
board games; a two-match knockout tie is a series *containing* two matches; a
bye is configuration; colors are a law each node applies to its children.

## The model: two sorts of things

- An **Encounter** is a contest between two sides that produces a two-sided
  `Outcome`. Encounters are recursive: `Game | Series | Match`.
- A **Pool** is N competitors scheduled into encounters by a pluggable
  pairing system, producing `Standings`.

The two cannot collapse into one node kind: an encounter's output is a
two-sided outcome (so it can nest inside knockouts and tiebreak chains); a
pool's output is a ranking. The recursion lives entirely in the Encounter
sort — a pool's encounter *template* may be a game, a best-of-N series, a
4-board team match, or a series of team matches.

An **Event** is a thin, deliberately *non-recursive* list of stages. Each
stage holds parallel groups (quads, the WUCC group stage, Corporate's
east/west pools); each group runs one Pool *or* one root Encounter (the World
Championship match is "a tournament with two players" — a root encounter).
Seed rules carry competitors between stages ("winner of group A").

```text
EventDef
 └─ stages[]                  sequenced; seeding flows between
     └─ groups[]              parallel pools/encounters within a stage
         └─ PoolDef | EncounterDef
             PoolDef.encounter: EncounterDef        ← template, instantiated per pairing
             EncounterDef = GameDef | SeriesDef | MatchDef   ← the recursion
```

## Definition types

All defs are immutable data with zod schemas (`parseEventDef`). Optional
fields are written `?: T | undefined` (the scaffold uses
`exactOptionalPropertyTypes`).

```ts
type Side = 0 | 1;                  // the two sides of any encounter, in definition order
type Color = "white" | "black";
type CompetitorId = string;        // branded; a player OR a team — the core never distinguishes
type PlayerId = string;            // branded; only Match lineups know players exist

type TieRule =
  | { kind: "draw" }                       // a tie is a final, legal result (default)
  | { kind: "drawOdds"; color: Color }     // games only: the side holding `color` wins a draw (armageddon)
  | { kind: "manual" };                    // stays pending until an arbiter `manualDecision` input

type GameDef = {
  kind: "game";
  clock: { initial: number; increment: number;          // seconds
           whiteInitial?: number; blackInitial?: number }; // per-side override = armageddon
  points?: { win: number; draw: number; loss: number };    // default 1 / 0.5 / 0
  tie?: TieRule;
};

type SeriesDef = {                  // ORDERED legs between the SAME two sides
  kind: "series";
  legs: EncounterDef[];             // heterogeneous: classical set, rapid set, armageddon…
  stop: { kind: "all" }                          // play every leg (2-game World Cup sets, return matches)
      | { kind: "firstTo"; points: number }      // stop when a side's running sum reaches p (WC match: 7.5)
      | { kind: "untilDecisive" };               // tiebreak chains: stop at the first leg with a winner
  colors: "alternate"               // leg i flips the parent seat i times (mini-matches, double-RR legs)
        | "fixed"                   // every leg inherits the parent seat (Norway armageddon)
        | "redraw";                 // each leg awaits a colorDraw input (World Cup: fresh lots per segment)
  tie?: TieRule;
};

type MatchDef = {                   // PARALLEL boards between two ROSTERS
  kind: "match";
  boards: number;                   // lineups arrive as INPUTS, never in the def
  board: EncounterDef;              // per-board contest (a GameDef in every real format)
  colors: "zigzag"                  // board 1 takes the team seat, board 2 flips, … (even boards swap)
        | "uniform";                // every board takes the team seat (Scheveningen legs)
  tie?: TieRule;
};

type EncounterDef = GameDef | SeriesDef | MatchDef;

type PoolDef = {
  kind: "pool";
  pairing: { system: "roundRobin"; cycles: 1 | 2 }
         | { system: "swiss" }                                  // proposer: naive demo; real events use bbpPairings/JavaFo host-side
         | { system: "knockout"; seeding: "traditional" | "adjacent" | "manual"; thirdPlace?: boolean }
         | { system: "manual" };
  rounds?: number;                  // required for swiss/manual; derived for roundRobin/knockout
  encounter: EncounterDef;          // ONE template per pairing — the whole recursion hook
  score: ScoreRule;                 // outcome → standings points (the ONLY re-mapping point)
  bye?: { kind: "points"; standings: number; encounter: number }   // never synthetic games
      | { kind: "advance" };                                       // knockout free pass
  legRelease?: "independent" | "lockstep";   // scheduling of series legs across sibling pairs; never affects scoring
  tiebreaks: MetricRef[];          // knockout pools automatically rank by elimination depth instead of points
};

type ScoreRule =
  | { kind: "encounterPoints" }                                  // pass sums through (= game points)
  | { kind: "perEncounter"; win: number; draw: number; loss: number }   // match points 2/1/0, 3/1/0, …
  | { kind: "byLeg"; legs: { win: number; loss: number }[]; draw?: number };
    // keyed by the DECIDING leg: Norway = [{win 3, loss 0}, {win 1.5, loss 1}]

type SeedSource =
  | { kind: "registration"; seed: number }                       // 1-based index into competitors
  | { kind: "fixed"; id: CompetitorId }                          // e.g. the reigning champion
  | { kind: "rank"; stage: string; group: string; rank: number };// "winner of group A" (1-based)

type EventDef = {
  id: string;
  name: string;
  competitors: { id: CompetitorId; name: string; rating?: number; roster?: PlayerId[] }[];
  stages: { id: string;
            groups: { id: string; entries: SeedSource[]; run: PoolDef | EncounterDef }[] }[];
};
```

zod refinements enforce, among others: unique ids; knockout groups sized to a
power of two; knockout encounters guaranteed to produce a winner (a manual
tie rule, draw odds, or an untilDecisive series ending in armageddon);
`rounds` present exactly where required; `firstTo` targets reachable from the
legs' point schedules; `byLeg` length matching the series; `drawOdds` only on
games; root-encounter groups having exactly two entries; rosters at least as
long as the deepest `boards` when the encounter contains a match; point
values on quarter-point boundaries (sums are compared exactly). `parseEventDef`
brands its output — the engine only accepts a `ParsedEventDef`, so unvalidated
literals cannot reach it.

## Outcome semantics: aggregate → decide → emit

Every materialized encounter node derives one `Outcome`:

```ts
type Decision =
  | { kind: "pending" }
  | { kind: "draw" }
  | { kind: "doubleLoss" }          // 0F-0F: distinct from draw so match points map it to a loss for both
  | { kind: "win"; winner: Side; by: "points" | "drawOdds" | "forfeit" | "manual"; leg?: number };

type Outcome = { points: [number, number]; decision: Decision };  // points in definition-side order
```

- **aggregate** — there is exactly one aggregator everywhere: component-wise
  *sum* of children's points. (Checked against every format below; nothing
  needs anything else.)
- **decide** —
  - *game*: points from the schedule by result. A drawn game under
    `drawOdds(color)` keeps ½–½ points but its decision is a win for the side
    holding that color.
  - *match / series `all`*: pending until every child resolves, then compare
    sums; equal sums go to the `TieRule` (`manual` → pending until an arbiter
    `manualDecision`).
  - *series `firstTo(p)`*: a side reaching p wins immediately — later legs
    never materialize. Exhausting every leg below p decides by total points;
    an equal total goes to the tie rule — default **draw**, which is exactly
    the signal an enclosing chain needs to continue.
  - *series `untilDecisive`*: legs materialize lazily; the first leg whose own
    decision is a win decides the series, which **inherits that winner
    structurally** (recording the deciding `leg` index). This rule is
    load-bearing: an armageddon decided on a draw has *zero points margin*,
    so re-comparing sums could not decide the chain.
- **emit** — composites always pass their sums upward. The only re-mapping in
  the whole system is the pool's `ScoreRule`: the same 4-board match template
  yields match points 2/1/0 in team swiss, 3/1/0 in a football-scored league,
  raw board points in a board-points-primary league, or pure advancement in a
  knockout — by pool configuration alone. `byLeg` (keyed on the deciding leg)
  gives Norway its 3 / 1.5 / 1 / 0 while the game records stay standard 1/½/0.

Standings keep **both channels** per round line: the encounter outcome
(game/board points) *and* the applied score-rule points (match points), plus
per-board detail for team matches — so Olympiad extended-Sonneborn-Berger,
lichess4545 board-N points, and games-won tiebreaks all compute from lines
without re-walking encounter trees.

## Colors

One rule: every materialized encounter node has a `whiteSeat: Side` flowing
top-down; game leaves bind it to the pieces.

1. Pool pairings assign the seat per pair (`PairingPlan.whiteSeat`) — swiss
   engines emit colors, Berger tables fix them, knockouts default to seed
   order.
2. A root encounter's seat comes from an optional `colorDraw` input at its
   path (defaults to side 0).
3. Series legs transform the parent seat: `alternate` flips per leg, `fixed`
   inherits, `redraw` awaits a `colorDraw` input at the leg's path — the
   World Cup's fresh drawing of lots before each tiebreak segment.
4. Match boards: `zigzag` gives board 1 the team seat and flips even boards
   (exactly heltour's `pairinggen.py` behavior); `uniform` gives every board
   the team seat.
5. The game leaf: the `whiteSeat` side plays white; `drawOdds` resolves
   against this binding.

Randomness is never ambient: a drawing of lots is a *recorded input*, so the
fold is replayable.

## Byes and forfeits — first-class, never synthetic games

- A pool bye is a `{ kind: "bye" }` pairing entry. Its points come from the
  pool's `bye` config: `{standings: 1, encounter: 2}` is an Olympiad-style
  draw-equivalent team bye; `{standings: 1, encounter: 1}` a full-point
  individual bye; `advance` a knockout free pass (the competitor advances in the bracket; a
  bye never materializes an encounter node, and earns no points).
- Game forfeits are result codes (`1X-0F`, `0F-1X`, `0F-0F`, `1/2Z-1/2Z`)
  scoring per the game's schedule, flagged so pairing history (and TRF
  export) can mark them unplayed.
- A whole-side no-show is one `encounterForfeit` input on a game or match
  node: nominal-max points, decision `win by "forfeit"`, no games created.

## The engine: a pure fold over inputs

```ts
type Input =
  | { kind: "pairingsSet";      pool: NodePath; round: number; pairings: PairingPlan[] }
  | { kind: "lineupSet";        match: NodePath; side: Side; players: PlayerId[] }
  | { kind: "gameResult";       game: NodePath; result: "1-0" | "0-1" | "1/2-1/2"
                                               | "1X-0F" | "0F-1X" | "0F-0F" | "1/2Z-1/2Z" }
  | { kind: "manualDecision";   node: NodePath; winner: Side }
  | { kind: "colorDraw";        node: NodePath; whiteSeat: Side }
  | { kind: "encounterForfeit"; node: NodePath; winner: Side };

materialize(def, inputs)            → EventState        // validates each input; rejects with reasons; results are last-write-wins
outcomeAt(state, path)              → Outcome           // throws on unresolvable paths (reads are strict; the fold is not)
standingsOf(state, poolPath)        → StandingsRow[]    // points + tiebreak columns + rank (or knockout progression)
nextActions(state)                  → Action[]          // createGame | awaitPairings | awaitLineup | awaitManualDecision
                                                        // | awaitColorDraw | awaitSeeding | eventComplete
proposePairings(state, poolPath)    → ProposeResult     // ok: a ready-to-record pairingsSet input — closes the loop
                                                        // for auto-accept workflows and tests
```

`NodePath` is a stable, serializable address:
`stage-<id>/group-<id>/round-<n>/pair-<n>/leg-<n>/board-<n>` (encounter
segments only as deep as the def nests).

Pairings are **inputs, not engine calls**. The real workflow is generate →
review → maybe regenerate, and JavaFo runs out of process — so the fold stays
total and replayable regardless of plugin behavior, and manual pairing is the
degenerate case (the arbiter authors `PairingPlan[]` directly).

Three protections keep last-write-wins honest: a `colorDraw` is rejected once
results exist under its node (results are white-relative — a re-draw would
flip them); lineups lock once their match has a result; and after every fold
the engine re-checks each accepted pairing round against the *final* entrant
resolution, flagging pairings orphaned by corrections in their seeding source
(`state.errors`).

Game creation gates, in order: pairings exist for the round → both lineups
submitted (team matches) → the leg is released (stop rule; plus pool
`legRelease: "lockstep"`, which holds leg N+1 until *all* sibling pairs
finish leg N — heltour's lockstep/upfront knockout setting, now pure
scheduling) → colors resolved → no result yet. `nextActions` is an idempotent
snapshot the host diffs against what it already created; the engine never
retracts a created game.

## Pairing plugins

```ts
type PairingPlan =
  | { kind: "pair"; a: CompetitorId; b: CompetitorId; whiteSeat: Side }
  | { kind: "bye"; competitor: CompetitorId };

type PairingSystem = (ctx: PairingContext) => { ok: true; pairings: PairingPlan[] }
                                            | { ok: false; error: string };
```

`PairingContext` carries: competitors in seed order (with ratings), current
standings points, per-competitor history (opponent, color, points, forfeit
and bye flags per round), round / total rounds, and the previous round's
pairings + winners (knockouts). This is exactly the information heltour
serializes into a JavaFo TRF file (`generate_trf_content` in `heltour/tournament/pairinggen.py`) — a real
bbpPairings/JavaFo adapter is a host-side async function against the same
context; it is out of scope here.

Included systems (a plain object map — no registries):

- **roundRobin** — Berger tables via the circle method (canonical n=4 table:
  R1 1-4, 2-3; R2 4-3, 1-2; R3 2-4, 3-1); odd fields get a rotating bye;
  `cycles: 2` replays with colors reversed.
- **swiss** — a deliberately *naive* demo: fold score groups, avoid
  rematches greedily, alternate due colors, bye to the lowest-scored player
  without one.
- **knockout** — round 1 from seeding (`traditional` uses the verified
  bracket-order tables ported from `heltour/tournament_core/knockout.py` so 1
  and 2 can only meet in the final — fields beyond 32 entrants are refused
  until a verified table exists, because heltour's recursive fallback
  mis-seeded them; `adjacent` pairs 1v2, 3v4; `manual` expects the arbiter to
  submit round 1). Round k+1 pairs the decided winners in bracket order —
  pull-based and lazy, so pairings always reference concrete competitors (no
  "winner of slot 3" futures in the core). `thirdPlace` emits a bronze
  pairing after the final; the last round must list the final as pair 1 and
  the bronze as pair 2 (the order the proposer emits).
- **manual** — no proposer; pairings are authored inputs.

## Tiebreak metrics

One signature over precomputed standings lines:
`(row, allRows, config) → number`. Implemented:

| metric | meaning |
| --- | --- |
| `encounterPoints` | game/board points as a tiebreak over match points |
| `matchWins` | encounters won (lichess4545 "rounds won") |
| `gamesWon` | leaf games actually won (armageddon draw-odds wins don't count) |
| `boardPoints(n)` | points scored on board n (lichess4545 board 1..4 tiebreaks) |
| `buchholz(cut?)` | sum of opponents' totals; byes contribute own total (FIDE virtual opponent); `cut` drops the lowest |
| `sonnebornBerger` | beaten opponents' totals + half of drawn opponents' totals |
| `extendedSB(opponentTotal, scored)` | Σ opponent total (MP or GP) × points scored against them (MP or GP) — one function covering FIDE's EGGSB / EMMSB / EMGSB / EGMSB family; the GP×GP form applies the FIDE Art. 16.4 virtual-opponent bye rule |
| `headToHead` | points among the tied group, only when every tied pair has played |

Ranking is lexicographic: standings points, then each tiebreak in order, ties
sharing a rank. Knockout pools use `rank: "progression"` (champion, finalist,
bronze winner/loser or tied semifinalists, then by elimination round).

## Acceptance table — every format as a def

| format | definition |
| --- | --- |
| Armageddon game | `game({ clock: { whiteInitial: 600, blackInitial: 420, increment: 0 }, tie: drawOdds("black") })` |
| Mini-match (best-of-N) | `series({ legs: repeat(game(tc), n), stop: all, colors: alternate })` |
| FIDE World Cup | knockout pool; encounter = `series({ legs: [duel(classical), duel(rapid25), duel(rapid10), duel(blitz5), game(armageddon)], stop: untilDecisive, colors: redraw })` where `duel(tc)` is a 2-game `alternate` series |
| World Championship match | root encounter: `series({ legs: [series({ legs: repeat(game(classical), 14), stop: firstTo(7.5), colors: alternate }), duel(rapid), duel(blitz), game(armageddon)], stop: untilDecisive, colors: redraw })` — 7–7 makes the classical leg a *draw*, so the chain continues; 7.5 stops everything |
| Individual swiss (LoneWolf) | swiss pool; encounter = `game(classical)`; `score: encounterPoints`; `bye: {standings: 1, encounter: 1}`; tiebreaks `[sonnebornBerger, buchholz, headToHead]` (a `cut` parameter drops the lowest opponents) |
| Team swiss (Olympiad) | swiss pool; encounter = `match({ boards: 4, board: game(classical), colors: zigzag })`; `score: perEncounter(2,1,0)`; `bye: {standings: 1, encounter: 2}`; tiebreaks `[extendedSB(gp,gp), encounterPoints, gamesWon]` |
| lichess4545 | as Olympiad with 8 boards and tiebreaks `[matchWins, gamesWon, boardPoints(1..4)]` |
| Board-points-primary league (Bundesliga style) | same encounter; `score: encounterPoints`; match points relegated to a tiebreak |
| Norway Chess | round-robin pool; encounter = `series({ legs: [game(classical), game(armageddon)], stop: untilDecisive, colors: fixed })`; `score: byLeg([{win 3, loss 0}, {win 1.5, loss 1}])` |
| Candidates (double RR) | `roundRobin(cycles: 2)` pool over `game(classical)` |
| WUCC 2026 weekend knockout (this repo's live event) | knockout pool (manual seeding); encounter = `series({ legs: [match(4 boards, zigzag), match(4 boards, zigzag)], stop: all, colors: alternate, tie: manual })`; `legRelease` lockstep or independent; aggregate board points decide; a tie awaits the arbiter's `manualDecision` |
| WUCC full event / FIDE Corporate | stages: swiss qualifier pool(s) → knockout seeded by `rank(...)` → four double-RR groups in parallel → `knockout({ thirdPlace: true })` seeded A1, B2, C1, … |
| Scheveningen | `series({ legs: repeat(match({ colors: uniform }), k), stop: all, colors: alternate })` — lineups rotate via inputs |
| Quads | one stage, parallel 4-player round-robin groups |
| Lichess arena | *representable, deliberately not implemented*: continuous pairing plus a chronological score fold (streak doubling, berserk bonus from result metadata); nothing in the core forbids it |

## What this is not (v1 scope)

- No persistence, API, or UI integration — the host owns the `path → lichess
  game id` mapping and feeds results back as inputs.
- No real bbpPairings/JavaFo adapter (the `PairingContext` is provably
  TRF-sufficient; the adapter is host-side and async).
- No registration-time entry inputs, withdrawals mid-pool, or lineup
  composition constraints (WUCC's "at least one female and one male player"
  becomes a lineup-validation predicate later).
- No rating calculation.
- Result corrections are last-write-wins and recompute everything derived;
  the engine never retracts created games — reconciliation is the host's job.

## Files

```text
src/tournament/
  def.ts        ids, paths, definition types, zod schemas, parseEventDef
  inputs.ts     input union, result codes, input schemas
  outcome.ts    the recursive evaluator (aggregate/decide/emit, colors, forfeits)
  standings.ts  round lines, score rules, tiebreak metrics, ranking
  pairing.ts    PairingSystem + roundRobin/swiss/knockout/manual proposers
  engine.ts     materialize (input fold + validation), nextActions, proposePairings
  builder.ts    fluent test driver + standings assertions
  formats.ts    the acceptance table above as executable definitions
  *.test.ts     unit, end-to-end format scripts, fast-check properties
```

Run from `palamedes/`: `bun run test` · `bun run typecheck` · `bun run lint`.
