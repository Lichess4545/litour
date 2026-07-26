# ADR 0018 — Bounded, non-blocking introspection admission; refusal serves stale within the standing TTL

Status: Accepted (2026-07-26)

Supersedes the "priced fix" framing in `design/open-decisions.md` § 2.1;
hard precondition of ADR 0014.

## Context

Lichess permits exactly one in-flight introspection globally per app and
429s beyond it — a budget that cannot be bought larger. `createTokenVerifier`
(`src/server/lichess/introspection.ts`) is fail-closed by ADR 0009 and must
stay so: a verification outage returns `unavailable`, never anonymous.

An unauthenticated attacker with a list of distinct random strings produces
distinct cold hashes. Single-flight de-duplication, keyed on the SHA-256
hex, cannot collapse them — it collapses only duplicate concurrent attempts
on the *same* hash, and N distinct tokens still cost N introspections. A
token-shape prefilter cannot reject them either: any shape is free for an
attacker to satisfy, and ADR 0009 already forbids parsing token prefixes
for a decision (`lio_`/`liu_` are "convention only, never parsed"). The
verifier holds no signal anywhere that distinguishes an attacker's cold
hash from a first-time legitimate user's — both are, structurally, a hash
this process has never seen before. ADR 0014's 10-minute high-privilege
reverification window multiplies traffic through precisely this bottleneck,
which is why that ADR names this one a hard precondition rather than a
nice-to-have.

Two mitigations were considered and are recorded here as rejected, because
both were tempting enough to need the refusal on paper:

- **Single-flight alone is insufficient.** It is retained — for ADR 0014's
  sake, so a busy moderator's concurrent requests collapse to one
  introspection — but it is good citizenship toward a single hot token, not
  a flood defence against many distinct ones.
- **A circuit breaker alone is harmful.** Left to run the show, it converts
  a flood into a permanently-open breaker: the attacker still achieves a
  total, sustained denial of introspection, just implemented more tidily by
  our own code. It earns its place below as a way to stop hammering a
  lichess that is already down, not as the mitigation for a flood of
  distinct tokens.
- **A token-shape prefilter is worthless.** It reduces the flood by exactly
  zero — an attacker satisfies any shape constraint for free — while adding
  a fail-closed rejection path that breaks legitimate users the day lichess
  changes a convention it never promised to keep.

## Decision

1. **Single-flight de-duplication**, keyed on the SHA-256 hex (never the
   raw token). A joiner — a second caller arriving for a hash already
   in flight — is admitted unconditionally, because joining costs no
   lichess budget; it awaits the in-flight result rather than issuing its
   own request. The in-flight map entry and the concurrency slot it holds
   are released in a creator-only `finally`, so a joiner never releases
   what it didn't acquire.
2. **Bounded, non-blocking admission.** Introspection concurrency is capped
   at a default of 1 — equal to lichess's own global limit — and admission
   is non-blocking: no queue, no waiting room, no timers. A request that
   finds the budget already spent is refused immediately, not parked.
3. **A circuit breaker counts transport failures only** — network/timeout
   errors and any non-2xx response, including 429 and 5xx. It does *not*
   count `body`, `schema`, `missing-entry`, or `cache-read` — for each of
   those, lichess answered fine (the fault is in how we parsed or stored
   the answer) or the fault is ours outright (a Postgres outage), and
   neither should open a breaker meant to protect lichess from us. Opening
   on a `schema` failure would be especially self-defeating: it would
   suppress the exact diagnostic that says "lichess renamed a field" behind
   a generic `unavailable`. The breaker opens on 3 consecutive counted
   failures, half-opens for a single probe 30 seconds after the failure
   that tripped it (measured from `now`, per the module's existing
   `now`-injection contract), and while open returns `unavailable` —
   never `invalid`, and never overriding a decision already derivable
   without the network (a malformed token, a negative-cache hit, or a
   fresh cache row all still answer as they do today).
4. **Refusal or an open breaker serves stale, not silence.** If a known row
   is past its reverify window (`REVERIFY_AFTER_MS`, or ADR 0014's shorter
   high-privilege window once that ships) but still inside the same
   `REVERIFY_AFTER_MS` ceiling, it is served as `valid` with a
   `stale-served` diagnostic rather than forced through a re-introspection
   the admission gate has no budget for. A cold hash — no row at all — and
   a row already past the 24h ceiling both get `unavailable`: there is
   nothing stale to fall back to.
5. **An `invalid` verdict deletes the cached positive row.** Decision 4
   serves a known row as stale past its reverify window; without this
   delete, that branch would resurrect a just-revoked row once the 5-minute
   negative-cache entry protecting it lapses — a revoked moderator
   authenticating for up to the 24h ceiling. The delete is best-effort: its
   failure is reported and swallowed rather than denying the caller, and it
   gets its own diagnostic (`revocation-write-failed`) distinct from the
   benign `cache-write` failure, so on-call can tell "a cache write missed,
   costs one extra introspection" from "a revocation didn't land, the
   revoked row is still servable." That distinction is the point: *best-
   effort is a property of the consequence, not of the table* — a write that
   looks like a cache eviction but is really a revocation cannot be allowed
   to fail as silently as an ordinary cache miss can. So when the delete
   does not land, the negative-cache entry is widened from
   `NEGATIVE_CACHE_MS` (5 minutes) to the full standing TTL
   (`REVERIFY_AFTER_MS`) — it now covers exactly what the delete failed to
   cover, rather than lapsing on its own unrelated schedule. This closes the
   revocation case only; a scope *downgrade* still yields no `invalid`
   verdict and no delete (see Consequences).
