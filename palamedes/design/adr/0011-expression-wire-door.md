# ADR 0011 — Inline expressions are the wire door for data-defined tiebreaks and scorings

Status: Accepted (2026-07-12)

## Context

The registry already lets a chess kind be pure data (ADR 0010): any
`MetricKind`/`ScoringKind` is an opaque, schema-validated ref living inside
`CompetitionDef`/`RunDef`. Task 5 built the expression language and its
non-throwing (`Result`) evaluation core. The remaining gap: an organizer
still needed a named registry entry — a code change — to add a genuinely new
tiebreak or scoring rule. Task 6 closes that gap by registering `"expr"` as
a kind in both catalogs, so an expression can stand in for any tiebreak or
scoring rule without a new kind ever being written.

## Decision

**Inline expressions, no new `DefChange` variant.** `exprMetricRef`
(`{metric:"expr", label, expr}`) and `exprScoringRef` (`{kind:"expr", label,
expr}`) carry the expression directly on the ref, validated by `exprSchema`.
`MetricRef`/`ScoringRef` are already erased-schema data nested inside
`CompetitionDef`/`RunDef`, themselves carried by the existing
`definition-created`/`competition-added`/`run-set` variants of `DefChange`
(`changes/types.ts`). Refs are instance-owned open data by design — adding a
new kind of ref needs no new change type, only a new registry entry
(`exprWireMetric`/`exprWireScoring`, registered in
`tiebreaks/index.ts`/`scoring-rules/index.ts`). This is the registry
extensibility ADR 0010 already committed to; the wire door is the first
concrete tenant.

**The non-throwing contract splits by kind, because `MetricKind` and
`ScoringKind` don't offer the same seam.** `MetricKind` carries an opt-in
`valueResult` (Task 5); `metricOutcome` prefers it when present, so
`exprWireMetric` implementing `valueResult` via `evalMetricResult` means a
broken organizer-authored metric block-skips that one criterion instead of
crashing standings — surfacing as an entry in `unsplitCriteria()`, not an
exception. `ScoringKind` has no equivalent: `points()` must return a
`number`. `exprWireScoring` compensates with `validate`, smoke-evaluating the
rule's expr via `evalScoringResult` against five synthetic lines — win, loss,
draw, doubleLoss, and pending — at round 1 and reporting any failure through
`issue(...)` — rejection moves from materialize/engine time to parse/validate
time, now across every `DecisionTag` the outcome/match ops can dispatch on.
The smoke gate still doesn't enumerate every line shape an expr could see
(rounds beyond 1, or leg contexts), so a residual runtime throw from
`points()` (which calls the throwing `evalScoring`) remains possible on input
the gate doesn't cover. That's the same throw-loudly contract the
valueResult-less builtins already carry (`expr/metric.ts`'s header: an
evaluation error there "is a bug ... and throws loudly rather than silently
scoring 0") — except here the input can genuinely be organizer error, not
just a builtin bug. Accepted for this task; the sharper fix is a static
checker that proves an expr total over the `ScoringKind` contract before
it's accepted, recorded as follow-up rather than built now.

**Builtin reuse by name; user-to-user sharing deferred.** An expr may
reference an existing builtin tiebreak by name via `{op:"metric", name}`,
resolved through `env.named = tiebreakExprs.get(name)` — the same
`"metric"` op and the same `named` wiring `expr-metric.ts`'s own builtins
use to reference each other. A namespace where organizer-authored
expressions name and reuse *each other* (a shared, growing expression
library) is out of scope here — Dr. Dub decision D6. Deferred, not
foreclosed: nothing in the wire shape prevents adding named registration for
user exprs later.

**The step budget already bounds untrusted evaluation; the wire door needs
no budget of its own.** Every expr, builtin or organizer-authored, runs
through `evaluate.ts`'s `ev`, which checks `budget.steps <= 0` before
evaluating each node and fails with a `budget` error rather than recursing
further; `evaluate`/`evaluateTraced` apply `DEFAULT_MAX_STEPS` (100,000)
uniformly. Because the budget lives in the evaluator, not in the caller, the
wire door inherits it for free — an expr that reuses a builtin by name, or
nests deeply through `map`/`scan`, is bounded the same way a hand-written
one would be.

**Standalone expr parsing gets the same admission guard the registry door already has.** `exprSchema` recurses natively (`z.lazy`), so a sufficiently deep or wide
untrusted payload can overflow the stack before zod raises a single issue —
`exprSchema` used *inside* registry parsing is already behind
`admitDefData`'s guard, but `parseExpr`/`safeParseExpr` are standalone entry
points reachable directly. Both now run an iterative, explicit-stack
depth/node pre-walk before `exprSchema` ever sees the data, mirroring
`admitDefData` (`tournament/registry.ts`) exactly, including its depth and
node caps (200 / 50,000) — the same DoS ceiling, not a second invented one.

## Consequences

- A pool tiebreak or a scoring rule is now definable entirely from data: no
  code change, no registry entry, to add one. `expr-wire-round-trip.test.ts`
  proves the full path — an inline expr def round-trips the changelog
  (`definitionToChanges` → `appendChanges` → `readDefinition`) and drives
  correct standings through the engine.
- `exprWireScoring`'s `card` renders `lines: flattenNode(describeExpr(rule.expr))`
  — a flattened, indented string array — rather than embedding the
  `ComputationNode` tree `describeExpr` returns, because `CardInfo.lines` is
  `readonly string[]`. A rendering choice inside the existing viewer
  contract, not a new decision surface.
- `equalPointsTied` is exported from `expr-metric.ts` and imported by
  `tiebreaks/wire.ts` — the two adapters share the one tied-group policy
  rather than each carrying its own copy.
