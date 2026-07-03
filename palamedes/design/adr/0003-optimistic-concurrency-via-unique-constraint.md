# ADR 0003 — Optimistic concurrency via the unique constraint; no transactions

Status: Accepted (2026-07-02)

## Context

Concurrent writers must never corrupt a stream, and losers must get a typed,
retryable answer. Empirical testing and the Prisma docs establish: `createMany` is ONE SQL
statement — atomic on both postgres and sqlite; a unique index is enforced
at write time regardless of snapshot isolation, so the second inserter of
(streamId, version) can never silently succeed.

## Decision

ONE table, no stream-head row, no counter row, no interactive transaction —
the `@@unique([streamId, version])` constraint alone carries the whole
concurrency story (a head row would force a transaction for zero gain;
stream metadata lives in the version-1 change).

`appendChanges` = read the stream (findMany by streamId, ordered) → verify
expectedVersion (max read version; 0 = must be empty) → fold+parse validity
gate → `createMany` the batch at versions expected+1..+n (never
`skipDuplicates`) → catch `e instanceof Prisma.PrismaClientKnownRequestError`:
`code === "P2002"` ⇒ versionConflict (the table's single unique constraint
IS the conflict; don't parse `meta`), `code === "P2034"` ⇒ transient write
conflict ⇒ bounded internal retry of the whole read-gate-write cycle.
Staleness is harmless: the batch only lands if it starts exactly at
expected+1, and the validity gate ran against exactly that prefix.

Losers get `versionConflict`; `submit` re-reads + re-decides (deterministic
decide over the new state) up to N retries — command-level rebase. Fold
purity + dense versions + atomic batches ⇒ replay is bit-for-bit repeatable.

`seq` (autoincrement) is PASSIVE global order: postgres assigns sequence
values at insert and never rolls them back, so seq has gaps and can disagree
with commit-visibility order (Dudycz, "ordering in postgres outbox" — a
poller can skip late-committing rows). No pollers exist yet;
`readAllChanges` documents the skew. The portable fix (counter-row
serialization) is ADR 0007. Per-stream consumption needs nothing:
(streamId, version) is gapless by construction.

## Consequences

- Empirically pinned by integration tests: a mid-batch duplicate version
  leaves ZERO rows (createMany all-or-nothing); Promise.all of conflicting
  appends yields exactly one success and typed conflicts for the rest.
- No isolation-level tuning, no deadlock analysis, no raw SQL.
