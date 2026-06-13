# The tournament system

A small, fixed **system** for running two-sided competitions, plus an open
**registry of kinds** that gives it all of its chess vocabulary. Nothing
tournament-specific is hardcoded: game, series, match, swiss, knockout,
Buchholz, draw odds — every one of them is a registered instance built
through the same public API any third party would use, and the standard set
lives outside the system in `src/chess/`.

This split exists because tournament definitions will be exposed to arbiters
and tournament designers: definitions are plain data, parsed and
cross-validated against a registry with errors that name what went wrong and
what kinds exist; and a new format idea must never require touching the
engine — at most it is a new kind, usually it is just composition.

```text
src/tournament/   THE SYSTEM — no chess vocabulary
  core.ts         the laws: outcomes, seats, paths, the input/work wire protocol, the recursive spine
  registry.ts     the typeclasses: defineEncounterKind / Pairing / Scoring / Metric / Tie / Seed,
                  buildRegistry / extendRegistry, registry-driven parseEventDef
  evaluate.ts     the generic recursive evaluator (asks instances for slots/outcomes/work)
  engine.ts       the input fold, validation, nextActions, public reads
  standings.ts    lines, scoring application, metrics, ranking
  concrete.ts     definition → concrete structure ("how it works"), the display's input
  builder.ts      fluent test driver

src/chess/        THE STANDARD LIBRARY — built outside the system, using it
  encounters.ts   game | series | match
  pairings.ts     roundRobin | swiss (demo) | knockout | manual
  scorings.ts     passThrough (game points) | table (match points, leg-keyed)
  metrics.ts      buchholz, Sonneborn-Berger, extended SB family, board points, …
  ties.ts         draw | drawOdds | manual
  seeds.ts        registration | fixed | rank | placements
  registry.ts     chessRegistry = buildRegistry(all of the above)
  compose.ts      the authoring combinators: named patterns → plain data
  formats.ts      the acceptance catalog, written ON the combinators
  extensions.test.ts  the proof: handicap + arena kinds defined in-test, run end-to-end
```

## The laws (what `core.ts` fixes)

- **Sides and outcomes.** Every encounter is between two sides (0 and 1, in
  definition order) and produces `Outcome = { points: [n, n]; decision }`,
  where a decision is `pending | draw | doubleLoss | win{winner, by, leg?}`.
  `by` is an open vocabulary; two names carry cross-cutting meaning:
  `drawOdds` wins don't count as games won, `forfeit` marks a node unplayed.
- **The seat algebra.** A node holds the white-ish seat; each child derives
  its seat through a repeating `keep`/`flip` cycle or awaits a recorded
  lot-drawing input. Zigzag boards, alternating legs, fixed colors are cycle
  *values*, not concepts: `["keep","flip"]`, `["keep"]`, or any pattern an
  arbiter invents.
- **Node paths.** Competition ids are globally unique within an event, so
  addressing is flat: `comp-<id>[/round-<n>/pair-<n>]` then child segments
  minted by kinds (`leg-2`, `board-1`, `inner-1`, …). Containers never
  appear in paths.
- **The wire protocol.** Inputs (the recorded log the engine folds):
  `pairingsSet`, `lineupSet`, `gameResult` (TRF-style codes incl. forfeits
  and scheduling draws), `manualDecision`, `colorDraw`, `encounterForfeit`.
  Work (what nodes ask of the host): `createGame{white, black, clock}`,
  `awaitLineup`, `awaitManualDecision`. New kinds compose behavior from this
  fixed effect vocabulary.
- **The event spine.** ONE recursive node: `Event → competition`, where a
  `CompetitionDef` is `{ id, name?, entries?, run }` and `run` is a Pool, an
  encounter, or `{ kind: "competitions", competitions: [...] }` — the same
  attributes at every level, so a whole tournament drops into another
  tournament unchanged (GRENKE is a Grand Chess Tour stop by reference). A
  LEAF runs a pool/encounter and must have `entries`; a CONTAINER runs
  sub-competitions and must not. A Pool is N competitors + a pairing ref +
  ONE encounter template + a scoring ref + tiebreak refs. All refs are open
  `{ kind/system/metric: string, … }` payloads owned by their instances. A
  leaf's entries are either a seed list (the field is known) or
  `{ open: true }` — registration-bound, so the definition assumes no count;
  open leaves stay unresolved (awaitSeeding, no pairings) until entries are
  bound, and entrant-count validation waits.
