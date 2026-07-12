# Palamedes — project status

As of **2026-07-12**, pending Task 4's commit (branch `palamedes-api`, stacked
on `palamedes-persistence` head `6d46252e`; head at last commit `e8b948fa`).
Updated once per milestone; each update revises the date, the commit, and the
sections below.

## Where the project stands

The recursive tournament meta-model is built, tested, and persisted: every
chess format is plain data interpreted by one engine, scoring and tiebreaks
are data too, and tournament definitions live in an event-sourced changelog
in Postgres seeded with the live lichess4545 leagues. New API work stacks
on `palamedes-api`.

## Built

Everything below exists on `palamedes-persistence` and is covered by the
suite (see "Suite status").

- **Engine** — `src/tournament/`: the recursive meta-model. No chess
  vocabulary inside; formats, kinds, and metrics are registered data.
  Contract: [`design/tournament-model.md`](tournament-model.md).
- **Expression language** — `src/tournament/expr/`: typed AST, schema,
  evaluator, and describer. Scoring, tiebreaks, and ranking are expressions,
  not code.
- **Chess vocabulary** — `src/chess/`: kinds, metrics, pairings, and the
  `compose.ts` authoring API. `src/chess/formats.ts` holds 23 real formats
  (World Championship, Candidates, Olympiad, Tata Steel, the Grand Chess Tour
  with whole tournaments nested inside it, lichess4545, …).
  `src/chess/tiebreaks/` defines the tiebreak library as data, including the
  live lichess4545 lonewolf tiebreaks (modifiedMedian, cumulativeOpposition).
- **Viewer** — `src/components/tournament/` rendered at `/tournaments`
  (`src/app/tournaments/`): interactive React Flow view of any definition.
  `/tiebreaks` renders the tiebreak library.
- **Persistence** — event-sourced definition changelog:
  - `DefinitionChange` table (`prisma/schema.prisma`), append-only, versions
    unique per stream.
  - Pure change domain — `src/tournament/changes/` (change types, fold,
    schema validation; no I/O).
  - Change-store DAL — `src/server/tournament/change-store.ts`, the single
    door to the table.
  - lichess4545 seeds — `bun run db:seed` writes the `team4545` and
    `lonewolf` league streams (via `src/server/tournament/seed.ts`).
  - Operations: [`design/persistence-runbook.md`](persistence-runbook.md).
  - **Hardened** (ADR 0010): every row pins `schemaRev`/`registryId`/`actorId`
    at write time; `DefinitionStream` (ownership) and `LichessToken`
    (bearer-token verification cache) tables; reads surface typed
    `PayloadError` (`corruptPayload`/`unknownSchemaRev`) instead of throwing,
    with an upcaster seam (`UPCASTERS`/`upcastPayload`, empty today) so old
    revisions stay readable forever.

## Designed, not built

ADRs in [`design/adr/`](adr/):

| ADR | Title | Status |
|---|---|---|
| [0001](adr/0001-storage-substrate-portable-prisma.md) | Storage substrate: existing Prisma + Postgres, portable-Prisma subset | Accepted (2026-07-02) |
| [0002](adr/0002-definition-changelog-model.md) | The definition changelog: changes, fold, batch-atomic validity | Accepted (2026-07-02) |
| [0003](adr/0003-optimistic-concurrency-via-unique-constraint.md) | Optimistic concurrency via the unique constraint; no transactions | Accepted (2026-07-02) |
| [0004](adr/0004-change-store-dal-boundary.md) | The change store is the single door; the change domain is pure | Accepted (2026-07-02) |
| [0005](adr/0005-lichess4545-seed-canon.md) | lichess4545 seed canon: the live site over the fork's defaults | Accepted (2026-07-02) |
| [0006](adr/0006-results-input-stream.md) | Results as a second stream: the engine's Input log | **Proposed** — designed, not built |
| [0007](adr/0007-snapshots-and-global-order.md) | Snapshots and a portable global-order counter row | **Proposed** — designed, not built |
| [0008](adr/0008-definition-api-hono-openapi.md) | The definition API: hono + zod-openapi, CQRS over the changelog | Accepted (2026-07-12) |
| [0009](adr/0009-lichess-oauth-and-permissions.md) | Lichess OAuth, bearer introspection cache, scope→permission mapping | Accepted (2026-07-12) |
| [0010](adr/0010-registry-identity-and-schema-evolution.md) | Registry identity and payload schema evolution are pinned per row | Accepted (2026-07-12) |

Nothing in the codebase implements 0006 or 0007 yet. 0008/0009 describe the
API/OAuth layer still ahead (see "In flight" below); 0010 is built — see
"Hardened" above.

## Branch state

- `palamedes-persistence` — 13 unpushed commits, base `4a7c235c` → head
  `6d46252e`. Final whole-branch review verdict: merge-ready. Awaiting
  Dr. Dub's review.
- `palamedes-api` — stacked on that head; ADR 0008, ADR 0009, and the
  persistence hardening (ADR 0010, commit `e8b948fa`) are in; this task
  (Task 4: read-path evolution) is next to land.

## In flight — the 2026-07-12 mandate

On `palamedes-api`: fully data-driven definitions, a generality review
(done — [reviews/2026-07-12-generality-review.md](reviews/2026-07-12-generality-review.md)),
a READ+WRITE OpenAPI API with lichess OAuth, and an OpenAPI docs site.

Remaining after this task: the expression wire door (new tiebreaks as data,
no code change), the expr substrate (unary ops, the `unplayed` accessor,
competitor attributes), secretspec provisioning, lichess OAuth browser
login, token introspection + the permission service, and the API skeleton
with its read/write endpoints and docs site — see
`/home/lakin/.claude/plans/2026-07-12-palamedes-data-api.md` (Tasks 5-17).

## Suite status

Pending Task 4's commit (will be repinned to that hash once the historian
commits): typecheck clean, lint clean, 279 tests passing, 0 skipped.

## How to run

- Commands: `palamedes/AGENTS.md` § Commands.
- Postgres + migrate/seed: the [runbook](persistence-runbook.md).
- `bun run db:seed` is idempotent and writes the `team4545` and `lonewolf`
  streams.

## Reference docs

- [`design/tournament-model.md`](tournament-model.md) — the meta-model
  contract (engine, kinds, `compose.ts`, viewer)
- [`design/persistence-runbook.md`](persistence-runbook.md) — operating the
  change store
- [`design/reviews/2026-07-12-generality-review.md`](reviews/2026-07-12-generality-review.md)
  — the generality review of the meta-model
- `ai-docs/db.md`, `ai-docs/testing.md`, `ai-docs/trpc.md` — schema/Prisma,
  testing, and tRPC/frontend task docs
- `AGENTS.md` — invariants and per-task doc routing
