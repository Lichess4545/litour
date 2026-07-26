# Open decisions

Every choice still open on `palamedes-api`, as of 2026-07-26. Head is still
at `2076063a` (API chassis) — nothing has landed a commit since. Task 14 (the
read API) is finished (§3) but, like everything else here, sits uncommitted in
the working tree. New since this was last true: ADRs 0012 through 0019, which
between them ratify every choice that used to live in §1, decide the hard
gate's design (§2), and close the ledger gap §5.5 used to flag.

The SDD ledger (`.superpowers/sdd/progress.md`) is a process log: it records
what happened, not what remains. This is the durable record of what remains.
It is grouped by urgency, and each entry names its owner. When a decision is
made, fold it into the ADR it belongs to and delete the entry here.

A note on vocabulary, because the API's own text depends on it: a changelog
entry is a **change**. It is never an "event" — `EventDef`/`EventState` are the
tournament itself.

---

## 1. Decided under Dr. Dub's standing grant

Dr. Dub granted full decision authority for this engagement — make the calls,
record them in ADRs. Everything this section used to list as open is now
decided. None of it is re-argued here: each ADR below carries the forces, the
option not taken, and the consequences in full; this table only points.

| Was | Decision | ADR |
|---|---|---|
| 1.1 Token revocation TTL | Two-tier: tokens carrying `web:mod` reverify at ~10 min; every other token keeps the 24h standing TTL | [0014](adr/0014-token-revocation-ttl-policy.md) |
| 1.2 Degraded rankings | Surface a degraded final order at the engine seams; never refuse the tournament | [0015](adr/0015-degraded-ranking-policy.md) |
| 1.3 Registry identity, reuse vs. bump | Any registry extension mints a new `id` — additive or not | [0016](adr/0016-registry-identity-reuse-vs-bump.md) |
| 1.4 The viewer / the data-display boundary | Display is a consumer of the read API's projection, never a second path into the engine | [0017](adr/0017-data-display-boundary.md) |
| 1.5 D1–D7 ratification | All seven ratified as-is (D5 is still unbuilt, and is therefore the cheapest of the seven to revisit) | [0013](adr/0013-ratify-definition-api-defaults.md) |

ADR 0017 is the one exception worth naming here: it explicitly leaves one
thing open — what the interactive viewer should be *good at* — as a stated
non-decision, not an oversight this ledger needs to keep tracking. Read the
ADR, not this row, for why.

---

## 2. Hard gate — must ship WITH the write endpoint

This is not a backlog item and it cannot land after the endpoint. The design is
now decided — [ADR 0018](adr/0018-bounded-introspection-admission.md) (bounded,
non-blocking admission; refusal serves stale within the standing TTL) and
[ADR 0019](adr/0019-bearer-rate-limit-placement.md) (a per-IP fairness limiter,
in HTTP middleware, gated on a trusted client key) — but neither is built yet.
Both ADRs are Proposed, not Accepted, precisely because "designed" and
"shipped" are different claims here; Task 15 builds both.

### 2.1 Rate-limit unauthenticated bearer attempts

**Corrected blast radius.** This entry previously said a token flood takes
"the entire API down for everyone." That was overstated. `createTokenVerifier`
consults the in-memory negative cache and then the persisted `LichessToken` row
*before* any network call, so a caller holding a fresh row is unaffected no
matter how many garbage tokens are hitting the verifier elsewhere; and
anonymous readers never invoke the verifier at all — no token means `def:read`
and nothing more (ADR 0009). The true blast radius is every bearer-carrying
request whose token has no row or a stale row: every write, and every
first-time authentication. Still severe — but not the whole API — and the
narrower statement is what names the mitigation precisely: ADR 0018 protects
lichess's introspection budget, not "the API" in the abstract.