- **The intake DAG.** Seed refs cross-reference source competitions by bare
  id (`rank {of, rank}`, `placements {over, points, rank}`); validation
  walks every seed's declared origins and rejects cycles — definition order
  never constrains references. The event's champion is the DAG's sink: the
  one leaf no other leaf draws entrants from (two sinks — parallel sections,
  an embedded open side event — mean no single champion).
- **Terminology belongs to the definition.** Competitions carry display
  `name`s; pools carry `terms` ("Round"/"pairing" by default — the GCT
  finals call their pairings "match"); encounter kinds accept their own
  vocabulary in their defs (`name`, `legName`, `boardName` on the builtins).
  The system mints structure, never nouns.

## The typeclasses (what `registry.ts` opens)

Authors write instances against their own payload type; `defineX` wraps them
so the registry stores an erased interface whose methods decode the raw def
through the instance's zod schema — memoized per def object, a one-time
parse, never a cast.

- **`EncounterKind`** — the recursion. `schema(deps)` (may embed child
  encounters and tie refs), `nextSlot(def, view, resolved)` for lazy child
  materialization (the engine asks repeatedly, feeding back outcomes),
  `outcome(def, view, children, ties)`, `work(def, view)` (games to create,
  lineups to await), plus capabilities: `structure` (static children for
  validation/UI), `nominalPoints` (forfeit awards), `alwaysDecisive`
  (knockout validation), `rosterNeed`, `card` (how the viewer renders it).
- **`PairingKind`** — `propose(options, ctx)` over a context that carries
  everything a JavaFo TRF encodes (seeds, scores, per-round
  opponent/color/unplayed history, previous round winners); optional
  `totalRounds`, `pairsInRound` (eliminative systems shrink),
  `progression` (rank by survival), `defaultBye`, `validate`.
  Proposals only take effect as recorded `pairingsSet` inputs, so external
  engines (bbpPairings) and manual arbiters use the same door; an
  *unregistered* system is even allowed in a def (rounds then required) —
  pairings are inputs, the engine doesn't need the proposer.
- **`ScoringKind`** — outcome → standings points for one line, with the
  competitor's chronological scored history (streak rules need it).
- **`MetricKind`** — label + value over precomputed standings lines.
- **`TieKind`** — children resolved, sums equal: now what? May request work
  (`manual` awaits the arbiter) and declares whether it guarantees a winner.
- **`SeedKind`** — entry list → competitors, resolving sources through
  `SeedContext.ranking(of)`; pipeline variety lives here (a losers bracket
  is a seed kind, not a spine concept). A kind declares its `origins`
  (source competition ids), which draw the intake edges and feed the DAG
  check.

`buildRegistry(spec)` assembles instances, builds the recursive event schema
*from* them, and binds the recursion helpers. `extendRegistry(base, extra)`
adds kinds. `parseEventDef(data, registry)` brands its output; the engine
only accepts a `ParsedEventDef`, so unvalidated literals can't reach it.

### Adding a kind (the whole job)

```ts
const handicapKind = defineEncounterKind<{ kind: "handicap"; ahead: Side; head: number; of: AnyEncounterDef }>({
  kind: "handicap",
  schema: (deps) => z.object({ kind: z.literal("handicap"), ahead: sideSchema,
                               head: z.number().positive(), of: deps.encounter }),
  nextSlot: (def, _v, done) => done.length === 0
    ? { segment: { label: "inner", n: 1 }, def: def.of, seat: "keep" } : undefined,
  outcome: (def, _v, children) => /* child points + head start, compare */,
  structure: (def) => [{ def: def.of, role: "with a head start" }],
  nominalPoints: (def, ops) => /* … */, alwaysDecisive: () => false,
});
const registry = extendRegistry(chessRegistry, { encounters: [handicapKind] });
```

`src/chess/extensions.test.ts` runs exactly this (plus an arena scoring
kind) end-to-end without touching a single system or library file.

## The engine

