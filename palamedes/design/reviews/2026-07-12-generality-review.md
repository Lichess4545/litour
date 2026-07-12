# Generality review: can the persisted data model carry everything the code can?

Date: 2026-07-12 · Branch: `palamedes-persistence` · Scope: the definition
changelog (`src/tournament/changes/`, `src/server/tournament/change-store.ts`,
`prisma/schema.prisma`) measured against the full code-based representation
(`src/tournament/`, `src/chess/`, the viewer) under the mandate:

> "I want EVERYTHING to be fully DATA driven — everything from new tiebreaks
> to new tournament types should be definable from data. The new display
> mechanisms should run off of this data."

Verdict in one line: **everything composed from the registered vocabulary is
already pure, persistable data — but the vocabulary itself (kinds, pairing
systems, tiebreak/scoring catalogs) is TypeScript, and the changelog has no
change type that could ever carry a new vocabulary entry.** The expression
language makes tiebreaks and scorings data-*shaped*, but no wire door exists
to author one: `exprSchema` is exported and referenced by nothing
(`src/tournament/expr/schema.ts:12` is its only non-test occurrence in `src/`).

---

## A. Inventory — fully data-representable today

1. **The whole definition spine.** `EventDef` → `CompetitionDef` (recursive
   containers/leaves) → `PoolDef`/encounter trees, entries (seed lists or
   `{open: true}`), competitors with ratings and rosters — all plain JSON
   validated by registry-built schemas (`src/tournament/core.ts:411–479`,
   `src/tournament/registry.ts:875–958`). Ref payloads are open
   `{kind/system/metric: string, …}` objects owned by their instances
   (`core.ts:380–401`), so a def never names a TS symbol.
2. **No closures can leak into a def.** `admitDefData` bounds depth/nodes and
   `structuredClone`s, refusing "non-data values" with a typed reason
   (`registry.ts:1393–1430`). Persisted ≡ authorable, by construction.
3. **The authoring surface compiles to wire data.** Every `compose.ts`
   combinator and the fluent layer return "the same `unknown`-shaped literal
   an arbiter would write" (`src/chess/compose.ts:1–29`); plans are authoring
   ephemera, not stored constructs. Seat cycles, stop rules
   (`untilScore`/`untilMargin`/`untilDecided`), per-game point schedules,
   armageddon clocks, `terms` vocabulary — all def fields
   (`src/chess/encounters.ts:84–91,200–216`).
4. **The whole format catalog round-trips through the changelog.** 24
   definitions (21 `FORMAT_EXAMPLES` entries + `candidates`,
   `lichess4545Season`, `wuccKnockoutUpfront`) decompose → append →
   `readDefinition` ≡ original
   (`src/server/tournament/format-round-trip.test.ts:23–59`), and stored defs
   drive the engine identically
   (`src/server/tournament/engine-differential.test.ts`). The live
   lichess4545 leagues are seeded from the same door
   (`src/server/tournament/seed.ts`, `src/chess/leagues.ts`).
5. **New pairing procedures need zero code *today*.** An unregistered pairing
   system is legal in a def as long as `rounds` is declared — pairings arrive
   as recorded `pairingsSet` inputs, and "the engine doesn't need the
   proposer" (`registry.ts:1326–1336`, `core.ts:260–267`). This is the one
   typeclass with a genuine data/manual escape hatch already shipped.
6. **Tiebreak and scoring *formulas* are data.** Every builtin metric and
   scoring rule is an `Expr` (37 ops: arithmetic, comparison, `if/match/let`,
   `map/filter/sortBy/take/drop/concat/scan`, reducers, substrate accessors —
   `src/tournament/expr/ast.ts:54–151`) evaluated by a total, step-bounded,
   cast-free evaluator, differential-pinned against the legacy oracles
   (`src/chess/tiebreaks/definitions.ts`, `src/chess/scoring-rules/definitions.ts`).
