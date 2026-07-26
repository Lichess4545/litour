# Open decisions

Every choice still open on `palamedes-api`, as of 2026-07-26. Head is now
`9378f3f2` — nine commits landed since the API-chassis head (`2076063a`) this
entry used to cite: Task 14 (the read API, `4a6eb000`), ADRs 0012 through 0019
(`bed77ed2`, `b2053817`, `5614c6ba`), the open-decisions/STATUS true-up this
entry supersedes (`66151daf`), **the hard gate itself, shipped in code**
(`d83965ea`), an ADR 0018 true-up (`760e75db`), the bounded-expression wire
fix (`d8a8242e`), and the degraded-ranking surfacing (`9378f3f2`). Everything
that used to live in §1 (owned-call decisions) is folded into its ADR; §2 (the
hard gate) is no longer pending — it shipped this session, ahead of Task 15
rather than inside it; §3 (Task 14) is committed, not merely finished; §5.5's
ledger gap (G7c) is closed by ADR 0012.

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

## 2. Hard gate — SHIPPED (`d83965ea`), ahead of the write endpoint it was scoped to

This was a "must ship WITH the write endpoint" item; it no longer is one,
because it already shipped, in its own commit, before Task 15 exists.
[ADR 0018](adr/0018-bounded-introspection-admission.md) (bounded, non-blocking
admission; refusal serves stale within the standing TTL) is built in
`src/server/lichess/introspection.ts`: verified in the tree —
`AdmissionRefusalReason`, the concurrency-1 admission gate, single-flight
de-duplication by SHA-256 hash, a circuit breaker counting transport failures
only, and the two-tier reverification TTL from
[ADR 0014](adr/0014-token-revocation-ttl-policy.md)
(`HIGH_PRIVILEGE_REVERIFY_AFTER_MS` = 10 min for a cached row carrying
`web:mod`, else the standing 24h) are all present and exercised by
`introspection.test.ts`.

**A documentation gap, not a code gap.** ADR 0018 and ADR 0014 both still read,
in their own body prose, as if this were future work bundled into Task 15 —
ADR 0018's own status header says `Proposed`, and ADR 0014 says "This ships
INSIDE Task 15, not as a distinct gated follow-on." Neither statement is true
of the code anymore: the mechanism shipped as commit `d83965ea`, standalone,
and commit `760e75db` ("ADR 0018 true-up") documented the defects found while
building it without flipping the status header. This ledger cannot fix that —
see `.superpowers/sdd/progress.md`'s session true-up for the full note —
flagging it here so nobody re-derives or re-schedules work that is already
done.

**Three review rounds found nine defects, every one proved by execution** —
recorded in full in `.superpowers/sdd/progress.md` and in ADR 0018's own
Consequences section. Two were auth bypasses (a revoked token served `valid`
via a stale cached row; a TOCTOU where a pre-admission snapshot was served
after the gate). Both are fixed in the shipped code.

**What ADR 0018 does not cover, by design — ADR 0019's per-IP layer is
genuinely still unbuilt.** [ADR 0019](adr/0019-bearer-rate-limit-placement.md)
places per-IP fairness in HTTP middleware, gated on a trusted client key
existing for the deployment; if no deployment states one, it ships with no
per-IP limiter at all, and cold-token fairness under flood stays unmitigated —
that is ADR 0019's own stated consequence. This piece has no code yet because
it needs Task 15's HTTP auth middleware to exist at all. **Task 15 must build
it**, per ADR 0019, with the trusted-client-key caveat carried forward (see §4).

### 2.1 Construct exactly one verifier per process — DONE

`createTokenVerifier` returns a closure, and the negative cache lives
**inside** that closure. This is now mitigated: `src/server/lichess/verifier.ts`
constructs it once and pins it on `globalThis` unconditionally (not dev-only,
unlike the `PrismaClient` precedent in `db.ts` — a duplicate verifier here
doubles lichess-facing concurrency against a global limit of 1). Enforced two
ways: a biome `noRestrictedImports` override blocking `createTokenVerifier`
outside `verifier.ts` (a speed bump — it matches literal import specifiers
only), and `verifier.test.ts`, which pins that two imports of the module,
even across a module reset, yield the identical function object.

