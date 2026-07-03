# ADR 0002 — The definition changelog: changes, fold, batch-atomic validity

Status: Accepted (2026-07-02)

## Context

The aggregate is the tournament DEFINITION lifecycle (structure), not
runtime results (those are the engine's existing `Input` log — ADR 0006).
Palamedes already calls the aggregate an "event" (`EventDef`, `EventState`),
so the changelog NEVER uses "event" for its entries.

## Decision

Vocabulary: a **Definition** (stream; stream id == `EventDef.id`) made of
**DefinitionChange** rows; TS union `DefChange`; pure **fold**; the DAL is
the **change store**.

Ten change types (discriminant `type`):
`definition-created { name, competition }` · `definition-renamed { name }` ·
`competitor-added { competitor, index? }` ·
`competitor-updated { competitorId, competitor }` (payload id must equal
competitorId) · `competitor-removed { competitorId }` ·
`competition-added { parentId, competition, index? }` (parent's run must be
a container) · `competition-renamed { competitionId, name? }` ·
`competition-removed { competitionId }` · `run-set { competitionId, run }`
(the big recursive lever) · `entries-set { competitionId, entries | null }`.

Tree ops address competitions by `CompetitionDef.id` (recursive search; ids
are globally unique within an event and stable under sibling edits — chosen
over NodePath). The first change of a stream MUST be `definition-created`;
the def's `id` is the stream id — identity lives on the stream, once.

`foldDefinition(streamId, changes)` is pure, total, deterministic: never
throws, no clock, no randomness. Errors are typed FoldErrors:
streamNotCreated, alreadyCreated, unknownCompetition, parentNotContainer,
duplicateCompetitionId, unknownCompetitor, duplicateCompetitorId,
competitorIdMismatch, rootRemoval. The fold checks per-change structural
preconditions only; whole-definition laws (leaf/container entries, registry
kinds, id uniqueness after run-set) belong to the gate:

**Validity gate = batch-atomic (per append), not per change.**
`fold(existing ++ batch)` must fold-succeed AND `safeParseEventDef` must
succeed (the existing admission boundary: clone-ability, depth/node caps,
leaf/container entries law, registry kinds). Mid-batch prefixes may be
structurally incomplete — batches are atomic, and reads at batch boundaries
are always valid. Consequence: authors order changes freely within a batch
(e.g. `run-set` to a container + `entries-set null` in either order).

## Consequences

- Move/pool-granular sugar (tiebreaks-set etc.) is deliberately deferred —
  expressible via run-set / remove+add; revisit when an editor UI exists.
- `readDefinition` with `toVersion` inside a batch can surface
  `invalidPrefix` — time travel is only guaranteed at batch boundaries.
- Payload subtrees are validated by the registry-assembled sub-schemas
  (`ModelRegistry.defSchemas`), so unknown kinds are rejected at the change
  boundary, before the gate.