7. **Ranking is programmed by the def.** `refineRanking` re-partitions
   still-tied blocks criterion by criterion; "the pool's ordered tiebreak
   refs ARE the ranking program", with each metric seeing the live tied group
   (`src/tournament/standings.ts:359–421`).
8. **The display input is serializable data.** `concretify(def, registry)`
   yields `ConcreteEvent` — plain recursive data; "a display iterates this
   structure; it never touches a definition or the registry"
   (`src/tournament/concrete.ts:20–32,675–691`). `def-graph.ts` is layout
   only (`src/components/tournament/def-graph.ts:16–40`); unknown kind chips
   degrade to a puzzle icon (`tournament-flow.tsx:77–97`). Tiebreak formulas
   render generically via `describeExpr`
   (`src/tournament/expr/describe.ts:29`, `concrete.ts:300–316`).
9. **The changelog machinery itself is sound and general at its level.**
   Total fold with typed `FoldError`s (`src/tournament/changes/fold.ts:334`),
   registry-parameterized payload schemas
   (`src/tournament/changes/schema.ts:14`), batch-atomic append gated by
   fold + `safeParseEventDef` (`change-store.ts:141–155`), OCC via
   `@@unique([streamId, version])` (`prisma/schema.prisma:100`), and a
   deterministic `submit` retry loop (`change-store.ts:304`).

The 10-type `DefChange` union (`src/tournament/changes/types.ts:10–49`)
covers create/rename, competitor add/update/remove (with insert index),
competition add/rename/remove, `run-set`, `entries-set`. Combined with
`definitionToChanges` (`decompose.ts:10–21`), **any `EventDef` expressible
over the registered vocabulary can be created, stored, edited, and rehydrated
purely from changes.** That answer is unconditionally yes — *within* the
vocabulary. Every gap below is about the vocabulary and its evolution.

---

## B. Gap findings

### G1 — The kinds themselves are code; the changelog cannot carry one. (Severity: HIGH — this is the mandate's "new tournament types" clause)

The six typeclasses are TS values holding functions: an encounter kind is
`nextSlot`/`outcome`/`work`/`validate`/`structure`/… (`registry.ts:399–425`);
a pairing kind is `propose`/`totalRounds`/`flows`/… (`registry.ts:460–486`);
`RegistrySpec` is arrays of these values (`registry.ts:669–676`), assembled at
build time (`src/chess/registry.ts:21–28`). The extensibility proof itself is
code: handicap and arena kinds are `defineEncounterKind`/`defineScoringKind`
calls in a test (`src/chess/extensions.test.ts:35,94,121`). Nothing in
`DefChange` (types.ts:10–49) or the `DefinitionChange` row
(schema.prisma:91–102) can represent a kind.

What is data-expressible today vs. irreducibly code, per typeclass:

| Typeclass | Data today | Irreducibly code today |
| --- | --- | --- |
| Encounter | composition (any tree of game/series/match, stop rules, seats, per-leg points) | outcome aggregation + lazy `nextSlot` for a *new* shape (e.g. handicap head start) |
| Pairing | **manual/unregistered door: full generality with zero code** (registry.ts:1326) | `propose` algorithms, bracket tables (`pairings.ts:185–200`), `flows`/`pairLabels` |
| Scoring | passThrough/table/phased params | a new *rule family* (streak scoring — see G3e) |
| Metric | ref params (cut, board, channels) over a **closed** catalog | a new metric (see G2) |
| Tie | draw/drawOdds/manual params | a new tie procedure |
| Seed | registration/fixed/rank/placements params | a new intake pipeline (`seeds.ts:75–142`) |

Honest calibration: composition is enormously expressive — all 24 catalog
formats, the World Championship, the Grand Chess Tour needed zero new kinds.
A user defining "a brand-new tournament type via the API" is blocked
specifically on: (a) new encounter *aggregation semantics*, (b) automated
pairing algorithms (manual pairing is the workaround), (c) new
scoring/metric/tie/seed *families*.

