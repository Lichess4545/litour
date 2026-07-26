# ADR 0017 — Display consumes the read API's projection; the viewer's job stays open

Status: Accepted (2026-07-26)

## Context

The mandate behind the generality review
(`design/reviews/2026-07-12-generality-review.md`) is that "the new display
mechanisms should run off of this data" — the same data the engine and the
API already speak, not a second, bespoke, per-format rendering path.

That data already exists and is already served. `concretify(def, registry)`
expands a definition into a `ConcreteEvent` — a plain, recursive, walkable
structure: every round, every pairing slot, the standings card, each
tiebreak's computation as data (`describeExpr`). The read API serves exactly
this: the `concrete` route in the definitions-read router reads the stored
definition off the changelog and returns `concretify(read.def,
chessRegistry)`. A display "iterates this structure; it never touches a
definition or the registry."

Two things are genuinely decidable now — the architectural boundary, and one
concrete data-side gap. One thing is not ours to decide and is recorded as
open.

## Decision

**Display mechanisms consume the same read-projection the API serves.** The
concrete projection — `ConcreteEvent` over the changelog, produced by
`concretify` — is the *one* input to any display. The display layer is a
**consumer of the read API's projection, not a second path into the engine.**
Data first, rendering second: a renderer walks `ConcreteEvent`; it does not
reach past it into definitions, the registry, or engine internals to
reconstruct what the projection already carries.

This is the boundary, and it is the only architectural commitment this ADR
makes about display. It says where the seam is (at the read projection),
which direction the dependency points (display depends on the projection; the
projection depends on neither), and what is forbidden (a display that
re-derives structure the engine already computed). It deliberately does *not*
say what the display should look like or do — see the open question below.

## Consequences

- **One source of truth for "how it works" and "how it went."** Any viewer,
  export, or third-party renderer reads the projection the API already
  serves, so they cannot drift from the engine's own account of a tournament.
  The `concrete` route documents this contract; `concrete` is served as an
  honest `unknown` today (the `ConcreteEvent` shape) with a tightened wire
  schema tracked as follow-up rather than hand-declared and left to drift.
- **Cost of the chosen boundary.** Any display need not yet represented in
  `ConcreteEvent` must be built by extending `concretify` (and, upstream, the
  kinds it walks) — never by having a renderer reach past the projection.
  Display velocity is therefore bottlenecked on projection/engine changes,
  not something a display-only change can route around. G6 (card/label text
  baked into `card()`/`structure()`/`pairLabels` rather than carried as data)
  is a concrete instance: a data-defined kind or an i18n need can't be met in
  the display layer alone under this boundary.
- **The option not taken: a display that reads definitions/registry
  directly.** A renderer *could* take the stored `EventDef` plus the live
  registry and compute structure itself — richer access, no projection to
  maintain. Rejected: it makes every display a second, uncontrolled
  implementation of the engine's own expansion, free to disagree with the
  standings and structure the API serves, and it re-couples rendering to
  registry internals the projection exists to hide. The projection is the
  door; there is one door.

- **OPEN — owned by Dr. Dub, blocking nothing on the data side: what the
  interactive viewer should be GOOD AT.** The data boundary above stands on
  its own; a well-formed `ConcreteEvent` is served regardless of what any
  viewer chooses to do with it. What remains genuinely undecided is the
  *product* question. The fractal, infinitely-zoomable experiment was tried,
  set aside, and judged "thoroughly meh"; no replacement job has been named.
  This is not an architecture question and this ADR does not invent an
  answer — naming what the interactive viewer is *for* is Dr. Dub's to
  decide. It blocks nothing on the data side: the projection is ready
  whenever the viewer's purpose is chosen.

- **DEFERRED data-side gap — G6: card/label text is code-generated prose.**
  The projection is data-driven, but the *strings inside it* are produced by
  code. Each kind's `card()` returns English titles and badges (`"Game
  points"`, `"Series"`, `` `${def.boards} boards` ``), `structure()` produces
  gate text and role labels (`` `${def.legName ?? "leg"} ${i + 1}` ``), and a
  pairing system's `pairLabels` produces semantic names (`"final"`, `"bronze
  final"`). Consequences: a *data-defined* kind (one with no code to author
  its card) renders as a bare fallback chip, and i18n of a stored tournament
  is impossible — the language is baked into the engine at card-production
  time, not carried as data. The fix is **declarative card/label templates**:
  a kind carries title/badge/line/role/gate templates as data (over its ref
  params and the already-declarative `role`/`gate`/`arrangement`/`terms`), and
  the renderer fills them. The generality review ranks this **last** among
  remediations, and deliberately so — it travels with a generic-renderer
  effort and buys little before one exists. Recorded as deferred; the
  **trigger** is the generic-renderer / data-defined-kind work, not a
  standalone action.

See the generality review
(`design/reviews/2026-07-12-generality-review.md`, §B G6 and Inventory §8)
for the full gap analysis, and ADR 0011
(`0011-expression-wire-door.md`) for the sibling case already closed —
tiebreak and scoring *formulas* made data, rendered generically via
`describeExpr`.
