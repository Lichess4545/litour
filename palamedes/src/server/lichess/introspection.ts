import { createHash } from "node:crypto";
import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";

export type LichessAuth = {
  readonly userId: string;
  readonly scopes: ReadonlySet<string>;
  readonly expiresAt: Date | null;
};

/**
 * Three outcomes, not two. `unavailable` means lichess could not be reached
 * or answered in a shape this module doesn't trust — it is distinct from
 * `invalid` (lichess was reached and said no) and from anonymous access.
 * Collapsing `unavailable` into `invalid` turns a lichess outage into a
 * fail-open bypass; callers must handle all three.
 */
export type VerifyResult =
  | { readonly kind: "valid"; readonly auth: LichessAuth }
  | { readonly kind: "invalid" }
  | { readonly kind: "unavailable" };

export type AdmissionRefusalReason = "breaker-open" | "saturated";

export type IntrospectionProblem =
  // NOTE: `errorName` carries only `Error.name` (e.g. "TimeoutError",
  // "ECONNREFUSED") — never `.message` or the error object itself. undici
  // errors can carry the request they failed on, and the request body here
  // is the raw bearer token.
  | { readonly kind: "network"; readonly errorName: string }
  | { readonly kind: "status"; readonly status: number }
  | { readonly kind: "body" }
  // NOTE: `issuePaths` is token-relative — built with `.path.slice(1)` at the
  // call site. lichess's response is keyed BY THE TOKEN, so a zod issue's
  // full path has the raw bearer token as its first segment. Never widen
  // this field to carry the zod error object, `.message`, or the unsliced
  // path — any of those puts the credential in a log line.
  | { readonly kind: "schema"; readonly issuePaths: readonly string[] }
  | { readonly kind: "missing-entry" }
  | { readonly kind: "cache-read" }
  // NOTE: same `errorName` constraint as the `network` case above.
  | { readonly kind: "cache-write"; readonly errorName: string }
  // NOTE: deliberately NOT `cache-write`, and alertable on its own. A
  // `cache-write` costs one extra introspection; this one means a revoked
  // token's row survived, so the negative-cache entry widened to
  // `REVERIFY_AFTER_MS` is the only thing standing between that row and the
  // stale-serve branch. Same `errorName` constraint as the `network` case.
  | { readonly kind: "revocation-write-failed"; readonly errorName: string }
  | {
      readonly kind: "throttled";
      readonly reason: AdmissionRefusalReason;
    }
  | { readonly kind: "stale-served" }
  // NOTE: same `errorName` constraint as the `network` case above.
  | { readonly kind: "unexpected"; readonly errorName: string };

export type IntrospectionDeps = {
  readonly db: {
    readonly lichessToken: Pick<
      PrismaClient["lichessToken"],
      "findUnique" | "upsert" | "deleteMany"
    >;
  };
  readonly fetchImpl: typeof fetch;
  readonly now: () => Date;
  readonly apiUrl: string;
  readonly timeoutMs?: number;
  readonly slotHeldWorkTimeoutMs?: number;
  readonly negativeCacheMax?: number;
  readonly maxConcurrentIntrospections?: number;
  readonly breakerFailureThreshold?: number;
  readonly breakerOpenMs?: number;
  /**
   * Diagnostic sink for `IntrospectionProblem`, so on-call can act on each
   * variant instead of seeing one undifferentiated `unavailable`. Not every
   * problem denies the caller: `cache-write` and `revocation-write-failed`
   * both report a swallowed write failure behind an otherwise `valid` /
   * `invalid` result, and `stale-served` reports a `valid` result served
   * without a fresh reverification.
   *
   * - `network` / `status` / `body`: lichess is unreachable or misbehaving —
   *   check lichess's own status, not this process.
   * - `schema` / `missing-entry`: lichess answered, but not in the shape this
   *   module expects — check for an API change before assuming an outage.
   * - `cache-read`: this process's own Postgres is unreachable — a Postgres
   *   incident, not a lichess one; `db.ts` logs nothing else for it.
   * - `cache-write`: benign — costs one extra introspection next time this
   *   token is checked.
   * - `revocation-write-failed`: a revoked token's row survived the delete;
   *   confirm it lands before the widened negative-cache entry it bought
   *   (see `revokeCachedRow`) lapses.
   * - `throttled`: the admission gate refused a request — the on-call signal
   *   for a token flood, or a lichess outage holding the breaker open.
   * - `stale-served`: a `valid` result was served past its reverify window
   *   because admission had no budget for a fresh check. Security-relevant,
   *   not routine — the caller may be running on a revoked or downgraded
   *   grant for up to `REVERIFY_AFTER_MS`.
   * - `unexpected`: an exception escaped every other handler — a defect in
   *   this module, not a lichess or Postgres incident.
   *
   * Receives a token HASH, never the token — see the `schema` case of
   * `IntrospectionProblem` for why that constraint also applies to anything
   * this callback goes on to log.
   */
  readonly onProblem?: (
    reason: IntrospectionProblem,
    tokenHash: string,
  ) => void | Promise<void>;
};

