# ADR 0009 — Lichess OAuth, bearer introspection cache, and the scope→permission mapping

Status: Accepted (2026-07-12)

## Context

Definition ownership (ADR 0002/0004) and the future results stream (ADR
0006) both need real identity, not a placeholder. Lichess is the only
identity provider that matters for this audience, and it does not behave
like a typical OAuth provider: **public-client PKCE only — no client secret
exists at all** (spec: "no client authentication, choose any unique client
id"); access tokens live ~1 year with **no refresh tokens** (expiry means
re-login, not silent renewal); and the API must accept bearer tokens
lichess itself issued outside palamedes' login flow (personal access
tokens, or tokens from another lichess OAuth client), so verification can't
assume the token came from palamedes' own session.

Two distinct trust boundaries follow from this: (a) browser login, backed
by a Better Auth session cookie; (b) direct API calls carrying a raw
lichess bearer token with no palamedes session at all. Both need the same
scope→permission mapping, verified independently.

## Decision

- **Lichess OAuth facts** (verified 2026-07-12 against lichess spec
  v2.0.152, github.com/lichess-org/api): authorize at
  `GET https://lichess.org/oauth` (`response_type=code`, `client_id` — an
  arbitrary unique string, e.g. a domain, not a secret — `redirect_uri`,
  `code_challenge_method=S256`, `code_challenge`; optional `scope`
  space-separated, `state`); token exchange at
  `POST https://lichess.org/api/token`, form-encoded,
  `grant_type=authorization_code` + `code` + `code_verifier` +
  `redirect_uri` + `client_id` — **no `client_secret` parameter exists**;
  response `{ token_type: "Bearer", access_token, expires_in ≈ 31536000 }`
  (~1 year) with **no refresh tokens** (expiry means re-login, never a
  refresh call); revoke via `DELETE https://lichess.org/api/token` → 204;
  introspect via `POST https://lichess.org/api/token/test` (no auth, body
  `text/plain` comma-separated tokens, ≤ 1000/request, response keyed by
  token → `null` or `{ userId, scopes: "comma,separated", expires: ms |
  null }`). 23 scopes exist (`preference:*`, `email:read`, `engine:*`,
  `challenge:*`, `study:*`, `tournament:write`, `racer:write`, `puzzle:*`,
  `team:*`, `follow:*`, `msg:write`, `board:play`, `bot:play`, `web:mod`) —
  **no `tournament:read`, no `email:write`**. `lio_`/`liu_` token prefixes
  are convention only, never parsed for a decision.
- **Browser login**: Better Auth 1.6.16's `genericOAuth` plugin fits
  without modification — confirmed by reading the installed types
  (`node_modules/better-auth/dist/plugins/generic-oauth/types.d.mts`) and
  request-building source
  (`node_modules/@better-auth/core/dist/oauth2/validate-authorization-code.mjs`),
  not the public docs, which misstate one field:
  `clientSecret?: string | undefined` is **optional** in the shipped
  types even though better-auth.com's docs page renders it as required —
  the code-exchange body sets `client_secret` only
  `if (options.clientSecret)`, omitted entirely when unset. Config: `pkce:
  true`, no `clientSecret`; `"authentication"` left unset — any value other than `'basic'` (including unset) takes the body-based token request that omits client_secret when absent; never `'basic'`, which would Base64-encode
  `client_id:${clientSecret ?? ""}` into a header lichess doesn't expect;
  explicit `authorizationUrl`/`tokenUrl`/`userInfoUrl` (no OIDC discovery
  on lichess, so no `discoveryUrl`). Shape guided by the two official
  lichess examples (`lichess-org/api` `example/oauth-backend` and
  `lichess-org/api-demo`): hand-rolled PKCE with a session-bound verifier,
  `userInfoUrl` → `GET /api/account` for identity (`id`, `username`), and
  no refresh path to wire up, matching lichess's own example. Lichess
  accounts carry no guaranteed email (`email:read` is a separate,
  unrequested scope); `mapProfileToUser` synthesizes a placeholder
  (`<lichessId>@lichess.invalid`-shaped) rather than requesting
  `email:read` just to satisfy Better Auth's user-creation shape. **This
  is D4 — a Dr.-Dub-owned default the implementer adopts as-is unless
  overridden.** `mapProfileToUser` returns `{}` on a malformed profile
  rather than throwing, so Better Auth's own missing-email check can
  redirect gracefully instead of a 500; this is safe only because a
  `{}` return also makes Better Auth fall back to the raw, unvalidated
  lichess `userInfo` (id/name/email), and lichess's response under
  `scopes: []` never contains an email for that fallback to reach.
  Requesting `email:read` removes that guard — re-examine
  `mapProfileToUser`'s fallback (`oauth-config.ts`) before adding it.
  Sign-out revoking the lichess token (`DELETE
  /api/token`) is a recorded follow-up, not built now: Better Auth's own
  sign-out only clears the local session; the api-demo's revoke-on-logout
  is the model to eventually wire in.
