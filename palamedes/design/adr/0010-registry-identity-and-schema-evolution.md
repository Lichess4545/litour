# ADR 0010 — Registry identity and payload schema evolution are pinned per row

Status: Accepted (2026-07-12)

## Context

`design/reviews/2026-07-12-generality-review.md` flagged two compounding gaps
in the changelog as written:

- **G7a — no schema-evolution story.** `toStored` throws "corrupt
  DefinitionChange payload" for any row the current registry rejects;
  payloads carried no schema/format version. Renaming a kind, tightening a
  kind schema, or removing a builtin would brick every existing stream,
  with no upcaster hook.
- **G8 — validity re-derived against an unidentified registry.** A stream
  recorded nothing about which registry (kind set, kind schema versions) it
  was validated against; `readDefinition` reports `invalidPrefix` against
  whatever `chessRegistry` the deployed code currently imports. Once kinds
  evolve or become user-defined, replay determinism and auditability need
  the registry identity pinned per row.

Both must be settled before any third party writes streams, since retrofitting
identity onto already-written rows is a data migration, not a column add.

## Decision

Every `DefinitionChange` row pins three columns at write time (stamped in
`appendChanges`):

- **`registryId: String`** — an explicit, human-assigned identity for the
  registry a batch was validated against (`chess/1` today, exported from
  `src/chess/registry.ts`). It is not derived from hashing the kind set;
  a maintainer bumps it deliberately whenever a kind is renamed, a kind's
  schema is tightened, or a builtin is removed — anything that could make an
  old payload fail against the new registry. `RegistrySpec.id` /
  `ModelRegistry.id` thread it from `buildRegistry` through the whole
  registry.
- **`schemaRev: Int`** — the `DefChange` wire-shape revision
  (`CURRENT_SCHEMA_REV`), bumped whenever the shape of a change payload
  itself changes (a field added/removed/retyped on any `DefChange` variant)
  — independent of `registryId`, which tracks the *vocabulary*, not the
  *envelope*. Task 4 builds the upcaster chain: on read, a row's
  `schemaRev` selects the sequence of pure functions that map its payload
  forward to the current revision before it reaches `defChangeSchema`.
- **`actorId: String?`** — per-change audit identity; `null` means
  system/seed-authored (the seed never passes `opts.actorId`). Purely
  descriptive — nothing in the fold, gate, or OCC logic reads it.

## Consequences

- **"Corrupt" is now typed and revision-aware.** `toStored` returns a
  `PayloadError` (`corruptPayload` | `unknownSchemaRev`) instead of throwing;
  `readChanges`, `readDefinition`, and `readAllChanges` all propagate it as a
  typed result. Two sites still throw rather than return it: `submit`, when
  the stream state it read is unreadable, and `appendChanges`'s pre-write
  fold, when a row among the stream's existing history is unreadable. Both
  are command loops with nothing sensible to decide against or fold over
  without readable prior state, and both surface the identical drift, fixed
  the same way — add the upcaster.
- **The upcaster seam: pure, one per rev bump, DB-blind.** `UPCASTERS` maps
  a `schemaRev` to a function that reshapes that revision's payload into the
  next one's; `upcastPayload` chains them up to `CURRENT_SCHEMA_REV` before
  `toStored` hands the result to `defChangeSchema`. Each function is a pure
  `unknown -> unknown` — no DB access, no side effects — and a gap anywhere
  in the chain (including a row's `schemaRev` newer than
  `CURRENT_SCHEMA_REV`) surfaces as `unknownSchemaRev`, never a thrown error.
  The map is empty today: rev 1 is current, so nothing has needed upcasting
  yet.
- **Discipline: never mutate a written row.** `registryId` and `schemaRev`
  are write-once per row, like `recordedAt` (ADR 0001) and `version` (ADR
  0003). Evolution happens by upcasting on read, never by rewriting history —
  the same "replay is bit-for-bit repeatable" invariant ADR 0003 established
  for fold purity extends to the upcast step.
- **The column `@default`s are backfill, not the write contract.**
  `schemaRev Int @default(1)` and `registryId String @default("chess/1")`
  exist only so pre-hardening rows (written before this migration) read back
  with valid values; the DAL stamps both explicitly on every `createMany`
  row regardless of the default, exactly as ADR 0001 documents for
  `recordedAt`.
- **Resolved: `extendRegistry` requires an explicit `id`.** Silent identity
  inheritance is now unrepresentable — `extendRegistry`'s `extra` parameter
  requires its own `id` at the type level, so an extension that doesn't
  choose an identity is a compile error, not a runtime footgun. What
  remains open is only the *policy* question: when must an extension bump
  `id` versus reuse the base's? (Additive instances arguably leave the
  vocabulary a strict superset — "safe" to keep the base id — while any
  change to an existing kind's behavior or schema is observably a
  different vocabulary and should rebrand.) That policy is deferred to the
  first real extension that needs to answer it.
