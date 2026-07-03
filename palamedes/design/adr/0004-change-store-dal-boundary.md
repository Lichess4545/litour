# ADR 0004 — The change store is the single door; the change domain is pure

Status: Accepted (2026-07-02)

## Context

The log invariant — every batch boundary folds to a valid definition — only
holds if every writer goes through the gate. Palamedes' standing invariant:
only server-side code imports Prisma (`src/server/`, `src/app/api/`,
`src/trpc/server.tsx`, `src/test/db.ts`, `prisma/seed.ts`).

## Decision

- PURE domain in `src/tournament/changes/` (types, registry-parameterized
  zod schemas, fold, definitionToChanges): NO Prisma import, no IO, no
  clock. Chess-curried convenience (`defChangeSchema` bound to
  `chessRegistry`) lives in `src/chess/changes.ts`, mirroring
  `src/chess/registry.ts`.
- DAL in `src/server/tournament/change-store.ts`: plain async functions
  taking the Prisma client as their first argument (simple DI for
  testability; production callers pass the `db` singleton) — no framework,
  no registries. It speaks ONLY changes: appendChanges, readChanges,
  readDefinition, readAllChanges, submit.
- Payload boundary, zero casts: READ — `payload: Prisma.JsonValue` feeds the
  registry-parameterized change schema's safeParse directly; a failure is
  corruption and throws with streamId+seq context, never swallowed. WRITE —
  zod `.optional()` + exactOptionalPropertyTypes make def subtrees NOT
  directly assignable to `Prisma.InputJsonValue`; the single write site
  launders through zod v4's `z.json()` (`payload: jsonValue.parse(change)`),
  which runtime-validates JSON purity (parsed defs carry no
  present-undefined keys). The `type` column is constructed FROM the parsed
  change's discriminant so it cannot drift from the payload.

## Consequences

- tRPC/API exposure (not yet built) will wrap the DAL, inheriting the
  gate; nothing else may touch the table.
- Tests can inject the shared `db` client and fresh uuid stream ids per
  test — no mock Prisma.