**Still true, and now the actual remaining item:** `createTokenVerifier` and
`grantsFor`/`canWriteStream`/`canCreateStream` have **zero production call
sites** outside their own modules and `verifier.ts`. The OpenAPI document
registers a `LichessToken` bearer security scheme
(`api.openAPIRegistry.registerComponent` in `src/server/http/app.ts`), but no
route enforces it. Task 15 is what wires the verifier and the grant
predicates into an actual auth-gated route.

---

## 3. Task 14 — DONE, committed (`4a6eb000`)

The read API is written, fixed up, re-reviewed, and landed. Nothing remains
here.

**What shipped.** Five routes under `src/server/http/routes/`
(`definitions-read.ts` + `.test.ts`, `vocabulary.ts` + `.test.ts`): list,
detail, changelog, concrete projection, vocabulary — plus `errors.ts` (the
error envelope, `apiDefaultHook`) and a global `onError` on `api`
(`src/server/http/app.ts`).

**Every fix from every review round is confirmed in the tree, including the
one this ledger previously flagged as unconfirmed.** The detail route's 500
description now names all four `invalidPrefix` causes, including the fourth
that a prior pass of this ledger could not confirm —
`definitions-read.ts`'s detail-route description now reads "a changelog whose
changes cannot be folded together at all (a structurally inapplicable
change, or a stream with no changes recorded against it)," which is exactly
the `reason: "fold"` cause in prose. Also confirmed: `apiDefaultHook` wired
into both routers with `invalid_request` in `apiErrorCodes`; the concrete
route's response narrowed by `.refine((value): value is ConcreteEvent =>
…)`, not a bare `z.unknown()`; and the vocabulary route's description
correctly stating pairing is open-world rather than claiming the whole
vocabulary is closed.

Historian commit: `4a6eb000`,
`feat(palamedes): read API — definitions, changelog, concrete projection, vocabulary`.
Suite stood at 419 passing at this commit; 513 by branch head (`9378f3f2`) —
see `.superpowers/sdd/progress.md`'s session true-up for a caveat on that
final count (a static file-count check found 43 test files, not the 45
recorded alongside it; not independently re-run).

---

## 4. Task 15 — the write door. What remains of substance.

Everything else the 2026-07-12 mandate asked for is built. This is the one
piece left before the mandate is feature-complete.

**The endpoints.** `POST /api/v1/definitions` (create a stream) and
`POST /api/v1/definitions/{streamId}/changes` (append a batch with optimistic
concurrency), bearer-gated through `verifyLichessToken`
(`src/server/lichess/verifier.ts`) and the grant predicates
(`grantsFor`/`canCreateStream`/`canWriteStream`, `src/server/lichess/permissions.ts`).
This is the CQRS write door: it speaks **changes**, never a whole definition.
Its brief is `.superpowers/sdd/task-15-brief.md`. It also carries §1.5's D5
(client-chosen stream ids, still unbuilt — see ADR 0013) and §2.1's actual
wiring (constructing the first route that calls the verifier at all).

**Three requirements this session found, that the brief does not yet carry —
fold these in before or during implementation:**

1. **Widen `errors.ts`.** `ApiErrorStatus` is `400 | 404 | 409 | 422 | 500`
   today (confirmed in the tree) and `apiErrorCodes` has no `unavailable` or
   `unauthorized`/`forbidden` code. ADR 0009 requires a 503 when the verifier
   returns `unavailable`; the write door itself needs 401 (no/invalid bearer)
   and 403 (valid bearer, insufficient grant). Widen both while keeping
   `toErrorResponse`'s `assertNever`-backed exhaustiveness check intact, per
   ADR 0019's own note on this exact requirement.
2. **A request body-size cap ahead of `JSON.parse`.** `admitExprData`
   (`src/tournament/expr/schema.ts`) pushes a whole node's children onto its
   walk stack before its node-count cap fires — so a single hostile wide
   array allocates before the admission walk ever gets to reject it. The
   node-count/depth bound is real but it is not the backstop against a large
   payload; a body-size cap enforced before `JSON.parse` is.
3. **Ship no per-IP limiter at all absent a trusted client key.** Per
   ADR 0019: a limiter keyed on a forgeable `X-Forwarded-For` lets an
   attacker get *other* users rate-limited — trading one denial-of-service
   vector for another dressed as a fix. If no deployment has stated a
   trusted-proxy contract, Task 15 ships the endpoint with no per-IP
   fairness layer, not a fake one.

**Already built, not Task 15's to redo:** the hard gate (§2), the two-tier
TTL (ADR 0014), and the degraded-ranking surfacing at
`buildPairingContext`/`UnsplitCriterion` (ADR 0015) — all three shipped as
their own commits this session (`d83965ea`, `9378f3f2`), ahead of this task
rather than inside it as originally scoped.

**Task 16 — DONE, written as [ADR 0012](adr/0012-kind-extensibility-boundary.md)**
(`bed77ed2`): the kind-extensibility boundary (which typeclasses are
data-definable, which stay code plugins) plus this engagement's 14-row
deferral ledger, including **G7c** (§5.5 — closed, not merely un-omitted).

**Task 17 — final whole-branch review — NOT RUN.** Still the last item of the
mandate once Task 15 lands.

**The docs site — partially verified, not by a human yet.** What has been
checked without a browser: `bun run openapi:spec` emits valid OpenAPI 3.1.0
with 6 paths; `/docs`, `/api/v1/openapi.json`, `/api/v1/health`, and
`/api/v1/definitions` all 200. What has **not** been verified: that
`src/app/docs/page.tsx`'s `createApiReference` mount — it runs inside a
client `useEffect` — actually paints in a browser. That is still a
two-minute manual check and still the honest last mile of the mandate's
fourth clause.

**One action Dr. Dub must take before his next `devenv shell` or `direnv allow`:**
run `secretspec set BETTER_AUTH_SECRET` once, then remove `BETTER_AUTH_SECRET` from
his own untracked `.env`. A missing required secret makes the shell refuse to
enter — fail-fast, by design. The path is in the runbook, § Secrets (secretspec).

**Not ours, do not absorb.** Four repo-root files (`.env.dev`, `.env.example`,
`README.md`, `devenv.nix`) are modified in the working tree by concurrent
work outside this branch's scope — a Postgres port move from 5432 to 5435 so
the Django project can coexist with palamedes' own devenv. Left unstaged
deliberately; a successor should not mistake them for this engagement's or
revert them. `db-prompt.txt` likewise stays untracked and untouched. (Two
stash entries reportedly also exist, untouched — this pass had no git access
to confirm that independently; recorded as given.)

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

**CLOSED this session:** `parseExpr`/`safeParseExpr` (`src/tournament/expr/schema.ts`)
used to have zero production callers, with the wire kinds parsing the raw,
unbounded `exprSchema` directly. Commit `d8a8242e` fixed it: the recursive
schema (renamed `rawExprSchema`) is now private and unexported;
`boundedExprSchema` — the only export, running the iterative `admitExprData`
admission walk before any native recursion — is what both
`src/chess/tiebreaks/wire.ts` and `src/chess/scoring-rules/wire.ts` parse expr
refs through. No unbounded `exprSchema` identifier remains under `src/`
(verified: empty grep). No open row remains for this.

| Debt | Where | Trigger to act |
|---|---|---|
| `admitExprData` is a deliberate ~40-line structural duplicate of `admitDefData` | `src/tournament/expr/schema.ts`, `src/tournament/registry.ts` | Extract a shared `admitData(data, {maxDepth, maxNodes, what})` **if either ceiling ever changes** — two bounds that could silently drift apart |
| Walk-then-clone ordering, inherited from `admitDefData` | same two files | If ever hardened to clone-first-walk-the-clone, fix **both** sites so they keep mirroring |
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
`"expr"` metric and scoring kinds parse an inline expression through the
expr schema at the boundary, so a new tiebreak is now genuinely definable
from data. That boundary was itself hardened later this session (`d8a8242e`,
see §5.3): both wire kinds now route through `boundedExprSchema`, not a raw
unbounded schema.
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