**Remediation direction.** Don't try to make pairing algorithms data (the
manual door already covers correctness; bbpPairings is host-side per the
design). Instead extend the expression-language strategy upward, cheapest
first: tie kinds and seed kinds have tiny contracts (one decision / one
lookup) and could be expression-backed; scoring/metric families fall out of
G2; encounter kinds could gain a declarative variant (outcome = an Expr over
child points/decisions + the existing stop-rule dictionary). Whatever subset
is chosen must be an explicit boundary decision (see ADR flags).

### G2 — New tiebreaks/scorings cannot arrive as data, even though they *are* data internally. (Severity: HIGH — this is the mandate's "new tiebreaks" clause, and it is cheap to fix)

The catalogs are closed TS lists: `builtinMetrics`
(`src/chess/tiebreaks/index.ts:30–124`) and `builtinScorings`
(`src/chess/scoring-rules/index.ts:18–86`) register named kinds whose
expressions are TS constants (`tiebreaks/definitions.ts:350–362`). There is
no `{metric: "expr", label, expr: …}` metric kind and no
`{kind: "expr", …}` scoring kind — `exprSchema` guards no wire anywhere
(grep: sole reference is its own file). Three secondary blockers:

- `evalMetric`/`evalScoring` **throw** on evaluation error, explicitly noting
  "organizer-authored metrics, when they arrive, will surface errors through
  a non-throwing path instead" (`expr/metric.ts:6–12,29–38`,
  `expr/scoring.ts:30–40`).
- The `{op: "metric", name}` reuse registry is hard-bound to the builtin map
  (`expr-metric.ts:51`: `named: (name) => tiebreakExprs.get(name)`), so a
  user expression could not name another user expression.
- No `DefChange` type exists for a named expression; user tiebreaks need
  either a new change type (event-scoped expressions) or a separate
  definition-like stream (a shared expression library).

**Remediation direction.** One generic expr-backed MetricKind + ScoringKind
parsing their payload through `exprSchema` (the step budget already assumes
untrusted expressions — `expr/evaluate.ts:20–21`); a non-throwing eval
surface that lands in standings as a typed per-cell error rather than 0; a
decision on where named user expressions live (per-event via a new change
type is the smallest step and stays inside the current stream model).

### G3 — Expression-language expressiveness holes. (Severity: MEDIUM — the shipped canon is covered; specific canonical and novel tiebreaks are not)

Covered today (as registered data): Buchholz + cut, median Buchholz,
Sonneborn-Berger, the 4-variant extended SB family, direct encounter
(with the all-played-each-other guard), cumulative, cumulative opposition,
USCF modified median, board points, games won, games with black, match wins
(`tiebreaks/definitions.ts:127–348`). Holes:

- **(a) Ratings are unreachable.** The `attribute` seam exists but is
  "unpopulated in phase 1, so this errors cleanly until fed"
  (`ast.ts:66–67`; `expr-metric.ts` never passes `attribute`). AROC, ARO,
  performance-rating tiebreaks are inexpressible until the env feeds
  competitor attributes — even though `CompetitorDef.rating` is already
  persisted (`core.ts:466–471`).
- **(b) No `unplayed` accessor.** `PlayedLine.unplayed` exists in the
  substrate (`registry.ts:144–146`) but no op reads it (`lineNum` fields:
  ast.ts:24–29; `kindIs`: played/bye/absent only). FIDE 2023 Buchholz with
  virtual/dummy opponents for unplayed games cannot be written.
- **(c) Arithmetic is `+ - * /` only** (`ast.ts:37`). No floor/round/abs/mod/
  pow — abs is composable via `if`, floor is not; performance-rating-style
  formulas and rounding conventions are out.
- **(d) No rank/position accessor** over the standings substrate; "opponent's
  final rank" style metrics can only be approximated by score counting.