6. **The negative cache is re-read at the refusal point, not trusted from
   entry.** `cached` is read from Postgres before the admission gate; a
   concurrent introspection of the same hash can prove the token revoked
   and delete that row in between — single-flight does not collapse the
   two calls, because the first had already settled by the time the second
   reached admission. A snapshot read before a gate is stale at the gate,
   so the in-memory negative cache — cheap enough to check that there is no
   reason not to — is re-read immediately before a refusal serves stale,
   not carried forward from the read that happened before the gate.

### Option not taken

**A bounded queue with a wait deadline.** Rejected: it converts a fast,
honest 503 into a slow 503 that also holds open a connection and a socket
while it waits — strictly worse under flood than refusing immediately.

## Consequences

- ADR 0014's short TTL becomes best-effort tightening rather than a firm
  guarantee: under introspection pressure it degrades to the standing 24h
  TTL and can never degrade below it. A token flood can delay a moderator's
  revocation check but cannot log a moderator out. This is exactly why ADR
  0014 cannot ship without this ADR.
- **Scope downgrades are not covered by decision 5, and this is accepted.**
  That rule fires only on an `invalid` verdict; a `valid` verdict carrying
  FEWER scopes than the cached row deletes nothing. If admission is then
  refused while that row is still inside its window, the caller receives
  the older, wider scopes for up to the standing TTL — and an attacker can
  force that window open on demand by flooding admission. This is stated
  here as an accepted consequence of this ADR plus ADR 0014, not as an open
  bug to fix.
- Under sustained flood, first-time bearer authentication degrades to
  best-effort too. This is **accepted, not solved** — no mechanism internal
  to the verifier can fix it, because a cold hash from an attacker and a
  cold hash from a first-time user are indistinguishable at this layer. ADR
  0019 exists to cover the fairness question this leaves open.
- The negative cache's boundedness (`NEGATIVE_CACHE_MAX`) stops being the
  load-bearing defence against a flood; admission caps what reaches lichess
  at the source, and the negative cache goes back to being what its name
  says — a cache, not a rate limiter.
- The in-flight map is bounded by construction: its entries are a subset of
  outstanding concurrency-slot holders, so no separate sweep or size cap is
  needed for it.
- All of this state — the in-flight map, the concurrency slot, the breaker —
  is **per process**. N app instances multiply lichess-facing load by N, and
  each instance keeps its own breaker with no shared view of the others.
  Acceptable at one instance; horizontal scaling requires revisiting this
  ADR *before* scaling, not after the fact.
- **The one-verifier-per-process rule is pinned by a test**, not only by the
  biome `noRestrictedImports` override that already blocks
  `createTokenVerifier` outside `verifier.ts`: that rule matches literal
  import specifiers, so a relative-path import, a namespace import, or a
  dynamic `import()` all evade it — a speed bump, not a boundary. The test
  asserts that the set of non-test files importing `createTokenVerifier` is
  exactly `{src/server/lichess/verifier.ts}`. The `globalThis` pin itself is
  unconditional — not dev-only, unlike the `PrismaClient` precedent in
  `db.ts` — because a duplicate verifier here doubles lichess-facing
  concurrency against a global limit of 1, rather than merely costing a
  second database connection.
- A leaked admission slot — acquired but never released — is a permanent,
  silent, total outage of introspection for the life of the process. The
  creator-only `finally` release is load-bearing and must stay pinned by
  tests.
- **Work performed while holding the single admission slot is now
  deadline-bounded** (`slotHeldWorkTimeoutMs`, default 5s), covering the
  `upsert`, the `deleteMany`, and `response.body.cancel()`. Without it, a
  hanging Postgres call or a hanging body-cancel parks the only slot — a
  total introspection outage for as long as it hangs, proven by execution,
  not theorised. Be honest about what that deadline does not buy: it frees
  the *admission slot*, not the Postgres connection underneath it — Prisma
  cannot cancel a query, so the query keeps running and the connection stays
  checked out. That is the right trade, because the slot is the globally
  scarce thing (one per process) and connections are pooled — but it means
  DB connection residency remains bounded only by Postgres, since
  `src/server/db.ts` sets no `statement_timeout` or query timeout. Named
  follow-up, with its trigger stated here: the proper fix for a hanging
  `lichess_token` lock wait is a `statement_timeout` on the pool, which
  lives outside the verifier and is not built by this ADR.
- **The breaker's re-open window is measured from settlement, not from
  probe start.** Measuring from probe start would make the effective
  cooldown `breakerOpenMs − probeDuration` — demonstrated to allow
  back-to-back probes with zero delay once probe duration approached the
  window itself.
- The `IntrospectionProblem` union widens with four new variants —
  `revocation-write-failed`, `throttled`, `stale-served`, `unexpected` —
  each still carrying only the token hash and an `Error.name` where
  applicable, never the raw token, per the existing constraint on every
  other variant in that union.
