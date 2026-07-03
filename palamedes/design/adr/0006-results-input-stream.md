# ADR 0006 — Results as a second stream: the engine's Input log

Status: Proposed (2026-07-02) — designed, not built

## Context

The engine already folds a zod-schematized, JSON-safe `Input` log
(`inputSchema`, src/tournament/core.ts) into `EventState` via
`materialize(def, inputs, registry)`. That log is the natural second stream.

## Proposal

A `RunChange`-style table (same portable subset, same OCC recipe) holding
`Input` payloads per run stream, with the run stream referencing the
definition stream AND the definition version it plays under. Rehydration =
`readDefinition` + fold inputs through `materialize`. Definition changes
mid-run become explicit version bumps the host must acknowledge.

## Consequences (anticipated)

- The builder's scripts become replayable fixtures against stored runs.
- Corrections stay last-write-wins inside the engine; the log stays
  append-only underneath.
