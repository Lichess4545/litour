# ADR 0012 — The kind-extensibility boundary: which typeclasses become data, which stay code plugins

Status: Accepted (2026-07-26)

## Context

G1 in `design/reviews/2026-07-12-generality-review.md` is the mandate's "new
tournament types" clause, and it is still open: the six typeclasses are
TypeScript values holding functions, assembled at build time into
`chessRegistry` (`src/chess/registry.ts`), and no `DefChange` variant
(`src/tournament/changes/types.ts`) can carry a kind. ADR 0011 closed G2 for
two of the six by registering `"expr"` as a metric kind and a scoring kind.
The other four were left undecided.

The definition API makes that indecision expensive. `GET /api/v1/vocabulary`
(`src/server/http/routes/vocabulary.ts`) publishes the registry's kind names
as a contract, and a third party will read it as a promise about what they
can build. Without a stated boundary the endpoint implies either too little
(hiding that `"expr"` is a door, not a name) or too much (implying the
pairing list is exhaustive, which it is not).

Two doors already exist in the code, and they are not the same shape:

- **The expression door.** `exprMetricRef` (`{metric:"expr", label, expr}`,
  `src/chess/tiebreaks/wire.ts`) and `exprScoringRef` (`{kind:"expr", label,
  expr}`, `src/chess/scoring-rules/wire.ts`) parse an inline `Expr` through
  `exprSchema` at the registry boundary. Both are registered in the builtin
  catalogs (`tiebreaks/index.ts:125`, `scoring-rules/index.ts:87`), so they
  appear in the vocabulary payload beside the named builtins.
