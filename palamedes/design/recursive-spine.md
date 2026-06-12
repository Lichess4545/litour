# The recursive spine — migration spec

Status: IN PROGRESS. This replaces Event→stages→groups with ONE recursive
node. Source of truth for the migration; delete this file when done and
fold the result into tournament-model.md.

## The one node

```ts
// core.ts
export type CompetitionDef = {
  readonly id: string;                    // globally unique within the event
  readonly name?: string | undefined;     // display; id stays structural
  readonly entries?: EntriesDef | undefined; // intake; REQUIRED on leaves, FORBIDDEN on containers
  readonly run: RunDef;
};
export type CompetitionsDef = {
  readonly kind: "competitions";
  readonly competitions: readonly CompetitionDef[]; // ≥1
};
export type RunDef = PoolDef | AnyEncounterDef | CompetitionsDef;

export type EventDef = {
  readonly id: string;
  readonly name: string;
  readonly competitors: readonly CompetitorDef[];
  readonly competition: CompetitionDef;   // the root (usually a container)
};
```

A "leaf" competition runs a pool or an encounter; a "container" runs
sub-competitions. Same attributes at every level — a whole tournament drops
into another tournament unchanged. EntriesDef unchanged
(`readonly SeedRef[] | { open: true }`).

## Node paths (wire protocol change)

Globally-unique competition ids ⇒ flat addressing; containers never appear
in paths:

```
comp-<id>(/round-<n>(/pair-<n>)?)?(/<label>-<n>)*
```

- `compRootPath(id)` replaces `groupRootPath(stage, group)`.
- CHILD_LABEL lookahead excludes `comp|round|pair`.
- PathSegment: `{kind:"comp"; id}` replaces stage+group segments.

## Seed refs (cross-references by competition id)

- rank:        `{ kind: "rank", of: <compId>, rank }`
- placements:  `{ kind: "placements", over: readonly <compId>[], points, rank }`
- SeedOrigin:  `{ readonly of: string; readonly rank?: number | undefined }`
- SeedContext.ranking(of: string)
- SeedValidateContext: `{ competitors, sizes: ReadonlyMap<string, number | "open">, self: string }`
  (sizes covers every LEAF competition id; `self` = the consuming leaf, for
  cycle messages).

## Validation (registry.ts)

- Competition ids globally unique (containers and leaves share namespace).
- Leaf ⇒ `entries` required; container ⇒ `entries` forbidden.
- Encounter leaf ⇒ exactly 2 entries (closed).
- Intake DAG must be acyclic: edges consumer→source from every seed kind's
  `origins`; report any cycle by ids. (Replaces "earlier stage" ordering —
  definition order no longer constrains references.)
- Pool checks unchanged.

## Engine (engine.ts + friends)

- `CompRef = { comp: CompetitionDef, path: NodePath }`; `allLeaves(def)`
  walks `event.competition` (containers contribute nothing but their
  children).
- `findCompetition(def, id)`, `resolveEntrants(state, ref)` (unchanged
  semantics), `groupRanking` → `rankingOf(state, ref)`.
- Action `awaitSeeding {stage, group}` → `{ competition: <id> }`.
- `eventWinner`: the DAG's sink — leaves that are no other leaf's intake
  source; if exactly one, its ranking[0]; else undefined.
- builder.ts / standings.ts / evaluate.ts: mechanical path + ref updates.

## Authoring helpers (`src/chess/compose.ts`) — REQUIRED DELIVERABLE

Plain-data builders (no casts; output is `unknown`-shaped literals parsed by
`parseEventDef`). Patterns are NAMED and COMPOSED:

```ts
// spine
event(id, name, competitors, competition)
competition(id, name, entries, run)        // leaf
container(id, name, ...competitions)       // {kind:"competitions",...}
// intakes
open                                        // { open: true }
seeds(n) / seedsFrom(start, n)              // registration slots
top(of, n)                                  // rank refs 1..n
ranks(of, ...ns)
tourTop(over, points, n)                    // placements refs 1..n
// pools (terms/bye/tiebreaks via opts)
swiss(rounds, encounter, score, opts?)
roundRobin(cycles, encounter, score, opts?)
knockout(encounter, opts?)                  // {seeding, thirdPlace, rounds(truncation), score, ...}
// encounters
game(clock, opts?) · matchOf(boards, board, opts?) · seriesOf(legs, opts?)
bestOf(n, game) · duel(game) · untilDecided(...legs)
```

formats.ts is REWRITTEN on these helpers — that's the proof the patterns
compose (grenke inside grandChessTour must be possible by reference).

## Concrete layer (concrete.ts)

```ts
export type ConcreteCompetition = {
  id, title, entrants ("open" | n | undefined for containers),
  card: ConcreteCard,                  // its face at the parent's level
  intakes: readonly ConcreteIntake[],  // from: readonly string[] (comp ids)
  tier: number,                        // among SIBLINGS (per container)
  run: ConcreteRoundsRun
     | { kind: "encounter"; node: ConcreteNode }
     | { kind: "competitions"; competitions: readonly ConcreteCompetition[] };
};
export type ConcreteEvent = { root: ConcreteCompetition };
```

ConcreteIntake.from: `readonly string[]` (competition ids). Tiers computed
per container over its children using intake sources (sources may sit in
other containers — tier contribution only from SIBLING ids; cross-container
sources tier the CONTAINER, recursively: a child's external source lifts the
containing sibling's tier).

## Display (def-graph.ts)

One recursive `competitionItem`:
- leaf collapsed = card (name, entrants, system · rounds, scoring, inflow
  lines); expanded = frame containing the existing lane body (rounds cycle,
  brackets, process icons).
- container collapsed = card listing children; expanded = frame containing
  intake icons + tier-laid child competition items + intra-container intake
  edges. Root renders via the single-drillable rule (force-expanded).
- Intake edges target the most specific visible node (id-addressed:
  `s:<id>` card/frame, `s:<id>/hdr` not needed anymore — the leaf card IS
  the header; lane end keeps `/out`).

## Checklist

- [ ] core.ts spine + paths
- [ ] registry.ts schema + validation (uniqueness, leaf/container entries, DAG)
- [ ] seeds.ts new ref shapes; registry SeedOrigin/contexts
- [ ] engine.ts addressing + actions + eventWinner sink
- [ ] evaluate.ts / standings.ts / builder.ts mechanical updates
- [ ] chess/compose.ts helpers
- [ ] formats.ts rewritten on helpers (all existing formats preserved)
- [ ] concrete.ts ConcreteCompetition recursion
- [ ] def-graph.ts + tournament-flow.tsx recursive rendering
- [ ] all tests migrated and green; browser-verified; docs folded in
