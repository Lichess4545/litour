# ADR 0014 — Scope-conditional reverification TTL for high-privilege tokens

Status: Accepted (2026-07-26)

Refines the 24h reverification acceptance in ADR 0009 (§ "API bearer
verification"); ADR 0009 otherwise stands.

## Context

`createTokenVerifier` (`introspection.ts`) reuses a positive `lichess_token`
cache row for `REVERIFY_AFTER_MS` — one constant, 24h, for every token —
before it calls lichess introspection again. The `isFresh` gate reads
`cached.verifiedAt`; `cached.scopes` is already on the same row.

Forces, verified against the code:

- Lichess pushes no revocation signal. A token the user revokes on lichess,
  or whose scopes lichess downgrades, keeps authenticating here until its
  cache row goes stale — up to the TTL. The only faster remedy today is the
  incident-response purge
  `db.lichessToken.deleteMany({ where: { userId } })`, which forces the next
  call to re-introspect.
- Lichess permits exactly one in-flight introspection globally per app and
  429s beyond it (noted at the `POST /api/token/test` call site). Every TTL
  expiry forces another introspection through that one-request bottleneck.
  Introspection overload is precisely what can take the whole fail-closed
  API down — an outage returns `unavailable`/503, never anonymous.
- The tokens most worth reverifying quickly — moderators holding `web:mod`,
  which maps to `def:moderate` (ADR 0009) — are also the rarest. Few
  moderator tokens means few extra introspections even at a short TTL. This
  is what makes a scope-conditional TTL plausible rather than merely
  tempting.
- So the trade is revocation latency against a global rate-limit budget that
  cannot be bought larger.
- The hard gate that makes short-TTL introspection load safe — single-flight
  de-duplication by token hash plus a short circuit-breaker on repeated 429s
  — is ADR 0018's bounded admission control. Absent it, every short-TTL
  expiry is an independent introspection against the global one-in-flight
  limit.

## Decision

**Reverify high-privilege scopes on a shorter TTL; keep 24h for everything
else. Shipped standalone, in the same commit as ADR 0018's admission gate —
never as a distinct gated follow-on.**

- Ordinary and read-only tokens keep `REVERIFY_AFTER_MS` = 24h unchanged.
- A token whose cached scopes include a high-privilege scope reverifies
  after `HIGH_PRIVILEGE_REVERIFY_AFTER_MS` = 10 minutes. Ten minutes is
  chosen distinctly larger than the 5-min `NEGATIVE_CACHE_MS`, so the two
  windows read as separate policies rather than the same number wearing two
  names, and caps moderator revocation latency at ~6 introspections per hour
  per actively-used moderator token — negligible against the global budget
  precisely because moderators are rare.
- The high-privilege set is `{ "web:mod" }` — the only scope ADR 0009 maps
  past `def:write:own`, to `def:moderate`. `tournament:write` is reserved
  (ADR 0009) and not yet privileged here; it joins the set if and when it
  grants a live permission.

This shipped standalone, ahead of Task 15 (the write door), rather than
waiting to land inside it: the two-tier TTL is in the same commit as ADR
0018's single-flight + circuit-breaker gate, never before it — it had to
ship together with the thing that makes it safe, not with the endpoint it
was originally scoped alongside. The 10-minute window multiplies
introspection pressure on the tokens it covers; that pressure is only safe
because concurrent checks for one token collapse to a single introspection
and repeated 429s trip a breaker instead of a retry storm.

### What `createTokenVerifier` does with this

The change is local to the cached-row branch; the fresh-introspection path
just writes `verifiedAt` and asks no freshness question.

- `HIGH_PRIVILEGE_REVERIFY_AFTER_MS = 10 * 60 * 1000` and a module-level
  `HIGH_PRIVILEGE_SCOPES: ReadonlySet<string> = new Set(["web:mod"])` sit
  alongside `REVERIFY_AFTER_MS` in `introspection.ts`.
- In the `cached !== null` branch, after the `lichessExpired` gate, the
  applicable window is derived from the cached scopes: `parseScopes` reads
  `cached.scopes`, and `reverifyWindowFor` returns
  `HIGH_PRIVILEGE_REVERIFY_AFTER_MS` if they intersect
  `HIGH_PRIVILEGE_SCOPES`, else `REVERIFY_AFTER_MS`. `isFresh` compares
  `nowMs - cached.verifiedAt.getTime()` against that window.
- The choice is keyed off `cached.scopes`, not off any client-supplied
  value: a token lichess downgraded still shows `web:mod` on the row until
  the next introspection, so it correctly stays on the short TTL — which is
  exactly the row we want to reverify soonest.
- The `lichessExpired` gate, the negative cache, and the fresh-write path
  are untouched.
- The `REVERIFY_AFTER_MS` header NOTE and the `createTokenVerifier` doc
  comment describe the two-tier policy and link this ADR.

### Option not taken

**Keep one 24h TTL and rely on the incident-response purge.** Simpler — no
scope parse in the hot path, no second constant, one revocation-latency
number to reason about. Rejected as the default because it leaves moderator
revocation at up to 24h latency unless an operator manually runs
`deleteMany`, and the highest-privilege scope is the one where a stale grant
does the most damage. The purge is not removed — it remains the backstop for
immediate revocation of any specific user (see Consequences).

## Consequences

- A revoked or downgraded moderator loses `def:moderate` here within ~10
  minutes with no operator action; ordinary tokens still trail lichess by up
  to 24h.
- The `deleteMany({ where: { userId } })` purge stays the only path to
  *immediate* (sub-TTL) revocation for any token, moderator or not. This ADR
  shortens the automatic ceiling for the scopes that matter most; it does
  not replace the purge, and the runbook still needs it for the
  can't-wait-10-minutes case.
- This forecloses reasoning about introspection load from the 24h TTL alone:
  moderator tokens now generate introspection traffic at up to 6×/hour each.
  Safe only behind ADR 0018's single-flight + circuit-breaker, which is why
  the two shipped together rather than this TTL landing first. The
  dependency was a hard precondition, not a nice-to-have.
- Adding a scope to `HIGH_PRIVILEGE_SCOPES` (e.g. `tournament:write` once it
  grants `run:write:own` per ADR 0009) is a one-line change that silently
  shortens that scope's revocation latency and lengthens its introspection
  tail — a change to make deliberately, with ADR 0018's admission gate in
  mind, not by reflex.
- The TTL choice reads off cached scopes, so a row carrying both a
  high-privilege and ordinary scope reverifies on the short window. That is
  the intended, conservative direction: presence of `web:mod` dominates.