**Superseded.** The "priced fix" this entry used to propose — single-flight
de-duplication plus a circuit breaker — is superseded by ADR 0018, which found
it insufficient on its own. Single-flight collapses only duplicate
*concurrent* attempts on the *same* token hash; N distinct garbage tokens still
cost N introspections regardless of how tightly concurrent duplicates are
collapsed. A circuit breaker alone is worse than insufficient — left to run the
show, it just implements the denial of service more tidily, converting a flood
into a permanently-open breaker. ADR 0018 decides bounded non-blocking
admission (default concurrency 1, matching lichess's own global limit) plus
serving stale-within-the-standing-TTL on refusal; single-flight and a breaker
survive as narrower, correctly-scoped pieces of that design, not as the fix on
their own.

**Still open.** ADR 0019 places per-IP fairness in HTTP middleware, gated on a
trusted client key existing for the deployment; if no deployment states one,
it ships with no per-IP limiter at all, and cold-token fairness under flood
stays unmitigated — that is ADR 0019's own stated consequence, not a gap this
ledger is separately tracking. Neither ADR is implemented. Task 15 builds both,
in the same commit series as ADR 0014's two-tier TTL (that ADR is a hard
precondition of this gate, not an independent follow-on).

### 2.2 Construct exactly one verifier per process

`createTokenVerifier` returns a closure, and the negative cache lives **inside**
that closure. A verifier constructed per request therefore starts with an empty
cache every time — silently disabling the very mechanism §2.1 depends on, with no
error and no test failure. It must be constructed once, at module scope.

**What is true today.** Both are still true and neither is mitigated, because
nothing calls the verifier yet: `createTokenVerifier` and
`grantsFor`/`canWriteStream`/`canCreateStream` have **zero production call sites**
outside their own modules. The OpenAPI document registers a `LichessToken` bearer
security scheme (`api.openAPIRegistry.registerComponent` in
`src/server/http/app.ts`), but no route enforces it. The auth stack is built and
unwired — which is exactly why this gate is still cheap to honor.

**Owner.** Delegator, as part of Task 15.

**If nobody decides.** There is nothing to decide. If it is merely *forgotten*,
the first write endpoint ships with a trivially-triggered, fail-closed,
whole-API denial of service.

---

## 3. Task 14 — finished, uncommitted

The read API is written, fixed up, and re-reviewed. What remains is the
historian commit.

**The tree.** Modified: `src/server/http/app.ts` (mounts the two routers,
rewrites the OpenAPI `description`), `src/server/http/app.test.ts`. New and
untracked: `src/server/http/errors.ts`, `src/server/http/routes/`
(`definitions-read.ts`, `definitions-read.test.ts`, `vocabulary.ts`,
`vocabulary.test.ts`). Five routes: list, detail, changelog, concrete
projection, vocabulary.

**The original fix batch — both items applied.**

1. The detail route's 500 description now names all three
   `ReadDefinitionError` causes: a corrupted row, an unknown schema revision,
   and a changelog that folds cleanly yet fails definition validation
   (`invalidPrefix`, `reason: "definition"`).
   **Correction to this ledger's own earlier claim:** this entry used to say
   "the changelog route's description has the same omission." That was false.
   `readChanges` (`src/server/tournament/change-store.ts`) returns only
   `notFound | corruptPayload | unknownSchemaRev` — `invalidPrefix` is
   structurally absent from its return type and is never constructed there, so
   the changelog route cannot surface it and its description needed no fix.
2. `src/server/http/app.ts` now registers a global `onError`, so an unhandled
   throw inside a handler returns the documented error envelope instead of
   hono's default plain-text 500.

**A further review round found four more, since applied:** a missing
`defaultHook` that let zod validation failures escape the error envelope as an
undocumented raw-zod 400 (`apiDefaultHook` is now wired into both routers, and
`invalid_request` was added to `apiErrorCodes`); the concrete route's
`z.unknown()` response given a compile-time constraint
(`.refine((value): value is ConcreteEvent => …)`); a corrected vocabulary-route
description; and a fourth `invalidPrefix` cause — `reason: "fold"` (the
changelog failing to fold into an intermediate definition at all, distinct
from folding cleanly and then failing validation) — to be added to the detail
route's prose.

