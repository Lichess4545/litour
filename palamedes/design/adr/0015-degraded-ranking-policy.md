# ADR 0015 — A degraded final order is surfaced, never silently crowned

Status: Accepted (2026-07-26)

## Context

ADR 0011 made a broken tiebreak honest at the cell level: a `MetricKind`
with an opt-in `valueResult` (the `expr` wire door is the only tenant today)
block-skips the criterion it can't evaluate instead of crashing standings.
The failure surfaces two ways — as an honest `MetricCell = { error }` in
`StandingsRow.metrics` (never a fabricated `0`), and as an entry in
`PoolStandings.unsplitCriteria`, meaning "this tied block survived an error,
not a genuine equal value." Only organizer-authored `expr` metrics can reach
this path: the `valueResult`-less builtins throw loudly (`expr/metric.ts`
header), so a failing builtin is a bug that crashes, not a degraded order.

That honesty is lost at two engine seams. `rankingOf` builds a completed
pool's final order as `poolStandings(...).rows.map((row) => row.competitor)`
and discards `unsplitCriteria`; the order it returns is indistinguishable
from a clean one, and `resolveEntrants`'s `ranking` callback seeds a
downstream knockout from it. `buildPairingContext` builds the next round's
`PairingContext` from the same `rows` and likewise drops `unsplitCriteria`.
So a pool whose tiebreaks partly ERRORED crowns an order and seeds the next
competition from it with no trace at either seam.

Two further seam nits ride the same honesty story. `UnsplitCriterion.criterion`
is a RAW INDEX (`0` = standings points, `N` = `pool.tiebreaks[N - 1]`) —
unreadable to an organizer, and the only handle the diagnostic offers on
*which* rule failed. And `MetricEvalResult`'s error arm is `{ reason: string }`
— the structured `ExprError` behind it (a discriminated union in `expr/ast.ts`)
is flattened to a string at that boundary.

This is tolerable TODAY only because no organizer-authored `expr` tiebreak
exists — every metric in play is a builtin, which can't reach the
`unsplitCriteria` path. It becomes a live hazard the moment the Task 15 write
door lets an organizer author a tiebreak: one bad expression then silently
degrades a final order and everything seeded from it. Dr. Dub granted full
authority to decide this bundle; the parts stand or fall together as one
policy — surface the degradation, do not refuse the tournament, and make the
diagnostic readable before any of it reaches a viewer.

## Decision

**Surface at the seams; never refuse.** Refusing — making `rankingOf` return
`undefined` (or a typed error) on a non-empty `unsplitCriteria` — is safe but
turns one bad organizer expression into a dead tournament: the leaf never
completes, seeding never fires, the event stalls with no recourse. Rejected.
The order a degraded ranking produces is already the honest best-effort — the
erroring criterion leaves its tied block in the prior pass's order, never
reshuffled — so the policy is to KEEP producing it and carry the degradation
alongside it. `rankingOf` keeps its `readonly CompetitorId[] | undefined`
contract (`undefined` still means only "not finished yet"); widening it to a
`Result` that encodes degradation is the option-not-taken, because that ripples
through `resolveEntrants`, `nextActions`, `eventWinner`, and `standingsOf` for
a diagnostic whose only consumers are DTOs — the wrong seam to pay that cost.
Per-pool degradation stays reachable where it already lives: `standingsOf(pool)`
returns `PoolStandings.unsplitCriteria`, so a DTO rendering a completed pool
reads it there without new engine plumbing. **Ships with Task 15:**
`buildPairingContext` stops discarding `unsplitCriteria` — it carries it into
`PairingContext`, which reaches the host on the existing `awaitPairings`
action's `context`, no new action type. **Accepted risk (trigger below):** a
proactive engine-level aggregate that flags every degraded completed pool in
one read, and the viewer surface that renders the warning to an organizer.

**`UnsplitCriterion` carries a readable label and the `MetricRef`, not a raw
index. Ships with Task 15.** At the `unsplitCriteria.push(...)` site in
`refineRanking` the registry and pool are both in scope, so the label is
computable there: criterion `0` is the constant `"standings points"`; criterion
`N` is `metric.label(ref)` for `ref = pool.tiebreaks[N - 1]`, the same label
`poolStandings` already keys `StandingsRow.metrics` by, so the two agree. The
criterion also carries its `MetricRef` (absent for standings points) so a
consumer has the rule itself, not just its name. The option-not-taken —
leaving the raw index and resolving the label downstream in each viewer — was
rejected because it scatters one lookup across every future consumer and drifts
from the `metrics` labels; resolve it once, at the source, before anything
renders it.

