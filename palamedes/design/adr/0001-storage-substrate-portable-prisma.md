# ADR 0001 — Storage substrate: existing Prisma + Postgres, portable-Prisma subset

Status: Accepted (2026-07-02)

## Context

Tournament definitions need durable storage. The workspace already runs
Prisma 7.8 (generator `prisma-client` → `src/generated/prisma`, driver
adapter `@prisma/adapter-pg`) against the devenv PostgreSQL 18. The one hard
constraint from Dr. Dub: no provider-specific tooling — only general Prisma,
so the store could also run on postgresql (his phrasing; sqlite was
permission, not mandate).

We evaluated event-store libraries. Emmett 0.42.3 was rejected: it is
pre-1.0, its stores are raw-SQL (no Prisma), and it is legally UNLICENSED —
all-rights-reserved across all published versions (an RFC PR proposing
AGPL/SSPL is open). Ideas were borrowed (read shape `{changes,
currentVersion}`, the command-handler retry loop); no code. castore is
dormant (zod v3, no sqlite); KurrentDB needs an external server. No credible
Prisma-backed event-store library exists on npm. Verdict: hand-roll (~200
typed lines on Prisma).

## Decision

Build on the EXISTING palamedes Prisma + devenv Postgres. The changelog
schema and every DAL query stay inside a documented portable-Prisma subset
that would also run on sqlite unchanged:

1. `Json` columns are portable (TEXT on sqlite) — but treat payloads as
   OPAQUE whole values: no Json filtering, no Json defaults.
2. No Prisma enums — `String` + zod (new change types must not require
   migrations; sqlite doesn't enforce enums anyway).
3. Forbidden: scalar lists (`String[]`), all `@db.*` natives,
   `@@schema`/multiSchema, full-text, `dbgenerated()`, `Unsupported()`,
   index `USING`.
4. Global-order column: `Int @default(autoincrement())`, NOT BigInt (BigInt
   autoincrement is broken at runtime on sqlite — prisma#20449, #13178). Int
   caps at 2^31 — fine at this scale; upgrade path: widen to BigInt in a
   postgres-only deployment, or introduce the counter row of ADR 0007.
5. No Decimal. Plain DateTime/`@updatedAt`/`cuid()`/`uuid()`/`now()` are
   portable.
6. Default constraint/index names (no `map:`).
7. `createMany`/`upsert` are portable BUT `skipDuplicates` is NOT (no
   sqlite) — never use it.
8. Never pass `isolationLevel` to `$transaction` (sqlite is
   Serializable-only; pg defaults ReadCommitted).
9. No `mode: "insensitive"`, no relationLoadStrategy, no
   `$queryRaw`/`$executeRaw` in the store (the one allowed raw is the
   existing `SELECT 1` reachability probe in `src/test/db.ts`).
10. The SCHEMA is portable; MIGRATION FILES are not (`migration_lock.toml`
    pins the provider). Multi-provider = one schema + per-provider
    migrations dirs via `--config` — adopt only if a sqlite mode activates.

## Consequences

- The store runs on the existing database; no new services, no new deps.
- Payload queries (find by content) are out — reads fold changes instead.
- A future sqlite mode is a migrations-dir exercise, not a schema rewrite.