**Verification note on that last one.** The first three are confirmed in the
current tree. The fourth is not, as of this pass: `definitions-read.ts`'s
detail-route description still enumerates only the three causes above and does
not separately mention `reason: "fold"`. Flagging rather than silently
asserting it's done — another agent may be mid-edit on `src/**` concurrently
with this pass, so confirm before treating it as landed.

The suite now stands at 419 passing.

**An owned call already made:** skip the nextjs-idiomatic review for Task 14.
It changed no file under `src/app/`; the Next surface is unchanged since Task
13's approval. The remaining reviewers (typescript-strict, poly-test-critic,
poly-doc-comment-critic re-review) applied clean, then the historian commit:
`feat(palamedes): read API — definitions, changelog, concrete projection, vocabulary`.

**Also note:** the ledger's task log for this engagement stops at Task 11. Tasks
12 (`70c91c8b`, scope→grant mapping) and 13 (`2076063a`, API chassis) are
committed but unrecorded there, and Task 14 is unrecorded because nothing here
has been committed yet. Do not read the ledger's last line as the branch's last
state; read `git log`.

---

## 4. Remaining mandate work

From the 2026-07-12 mandate, still unstarted (plan Tasks 15–17):

- **Task 15 — the write endpoints.** `POST /api/v1/definitions` (create a stream)
  and `POST /api/v1/definitions/{streamId}/changes` (append a batch with
  optimistic concurrency), bearer-gated through the verifier and the grant
  predicates. This is the CQRS write door: it speaks **changes**, never a whole
  definition. **Blocked by §2** — the rate limit ships with it or the API ships
  broken. Task 15 also now carries the `UnsplitCriterion`/`buildPairingContext`
  degraded-ranking surfacing (ADR 0015) and the two-tier TTL policy landing
  with the hard gate (ADR 0014).
- **Task 16 — now written as [ADR 0012](adr/0012-kind-extensibility-boundary.md)**,
  the kind-extensibility boundary (which typeclasses are data-definable, which
  stay code plugins) plus this engagement's deferral ledger, including **G7c**
  (see §5.5 — the earlier note that the ledger omitted it is stale).
- **Task 17 — final whole-branch review**, docs true-up, final STATUS.

**The docs site.** The mandate asks that the Scalar docs site be devenv-integrated
and viewable during development. What exists: `src/app/docs/page.tsx` and
`layout.tsx` mount `createApiReference` from `@scalar/api-reference` (^1.62.5), and
`bun run openapi:spec` emits the document via `scripts/emit-openapi.ts`. What has
**not** been verified: that `/docs` actually renders in a browser under
`bun run dev`. Nobody has looked at it. That is a two-minute manual check and it is
the honest last mile of the mandate's fourth clause.

**One action Dr. Dub must take before his next `devenv shell` or `direnv allow`:**
run `secretspec set BETTER_AUTH_SECRET` once, then remove `BETTER_AUTH_SECRET` from
his own untracked `.env`. A missing required secret makes the shell refuse to
enter — fail-fast, by design. The path is in the runbook, § Secrets (secretspec).

---

## 5. Deferred by design, and ledgered nits

Recorded so nobody rediscovers them as bugs. Nothing here is broken; each is a
choice already made, or a small debt with a named trigger.

### 5.1 Designed, not built

- **ADR 0006 — results as a second stream.** Proposed. Results are not persisted
  anywhere. Standings today are computed from a log that lives only in memory and
  in tests. Until this lands, the display mandate can describe how a tournament
  *works* but never how it *went*. Deferred by decision D3.
- **ADR 0007 — snapshots and a counter-row global order.** Proposed. Snapshots
  are worth building only when streams grow long; the counter row only when a
  projection or poller exists. Neither is true yet.