- **The open-world pairing door.** `validatePoolDef` looks the pairing system
  up and, on a miss, accepts the definition anyway provided `rounds` is
  declared (`src/tournament/registry.ts:1382–1391`: *"Open world: unknown
  systems are fine (pairings arrive as inputs), but then the schedule length
  cannot be derived"*). Pairings then arrive as recorded `pairingsSet` inputs
  (`src/tournament/core.ts:260–267`).

Verified against the code, pairing is the **only** open-world typeclass.
Encounters and ties reject unknown kinds inside their schemas
(`registry.ts:808–820`, `registry.ts:791–803`); scorings, metrics, and seeds
reject them in `validatePoolDef` / the entries pass (`registry.ts:1348–1352`,
`1367–1379`, `1156–1163`). Everything else is closed.

This engagement also deferred a great deal on purpose. Those deferrals are
scattered across task reports, `design/open-decisions.md` §5, and four other
ADRs. One ledger, here, so nobody rediscovers a decision as a bug.

### Two claims this ADR corrects

- **The pairing door is at `registry.ts:1382–1391`, not `1326`.** The
  generality review's `registry.ts:1326–1336` citation was accurate when
  written; the file has since grown and line 1326 now sits in the intake-cycle
  walk. Cited by content here, not by line, so it survives the next edit.
- **The format catalog is 23 definitions, not 24.** `FORMAT_EXAMPLES` holds
  20 entries (`src/chess/formats.ts:838–968`), and
  `format-round-trip.test.ts` adds `candidates`, `lichess4545Season`, and
  `wuccKnockoutUpfront` for 23. The review's "24 (21 + 3)" is off by one.
  The substantive claim it supports — that every one of them composes from
  the three registered encounter kinds — is unaffected and holds.

## Decision

### 1. The boundary, per typeclass

| Typeclass | Registry world | Organizer-extensible from data **today** | Decided direction |
| --- | --- | --- | --- |
| **Metric** (tiebreak) | closed | **Yes** — `{metric:"expr", label, expr}` | **Done.** Widen by adding expression ops, never by adding kinds |
| **Scoring** | closed | **Yes** — `{kind:"expr", label, expr}` | **Done.** Widen by feeding the scoring env, never by adding kinds |
| **Tie** | closed | No — `draw` / `drawOdds` / `manual` params only | **NEXT** for expression-backing |
| **Seed** | closed | No — `registration` / `fixed` / `rank` / `placements` params only | **NEXT** for expression-backing |
| **Encounter** | closed | Composition only — any tree of `game`/`series`/`match`, plus stop rules, seat cycles, per-leg point schedules, armageddon clocks, `terms` | Declarative outcome variant recorded as the future direction; **novel aggregation semantics stay a code plugin** |
| **Pairing** | **open** | **Yes, fully** — an unregistered system is legal with explicit `rounds`; pairings arrive as `pairingsSet` inputs | **Stays code**, plus the shipped manual/unregistered door. Not expression-backed, now or later |

**Metrics and scorings are finished business.** A new tiebreak or a new
scoring rule is definable from data today, with no code change and no registry
entry. Every future gain here is a wider expression language — more ops, a
richer evaluation env — not a wider kind catalog. That is the whole point of
ADR 0011's inline-ref shape: refs are instance-owned open data, so widening
the language needs no new `DefChange` variant and no schema-rev bump.

**Ties and seeds are next, and are designated only.** Their contracts are the
smallest of the six, which is exactly why they are next:
`TieKind.decide(rule, {view, points}) → TieDecision` plus `decisive(rule)`,
and `SeedKind.resolve(ref, ctx) → CompetitorId | undefined`
(`src/tournament/registry.ts:363–390`). One decision, one lookup. Honest
qualification: each carries a second obligation an expression must also
satisfy — `decisive` is a static claim a knockout's validation depends on, and
a seed's optional `origins` feeds the intake DAG and its cycle check. An
expression-backed tie kind must therefore declare decisiveness rather than
derive it, and an expression-backed seed must declare its origins. Neither is
built. "NEXT" means the next typeclasses to receive the treatment when the
work is scheduled — nothing in this ADR promises a date, and nothing in the
API may advertise them as available.

**Encounters keep their code plugins.** Composition is doing the work already:
all 23 catalog definitions — the World Championship, the Grand Chess Tour with
whole tournaments nested inside it, Olympiad, Scheveningen — round-trip the
changelog and drive the engine using only `game`, `series`, and `match`
(`src/chess/encounters.ts:486–490`,
`src/server/tournament/format-round-trip.test.ts`,
`engine-differential.test.ts`). What composition cannot express is a genuinely
new *aggregation* — a handicap head start, an arena's bespoke outcome — which
lives in `outcome`/`nextSlot`/`work` (`registry.ts:410–437`), and those are
the kind's imperative core, not parameters. The recorded direction is a
declarative variant: `outcome` as an `Expr` over child points and decisions,
composed with the stop-rule dictionary the def already carries
(`untilScore` / `untilMargin` / `untilDecided`). Anything past that — a kind
that needs its own scheduling or its own work items — remains a code plugin,
by decision and not by omission.

**Pairings stay code, and this is the deliberate asymmetry.** The manual door
already delivers full generality at zero code cost: any pairing procedure
whatsoever, however exotic, can drive a palamedes tournament by submitting
`pairingsSet` inputs. Making `propose` data would buy a *worse* version of
something that already works. Real pairing engines — bbpPairings and its kin —
are host-side by design; palamedes interprets their output rather than
reimplementing them in an expression language it would have to make
Turing-adjacent to host them.

### 2. How the API names each tier

Three tiers, and every kind on the wire is exactly one of them:

- **Composable now** — a registered kind name. It appears in the vocabulary
  payload and a definition may name it. This is the whole of `encounters`,
  `pairings`, `ties`, `seeds`, and the named entries under `scorings` and
  `metrics`.
- **Organizer-extensible now** — the `"expr"` entries under `scorings` and
  `metrics`. Same payload position as a name, different meaning: it is a door
  the organizer authors through, not a rule they select.
- **Propose a plugin** — everything else. A new tie procedure, a new intake
  pipeline, new encounter aggregation semantics. The answer is a code
  contribution against a `defineXKind` contract, not a wire payload. There is
  no third state where the API accepts something the engine cannot interpret.

Pairings sit outside the three tiers because the open-world door is not
extensibility of the *vocabulary* — it is the absence of a vocabulary
requirement. A definition may name a system the registry has never heard of;
what it may not do is expect the engine to pair for it.

**What the endpoint actually does today, and the defect that follows.** The
route returns six flat `string[]` plus `registryId`
(`src/server/http/routes/vocabulary.ts`). The tier distinction lives entirely
in the route's OpenAPI `description`, which does call `"expr"` out by name —
and which also states that *"a definition naming anything outside this
vocabulary fails validation."* For pairings that is false: an unregistered
system with explicit `rounds` validates cleanly. The prose is a promise the
code does not keep, in the direction that matters least for safety (it
understates what is allowed) and most for a client author (it hides the one
escape hatch that already exists). Recorded here as a defect with a trigger
rather than fixed in flight — this ADR does not edit routes another task owns.

### 3. The deferral ledger

Every deliberate deferral from this engagement, once, with a trigger.

| # | Deferral | Why deferred | Trigger to revisit |
| --- | --- | --- | --- |
| G3d | **No rank accessor** in the expression language — no op reads a competitor's position over the standings substrate (`expr/ast.ts`), so "opponent's final rank" metrics can only be approximated by counting points | Rank is an output of `refineRanking`, so an op that reads it inside a refinement criterion needs a defined answer for the partially-ranked case | The first requested tiebreak whose definition reads a *rank or placement* rather than a score |
| G3e | **Scoring expressions cannot see history.** `points()` collapses it to `history.length + 1` and the eval env carries only `{line, round}` (`expr/scoring.ts`, `scoring-rules/expr-scoring.ts`), so the arena streak proof stays code (`chess/extensions.test.ts`) | Exposing history as a list widens the scoring env and the step budget's worst case; no shipped format needs it | The first streak-shaped or arena scoring rule requested **as data** — any rule whose points depend on a prior round's result |
| G3f | **`boardPoint` takes a literal board number** (`expr/schema.ts`: `board: z.number().int().min(1)`), so the parameter cannot be computed | Every real board-points tiebreak names a constant board; making it an `Expr` is additive whenever one doesn't | The first expression that must derive its board (e.g. "the board matching the competitor's seed") |
| G4 | **Ranking is only half data.** Criterion 0 is hard-coded `standingsPoints` (`standings.ts:423`) and the refinement-vs-progression choice is a code flag on the pairing kind (`progression: true`, `pairings.ts:259`, read at `standings.ts:573–575`) | The pool's tiebreak list already *is* the ranking program past criterion 0; lifting the primary and the mode into def data is a `PoolDef` shape change, hence a schema rev | The first definition that needs a non-points primary criterion ("rank by games won first"), or a hybrid of refinement and progression |
| G5 | **`ByeRule` is a closed two-variant union** (`core.ts:403–409`): `points` or `advance`. First-round-only byes, requested half-point byes, and per-round schedules need an engine change | The spine's closed unions are laws on purpose; the review rates this LOW and says not to rush it | The first league that needs a requested or conditional bye — concretely, a bye whose value depends on the round or on the competitor's request |
| G6 | **Display metadata is code-generated prose** — card titles, badges, gate text, and pair labels are English strings from each kind's `card()`/`structure()`/`pairLabels`, so a data-defined kind renders as a bare fallback chip and i18n of a stored tournament is impossible. Includes the `concrete` route's honest `z.unknown()` response schema (Task 14) | Owned in full by ADR 0017; the review ranks declarative templates **last** because they buy little before a generic renderer exists | The generic-renderer / data-defined-kind work (ADR 0017). For the `concrete` schema specifically: the first typed client generated from the OpenAPI spec that must consume `concrete` |
| G7c | **Whole-subtree edit granularity, under stream-level OCC.** `run-set` replaces a competition's entire `run` and `entries-set` its entire `entries` (`changes/fold.ts:288–294`), so a one-tiebreak edit rewrites the pool and a one-seed edit rewrites the entry list. Compounding it, OCC is per **stream**, not per subtree: `appendChanges` compares `expectedVersion` against the stream's head version (`change-store.ts:205–222`), so two editors touching two unrelated pools of the same tournament conflict. Correct today; concurrency-hostile under a multi-editor API, because the natural client response to a `versionConflict` — re-read, re-send — replays a whole-subtree payload over a co-editor's committed change | Finer-grained change variants are a `DefChange` shape change and therefore a schema rev (ADR 0010), and single-editor streams are the only reality so far | The moment more than one editor is expected on one stream — a co-arbiter or delegated-write role in the write API — or the first `versionConflict` observed in production against a stream with more than one actor |
| G7b | **No cross-stream references.** A stored definition embeds its whole competition subtree by value; `definitionToChanges` emits one `definition-created` carrying the entire tree (`changes/decompose.ts`). "GRENKE drops into the tour by reference" is authoring-time only | The fold's closed-world assumption is what makes replay deterministic; a reference would make a definition's meaning depend on another stream's version | Definition sharing or reuse becoming an API goal — concretely, the first request to reference a stored competition from another stream rather than copy it |
| G7e | **Results are not persisted** (ADR 0006, Proposed). Standings are computed from an Input log that lives only in memory and in tests, so the display mandate covers how a tournament *works*, never how it *went* | Dr. Dub decision D3: the results-write endpoint is out of this engagement; ADR 0008 reserves `/api/v1/definitions/{streamId}/runs…` so the URL space needs no renegotiating | ADR 0006 accepted — i.e. the first requirement to serve *played* results through the API |
| D6 | **Named/shared user-expression library.** An expression may name a *builtin* via `{op:"metric", name}`, resolved through `tiebreakExprs`, but organizer expressions cannot name each other (ADR 0011; ratified in ADR 0013 §D6) | Inline-only keeps a definition self-contained: it carries its own formulas, so it means the same thing wherever it is read | The second organizer asking to reuse another's named tiebreak — or duplicated identical inline expressions observed across streams |
| — | **Sign-out does not revoke the lichess token.** Better Auth's sign-out clears the local session only; lichess's `DELETE /api/token` is never called, so a signed-out palamedes session leaves the underlying token live until it expires or the user revokes it manually (ADR 0009) | The api-demo's revoke-on-logout is the model, but revoking a token the user may also be using elsewhere is a product decision, not a bug fix | A security review that treats a live post-sign-out token as unacceptable — or the first shared-device usage report |
| — | **Introspection is one token per call.** Lichess accepts up to 1000 tokens per introspection request; batching is deliberately out of scope, and lichess permits only one in-flight introspection globally with back-off on 429 (`server/lichess/introspection.ts`) | Batching only pays with concurrent distinct tokens to batch, which no traffic pattern has yet produced | Sustained 429s from lichess introspection, or any auth path that must verify more than one token per request |
| — | **No read-side projection.** Reads fold on read via `readDefinition`/`readChanges`; list reads are O(streams × changes) (ADR 0008) | ADR 0008 names the projection as the escape hatch, explicitly not a prerequisite; the wire contract does not change when it lands | List-read latency becoming operator-visible at the deployed stream count — concretely, the first time the list route needs pagination or is raised as slow |
| — | **The vocabulary route's description overstates closedness** for pairings (see §2): it says anything outside the vocabulary fails validation, but an unregistered pairing system with explicit `rounds` validates | Found while grounding this ADR; the route belongs to another task in flight and this ADR does not edit code | The next edit to `src/server/http/routes/vocabulary.ts`, or before any third-party client is pointed at `/api/v1/vocabulary` — whichever comes first |

## Consequences

- **The API can state a boundary instead of implying one.** "Composable now /
  organizer-extensible now / propose a plugin" is three phrases a client
  author can act on, and every kind on the wire is exactly one of them. The
  vocabulary endpoint stops being a list that quietly means two different
  things.
- **The cost of this boundary is that four typeclasses stay shut, and two of
  them are shut on purpose forever.** An organizer who wants a genuinely new
  tie procedure, a new intake pipeline, or new encounter aggregation must
  contribute code and wait for a deploy — a self-serve promise this ADR
  declines to make. For encounters that is a considered trade (aggregation is
  imperative, and a declarative variant covers the tractable subset later);
  for pairings it is permanent (the manual door already covers correctness at
  zero cost, so an expression-language `propose` would be strictly worse).
  The honest reading is that "everything is data" is now true of *formulas*
  and *composition*, and will not become true of *semantics*.
- **Ties and seeds are designated but unbuilt, which is a promise with no
  delivery date.** Naming them "NEXT" risks the API describing them as coming
  soon; nothing here authorizes that. Until they ship they are in the
  "propose a plugin" tier like anything else, and `decisive`/`origins` are the
  two obligations that will make them more than a one-line adapter.
- **The ledger makes deferral cost visible in one place.** Thirteen entries,
  each with a trigger someone can check rather than a wish. The risk it
  carries is the usual one: a ledger that nobody reads becomes an alibi. It is
  worth exactly as much as the next reader's willingness to grep it before
  filing a bug.
- **Two published claims were wrong and are corrected above** (the pairing
  door's line number, the catalog count). Neither changed a decision, but both
  were repeated downstream from the generality review, which argues for citing
  code by content rather than by line in documents that outlive a refactor.

See `design/reviews/2026-07-12-generality-review.md` §B (G1) for the gap
analysis this decides, ADR 0011 (`0011-expression-wire-door.md`) for the
expression door already shipped, ADR 0010
(`0010-registry-identity-and-schema-evolution.md`) for the registry
extensibility this boundary sits on, ADR 0017
(`0017-data-display-boundary.md`) for G6, and ADR 0013
(`0013-ratify-definition-api-defaults.md`) for the D3 and D6 ratifications the
ledger references.
