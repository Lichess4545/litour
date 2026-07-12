# Palamedes — project status

As of **2026-07-13**, pending this task's commit (branch `palamedes-api`,
stacked on `palamedes-persistence` head `6d46252e`; head at last commit
`ae48a7fc`). Updated once per milestone; each update revises the date, the
commit, and the sections below.

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
  not code. Complete for this engagement's scope: the `expr` wire door (an
  inline expression stands in for any tiebreak or scoring rule — no new
  registered kind, ADR 0011), the `calc` unary ops and `unplayed` accessor,
  and the `attribute` op fed from persisted `CompetitorDef.rating` (AROC/ARO
  tiebreaks as data).
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
- **Auth stack** (ADR 0009), complete end to end:
  - "Sign in with lichess" — Better Auth's `genericOAuth` plugin, PKCE
    public client, no client secret (lichess issues none).
  - Bearer-token verification — `src/server/lichess/introspection.ts`:
    `POST /api/token/test`, a hashed `LichessToken` cache, 24h reverify, an
    in-memory 5-minute negative cache, and fail-closed `unavailable` on any
    lichess outage (never falls back to anonymous).
  - Scope→grant mapping + ownership predicates —
    `src/server/lichess/permissions.ts`: ADR 0009's D1 table as code
    (`grantsFor`), plus `canWriteStream`/`canCreateStream`.
  - The API chassis now exists (Task 13): an `OpenAPIHono` app at
    `/api/v1` (`src/server/http/app.ts`), a real `/api/v1/health` route,
    the generated OpenAPI 3.1 document (`/api/v1/openapi.json`), and a
    Scalar docs page at `/docs`. Not yet built: any read or write
    endpoint. Nothing is authenticated — the document declares a
    `LichessToken` bearer scheme, but no route enforces it, so the grants
    `permissions.ts` defines still have no enforcement point.

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
| [0011](adr/0011-expression-wire-door.md) | Inline expressions are the wire door for data-defined tiebreaks and scorings | Accepted (2026-07-12) |

Nothing in the codebase implements 0006 or 0007 yet. 0009's auth stack is
now built (see "Auth stack" above); 0008's API chassis is built (Task 13 —
see "Auth stack" above), its read and write endpoints are still ahead (see
"In flight" below); 0010 and 0011 are built — see "Hardened" and
"Expression language" above.

## Branch state

- `palamedes-persistence` — 13 unpushed commits, base `4a7c235c` → head
  `6d46252e`. Final whole-branch review verdict: merge-ready. Awaiting
  Dr. Dub's review.
- `palamedes-api` — stacked on that head; ADR 0008, ADR 0009, persistence
  hardening (ADR 0010, `e8b948fa`), the read-path upcaster seam (`26d5f187`),
  non-throwing expr evaluation (`d808f1ee`), the expression wire door (ADR
  0011, `d9b90340`), the `calc`/`unplayed` ops (`ae48a7fc`), secretspec
  provisioning, lichess OAuth login, bearer-token introspection, and now
  this task's scope→grant mapping + ownership predicates are in, plus Task
  13's API chassis (hono + zod-openapi under `/api/v1`, the health route,
  the OpenAPI 3.1 document, `/docs`) — both pending the historian commit.

## In flight — the 2026-07-12 mandate

On `palamedes-api`: fully data-driven definitions, a generality review
(done — [reviews/2026-07-12-generality-review.md](reviews/2026-07-12-generality-review.md)),
a READ+WRITE OpenAPI API with lichess OAuth, and an OpenAPI docs site.

The auth stack (login, introspection, permissions) is done, and so is the
API skeleton itself (Task 13) — see "Auth stack" above. Remaining: the
read and write endpoints and their bearer gate — see
`/home/lakin/.claude/plans/2026-07-12-palamedes-data-api.md` (Tasks 14-17).

Hard gate before the write endpoints ship: unauthenticated bearer attempts
must be rate-limited first. lichess allows only one in-flight introspection
request globally and 429s beyond it (see
`src/server/lichess/introspection.ts`); a flood of distinct garbage tokens
reaching the API would turn every auth into `unavailable` and, correctly
fail-closed (ADR 0009), take the whole API down.

## Suite status

Typecheck clean, lint clean, full suite green, 0 skipped. The count of
tests isn't pinned here — it grows every task and a hand-maintained number
is stale before the next commit lands. Run `bun run test` for the current
count.

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
