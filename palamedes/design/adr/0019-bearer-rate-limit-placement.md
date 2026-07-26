# ADR 0019 — Bearer rate limiting lives in the verifier; per-IP fairness lives in HTTP and requires a trusted client key

Status: Proposed (2026-07-26)

## Context

The scarce resource is lichess's introspection budget, and the *only* code
that consumes it is the verifier closure built by `createTokenVerifier`
(`src/server/lichess/introspection.ts`). HTTP middleware sees requests, not
introspections, and can only count the former. That one HTTP request
currently costs about one introspection is an accident of today's wiring,
not an invariant the design can lean on — a future batch endpoint, a
websocket connection that authenticates once and streams, or a cron job
calling the verifier directly would all break the equivalence silently,
with no HTTP-layer counter any wiser.

The verifier, symmetrically, cannot see a client identity — it takes a
bearer token and nothing else — so it cannot distinguish an attacker's cold
token from a first-time legitimate user's. Only the HTTP layer, which sees
the connection, can attempt that distinction. But the obvious source for a
client identity, `X-Forwarded-For`, is attacker-controlled unless a trusted
proxy in front of the app overwrites it before the request reaches Hono. A
limiter keyed on a header the caller can set to anything is not a fairness
mechanism; it is a way for the caller to point the limiter at someone else.

## Decision

The hard, unbypassable gate against introspection overload is
verifier-internal — bounded, non-blocking admission per ADR 0018. That gate
is not per-IP and does not attempt fairness; it protects lichess's budget,
full stop.

A **per-IP bearer-attempt limiter** ships in the Task 15 HTTP auth
middleware as a fairness layer only, on top of ADR 0018's gate, never as a
substitute for it. It is keyed by an injected `clientKeyFor` function
whose default implementation comes from the deployment's own trusted-proxy
contract — whatever header (or absence of one) that deployment has
verified actually carries a value a client cannot forge. If no such
trustworthy key exists for a given deployment, it ships with **no per-IP
limiter at all**. A limiter keyed on a forgeable header does not fail
safe — it hands an attacker a way to get other users rate-limited,
trading one denial-of-service vector for another one dressed as a fix.

## Consequences

- There are now two limiters with two different jobs, and they must be
  documented as such at the code they land in — a future reader who finds
  both and doesn't know this ADR will read one as redundant with the other
  and be tempted to delete it. Deleting either changes what the system
  protects: the verifier gate protects lichess's budget from everyone at
  once; the per-IP layer protects one user's fairness from another's flood.
- Deployment now owes an explicit trusted-proxy statement — which header,
  set by which hop, verified how — before the fairness layer can be turned
  on at all. Until that statement exists, cold-token fairness under flood
  is unmitigated, and ADR 0018's stated residual risk (first-time bearer
  authentication degrades to best-effort under sustained flood) stands
  undiminished; this ADR does not close that gap, it only says where the
  closing mechanism is allowed to live once a trusted key exists.
- The middleware must map a verifier `unavailable` result to HTTP 503,
  which requires widening `src/server/http/errors.ts`'s `ApiErrorStatus`
  (today `404 | 409 | 422 | 500`) and its `apiErrorCodes` list (today
  `not_found | invalid_stream | version_conflict | already_exists |
  empty_batch | invalid_batch | invalid_definition | malformed_change |
  internal` — no `unavailable` or `unauthorized` code exists yet), while
  keeping `toErrorResponse`'s `assertNever`-backed exhaustiveness check
  intact so a future unhandled variant still fails to compile rather than
  falling through to the wrong status.