const defaultOnProblem = (
  reason: IntrospectionProblem,
  tokenHash: string,
): void => {
  console.warn("[lichess/introspection] problem", reason, tokenHash);
};

// NOTE: lichess never pushes revocation. A token the user revokes, or whose
// scopes lichess downgrades, keeps authenticating here for up to this long.
// Incident response: `db.lichessToken.deleteMany({ where: { userId } })`
// forces the next call to re-introspect. ADR 0014 shortens this window for
// `HIGH_PRIVILEGE_SCOPES` rows to `HIGH_PRIVILEGE_REVERIFY_AFTER_MS`; this
// constant remains the ceiling for everything else, and the ceiling that
// ADR 0018's stale-serve and negative-cache widening both measure against.
const REVERIFY_AFTER_MS = 24 * 60 * 60 * 1000;
const NEGATIVE_CACHE_MS = 5 * 60 * 1000;
const AUTH_TIMEOUT_MS = 5000;
// NOTE: bounds the `upsert`, the `deleteMany`, and `response.body.cancel()` —
// all run while the single global admission slot is held. Without this, a
// hanging Postgres call or a hanging body-cancel parks that slot and is a
// total introspection outage for as long as it hangs — proven by execution,
// not theorised. Be honest about what the deadline buys: it frees the
// admission slot, not the Postgres connection underneath it — Prisma cannot
// cancel a query, so the query keeps running and the connection stays
// checked out. `src/server/db.ts` sets no `statement_timeout`, so DB
// connection residency past this deadline is bounded only by Postgres.
const SLOT_HELD_WORK_TIMEOUT_MS = 5000;
// NOTE: bounds the in-memory negative cache. Unbounded, it's an
// attacker-driven OOM vector — one request per distinct garbage token grows
// it forever. See `setNegativeCacheEntry` for the sweep-then-evict policy
// this backs.
const NEGATIVE_CACHE_MAX = 10_000;
const MAX_TOKEN_LENGTH = 512;
const HIGH_PRIVILEGE_REVERIFY_AFTER_MS = 10 * 60 * 1000;
export const HIGH_PRIVILEGE_SCOPES: ReadonlySet<string> = new Set(["web:mod"]);
const MAX_CONCURRENT_INTROSPECTIONS = 1;
const BREAKER_FAILURE_THRESHOLD = 3;
const BREAKER_OPEN_MS = 30 * 1000;
// `Date`'s representable range, per ECMA-262 — the largest epoch-millisecond
// value `new Date()` can hold without becoming an Invalid Date. A larger
// `expires` is still a safe integer, so `.int().nonnegative()` alone lets it
// through; `new Date(...)` then returns Invalid Date, `.getTime()` is `NaN`,
// and every `<= nowMs` expiry check is false — the token reads as
// never-expiring. Reject it here, at the input, rather than trying to
// recover from a `NaN` downstream.
const MAX_EPOCH_MS = 8_640_000_000_000_000;

const introspectionResponseSchema = z.record(
  z.string(),
  z.union([
    z.null(),
    z.object({
      userId: z.string(),
      scopes: z.string(),
      expires: z.number().int().nonnegative().max(MAX_EPOCH_MS).nullable(),
    }),
  ]),
);

const parseScopes = (raw: string): ReadonlySet<string> =>
  new Set(raw === "" ? [] : raw.split(","));

const reverifyWindowFor = (scopes: ReadonlySet<string>): number =>
  [...scopes].some((scope) => HIGH_PRIVILEGE_SCOPES.has(scope))
    ? HIGH_PRIVILEGE_REVERIFY_AFTER_MS
    : REVERIFY_AFTER_MS;

