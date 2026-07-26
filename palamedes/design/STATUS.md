# Palamedes — project status

As of **2026-07-26**, branch `palamedes-api`, head `9378f3f2`, stacked on
`palamedes-persistence` head `6d46252e`. Updated once per milestone; each
update revises the date, the commit, and the sections below.

## Where the project stands

The recursive tournament meta-model is built, tested, and persisted: every
chess format is plain data interpreted by one engine, scoring and tiebreaks
are data too, and tournament definitions live in an event-sourced changelog
in Postgres seeded with the live lichess4545 leagues. The definition API's
read side is built and bearer-auth's security hard gate has shipped; the
write door (Task 15) is the one substantial piece left.

**Every choice still unmade lives in
[`design/open-decisions.md`](open-decisions.md)** — Task 15's shape and its
three newly-discovered requirements, the final whole-branch review, the
`/docs` human check, and what is deferred on purpose. Read it before picking
this branch back up.

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
  - The API chassis (Task 13): an `OpenAPIHono` app at `/api/v1`
    (`src/server/http/app.ts`), a real `/api/v1/health` route, the
    generated OpenAPI 3.1 document (`/api/v1/openapi.json`), and a Scalar
    docs page at `/docs`.
  - **The read API (Task 14)** — five routes under
    `src/server/http/routes/`: `GET /definitions` (list),
    `GET /definitions/{streamId}` (folded definition detail),
    `GET /definitions/{streamId}/changes` (the changelog),
    `GET /definitions/{streamId}/concrete` (the `concretify` projection,
    typed via a compile-time `ConcreteEvent` refinement, not a bare
    `z.unknown()`), and `GET /vocabulary` (registered kind names, with an
    honest description that pairing is open-world rather than a closed
    list — see ADR 0012). A shared error envelope + `apiDefaultHook`
    (`src/server/http/errors.ts`) and a global `onError` on `api`
    (`src/server/http/app.ts`) mean no unhandled throw or zod validation
    failure escapes as an undocumented raw response. All routes are
    anonymous-readable (ADR 0009 D1); none is bearer-gated yet.
  - **The bearer-verification hard gate (ADR 0018) is built**, not just
    designed: bounded non-blocking admission in
    `src/server/lichess/introspection.ts` (concurrency capped at 1,
    matching lichess's own global in-flight limit), single-flight
    de-duplication by SHA-256 token hash, a circuit breaker counting
    transport failures only (opens on 3 consecutive, half-opens after
    30s), serve-stale-within-the-standing-TTL on refusal, a best-effort
    revocation delete on an `invalid` verdict (with a
    `revocation-write-failed` diagnostic and a widened negative-cache
    window if that delete itself fails), and the two-tier reverification
    TTL (ADR 0014): `HIGH_PRIVILEGE_REVERIFY_AFTER_MS` = 10 minutes for a
    cached row carrying `web:mod`, else the standing 24h. Exactly one
    verifier is constructed per process — `src/server/lichess/verifier.ts`
    pins it on `globalThis` unconditionally, enforced by both a biome
    `noRestrictedImports` override and a test. What ADR 0018 does **not**
    cover, by design: per-IP fairness (ADR 0019) — that piece needs Task
    15's HTTP middleware and a deployment-stated trusted client key, and
    ships with no limiter at all absent one.
  - **Organizer-authored expressions are bounded at the wire boundary.**
    `src/tournament/expr/schema.ts`'s recursive schema is now private and
    unexported; the only export, `boundedExprSchema`, runs the iterative
    stack-safe `admitExprData` admission walk before any native recursion
    and is what both `src/chess/tiebreaks/wire.ts` and
    `src/chess/scoring-rules/wire.ts` parse expr refs through. No
    unbounded `exprSchema` identifier remains anywhere under `src/`.
  - **Degraded rankings are surfaced at the pairing seam (ADR 0015).**
    `buildPairingContext` (`src/tournament/engine.ts`) carries
    `unsplitCriteria` into `PairingContext.degraded` instead of discarding
    it, and `UnsplitCriterion.criterion` (`src/tournament/standings.ts`)
    is a readable `{ index, label, ref? }`, not a raw index — the failed
    rule now names itself.
  - **The kind-extensibility boundary is decided (ADR 0012).** Per
    typeclass: metrics and scorings are organizer-extensible today (the
    `"expr"` door); ties and seeds are designated next, unbuilt; encounters
    keep composition plus a recorded declarative-`outcome` direction;
    pairing is the one open-world typeclass and stays code, permanently.
    A 14-entry deferral ledger (including G7c, whole-subtree edit
    granularity under stream-level OCC) closes out this engagement's
    generality review.
  - **The docs site — verified as far as possible without a
    JS-executing browser.** `bun run openapi:spec` emits valid OpenAPI
    3.1.0 with 6 paths; `/docs`, `/api/v1/openapi.json`,
    `/api/v1/health`, and `/api/v1/definitions` all 200. Not verified:
    that `src/app/docs/page.tsx`'s client-side Scalar mount actually
    paints in a browser — it runs in a `useEffect`, so only a human with
    a real browser can confirm it.
  - Nothing on the read side is authenticated — the OpenAPI document
    declares a `LichessToken` bearer scheme, but no route enforces it, so
    the grants `permissions.ts` defines still have no enforcement point.
    That enforcement point is Task 15.

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
| [0012](adr/0012-kind-extensibility-boundary.md) | The kind-extensibility boundary + this engagement's deferral ledger | Accepted (2026-07-26) |
| [0013](adr/0013-ratify-definition-api-defaults.md) | Ratifying the seven definition-API defaults (D1–D7) | Accepted (2026-07-26) |
| [0014](adr/0014-token-revocation-ttl-policy.md) | Scope-conditional reverification TTL for high-privilege tokens | Accepted (2026-07-26) — **built** |
| [0015](adr/0015-degraded-ranking-policy.md) | A degraded final order is surfaced, never silently crowned | Accepted (2026-07-26) — **built** |
| [0016](adr/0016-registry-identity-reuse-vs-bump.md) | Every registry extension mints a new id, additive or not | Accepted (2026-07-26) |
| [0017](adr/0017-data-display-boundary.md) | Display consumes the read API's projection; the viewer's job stays open | Accepted (2026-07-26) |
| [0018](adr/0018-bounded-introspection-admission.md) | Bounded, non-blocking introspection admission | Accepted (2026-07-26) — **built** |
| [0019](adr/0019-bearer-rate-limit-placement.md) | Bearer rate limiting lives in the verifier; per-IP fairness needs a trusted client key | Proposed (2026-07-26) — genuinely unbuilt (needs Task 15's HTTP middleware) |

Nothing in the codebase implements 0006 or 0007 yet. 0009's auth stack, 0008's
full read side (Task 14), 0010, 0011, 0012's boundary, and 0014/0015's
mechanisms are all built — see "Built" above. 0018's verifier-side mechanism
is built (see "Built" above); its own status header still says Proposed,
which is stale against the code but hasn't been corrected — see
`open-decisions.md` for detail. 0019's per-IP layer is the one ADR here with
zero code behind it; it is genuinely Task 15's to build.

## Branch state

- `palamedes-persistence` — 13 unpushed commits, base `4a7c235c` → head
  `6d46252e`. Final whole-branch review verdict: merge-ready. Awaiting
  Dr. Dub's review.
- `palamedes-api` — stacked on that head, 9 further commits landed this
  session: `4a6eb000` (Task 14 read API), `bed77ed2` (ADR 0012), `b2053817`
  (ADRs 0013–0017), `5614c6ba` (ADRs 0018–0019), `66151daf` (open-decisions +
  STATUS true-up), `d83965ea` (the bearer hard gate — bounded admission +
  two-tier TTL), `760e75db` (ADR 0018 true-up + AGENTS verifier invariant),
  `d8a8242e` (bounded organizer expressions at the wire boundary), `9378f3f2`
  (degraded rankings surfaced at the pairing seam, ADR 0015). Head is
  `9378f3f2`. Everything under "Built" above is on this branch.

## In flight — the 2026-07-12 mandate

**Resumed under Dr. Dub's full decision authority, 2026-07-26.** Task 14 (the
read API) is done and committed. The hard gate (ADR 0018) and the
degraded-ranking surfacing (ADR 0015) — both originally scoped to ship
*inside* Task 15 — shipped ahead of it, as their own commits, this session.
[`open-decisions.md`](open-decisions.md) § 4 is the resume-here: Task 15, the
write door, is what remains of substance.

On `palamedes-api`: fully data-driven definitions, a generality review
(done — [reviews/2026-07-12-generality-review.md](reviews/2026-07-12-generality-review.md)),
a READ+WRITE OpenAPI API with lichess OAuth, and an OpenAPI docs site.

The auth stack, the API chassis, the read endpoints, the bearer hard gate,
and the expression-wire bound are all done — see "Built" above. Remaining:
the write endpoints themselves — see
`/home/lakin/.claude/plans/2026-07-12-palamedes-data-api.md` (Task 15) and
its brief, `.superpowers/sdd/task-15-brief.md` — plus Task 16 (now written as
ADR 0012, done) and Task 17 (final whole-branch review, not run).

Task 15 must also fold in three requirements discovered this session that its
brief does not yet carry: widen `errors.ts`'s `ApiErrorStatus`/`apiErrorCodes`
to carry 401/403/503 (ADR 0009 requires 503 on verifier `unavailable`; the
write door needs 401/403); enforce a request body-size cap *ahead of*
`JSON.parse` (`admitExprData` pushes a whole node's children onto its walk
stack before the node-count cap fires, so a hostile wide array allocates
before rejection — the size cap is the real backstop); and ship no per-IP
rate limiter at all unless a trusted client key exists (ADR 0019 — a limiter
keyed on a forgeable `X-Forwarded-For` lets an attacker get other users
rate-limited).

## Suite status

Typecheck clean, lint clean, full suite green, 0 skipped. Last observed at
this pass's commit: 513 passed / 0 failed. The count of tests isn't pinned
here as a promise — it grows every task and a hand-maintained number is stale
before the next commit lands. A static file count this pass found 43
`*.test.ts` files under `src/`, not the 45 recorded alongside the 513 figure;
the suite itself was not re-run to reconcile this (docs-only pass, no test
execution). Run `bun run test` for the current, authoritative count.

## How to run

- Commands: `palamedes/AGENTS.md` § Commands.
- Postgres + migrate/seed: the [runbook](persistence-runbook.md).
- `bun run db:seed` is idempotent and writes the `team4545` and `lonewolf`
  streams.

## Reference docs

- [`design/open-decisions.md`](open-decisions.md) — every open choice: owner,
  trade-off, current behavior, and the cost of leaving it unmade
- [`design/tournament-model.md`](tournament-model.md) — the meta-model
  contract (engine, kinds, `compose.ts`, viewer)
- [`design/persistence-runbook.md`](persistence-runbook.md) — operating the
  change store
- [`design/reviews/2026-07-12-generality-review.md`](reviews/2026-07-12-generality-review.md)
  — the generality review of the meta-model
- `ai-docs/db.md`, `ai-docs/testing.md`, `ai-docs/trpc.md` — schema/Prisma,
  testing, and tRPC/frontend task docs
- `AGENTS.md` — invariants and per-task doc routing