- **(e) Scoring expressions cannot see history.** The `ScoringKind` contract
  passes chronological scored history — "`history` enables streak-style
  rules" (`registry.ts:321`) — but `exprScoring` reduces history to
  `history.length + 1` (`expr-scoring.ts:39–40`) and the scoring env carries
  no history lines, only the current `line` and `round`
  (`expr/scoring.ts:26–29`). The arena streak proof is therefore
  code (`extensions.test.ts:94`) — a data-defined arena scoring is
  impossible today.
- **(f) `boardPoint` takes a literal board number** (`expr/schema.ts:56–60`)
  — fine in practice, but parameters cannot be computed.

**Remediation direction.** Feed `attribute` from `CompetitorDef` (rating
first); add an `unplayed`-reading op (or a `lineIs` predicate family); a
small numeric-op extension (floor/abs at minimum); expose scored history as a
list in the scoring context. Each is additive to the closed `op` union and
its schema.

### G4 — Ranking policy is only half data. (Severity: MEDIUM)

`refineRanking` is data-programmed, but: the primary criterion is hard-coded
`standingsPoints` (`standings.ts:379`); progression ranking — podium
sentinels, final/bronze pair-order assumptions — is code
(`standings.ts:254–338`), and the *choice* between refinement and progression
is a code flag on the pairing kind (`progression: true`,
`standings.ts:495–508`, `pairings.ts:259`), not a def field. An organizer
cannot express "rank by games won first" or a hybrid policy from data.

**Remediation direction.** Make the criterion list fully explicit in
`PoolDef` (standings points as an implicit-but-overridable first ref), and
either express progression as a metric or lift the ranking mode into def data.

### G5 — Spine-level closed unions limit organizer-varied policy. (Severity: LOW — deliberate laws, mostly correctly placed)

`ByeRule` is a closed two-variant union (`core.ts:403–409`); plausible
organizer variations (first-round-only byes, requested half-point byes,
per-round schedules) need engine changes. `legRelease` is a closed enum
(`core.ts:419–420`). `GAME_RESULT_CODES` (`core.ts:195–203`) and the input
vocabulary are the wire protocol — correctly fixed. Only the bye rule feels
like policy trapped in the laws; note it, don't rush it.

### G6 — Display metadata is code-generated prose. (Severity: MEDIUM for a *generic* renderer; LOW for today's viewer)