function assertNever(value: never): never {
  throw new Error(`unreachable breaker state: ${JSON.stringify(value)}`);
}

type SlotHeldWorkOutcome =
  | { readonly kind: "finished" }
  | { readonly kind: "unfinished"; readonly errorName: string };

type Admission =
  | { readonly kind: "admitted" }
  | { readonly kind: "refused"; readonly reason: AdmissionRefusalReason };

type BreakerState =
  | { readonly kind: "closed"; readonly consecutiveFailures: number }
  | { readonly kind: "open"; readonly openedAtMs: number }
  | { readonly kind: "half-open"; readonly probeStartedAtMs: number };

/**
 * Verifies a raw lichess OAuth bearer token against lichess's introspection
 * endpoint (`POST {apiUrl}/api/token/test`), the bearer verifier for the
 * whole API. Positive results cache in the `lichess_token` table; negative
 * results cache in memory for the lifetime of the returned closure — so
 * construct exactly one verifier per process, at module scope. A
 * per-request verifier gets a fresh, empty negative cache every time,
 * silently disabling it.
 *
 * The row is keyed by the SHA-256 hex of the token, never the token itself:
 * the raw value lives only in memory and in the outbound request body to
 * lichess, and touches neither the database nor any log line.
 *
 * - A cache row is reused for its scope-conditional window (`REVERIFY_AFTER_MS`,
 *   or `HIGH_PRIVILEGE_REVERIFY_AFTER_MS` for a row carrying a
 *   `HIGH_PRIVILEGE_SCOPES` scope — ADR 0014) without a network call, unless
 *   lichess's own `expiresAt` on that row has already passed — an expired
 *   token is `invalid` even inside that window. See `REVERIFY_AFTER_MS` for
 *   what the standing window means for revocation.
 * - A negative result (lichess returned `null` for the token) caches for
 *   5 minutes (`NEGATIVE_CACHE_MS`) in a plain in-memory `Map`; it does not
 *   survive a process restart. That window widens to `REVERIFY_AFTER_MS` when
 *   the row it stands in for failed to delete — see `revokeCachedRow`.
 * - lichess reports `expires` as UNIX milliseconds, not seconds — passed
 *   straight to `new Date()` with no unit conversion.
 * - Failure to reach lichess, or a response this module doesn't trust, is
 *   `unavailable`, never `invalid` — see the `VerifyResult` doc above. Of the
 *   three database calls, `findUnique` (cache-read) failing denies the caller
 *   with `unavailable` because we then don't know the token's status; `upsert`
 *   (cache-write) failing is swallowed and the caller still gets `valid`,
 *   since lichess already vouched for the token and the row is only a cache;
 *   `deleteMany` (revocation-write) failing is also swallowed toward the
 *   caller but reported under its own diagnostic — see `revokeCachedRow`.
 */