- **The `seq` commit-order skew.** `seq` is a passive autoincrement, so it has
  gaps and can disagree with commit-visibility order. Harmless with no pollers;
  the portable fix is ADR 0007's counter row. Documented at `readAllChanges`
  (`src/server/tournament/change-store.ts`).

### 5.2 Things that read like bugs and are not

- **`recordedAt` is a naive `TIMESTAMP(3)`.** The portable-Prisma subset (ADR
  0001) forbids `@db.Timestamptz`. Mitigation: the DAL — the single write door —
  sets `recordedAt: new Date()` explicitly on every row, and the adapter
  serializes UTC. The column default is a fallback and must never be relied on.
- **The bearer verifier's cache-failure rule is deliberately asymmetric.** A
  cache **read** failure returns `unavailable` (cannot read the cache = do not
  know = never answer `invalid`). A cache **write** failure is swallowed and the
  call still returns `valid` (lichess already vouched for the token; the row is a
  cache, not the source of truth — a failed cache write must not deny a legitimate
  user, it costs one extra introspection next time). This asymmetry reads as an
  inconsistency and **will** be "fixed" into a bug by a well-meaning reader. It is
  documented at both call sites in `src/server/lichess/introspection.ts`. It is
  here too, for the reader who greps the docs before the code.
- **`secretspec.toml` declares both secrets twice**, byte-identically under
  `[profiles.default]` and `[profiles.development]`. Profiles auto-inherit from
  default, so the development block is redundant. Left explicit deliberately —
  inheritance is documented but not observed here, and collapsing it risks a
  missing-required-secret break for zero behavioral gain. Safe follow-up if anyone
  wants it.
- **Better-auth's own `createSession` has no try/catch**, so a DB failure there
  escapes as a bare 500 rather than redirecting. Pre-existing library gap, not
  ours. File upstream if it is ever observed.

### 5.3 Debts with a named trigger

| Debt | Where | Trigger to act |
|---|---|---|
| `admitExprData` is a deliberate ~40-line structural duplicate of `admitDefData` | `src/tournament/expr/schema.ts`, `src/tournament/registry.ts` | Extract a shared `admitData(data, {maxDepth, maxNodes, what})` **if either ceiling ever changes** — two bounds that could silently drift apart |
| Walk-then-clone ordering, inherited from `admitDefData` | same two files | If ever hardened to clone-first-walk-the-clone, fix **both** sites so they keep mirroring |
| `parseExpr`/`safeParseExpr` have zero production callers | `src/tournament/expr/schema.ts` | **Verified still true.** These are the *bounded-admission* entry points (depth 200 / 50,000 nodes). The wire kinds consume the raw `exprSchema` directly (`src/chess/tiebreaks/wire.ts`, `src/chess/scoring-rules/wire.ts`), which carries no such bound. Task 14's read routes had no reason to parse an expr. **The trigger is now imminent:** every decision that blocked Task 15 (§1, ADR 0018/0019) is settled, making the write door the very next task — and it MUST route expr-bearing change payloads through the bounded entry point rather than re-inventing one |
| `RegistryId` is an unbranded string | `src/tournament/registry.ts` | Brand it once a second call site compares two |
| `DefinitionStream` has no `updatedAt` | `prisma/schema.prisma` | Add it before any ownership-transfer write path exists |
| The write API must preserve append-then-upsert ordering | Task 15 | Deliberate: there is no FK from change to stream (ADR 0003). If that ordering is ever revisited, revisit the missing FK with it |
| `src/server/db.ts` builds `PrismaClient` with no `log` config | — | Prisma is silent on a DB outage, so the verifier's `cache-read` problem reason is the only signal. Add logging if a DB incident is ever hard to diagnose |
| `expr` totality is proved by a smoke gate, not a checker | ADR 0011 | The gate does not enumerate every line shape an expr could meet (rounds beyond 1, leg contexts), so a residual runtime throw remains possible. The sharp fix is a static checker proving an expr total against the `ScoringKind` contract before it is accepted |

### 5.4 Test and doc nits, ledgered