The viewer's pipeline is genuinely data-driven (Inventory §8) — but the data
is *produced* by code: every card title/badge/line is an English string from
a kind's `card()` (`encounters.ts:177–194,383–398`, `scoring-rules/index.ts:
47–60`), gate text from `structure()` (`encounters.ts:339–354`), semantic
pair names from `pairLabels` (`pairings.ts:219–233`). The viewer keys icons
and colors off kind strings with a graceful fallback
(`tournament-flow.tsx:77–97`). Consequences: data-defined kinds (G1/G2) would
render as bare fallbacks unless kinds can carry **declarative card/label
templates**; i18n of stored tournaments is impossible.

What a generic renderer needs from the data model (most already exist as
code capabilities to be made declarable): title/badge/line templates per
kind + per ref params; role/gate/arrangement (already in `StructureChild`,
`registry.ts:66–113`); `terms` (already def data, `core.ts:422–428`); a label
for user metrics (part of G2's payload). `describeExpr` already covers
formula rendering generically.

### G7 — Persistence ceilings in the changelog itself. (Severity: HIGH for (a); MEDIUM for (b), (e); LOW for (c), (d))

- **(a) No schema-evolution story.** `defChangeSchema` is bound to today's
  `chessRegistry` (`src/chess/changes.ts:5`); `toStored` **throws** "corrupt
  DefinitionChange payload" for any row the current registry rejects
  (`change-store.ts:74–88`). Payloads carry no schema/format version
  (schema.prisma:91–98). Renaming a kind, tightening a kind schema, or
  removing a builtin bricks every stream that used it — with no upcaster
  hook. This must be settled before any third party writes streams.
- **(b) No cross-stream reference.** "GRENKE drops into the tour by
  reference" is authoring-time only — the wire data embeds the whole subtree
  by value (compose.ts flow combinators compile to ids *within one def*;
  `definitionToChanges` emits one `definition-created` carrying the entire
  competition tree, decompose.ts:13–17). A stored definition cannot reference
  another stream, so API-level reuse/sharing of a stored competition is
  unrepresentable.
- **(c) Coarse edit granularity.** `run-set`/`entries-set` replace whole
  subtrees (types.ts:40–49); a one-tiebreak edit rewrites the pool, a
  one-seed edit rewrites the entry list. Correct but concurrency-hostile for
  a multi-editor API (OCC will conflict at whole-run granularity).
- **(d) `seq` commit-order skew and no snapshots** — known and deferred
  (`change-store.ts:346–347`, ADR 0003/0007); fine at current stream lengths.
- **(e) Results are not persisted at all** (ADR 0006 proposed). Standings —
  the other half of "display runs off this data" — are computed from a log
  that only lives in memory/tests today. The mandate's display clause cannot
  be met for *played* tournaments until the Input stream lands.

### G8 — Definitions are validated against an unidentified registry. (Severity: MEDIUM, compounds G1/G2/G7a)

A stream records nothing about which registry (kind set, kind schema
versions) it was valid against — validity is re-derived against whatever
`chessRegistry` the deployed code holds (`change-store.ts:7,149`;
`readDefinition` reports `invalidPrefix` when yesterday's def no longer
parses, change-store.ts:265–281). Once kinds are user-defined or merely
evolve, replay determinism and auditability need the registry identity
pinned per stream (or per change).

---

## C. Ranked: what must change before/with the API

1. **The expression wire door (G2).** Generic expr-backed metric + scoring
   kinds, `exprSchema` at the boundary, a non-throwing eval surface, and a
   home for named user expressions. Highest mandate value per unit work —
   "new tiebreaks from data" becomes literally true.
2. **Schema evolution + registry pinning (G7a, G8).** Payload versioning /
   upcaster seam and a recorded registry identity, before third-party
   streams exist. Retrofitting is a data migration; deciding now is a column.
3. **The kind-extensibility boundary, decided explicitly (G1).** Declare per
   typeclass what will be data-definable (ties, seeds, scorings, metrics —
   realistic; encounters — partially, via a declarative outcome variant;
   pairings — stay code + the manual door) so the API's registration surface
   doesn't promise what the engine can't keep.
4. **The results stream (G7e / ADR 0006).** Without it the display mandate
   only covers "how it works", never "how it went".
5. **Expression substrate completions (G3).** Feed `attribute` from
   persisted ratings; add `unplayed`; floor/abs; scoring history. Ordered
   here because they widen door #1 once it exists.
6. **Ranking policy as data (G4).** Explicit criterion list + progression as
   data or def-selected mode.
7. **Cross-stream composition (G7b)** — only if definition sharing/reuse is
   an API goal; by-value embedding is otherwise acceptable.
8. **Declarative display templates (G6)** — with the generic renderer work,
   not before it.

## D. ADR-worthy findings (next free number: 0008 — flagged, not written)

- **User-defined expressions on the wire** (G2 + G3's error-surfacing and
  naming/reuse questions) — registration surface, event-scoped vs shared
  library, non-throwing error contract.
- **Registry identity + payload schema evolution** (G7a + G8) — versioning
  discipline, upcasters, what `invalidPrefix`/"corrupt" become under
  evolution.
- **The kind-extensibility boundary** (G1) — which typeclasses get data
  variants, which remain code plugins, and how the API names each.
- **Cross-stream definition references** (G7b) — only if reuse becomes a
  goal; changes the fold's closed-world assumption.

(G7e already has ADR 0006; snapshots/global order already have ADR 0007.)