export function createTokenVerifier(
  deps: IntrospectionDeps,
): (token: string) => Promise<VerifyResult> {
  const negativeCache = new Map<string, number>();
  const negativeCacheMax = deps.negativeCacheMax ?? NEGATIVE_CACHE_MAX;
  const maxConcurrentIntrospections =
    deps.maxConcurrentIntrospections ?? MAX_CONCURRENT_INTROSPECTIONS;
  const breakerFailureThreshold =
    deps.breakerFailureThreshold ?? BREAKER_FAILURE_THRESHOLD;
  const breakerOpenMs = deps.breakerOpenMs ?? BREAKER_OPEN_MS;
  const slotHeldWorkTimeoutMs =
    deps.slotHeldWorkTimeoutMs ?? SLOT_HELD_WORK_TIMEOUT_MS;

  const inFlight = new Map<string, Promise<VerifyResult>>();
  let introspectionsInFlight = 0;
  let breaker: BreakerState = { kind: "closed", consecutiveFailures: 0 };

  const sink = deps.onProblem ?? defaultOnProblem;
  // This is diagnostics, not the auth decision — a caller-supplied sink
  // that throws (a broken logger, a full disk) must never change a
  // `VerifyResult` or escape as an exception. The empty catch is
  // deliberate: every other catch in this function is load-bearing and
  // documented at its call site, but this one exists solely to make
  // `sink` infallible.
  const reportProblem = (
    reason: IntrospectionProblem,
    tokenHash: string,
  ): void => {
    try {
      void Promise.resolve(sink(reason, tokenHash)).catch(() => undefined);
    } catch {}
  };

  // At capacity, first sweep out anything already expired (the common case:
  // most eviction pressure is from tokens whose 5-minute window has simply
  // elapsed). Only if that doesn't free a slot does it fall back to
  // evicting the oldest entry by insertion order — `Map` iterates in
  // insertion order, so `.keys().next()` is the oldest, not an arbitrary one.
  function setNegativeCacheEntry(hash: string, expiresAtMs: number): void {
    if (negativeCache.size >= negativeCacheMax && !negativeCache.has(hash)) {
      const sweepNowMs = deps.now().getTime();
      for (const [cachedHash, cachedExpiresAtMs] of negativeCache) {
        if (cachedExpiresAtMs <= sweepNowMs) {
          negativeCache.delete(cachedHash);
        }
      }
    }
    if (negativeCache.size >= negativeCacheMax && !negativeCache.has(hash)) {
      const oldestHash = negativeCache.keys().next().value;
      if (oldestHash !== undefined) {
        negativeCache.delete(oldestHash);
      }
    }
    negativeCache.set(hash, expiresAtMs);
  }

  function finishWhileHoldingAdmissionSlot(
    work: () => Promise<unknown>,
  ): Promise<SlotHeldWorkOutcome> {
    return new Promise<SlotHeldWorkOutcome>((resolve) => {
      const deadline = setTimeout(
        () => resolve({ kind: "unfinished", errorName: "TimeoutError" }),
        slotHeldWorkTimeoutMs,
      );
      const settle = (outcome: SlotHeldWorkOutcome): void => {
        clearTimeout(deadline);
        resolve(outcome);
      };
      const unfinishedBy = (error: unknown): SlotHeldWorkOutcome => ({
        kind: "unfinished",
        errorName: error instanceof Error ? error.name : "unknown",
      });
      try {
        work().then(
          () => settle({ kind: "finished" }),
          (error: unknown) => settle(unfinishedBy(error)),
        );
      } catch (error) {
        settle(unfinishedBy(error));
      }
    });
  }

  function recordBreakerFailure(): void {
    const nowMs = deps.now().getTime();
    const state = breaker;
    switch (state.kind) {
      case "half-open":
        breaker = { kind: "open", openedAtMs: nowMs };
        return;
      // `assertNever` doesn't apply to this arm: `"open"` is a real member of
      // `BreakerState`, only unreachable by the calling convention, not by the
      // type. The throw sits before any reassignment, so a caller that
      // bypasses `admit()` leaves the breaker `open` rather than corrupting
      // it to `closed{1}`.
      case "open":
        throw new Error(
          "recordBreakerFailure called while the breaker is already open — admit() always moves it to half-open before any call site can reach this function, so this indicates a caller bypassed admit()",
        );
      case "closed": {
        const consecutiveFailures = state.consecutiveFailures + 1;
        breaker =
          consecutiveFailures >= breakerFailureThreshold
            ? { kind: "open", openedAtMs: nowMs }
            : { kind: "closed", consecutiveFailures };
        return;
      }
      default:
        assertNever(state);
    }
  }

  // Guards a non-finite clock reading from reaching `openedAtMs`: `deps.now()`
  // is caller-injected, and an Invalid Date's `.getTime()` is `NaN`. A `NaN`
  // `openedAtMs` would make every future `nowMs - openedAtMs < breakerOpenMs`
  // in `admit()` compare against `NaN`, which is always `false` — the breaker
  // would never clear `breakerOpenMs` and would probe forever.
  function nowMsOrFallback(fallbackMs: number): number {
    try {
      const candidateMs = deps.now().getTime();
      return Number.isFinite(candidateMs) ? candidateMs : fallbackMs;
    } catch {
      return fallbackMs;
    }
  }

  function recordBreakerSuccess(): void {
    breaker = { kind: "closed", consecutiveFailures: 0 };
  }

  function admit(nowMs: number): Admission {
    const state = breaker;
    switch (state.kind) {
      case "open": {
        if (nowMs - state.openedAtMs < breakerOpenMs) {
          return { kind: "refused", reason: "breaker-open" };
        }
        if (introspectionsInFlight >= maxConcurrentIntrospections) {
          return { kind: "refused", reason: "saturated" };
        }
        breaker = { kind: "half-open", probeStartedAtMs: nowMs };
        introspectionsInFlight += 1;
        return { kind: "admitted" };
      }
      case "half-open":
        return { kind: "refused", reason: "breaker-open" };
      case "closed": {
        if (introspectionsInFlight >= maxConcurrentIntrospections) {
          return { kind: "refused", reason: "saturated" };
        }
        introspectionsInFlight += 1;
        return { kind: "admitted" };
      }
      default:
        return assertNever(state);
    }
  }

  // An `invalid` verdict makes the positive row known-false, and the 5-minute
  // negative-cache entry is the ONLY thing suppressing that row. Once it
  // lapses, the serve-stale branch reads the row back and answers `valid` —
  // a revoked token authenticating indefinitely under sustained admission
  // refusal. Deleting the row is what makes the negative entry an
  // optimisation rather than the whole defence; do not drop this call
  // because the negative cache "already handles it". This closes the REVOKED
  // case only — a scope DOWNGRADE still yields no `invalid` verdict and no
  // delete, so the stale-serve branch keeps handing out the OLD, wider scopes
  // for up to `REVERIFY_AFTER_MS`, and an attacker can hold that window open
  // on demand by flooding admission. That residue is accepted by ADRs
  // 0018/0014, not fixed here.
  //
  // The delete itself stays best-effort — the error is reported and swallowed,
  // never turned into a denial — but its FAILURE is not. This is a revocation,
  // not a cache eviction: the surviving row is servable for `REVERIFY_AFTER_MS`
  // by the stale-serve branch, while the negative entry that suppresses it
  // lapses after `NEGATIVE_CACHE_MS`. So when the delete does not land, the
  // negative entry is widened to cover exactly what the delete failed to cover.
  // Do not collapse this back into the module's cache-write asymmetry: that
  // asymmetry is a property of a cache miss costing one extra introspection,
  // and this consequence is an auth bypass with a five-minute fuse.
  async function revokeCachedRow(hash: string): Promise<void> {
    setNegativeCacheEntry(hash, deps.now().getTime() + NEGATIVE_CACHE_MS);
    const deletion = await finishWhileHoldingAdmissionSlot(() =>
      deps.db.lichessToken.deleteMany({ where: { tokenHash: hash } }),
    );
    if (deletion.kind === "unfinished") {
      reportProblem(
        { kind: "revocation-write-failed", errorName: deletion.errorName },
        hash,
      );
      setNegativeCacheEntry(hash, deps.now().getTime() + REVERIFY_AFTER_MS);
    }
  }

  async function runIntrospection(
    token: string,
    hash: string,
  ): Promise<VerifyResult> {
    // ADR 0018 says `body`/`schema`/`missing-entry` must not COUNT as breaker
    // failures. That is not the same statement as "must not change breaker
    // state at all": those paths returned without calling either record
    // function, so a probe that ended on one consumed the single half-open
    // token and never gave it back, and `admit()` refused every later call
    // for the life of the process. The token comes back on every exit path,
    // and it comes back as `open` — re-opening schedules another probe one
    // window later, whereas closing would forgive an outage this call never
    // proved was over. The failure count is deliberately untouched.
    const tookProbeToken = breaker.kind === "half-open";
    try {
      // Fail-closed only works if the failure arrives. Without a deadline, a
      // lichess that accepts the connection but never answers would park this
      // call — and the request depending on it — forever instead of resolving
      // `unavailable`.
      let response: Response;
      try {
        response = await deps.fetchImpl(`${deps.apiUrl}/api/token/test`, {
          method: "POST",
          headers: { "Content-Type": "text/plain" },
          body: token,
          signal: AbortSignal.timeout(deps.timeoutMs ?? AUTH_TIMEOUT_MS),
        });
      } catch (error) {
        recordBreakerFailure();
        reportProblem(
          {
            kind: "network",
            errorName: error instanceof Error ? error.name : "unknown",
          },
          hash,
        );
        return { kind: "unavailable" };
      }
      if (!response.ok) {
        recordBreakerFailure();
        reportProblem({ kind: "status", status: response.status }, hash);
        // Drains the undici response body instead of discarding the Response
        // unread. This path runs on every outage, at request volume — an
        // unread body is a back-pressure leak per call, not a one-off.
        // `.cancel()` itself rejects when the stream is already errored (the
        // connection dropped mid-body, or the timeout signal fired) — exactly
        // the condition this path exists to handle. We're discarding the body
        // either way, so that rejection must not become an exception.
        await finishWhileHoldingAdmissionSlot(
          () => response.body?.cancel() ?? Promise.resolve(),
        );
        return { kind: "unavailable" };
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        reportProblem({ kind: "body" }, hash);
        return { kind: "unavailable" };
      }
      const parsed = introspectionResponseSchema.safeParse(body);
      if (!parsed.success) {
        // `.slice(1)` drops the leading path segment, which is the token
        // itself — see the `schema` case of `IntrospectionProblem` for why.
        // Never pass `parsed.error` (or its `.message`) to `reportProblem`
        // or any logger: the whole point of slicing here is that the raw zod
        // error still has the token in it.
        reportProblem(
          {
            kind: "schema",
            issuePaths: parsed.error.issues.map((issue) =>
              issue.path.slice(1).join("."),
            ),
          },
          hash,
        );
        return { kind: "unavailable" };
      }
      // `parsed.data[token]` alone would walk the prototype chain: a token of
      // "toString" or "__proto__" resolves to `Object.prototype`'s member
      // instead of `undefined`, which is neither `null` nor `undefined` and
      // would fall through into the `entry.userId` access below and throw —
      // out of a function whose return type promises no throw. `Object.hasOwn`
      // is load-bearing here; do not simplify this back to a bare index read.
      const entry = Object.hasOwn(parsed.data, token)
        ? parsed.data[token]
        : undefined;
      if (entry === undefined) {
        reportProblem({ kind: "missing-entry" }, hash);
        return { kind: "unavailable" };
      }

      recordBreakerSuccess();

      if (entry === null) {
        await revokeCachedRow(hash);
        return { kind: "invalid" };
      }

      // NOTE: milliseconds, not seconds — see the doc comment above.
      const expiresAt = entry.expires === null ? null : new Date(entry.expires);
      // Same lichess-expiry gate as the cached-row branch above: a freshly
      // introspected entry can still be already-expired by lichess's own
      // clock, and that must be `invalid` here too, not just on replay.
      if (expiresAt !== null && expiresAt.getTime() <= deps.now().getTime()) {
        await revokeCachedRow(hash);
        return { kind: "invalid" };
      }
      // Deliberately asymmetric with the findUnique failure above: lichess has
      // already said this token is good, and the row is a cache, not the
      // source of truth. A failed write here must not deny a legitimate user
      // — it costs one extra introspection call next time this token is
      // checked, nothing more. Do not turn this into an early return.
      const cacheWrite = await finishWhileHoldingAdmissionSlot(() =>
        deps.db.lichessToken.upsert({
          where: { tokenHash: hash },
          create: {
            tokenHash: hash,
            userId: entry.userId,
            scopes: entry.scopes,
            expiresAt,
            verifiedAt: deps.now(),
          },
          update: {
            userId: entry.userId,
            scopes: entry.scopes,
            expiresAt,
            verifiedAt: deps.now(),
          },
        }),
      );
      if (cacheWrite.kind === "unfinished") {
        reportProblem(
          { kind: "cache-write", errorName: cacheWrite.errorName },
          hash,
        );
      }

      return {
        kind: "valid",
        auth: {
          userId: entry.userId,
          scopes: parseScopes(entry.scopes),
          expiresAt,
        },
      };
    } catch (error) {
      reportProblem(
        {
          kind: "unexpected",
          errorName: error instanceof Error ? error.name : "unknown",
        },
        hash,
      );
      return { kind: "unavailable" };
    } finally {
      // This restore must be infallible — it runs in every exit path of this
      // function, success or throw. Measured from settlement (now), not from
      // `probeStartedAtMs`: measuring from probe start would make the
      // effective re-open cooldown `breakerOpenMs - probeDuration`, which
      // shrinks toward zero as a probe takes longer, allowing back-to-back
      // probes with no delay between them. `probeStartedAtMs` doubles as the
      // fallback `nowMsOrFallback` returns on a non-finite clock read, and
      // `Math.max` against it keeps `openedAtMs` from regressing behind the
      // probe's own start time.
      if (tookProbeToken && breaker.kind === "half-open") {
        const probeStartedAtMs = breaker.probeStartedAtMs;
        breaker = {
          kind: "open",
          openedAtMs: Math.max(
            probeStartedAtMs,
            nowMsOrFallback(probeStartedAtMs),
          ),
        };
      }
    }
  }

  return async function verifyLichessToken(
    token: string,
  ): Promise<VerifyResult> {
    // A malformed credential is a definite answer, not a reachability
    // failure — `invalid`, not `unavailable`, and resolved before any
    // network or database call.
    if (token === "" || token.length > MAX_TOKEN_LENGTH) {
      return { kind: "invalid" };
    }

    const hash = createHash("sha256").update(token).digest("hex");
    const nowMs = deps.now().getTime();

    const isNegativelyCached = (): boolean => {
      const negativeUntil = negativeCache.get(hash);
      return negativeUntil !== undefined && negativeUntil > nowMs;
    };

    if (isNegativelyCached()) {
      return { kind: "invalid" };
    }

    let cached: Awaited<
      ReturnType<IntrospectionDeps["db"]["lichessToken"]["findUnique"]>
    >;
    // If we cannot read the cache, we do not know whether the token is
    // good — and "we do not know" is never `invalid`. Contrast the upsert
    // failure below, which is swallowed instead. Report this one: `db.ts`
    // builds `PrismaClient` with no `log` config, so a Postgres outage is
    // otherwise silent end to end — this call is the only place it surfaces.
    try {
      cached = await deps.db.lichessToken.findUnique({
        where: { tokenHash: hash },
      });
    } catch {
      reportProblem({ kind: "cache-read" }, hash);
      return { kind: "unavailable" };
    }
    if (cached !== null) {
      const lichessExpired =
        cached.expiresAt !== null && cached.expiresAt.getTime() <= nowMs;
      if (lichessExpired) {
        return { kind: "invalid" };
      }
      const isFresh =
        nowMs - cached.verifiedAt.getTime() <
        reverifyWindowFor(parseScopes(cached.scopes));
      if (isFresh) {
        return {
          kind: "valid",
          auth: {
            userId: cached.userId,
            scopes: parseScopes(cached.scopes),
            expiresAt: cached.expiresAt,
          },
        };
      }
    }

    // NOTE: lichess's introspection endpoint accepts up to 1000 tokens per
    // request; batching them is deliberately out of scope here — one token
    // per call. lichess also allows only one in-flight introspection
    // request at a time globally, with back-off on 429; a 429 here is
    // handled below as `unavailable`, same as any other reachability
    // failure.
    const existingIntrospection = inFlight.get(hash);
    if (existingIntrospection !== undefined) {
      return existingIntrospection;
    }

    const admission = admit(nowMs);
    if (admission.kind === "refused") {
      // `cached` was read BEFORE the gate and is stale AT the gate: a
      // concurrent introspection of this same hash can have proved the token
      // revoked and deleted the row in between, and single-flight does not
      // collapse the two because that call had already settled by the time
      // this one reached admission. The negative cache is the in-memory record
      // of that proof, and re-reading it here costs no I/O — so it is re-read
      // at the point of decision, not only at the point of entry. Do not
      // "simplify" this back to the entry check alone.
      if (isNegativelyCached()) {
        return { kind: "invalid" };
      }
      if (
        cached !== null &&
        nowMs - cached.verifiedAt.getTime() < REVERIFY_AFTER_MS
      ) {
        reportProblem({ kind: "throttled", reason: admission.reason }, hash);
        reportProblem({ kind: "stale-served" }, hash);
        return {
          kind: "valid",
          auth: {
            userId: cached.userId,
            scopes: parseScopes(cached.scopes),
            expiresAt: cached.expiresAt,
          },
        };
      }
      reportProblem({ kind: "throttled", reason: admission.reason }, hash);
      return { kind: "unavailable" };
    }

    // The release must be attached HERE, not inside `runIntrospection`'s own
    // `finally`. That body runs synchronously up to its first `await`, so an
    // introspection that settles without ever suspending — a `fetchImpl` or
    // an `AbortSignal.timeout(...)` that throws synchronously — would run its
    // `finally`, and its `inFlight.delete`, BEFORE the `set` below. The entry
    // that then landed was a resolved promise nobody would ever remove: that
    // hash pinned to its stale result forever, and a map that grows without
    // bound. `.finally` on an already-settled promise still runs in a later
    // microtask than this synchronous `set`, which is the whole point.
    // Creator-only by construction: a joiner returns above and never attaches
    // a release for a slot it did not take.
    const introspection = runIntrospection(token, hash).finally(() => {
      inFlight.delete(hash);
      introspectionsInFlight -= 1;
    });
    inFlight.set(hash, introspection);
    return introspection;
  };
}