- `wire.test.ts` pins a full reason string **including JSON key order**. If a
  harmless rewording breaks it, loosen it to `stringContaining("unknownAttribute")`
  — do not update it by reflex.
- Three cache-write-failure tests share a fixture and could fold into one (~15
  lines). **Deliberately kept**: each pins a distinct, nameable claim.
- `MAX_EPOCH_MS` is duplicated as a local const in the introspection test file
  (the production const is not exported). Export it if a third consumer appears.
- The expr schema's 35-alternative discriminator produces an unreadable rejection
  message. Ledgered, not fixed.
- `pointsSquared` is duplicated across two test files. Watch for a third.
- zod's `.default()` bypasses the base schema's validation for the default value
  itself — harmless today (one call site, a hardcoded valid literal).

### 5.5 Generality-review gaps: what closed, what didn't

Against `design/reviews/2026-07-12-generality-review.md`:

**Closed by shipped work.** G2 — the expression wire door (`d9b90340`, ADR 0011):
`"expr"` metric and scoring kinds parse an inline expression through `exprSchema`
at the boundary, so a new tiebreak is now genuinely definable from data.
G7a + G8 — pinned `schemaRev`/`registryId`/`actorId` columns and the
`UPCASTERS`/`upcastPayload` seam (`e8b948fa`, `26d5f187`, ADR 0010): reads surface
a typed `PayloadError` instead of throwing, and old revisions stay readable.
G3a/b/c — the `attribute` feed from persisted ratings (`6c4afee7`), the `unplayed`
accessor and the `calc` unary ops (`ae48a7fc`): ARO/AROC and the FIDE-2023
virtual-opponent shapes are expressible.

**Also closed — G1.** The boundary itself is decided: ADR 0012 (Task 16) states,
per typeclass, which are data-definable today (metrics, scorings — "finished
business"), which are next but unbuilt (ties, seeds), and which stay code by
decision, not default (encounters; pairing, the one open-world typeclass).
What was "still open" about G1 was the boundary question, not the full
extensibility of every typeclass — that per-typeclass work is what ADR 0012's
own table tracks going forward, not this ledger.

**Still open.** G3d (no rank accessor), G3e (scoring expressions cannot see
history, so a data-defined arena streak rule is impossible), G3f (`boardPoint`
takes a literal); G4 (the primary ranking criterion is hard-coded
`standingsPoints` and the refinement-vs-progression choice is a code flag, not
def data); G5 (`ByeRule` is a closed two-variant union); G6 (the viewer
question — ADR 0017); G7b (no cross-stream references; a stored definition
embeds its whole subtree by value); G7e (results — ADR 0006).

**G7c — closed.** It was open and missing from the planned deferral ledger; it
isn't anymore. [ADR 0012](adr/0012-kind-extensibility-boundary.md)'s ledger
(its G7c row) now carries it: `run-set` and `entries-set` replace whole
subtrees, so a one-tiebreak edit rewrites the pool and a one-seed edit rewrites
the entry list — correct today, concurrency-hostile the moment more than one
editor is expected on a stream. **Correction to this ledger's own earlier
framing:** the entry used to say optimistic concurrency conflicts "at
whole-run granularity." That conflated the OCC boundary with the edit-
granularity problem. OCC is per **stream**, not per run: `appendChanges`
compares `expectedVersion` against the stream's head version
(`change-store.ts`), so two editors working on two *unrelated* pools of the
*same* tournament conflict — not just two editors of the same run. ADR 0012
names the trigger to act: the moment more than one editor is expected on one
stream — a co-arbiter or delegated-write role — or the first `versionConflict`
observed in production against a stream with more than one actor.

### 5.6 A process lesson worth keeping

Never run a **mutating** reviewer (poly-test-critic mutates source to prove the
tests catch regressions) concurrently with read-only reviewers on a shared tree.
It has already happened once: two reviewers read files mid-mutation and reported
states that could not exist. Run the mutating one alone.
