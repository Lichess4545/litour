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
  | { readonly kind: "cache-write"; readonly errorName: string };

export type IntrospectionDeps = {
  readonly db: {
    readonly lichessToken: Pick<
      PrismaClient["lichessToken"],
      "findUnique" | "upsert"
    >;
  };
  readonly fetchImpl: typeof fetch;
  readonly now: () => Date;
  readonly apiUrl: string;
  readonly timeoutMs?: number;
  readonly negativeCacheMax?: number;
  /**
   * Diagnostic sink for `IntrospectionProblem`, so on-call can tell "lichess
   * is down" from "lichess renamed a field" instead of seeing one
   * undifferentiated `unavailable`. Not every problem denies the caller —
   * `cache-write` reports a swallowed write failure alongside an otherwise
   * `valid` result. Receives a token HASH, never the token — see the
   * `schema` case of `IntrospectionProblem` for why that constraint also
   * applies to anything this callback goes on to log.
   */
  readonly onProblem?: (
    reason: IntrospectionProblem,
    tokenHash: string,
  ) => void;
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
// forces the next call to re-introspect. Shortening this window for
// high-privilege scopes is an open question, not an oversight.
const REVERIFY_AFTER_MS = 24 * 60 * 60 * 1000;
const NEGATIVE_CACHE_MS = 5 * 60 * 1000;
const AUTH_TIMEOUT_MS = 5000;
// NOTE: bounds the in-memory negative cache. Unbounded, it's an
// attacker-driven OOM vector — one request per distinct garbage token grows
// it forever. See `setNegativeCacheEntry` for the sweep-then-evict policy
// this backs.
const NEGATIVE_CACHE_MAX = 10_000;
const MAX_TOKEN_LENGTH = 512;
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
 * - A cache row is reused for 24h (`REVERIFY_AFTER_MS`) without a network
 *   call, unless lichess's own `expiresAt` on that row has already passed
 *   — an expired token is `invalid` even inside the 24h window. See
 *   `REVERIFY_AFTER_MS` for what that window means for revocation.
 * - A negative result (lichess returned `null` for the token) caches for
 *   5 minutes (`NEGATIVE_CACHE_MS`) in a plain in-memory `Map`; it does not
 *   survive a process restart.
 * - lichess reports `expires` as UNIX milliseconds, not seconds — passed
 *   straight to `new Date()` with no unit conversion.
 * - Failure to reach lichess, or a response this module doesn't trust, is
 *   `unavailable`, never `invalid` — see the `VerifyResult` doc above. The
 *   two database calls fail asymmetrically by design; see the comment at
 *   each call site.
 */
export function createTokenVerifier(
  deps: IntrospectionDeps,
): (token: string) => Promise<VerifyResult> {
  const negativeCache = new Map<string, number>();
  const negativeCacheMax = deps.negativeCacheMax ?? NEGATIVE_CACHE_MAX;

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

    const negativeUntil = negativeCache.get(hash);
    if (negativeUntil !== undefined && negativeUntil > nowMs) {
      return { kind: "invalid" };
    }

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
        sink(reason, tokenHash);
      } catch {}
    };

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
      const isFresh = nowMs - cached.verifiedAt.getTime() < REVERIFY_AFTER_MS;
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
      reportProblem({ kind: "status", status: response.status }, hash);
      // Drains the undici response body instead of discarding the Response
      // unread. This path runs on every outage, at request volume — an
      // unread body is a back-pressure leak per call, not a one-off.
      // `.cancel()` itself rejects when the stream is already errored (the
      // connection dropped mid-body, or the timeout signal fired) — exactly
      // the condition this path exists to handle. We're discarding the body
      // either way, so that rejection must not become an exception.
      await response.body?.cancel().catch(() => undefined);
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
    if (entry === null) {
      setNegativeCacheEntry(hash, nowMs + NEGATIVE_CACHE_MS);
      return { kind: "invalid" };
    }

    // NOTE: milliseconds, not seconds — see the doc comment above.
    const expiresAt = entry.expires === null ? null : new Date(entry.expires);
    // Same lichess-expiry gate as the cached-row branch above: a freshly
    // introspected entry can still be already-expired by lichess's own
    // clock, and that must be `invalid` here too, not just on replay.
    if (expiresAt !== null && expiresAt.getTime() <= nowMs) {
      return { kind: "invalid" };
    }
    // Deliberately asymmetric with the findUnique failure above: lichess has
    // already said this token is good, and the row is a cache, not the
    // source of truth. A failed write here must not deny a legitimate user
    // — it costs one extra introspection call next time this token is
    // checked, nothing more. Do not turn this into an early return.
    try {
      await deps.db.lichessToken.upsert({
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
      });
    } catch (error) {
      reportProblem(
        {
          kind: "cache-write",
          errorName: error instanceof Error ? error.name : "unknown",
        },
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
  };
}