- **API bearer verification**: the API accepts a raw lichess bearer token
  on `Authorization: Bearer …` from ANY source — browser-session tokens
  and directly-presented personal access tokens alike, since prefixes
  aren't parsed. Verification calls `POST /api/token/test`; the result is
  cached in a `lichess_token` table keyed by **SHA-256(token)** — the raw
  token is never persisted — carrying `userId`, `scopes`, lichess's own
  `expires`, and `verifiedAt`. Re-verify when `verifiedAt` is older than
  24h, or once lichess's own `expires` has passed, whichever is sooner; an
  invalid token (introspection returned `null`) is cached negatively for 5
  minutes, **in-memory only**, so a flood of garbage tokens can't grow the
  table. If lichess is unreachable, the API returns **503**, never falls
  back to treating the request as anonymous — a verification outage is a
  visible failure, not a silent permission downgrade.
- **Permission mapping — D1 (Dr.-Dub-owned default) + D2 (alternative)**

| Principal | Grants |
|---|---|
| anonymous (no token / invalid token) | `def:read` |
| any valid lichess token | `def:read`, `def:create`, `def:write:own` |
| token with `web:mod` scope | + `def:moderate` |
| token with `tournament:write` scope | reserved — maps to `run:write:own` once ADR 0006 (results stream) is built, not to anything on the definition changelog |

Public anonymous read mirrors lichess's own API (`GET /api/account` and
friends need no scope). **This table is D1: a Dr.-Dub-owned decision,
adopted here as the proposed default.** D2 (alternative, not adopted):
gate `def:create` behind `tournament:write` instead of "any valid token,"
matching lichess's own gating of tournament-adjacent writes. Rejected as
the default because it would require every definition-authoring user to
hold a scope named for running lichess tournaments — a mismatch of
vocabulary as much as of strictness — but recorded here so Dr. Dub can
flip it without re-deriving the option.
- **Ownership**: a new `definition_stream` row (keyed by stream id,
  alongside the existing `DefinitionChange` rows — ADR 0002) records
  `ownerId`: the lichess `userId` of whoever held `def:create` at creation
  time. Seeded streams (ADR 0005's lichess4545 seeds) are **ownerless**
  (`ownerId: null`) and writable only by `def:moderate`, never
  `def:write:own`, since there is no "own" to match against. Every
  `DefinitionChange` additionally records `actorId` (the acting lichess
  `userId`, or null for system/seed writes) for audit — distinct from
  stream ownership, which doesn't change as different moderators touch a
  stream over time.
- **Secrets**: `LICHESS_CLIENT_ID` is **not a secret** — it appears in
  plaintext in every authorize-URL redirect a browser makes. It lives in
  `src/env.ts` with a default, the same tier as `BETTER_AUTH_URL`. Real
  secrets — `BETTER_AUTH_SECRET` and an optional `LICHESS_API_TOKEN` for
  server-side jobs (e.g. a `tournament:write` bot account) — flow through
  secretspec (Task 9), not through checked-in `.env` values. Prod
  `DATABASE_URL` secret management is deferred — Task 9 deliberately
  excludes it (see `design/persistence-runbook.md` § "Secrets").

## Consequences

- Tasks 10/11/12/15 implement this without re-deriving it: the
  `genericOAuth` config shape, the `lichess_token` cache schema and TTLs,
  the permission table, and the `definition_stream` + `actorId` columns
  are the contract they build against.
- D1 and D4 are Dr.-Dub-owned defaults adopted here, not settled facts —
  D1's alternative (D2) is recorded above; a decision to flip either
  supersedes this ADR rather than editing it in place.
- No refresh code path exists to build, monitor, or fail to build:
  "expired" is a normal, expected state for both browser sessions and
  directly-presented bearer tokens, handled by re-login alone.
- Because verification never falls back to anonymous on a lichess outage,
  API availability is now coupled to lichess's own uptime for anything past
  `def:read`. That coupling is accepted here, not separately re-argued.
- Sign-out-time lichess token revocation is explicitly deferred above;
  until it's built, a signed-out palamedes session leaves the underlying
  lichess token live until it naturally expires or the user revokes it
  manually.