```text
materialize(def, inputs, registry) → EventState   // validated fold; bad inputs recorded with reasons, never thrown;
                                                  // corrections are last-write-wins and re-derive everything
nextActions(state)                 → Action[]     // createGame | awaitPairings(ctx) | awaitLineup | awaitManualDecision
                                                  // | awaitColorDraw | awaitSeeding | eventComplete — an idempotent
                                                  // snapshot the host diffs; the engine never retracts a created game
standingsOf(state, poolPath)       → StandingsRow[]  // both points channels per line + metric columns + rank
outcomeAt / evaluatedNodeAt        → strict reads (throw on unresolvable paths; the fold does not)
proposePairings(state, poolPath)   → a ready-to-record pairingsSet input
```

Protections that keep last-write-wins honest: color draws are rejected once
results exist beneath them (results are white-relative); lineups lock once
their match has results; after every fold, accepted pairing rounds are
re-checked against the *final* entrant resolution so corrections that
re-seed a downstream leaf flag orphaned pairings in `state.errors`.

`legRelease: "lockstep"` on a pool holds child N+1 of every pair's encounter
until all pairs resolved child N (heltour's lockstep/upfront knockout
setting) — pure scheduling, generic over kinds.

## The authoring combinators (`src/chess/compose.ts`)

Definitions stay plain data, but nobody writes the wire shapes by hand:
`compose.ts` is a library of NAMED patterns that compose into them — spine
(`event`/`competition`/`container`), intakes (`open`, `seeds`/`seedsFrom`/
`seedsAt`, `top`/`ranks`, `tourTop`), pools (`swiss`/`roundRobin`/
`knockout`), encounters (`game`/`matchOf`/`seriesOf` and the sugar
`bestOf`/`duel`/`untilDecided`), the seat cycles (`alternate`, `sameSeats`,
`drawnSeats`, `zigzag`, `uniformBoards`) and the point tables (`gamePoints`,
`matchPoints`, `pointsTable`, `phased`). Every builder returns the same
`unknown`-shaped literal an arbiter would write; `parseEventDef` validates
the result, so an invalid composition fails at parse with arbiter-grade
errors, never with a cast. The World Championship reads as
`untilDecided(bestOf(14, classical), duel(rapid), duel(blitz), armageddon)`
— and because patterns are values, a whole competition built once (GRENKE)
drops into another event by reference.

## The chess vocabulary (a registry like any other)

- `game` — clock (per-side override = armageddon), optional points schedule,
  tie rule (`drawOdds` makes draws decisive).