**`MetricEvalResult`'s error arm stays `{ reason: string }`. Accepted risk.**
A structured `kind` would let a consumer branch on the failure — refuse on
some kinds, tolerate others, render `unknownAttribute` differently from
`budget` or `divByZero`. There is exactly one consumer today (`refineRanking`,
plus the metric-cell build in `poolStandings`), and it only displays the
reason string. The structure is not lost, only flattened: `evalMetricResult`
already holds the discriminated `ExprError` and `JSON.stringify`s it into the
reason. Adding a `kind` now is speculative generality with no brancher to
justify it; the later widening is mechanical (surface `ExprError`'s
discriminant through the arm instead of stringifying it) and touches its one
consumer. Deferred, not foreclosed.

**`MetricEnv.attribute`'s optionality is left as-is; not in the shipping
bundle.** `evaluate` calls `env.attribute` unconditionally while
`MetricEnv.attribute` is typed optional, but this is already honest, not a
silent-failure hole: `evalMetricResult` bridges the optional with a total
`?? (() => undefined)` default, and the `attribute` op turns every absent
function, competitor, or key into a clean `unknownAttribute` error — never a
fabricated `0` (documented at `MetricEnv.attribute`). Making it required has
no correctness payoff — only churn at every construction site and test — while
`rating` is the sole attribute source. Judged tangential to the degradation
story and excluded.

## Consequences

- **Foreclosed:** no seam may silently discard `unsplitCriteria` once
  organizer-authored tiebreaks are writable. A degraded order is still crowned
  and still seeds downstream — the deliberate choice over a dead tournament —
  but the degradation now travels with it (into `PairingContext`) or stays
  one `standingsOf` read away (for seeding), and it names the failed rule in
  words.

- **Buildable spec for the ships-with-Task-15 parts.**
  - *Readable `UnsplitCriterion` (`tournament/standings.ts`):* replace
    `criterion: number` with `criterion: { index: number; label: string; ref?: MetricRef }`.
    Fill it at the single `unsplitCriteria.push` site in `refineRanking`
    (inside the block loop): `index` is the loop's `criterion`; `label` is
    `"standings points"` when `index === 0`, else `metric.label(ref)`; `ref`
    is `pool.tiebreaks[index - 1]` for `index > 0`, absent otherwise. Neither
    `ref` nor `metric` is in scope at the push site — both are local to the
    `criterionOutcome` closure — so resolve them fresh there:
    `ref = pool.tiebreaks[index - 1]` and
    `metric = registry.metrics.get(ref.metric)`, `pool` and `registry` being
    `refineRanking`'s own parameters. `progressionKeys` returns an
    empty `unsplitCriteria` via a hardcoded literal in `rankByProgression`, so
    it needs no change. `builder.ts` imports `UnsplitCriterion` as a type and
    uses it only as a return-type annotation — no field access — so it needs
    no change either. Update the exact-match assertions in `standings.test.ts`
    (the `criterion: 1` / `criterion: 2` cases) to the new shape;
    `expr-wire-round-trip.test.ts` asserts `[]` and is unaffected.
  - *`buildPairingContext` carry (`tournament/engine.ts`):* read
    `unsplitCriteria` from the `poolStandings(...)` call it already makes and
    add it to the returned `PairingContext` as a new
    `readonly degraded: readonly UnsplitCriterion[]` (default `[]`). Mind the
    import direction: `standings.ts` imports `registry.ts`, so
    `PairingContext` (in `registry.ts`) cannot name `UnsplitCriterion` (in
    `standings.ts`) without a cycle — move `UnsplitCriterion` to `core.ts`
    (both import it) or give `PairingContext` a structurally-equal inline shape.

- **Accepted risk, with named post-Task-15 triggers.**
  - The proactive degradation aggregate + organizer-facing viewer warning:
    build when a standings/write-door surface exists to render it. Until then
    the data is reachable per pool via `standingsOf`; Task 15 lands the write
    door and the `PairingContext` carry, a later surface renders it.
  - `MetricEvalResult` structured `kind`: add when the first consumer needs to
    branch on failure kind (a policy that tolerates some failures but not
    others, or a viewer distinguishing failure classes).
  - `MetricEnv.attribute` required: revisit when a second attribute source
    lands and a construction site forgetting it would be a bug worth a compile
    error.