- `series` — legs (any encounters), `seats` (cycle or drawn), and `stop`
  combinators: `{}`/absent = play all; `untilScore` (WC match's 7.5);
  `untilMargin` (win-by-2); `untilDecided` (tiebreak chains — inherits the
  deciding leg's winner structurally, because a drawOdds win has no points
  margin to re-compare).
- `match` — N boards of one encounter between two lineups (inputs, never
  defs), board seats from a cycle.
- Scoring: `passThrough` (game points) and `table` (`draw` + per-deciding-leg
  `{win, loss}` rows — one row is plain match points, Norway is
  `[{3,0},{1.5,1}]`; wins without a leg, e.g. forfeits, pay row 0).
- Knockout pairing refuses fields beyond its verified ≤32-entrant bracket
  tables (heltour's recursive fallback mis-seeded larger ones), requires
  power-of-two fields and always-decisive encounters, ranks by progression,
  and emits final-then-bronze in the last round.

The acceptance catalog (`src/chess/formats.ts`, all parsed at import, all
driven end-to-end by tests): armageddon; the World Championship match; the
FIDE World Cup chain; individual swiss; Olympiad team swiss (extended SB);
lichess4545 (board points); Norway Chess; Candidates double round robin; the
WUCC 2026 weekend knockout (two-match ties, lockstep or upfront, arbiter
tiebreaks); groups→knockout with a bronze final; Scheveningen; quads; and
the cascade round — an 8-round team swiss whose every round is two
color-swapped rapid team games (match points only), then a full-team blitz
with drawn colors, then a one-board armageddon: pure composition, including
the per-leg "random color" (singleton untilDecided wrappers with drawn
seats). Sectioned events are parallel leaves in one container —
contemporaneous, separately registered, separately scored: LoneWolf's Open
and U1800, both Candidates tournaments, GRENKE's elite round robin beside
its huge open swiss, Tata Steel's Masters/Challengers/Amateurs.
The Grand Chess Tour rolls whole tournaments into tour standings with two
more registered instances and zero engine changes: a `placements` seed kind
(rankings across many competitions through a points table — the finals seed
from it, and its plural origins draw the flows from every stop) and a
`phased` scoring kind (rapid rounds score 2/1/0, blitz 1/½/0, one combined
standings); the finals' weighted classical/rapid/blitz matches are just
per-game point schedules summing up an until-decided series. The recursion's
proof rides along: the entire GRENKE event — the same `grenkeCompetition`
object the standalone event parses — sits inside the tour as a sixth stop,
its elite round robin feeding the tour standings.

## The concrete domain (`concrete.ts`) and the viewer (`/tournaments`)

Two domains, one conversion. The definition says what the rules are;
`concretify(def, registry)` expands it into the **concrete structure** of
how the tournament works — one recursive `ConcreteCompetition` (a leaf
carries its field, intakes, and rounds → pairings → the encounter recursion;
a container carries its children) as explicit data — by asking the registry
(structure, arrangement, cards, `pairsInRound`, seat derivations, seed
origins). Intakes are id-keyed: every leaf that needs entrants starts from a
generator node (registration, a source competition's standings, a tour
aggregation) whose `from` lists source competition ids. Children tier among
their SIBLINGS: a child whose subtree draws on a sibling's subtree sits one
tier past it, and a source outside the container tiers the container itself
at its own parent's level, recursively — so the tour's stops share tier 0
while the finals sit at tier 1, and a qualifiers→knockout→groups→medals
pipeline reads left to right. Sizes are explicit via `Many<T>`: a collection
either knows all of its items (a bound field materializes every round,
pairing, board) or is open and carries example items plus one faded
continuation ("… pairing n", "… Round n"). Colors are names, not prose: each
node carries `{white, black}` side names — real competitors where the
definition knows them, exemplars ("A" = whoever holds the white seat) where
it doesn't — moved through the seat algebra, so zigzag boards read ⬜A/⬛B
then ⬜B/⬛A; a drawing of lots hides the holder and resets exemplars below
it. When real registrations and pairings exist, a state-bound conversion
will produce the same shapes with every item known and named.

The scoring process is part of the structure: every round carries its
`ConcreteProcess` — the scoring rule's self-description (a new `card`
capability on ScoringKind: "win → 2 · loss → 0 · draw → 1"), the standings
with their tiebreak metric labels, and the pairing system that pairs the
next round (absent after the last). The overview interleaves "score · pair"
steps between rounds; the round level fans every pairing's outcome into
scoring → standings → pair-next.

The viewer only iterates that structure, with in-place zoom: expanding a
card swaps it for a bordered frame holding the next level of resolution
while everything else stays put — siblings shift to make room, and every
edge keeps pointing at the same id, so the "32 advance" arrow lands on the
expanded knockout frame and one canvas can mix altitudes (a container
opened beside collapsed siblings, rounds beside an opened round, a pairing
opened to its boards). ONE recursive item draws every competition. A leaf's
collapsed face is its card — name, entrants, schedule badge, scoring,
inflow lines; the card IS the lane header — and expanded it becomes a frame
holding its lane (the rounds cycle with its standings·pair-next process
icons, knockout brackets pairing-to-pairing when adjacent rounds are open)
or its encounter recursion. A container's collapsed face lists its
children; expanded, its frame holds intake icons and the children laid out
by sibling tier. Within a frame, a round is its pairings feeding the
scoring rule; a node is its immediate children, "then"-chained or stacked
per arrangement, ghosts faded. Intake edges always target the most specific
visible node: the intake icon and leaf card where rendered, the deepest
visible ancestor's card where folded away, a lane's `/out` end where the
source frame is open. Conditional transitions are logic gates: kinds
surface their stop rules per child (`StructureChild.gate` — "still tied?" /
"first to 7.5 wins"), and the display draws a gate node whose "yes"
continues to the next leg and whose "no" exits — so a World Championship
visibly ends at the first decided gate. Clicking a frame folds it back into
its card. One stateless rule replaces special cases: an item that is the
only drillable thing at its level renders pre-expanded and cannot collapse
— the root always, an only child, an encounter leaf's run — so a
single-competition event opens at its rounds structurally.

## Out of scope (unchanged)

No persistence/API wiring; no real bbpPairings adapter (the PairingContext
is TRF-sufficient; the adapter is host-side and async); no registration-time
entry inputs or withdrawals; no rating calculation. Result corrections
re-derive everything; reconciling already-created lichess games is the
host's job.
