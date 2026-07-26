// @vitest-environment node
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { LichessToken, Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import {
  createTokenVerifier,
  type IntrospectionDeps,
  type IntrospectionProblem,
} from "@/server/lichess/introspection";
import { describeWithDb } from "@/test/db";

const API_URL = "https://lichess.example.test";
const FIXED_NOW = new Date("2026-07-12T00:00:00.000Z");
const MAX_EPOCH_MS = 8_640_000_000_000_000;

const hashOf = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

type RecordedCall = {
  readonly input: RequestInfo | URL;
  readonly init: RequestInit | undefined;
};

function recordingFetch(handler: (call: RecordedCall) => Response): {
  readonly fetchImpl: typeof fetch;
  readonly calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const call = { input, init };
    calls.push(call);
    return handler(call);
  };
  return { fetchImpl, calls };
}

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

type RecordedUnavailable = {
  readonly reason: IntrospectionProblem;
  readonly tokenHash: string;
};

function recordingSink(): {
  readonly onProblem: (reason: IntrospectionProblem, tokenHash: string) => void;
  readonly calls: RecordedUnavailable[];
} {
  const calls: RecordedUnavailable[] = [];
  return {
    onProblem: (reason, tokenHash) => {
      calls.push({ reason, tokenHash });
    },
    calls,
  };
}

function makePrismaPromise<T>(p: Promise<T>): Prisma.PrismaPromise<T> {
  // Attaches a rejection handler in the same tick, so Node does not flag `p` as an
  // unhandled rejection before the caller wires up its own .then/.catch.
  void p.catch(() => undefined);
  return {
    [Symbol.toStringTag]: "PrismaPromise" as const,
    // biome-ignore lint/suspicious/noThenProperty: required to satisfy Prisma.PrismaPromise<T> structurally
    then<TResult1 = T, TResult2 = never>(
      onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?:
        | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
        | null,
    ): Promise<TResult1 | TResult2> {
      return p.then<TResult1, TResult2>(onfulfilled, onrejected);
    },
    catch<TResult = never>(
      onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null,
    ): Promise<T | TResult> {
      return p.catch<TResult>(onrejected);
    },
    finally(onfinally?: (() => void) | null): Promise<T> {
      return p.finally(onfinally);
    },
  };
}

const makeRejectedPrismaPromise = <T>(
  reason: unknown,
): Prisma.PrismaPromise<T> => makePrismaPromise(Promise.reject<T>(reason));

type LichessTokenDb = IntrospectionDeps["db"];

function deferredFetch(): {
  readonly fetchImpl: typeof fetch;
  readonly calls: RecordedCall[];
  readonly release: (index: number, response: Response) => void;
  readonly whenCallCount: (count: number) => Promise<void>;
} {
  const calls: RecordedCall[] = [];
  const resolvers: Array<(response: Response) => void> = [];
  const countWaiters: Array<{
    readonly count: number;
    readonly resolve: () => void;
  }> = [];
  const fetchImpl: typeof fetch = (input, init) =>
    new Promise<Response>((resolve) => {
      calls.push({ input, init });
      resolvers.push(resolve);
      for (const waiter of countWaiters) {
        if (calls.length >= waiter.count) {
          waiter.resolve();
        }
      }
    });
  const release = (index: number, response: Response): void => {
    const resolve = resolvers[index];
    if (resolve === undefined) {
      throw new Error(`deferredFetch: no pending call at index ${index}`);
    }
    resolve(response);
  };
  // Real Postgres round-trips (as opposed to an in-memory fake) do not
  // preserve call-issuance order, so a test cannot assume that starting a
  // "held" verify() first means its fetch is registered first. This lets a
  // test await the actual admission signal — one or more fetchImpl
  // invocations having happened — instead of assuming an ordering.
  const whenCallCount = (count: number): Promise<void> => {
    if (calls.length >= count) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      countWaiters.push({ count, resolve });
    });
  };
  return { fetchImpl, calls, release, whenCallCount };
}

function tokenRow(
  overrides: Partial<LichessToken> & Pick<LichessToken, "tokenHash">,
): LichessToken {
  return {
    userId: "thibault",
    scopes: "",
    expiresAt: null,
    verifiedAt: FIXED_NOW,
    ...overrides,
  };
}

function makeTokens(n: number, prefix: string): string[] {
  return Array.from({ length: n }, () => `${prefix}-${crypto.randomUUID()}`);
}

describeWithDb("createTokenVerifier", () => {
  const cleanupHashes = new Set<string>();

  async function seedTokenRow(
    overrides: Partial<LichessToken> & Pick<LichessToken, "tokenHash">,
  ): Promise<void> {
    cleanupHashes.add(overrides.tokenHash);
    await db.lichessToken.create({ data: tokenRow(overrides) });
  }

  afterEach(async () => {
    if (cleanupHashes.size === 0) return;
    await db.lichessToken.deleteMany({
      where: { tokenHash: { in: [...cleanupHashes] } },
    });
    cleanupHashes.clear();
  });

  it("valid token: parses the comma-separated scopes into a Set", async () => {
    const token = `test-token-${crypto.randomUUID()}`;
    cleanupHashes.add(hashOf(token));
    const { fetchImpl } = recordingFetch(() =>
      jsonResponse({
        [token]: {
          userId: "thibault",
          scopes: "tournament:write,web:mod",
          expires: FIXED_NOW.getTime() + 1000,
        },
      }),
    );
    const verify = createTokenVerifier({
      db,
      fetchImpl,
      now: () => FIXED_NOW,
      apiUrl: API_URL,
    });

    const result = await verify(token);

    expect(result).toEqual({
      kind: "valid",
      auth: {
        userId: "thibault",
        scopes: new Set(["tournament:write", "web:mod"]),
        expiresAt: new Date(FIXED_NOW.getTime() + 1000),
      },
    });
  });

  it("empty scopes string parses to an empty Set", async () => {
    const token = `test-token-${crypto.randomUUID()}`;
    cleanupHashes.add(hashOf(token));
    const { fetchImpl } = recordingFetch(() =>
      jsonResponse({
        [token]: { userId: "thibault", scopes: "", expires: null },
      }),
    );
    const verify = createTokenVerifier({
      db,
      fetchImpl,
      now: () => FIXED_NOW,
      apiUrl: API_URL,
    });

    const result = await verify(token);

    expect(result.kind).toBe("valid");
    if (result.kind !== "valid") return;
    expect(result.auth.scopes).toEqual(new Set());
    expect(result.auth.expiresAt).toBeNull();
  });

  it("a null introspection entry is invalid, and negatively caches so a second call never hits the network", async () => {
    const token = `test-token-${crypto.randomUUID()}`;
    cleanupHashes.add(hashOf(token));
    const { fetchImpl, calls } = recordingFetch(() =>
      jsonResponse({ [token]: null }),
    );
    const verify = createTokenVerifier({
      db,
      fetchImpl,
      now: () => FIXED_NOW,
      apiUrl: API_URL,
    });

    const first = await verify(token);
    const second = await verify(token);

    expect(first).toEqual({ kind: "invalid" });
    expect(second).toEqual({ kind: "invalid" });
    expect(calls).toHaveLength(1);
  });

  it("a warm positive cache serves the second call without a network call", async () => {
    const token = `test-token-${crypto.randomUUID()}`;
    cleanupHashes.add(hashOf(token));
    const { fetchImpl, calls } = recordingFetch(() =>
      jsonResponse({
        [token]: {
          userId: "thibault",
          scopes: "web:mod",
          expires: FIXED_NOW.getTime() + 1000,
        },
      }),
    );
    const verify = createTokenVerifier({
      db,
      fetchImpl,
      now: () => FIXED_NOW,
      apiUrl: API_URL,
    });

    const first = await verify(token);
    const second = await verify(token);

    expect(first.kind).toBe("valid");
    expect(second).toEqual(first);
    expect(calls).toHaveLength(1);
  });

  it("a cached row whose lichess expiry has passed is invalid", async () => {
    const token = `test-token-${crypto.randomUUID()}`;
    const hash = hashOf(token);
    cleanupHashes.add(hash);
    await db.lichessToken.create({
      data: {
        tokenHash: hash,
        userId: "thibault",
        scopes: "web:mod",
        expiresAt: new Date(FIXED_NOW.getTime() - 1000),
        verifiedAt: FIXED_NOW,
      },
    });
    const { fetchImpl, calls } = recordingFetch(() =>
      jsonResponse({ [token]: null }),
    );
    const verify = createTokenVerifier({
      db,
      fetchImpl,
      now: () => FIXED_NOW,
      apiUrl: API_URL,
    });

    const result = await verify(token);

    expect(result).toEqual({ kind: "invalid" });
    expect(calls).toHaveLength(0);
  });

  it("a cache row older than the 24h reverify window re-hits the network and updates the row", async () => {
    const token = `test-token-${crypto.randomUUID()}`;
    const hash = hashOf(token);
    cleanupHashes.add(hash);
    const staleVerifiedAt = new Date(
      FIXED_NOW.getTime() - 24 * 60 * 60 * 1000 - 1,
    );
    await db.lichessToken.create({
      data: {
        tokenHash: hash,
        userId: "thibault",
        scopes: "web:mod",
        expiresAt: null,
        verifiedAt: staleVerifiedAt,
      },
    });
    const { fetchImpl, calls } = recordingFetch(() =>
      jsonResponse({
        [token]: {
          userId: "thibault",
          scopes: "tournament:write",
          expires: null,
        },
      }),
    );
    const verify = createTokenVerifier({
      db,
      fetchImpl,
      now: () => FIXED_NOW,
      apiUrl: API_URL,
    });

    const result = await verify(token);

    expect(calls).toHaveLength(1);
    expect(result).toEqual({
      kind: "valid",
      auth: {
        userId: "thibault",
        scopes: new Set(["tournament:write"]),
        expiresAt: null,
      },
    });
    const row = await db.lichessToken.findUnique({
      where: { tokenHash: hash },
    });
    expect(row?.scopes).toBe("tournament:write");
    expect(row?.verifiedAt.getTime()).toBe(FIXED_NOW.getTime());
  });

  it("the negative cache expires after 5 minutes, letting a third call reach the network again", async () => {
    const token = `test-token-${crypto.randomUUID()}`;
    cleanupHashes.add(hashOf(token));
    let currentTime = FIXED_NOW;
    const { fetchImpl, calls } = recordingFetch(() =>
      jsonResponse({ [token]: null }),
    );
    const verify = createTokenVerifier({
      db,
      fetchImpl,
      now: () => currentTime,
      apiUrl: API_URL,
    });

    const first = await verify(token);
    currentTime = new Date(FIXED_NOW.getTime() + 5 * 60 * 1000 - 1);
    const second = await verify(token);
    currentTime = new Date(FIXED_NOW.getTime() + 5 * 60 * 1000 + 1);
    const third = await verify(token);

    expect(first).toEqual({ kind: "invalid" });
    expect(second).toEqual({ kind: "invalid" });
    expect(third).toEqual({ kind: "invalid" });
    expect(calls).toHaveLength(2);
  });

  it("a rejected fetch is unavailable, never invalid or valid", async () => {
    const token = `test-token-${crypto.randomUUID()}`;
    cleanupHashes.add(hashOf(token));
    const fetchImpl: typeof fetch = async () => {
      throw new Error("network down");
    };
    const verify = createTokenVerifier({
      db,
      fetchImpl,
      now: () => FIXED_NOW,
      apiUrl: API_URL,
    });

    const result = await verify(token);

    expect(result).toEqual({ kind: "unavailable" });
  });

  it("an HTTP 429 is unavailable", async () => {
    const token = `test-token-${crypto.randomUUID()}`;
    cleanupHashes.add(hashOf(token));
    const { fetchImpl } = recordingFetch(() =>
      jsonResponse({ error: "Too Many Requests" }, 429),
    );
    const verify = createTokenVerifier({
      db,
      fetchImpl,
      now: () => FIXED_NOW,
      apiUrl: API_URL,
    });

    const result = await verify(token);

    expect(result).toEqual({ kind: "unavailable" });
  });

  it("a non-2xx response whose body stream is already errored still resolves unavailable", async () => {
    const token = `test-token-${crypto.randomUUID()}`;
    cleanupHashes.add(hashOf(token));
    const streamError = new Error("stream broken");
    const fetchImpl: typeof fetch = async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(streamError);
          },
        }),
        { status: 503 },
      );
    const verify = createTokenVerifier({
      db,
      fetchImpl,
      now: () => FIXED_NOW,
      apiUrl: API_URL,
    });

    const result = await verify(token);

    expect(result).toEqual({ kind: "unavailable" });
  });

  it("an unparseable response body is unavailable", async () => {
    const token = `test-token-${crypto.randomUUID()}`;
    cleanupHashes.add(hashOf(token));
    const { fetchImpl } = recordingFetch(
      () =>
        new Response("not json at all {{{", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const verify = createTokenVerifier({
      db,
      fetchImpl,
      now: () => FIXED_NOW,
      apiUrl: API_URL,
    });

    const result = await verify(token);

    expect(result).toEqual({ kind: "unavailable" });
  });

  it("a response shaped wrong for the schema (e.g. non-string scopes) is unavailable, not invalid", async () => {
    const token = `test-token-${crypto.randomUUID()}`;
    cleanupHashes.add(hashOf(token));
    const { fetchImpl } = recordingFetch(() =>
      jsonResponse({
        [token]: { userId: "thibault", scopes: 42, expires: null },
      }),
    );
    const verify = createTokenVerifier({
      db,
      fetchImpl,
      now: () => FIXED_NOW,
      apiUrl: API_URL,
    });

    const result = await verify(token);

    expect(result).toEqual({ kind: "unavailable" });
  });

  it("a 200 whose body omits this token's key is unavailable, not invalid", async () => {
    const token = `test-token-${crypto.randomUUID()}`;
    cleanupHashes.add(hashOf(token));
    const { fetchImpl } = recordingFetch(() => jsonResponse({}));
    const verify = createTokenVerifier({
      db,
      fetchImpl,
      now: () => FIXED_NOW,
      apiUrl: API_URL,
    });

    const result = await verify(token);

    expect(result).toEqual({ kind: "unavailable" });
  });

  it.each(["__proto__", "toString", "constructor"])(
    "a prototype-chain token %s against an empty response is unavailable, not a thrown error",
    async (token) => {
      cleanupHashes.add(hashOf(token));
      const { fetchImpl } = recordingFetch(() => jsonResponse({}));
      const verify = createTokenVerifier({
        db,
        fetchImpl,
        now: () => FIXED_NOW,
        apiUrl: API_URL,
      });

      const result = await verify(token);

      expect(result).toEqual({ kind: "unavailable" });
    },
  );

  it("a lichess request that never answers times out and resolves unavailable", async () => {
    const token = `test-token-${crypto.randomUUID()}`;
    cleanupHashes.add(hashOf(token));
    const fetchImpl: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(init.signal?.reason);
        });
      });
    const verify = createTokenVerifier({
      db,
      fetchImpl,
      now: () => FIXED_NOW,
      apiUrl: API_URL,
      timeoutMs: 5,
    });

    const result = await verify(token);

    expect(result).toEqual({ kind: "unavailable" });
  });

  it("a rejected fetch reports an onProblem network reason with the token hash, never the token", async () => {
    const token = `test-token-${crypto.randomUUID()}`;
    cleanupHashes.add(hashOf(token));
    const fetchImpl: typeof fetch = async () => {
      throw new Error("network down");
    };
    const { onProblem, calls } = recordingSink();
    const verify = createTokenVerifier({
      db,
      fetchImpl,
      now: () => FIXED_NOW,
      apiUrl: API_URL,
      onProblem,
    });

    await verify(token);

    expect(calls).toEqual([
      {
        reason: { kind: "network", errorName: "Error" },
        tokenHash: hashOf(token),
      },
    ]);
  });

  it("a non-2xx response reports an onProblem status reason with the HTTP status", async () => {
    const token = `test-token-${crypto.randomUUID()}`;
    cleanupHashes.add(hashOf(token));
    const { fetchImpl } = recordingFetch(() =>
      jsonResponse({ error: "Too Many Requests" }, 429),
    );
    const { onProblem, calls } = recordingSink();
    const verify = createTokenVerifier({
      db,
      fetchImpl,
      now: () => FIXED_NOW,
      apiUrl: API_URL,
      onProblem,
    });

    await verify(token);

    expect(calls).toEqual([
      { reason: { kind: "status", status: 429 }, tokenHash: hashOf(token) },
    ]);
  });

  it("an unparseable body reports an onProblem body reason", async () => {
    const token = `test-token-${crypto.randomUUID()}`;
    cleanupHashes.add(hashOf(token));
    const { fetchImpl } = recordingFetch(
      () =>
        new Response("not json at all {{{", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const { onProblem, calls } = recordingSink();
    const verify = createTokenVerifier({
      db,
      fetchImpl,
      now: () => FIXED_NOW,
      apiUrl: API_URL,
      onProblem,
    });

    await verify(token);

    expect(calls).toEqual([
      { reason: { kind: "body" }, tokenHash: hashOf(token) },
    ]);
  });

  it("a schema-mismatched body reports an onProblem schema reason, and the raw token appears nowhere in what's handed to the sink", async () => {
    const token = "super-secret-raw-lichess-token-for-sink-test";
    cleanupHashes.add(hashOf(token));
    const { fetchImpl } = recordingFetch(() =>
      jsonResponse({
        [token]: { userId: "thibault", scopes: 42, expires: null },
      }),
    );
    const { onProblem, calls } = recordingSink();
    const verify = createTokenVerifier({
      db,
      fetchImpl,
      now: () => FIXED_NOW,
      apiUrl: API_URL,
      onProblem,
    });

    await verify(token);

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call).toBeDefined();
    if (call === undefined) return;
    expect(call.reason.kind).toBe("schema");
    expect(call.tokenHash).toBe(hashOf(token));
    expect(JSON.stringify(call)).not.toContain(token);
  });

  it("a 200 body omitting this token's key reports an onProblem missing-entry reason", async () => {
    const token = `test-token-${crypto.randomUUID()}`;
    cleanupHashes.add(hashOf(token));
    const { fetchImpl } = recordingFetch(() => jsonResponse({}));
    const { onProblem, calls } = recordingSink();
    const verify = createTokenVerifier({
      db,
      fetchImpl,
      now: () => FIXED_NOW,
      apiUrl: API_URL,
      onProblem,
    });

    await verify(token);

    expect(calls).toEqual([
      { reason: { kind: "missing-entry" }, tokenHash: hashOf(token) },
    ]);
  });

  it("a cache-write failure after a positive introspection reports an onProblem cache-write reason", async () => {
    const token = `test-token-${crypto.randomUUID()}`;
    cleanupHashes.add(hashOf(token));
    const brokenDb: LichessTokenDb = {
      lichessToken: {
        findUnique: () => makePrismaPromise(Promise.resolve(null)),
        upsert: () => makeRejectedPrismaPromise(new Error("write conflict")),
        deleteMany: () =>
          makeRejectedPrismaPromise(new Error("should not be called")),
      },
    };
    const { fetchImpl } = recordingFetch(() =>
      jsonResponse({
        [token]: { userId: "thibault", scopes: "web:mod", expires: null },
      }),
    );
    const { onProblem, calls } = recordingSink();
    const verify = createTokenVerifier({
      db: brokenDb,
      fetchImpl,
      now: () => FIXED_NOW,
      apiUrl: API_URL,
      onProblem,
    });

    const result = await verify(token);

    expect(result.kind).toBe("valid");
    expect(calls).toEqual([
      {
        reason: { kind: "cache-write", errorName: "Error" },
        tokenHash: hashOf(token),
      },
    ]);
  });

  it("a throwing onProblem sink does not prevent a cache-write success from resolving valid", async () => {
    const token = `test-token-${crypto.randomUUID()}`;
    cleanupHashes.add(hashOf(token));
    const brokenDb: LichessTokenDb = {
      lichessToken: {
        findUnique: () => makePrismaPromise(Promise.resolve(null)),
        upsert: () => makeRejectedPrismaPromise(new Error("write conflict")),
        deleteMany: () =>
          makeRejectedPrismaPromise(new Error("should not be called")),
      },
    };
    const { fetchImpl } = recordingFetch(() =>
      jsonResponse({
        [token]: { userId: "thibault", scopes: "web:mod", expires: null },
      }),
    );
    const throwingOnUnavailable = (): void => {
      throw new Error("sink is broken");
    };
    const verify = createTokenVerifier({
      db: brokenDb,
      fetchImpl,
      now: () => FIXED_NOW,
      apiUrl: API_URL,
      onProblem: throwingOnUnavailable,
    });

    const result = await verify(token);

    expect(result.kind).toBe("valid");
  });

  it("a throwing onProblem sink does not prevent a network failure from resolving unavailable", async () => {
    const token = `test-token-${crypto.randomUUID()}`;
    cleanupHashes.add(hashOf(token));
    const fetchImpl: typeof fetch = async () => {
      throw new Error("network down");
    };
    const throwingOnUnavailable = (): void => {
      throw new Error("sink is broken");
    };
    const verify = createTokenVerifier({
      db,
      fetchImpl,
      now: () => FIXED_NOW,
      apiUrl: API_URL,
      onProblem: throwingOnUnavailable,
    });

    const result = await verify(token);

    expect(result).toEqual({ kind: "unavailable" });
  });

  it("an empty token is invalid without any network call", async () => {
    const { fetchImpl, calls } = recordingFetch(() => jsonResponse({}));
    const verify = createTokenVerifier({
      db,
      fetchImpl,
      now: () => FIXED_NOW,
      apiUrl: API_URL,
    });

    const result = await verify("");

    expect(result).toEqual({ kind: "invalid" });
    expect(calls).toHaveLength(0);
  });

  it("a token longer than 512 chars is invalid without any network call", async () => {
    const { fetchImpl, calls } = recordingFetch(() => jsonResponse({}));
    const verify = createTokenVerifier({
      db,
      fetchImpl,
      now: () => FIXED_NOW,
      apiUrl: API_URL,
    });

    const result = await verify("x".repeat(513));

    expect(result).toEqual({ kind: "invalid" });
    expect(calls).toHaveLength(0);
  });

  it("a token exactly 512 chars proceeds to introspection rather than short-circuiting to invalid", async () => {
    const token = "x".repeat(512);
    cleanupHashes.add(hashOf(token));
    const { fetchImpl, calls } = recordingFetch(() =>
      jsonResponse({
        [token]: { userId: "thibault", scopes: "", expires: null },
      }),
    );
    const verify = createTokenVerifier({
      db,
      fetchImpl,
      now: () => FIXED_NOW,
      apiUrl: API_URL,
    });

    const result = await verify(token);

    expect(result.kind).toBe("valid");
    expect(calls).toHaveLength(1);
  });

  it("the negative cache evicts the oldest entry once it reaches negativeCacheMax", async () => {
    const t1 = `t1-${crypto.randomUUID()}`;
    const t2 = `t2-${crypto.randomUUID()}`;
    const t3 = `t3-${crypto.randomUUID()}`;
    for (const t of [t1, t2, t3]) cleanupHashes.add(hashOf(t));
    const { fetchImpl, calls } = recordingFetch((call) =>
      jsonResponse({ [String(call.init?.body)]: null }),
    );
    const verify = createTokenVerifier({
      db,
      fetchImpl,
      now: () => FIXED_NOW,
      apiUrl: API_URL,
      negativeCacheMax: 2,
    });

    await verify(t1);
    await verify(t2);
    await verify(t3);
    await verify(t1);
    await verify(t3);

    expect(calls).toHaveLength(4);
  });

  it("a freshly-introspected token whose lichess expiry is already in the past is invalid, not valid", async () => {
    const token = `test-token-${crypto.randomUUID()}`;
    cleanupHashes.add(hashOf(token));
    const { fetchImpl } = recordingFetch(() =>
      jsonResponse({
        [token]: {
          userId: "thibault",
          scopes: "web:mod",
          expires: FIXED_NOW.getTime() - 1000,
        },
      }),
    );
    const verify = createTokenVerifier({
      db,
      fetchImpl,
      now: () => FIXED_NOW,
      apiUrl: API_URL,
    });

    const result = await verify(token);

    expect(result).toEqual({ kind: "invalid" });
  });

  it("an expires value one past Date's representable range is unavailable, not a never-expiring valid token", async () => {
    const token = `test-token-${crypto.randomUUID()}`;
    cleanupHashes.add(hashOf(token));
    const { fetchImpl } = recordingFetch(() =>
      jsonResponse({
        [token]: {
          userId: "thibault",
          scopes: "web:mod",
          expires: MAX_EPOCH_MS + 1,
        },
      }),
    );
    const verify = createTokenVerifier({
      db,
      fetchImpl,
      now: () => FIXED_NOW,
      apiUrl: API_URL,
    });

    const result = await verify(token);

    expect(result).toEqual({ kind: "unavailable" });
  });

  it("an expires value exactly at Date's representable range is valid", async () => {
    const token = `test-token-${crypto.randomUUID()}`;
    cleanupHashes.add(hashOf(token));
    const { fetchImpl } = recordingFetch(() =>
      jsonResponse({
        [token]: {
          userId: "thibault",
          scopes: "web:mod",
          expires: MAX_EPOCH_MS,
        },
      }),
    );
    const verify = createTokenVerifier({
      db,
      fetchImpl,
      now: () => FIXED_NOW,
      apiUrl: API_URL,
    });

    const result = await verify(token);

    expect(result).toEqual({
      kind: "valid",
      auth: {
        userId: "thibault",
        scopes: new Set(["web:mod"]),
        expiresAt: new Date(MAX_EPOCH_MS),
      },
    });
  });

  it("a cache-read (findUnique) failure is unavailable, not a thrown error", async () => {
    const token = `test-token-${crypto.randomUUID()}`;
    cleanupHashes.add(hashOf(token));
    const brokenDb: LichessTokenDb = {
      lichessToken: {
        findUnique: () =>
          makeRejectedPrismaPromise(new Error("connection reset")),
        upsert: () =>
          makeRejectedPrismaPromise(new Error("should not be called")),
        deleteMany: () =>
          makeRejectedPrismaPromise(new Error("should not be called")),
      },
    };
    const verify = createTokenVerifier({
      db: brokenDb,
      fetchImpl: recordingFetch(() => jsonResponse({ [token]: null }))
        .fetchImpl,
      now: () => FIXED_NOW,
      apiUrl: API_URL,
    });

    const result = await verify(token);

    expect(result).toEqual({ kind: "unavailable" });
  });

  it("a cache-read (findUnique) failure reports an onProblem cache-read reason", async () => {
    const token = `test-token-${crypto.randomUUID()}`;
    cleanupHashes.add(hashOf(token));
    const brokenDb: LichessTokenDb = {
      lichessToken: {
        findUnique: () =>
          makeRejectedPrismaPromise(new Error("connection reset")),
        upsert: () =>
          makeRejectedPrismaPromise(new Error("should not be called")),
        deleteMany: () =>
          makeRejectedPrismaPromise(new Error("should not be called")),
      },
    };
    const { onProblem, calls } = recordingSink();
    const verify = createTokenVerifier({
      db: brokenDb,
      fetchImpl: recordingFetch(() => jsonResponse({ [token]: null }))
        .fetchImpl,
      now: () => FIXED_NOW,
      apiUrl: API_URL,
      onProblem,
    });

    const result = await verify(token);

    expect(result).toEqual({ kind: "unavailable" });
    expect(calls).toEqual([
      { reason: { kind: "cache-read" }, tokenHash: hashOf(token) },
    ]);
  });

  it("a cache-write (upsert) failure after a positive introspection is still valid, best-effort", async () => {
    const token = `test-token-${crypto.randomUUID()}`;
    cleanupHashes.add(hashOf(token));
    const brokenDb: LichessTokenDb = {
      lichessToken: {
        findUnique: () => makePrismaPromise(Promise.resolve(null)),
        upsert: () => makeRejectedPrismaPromise(new Error("write conflict")),
        deleteMany: () =>
          makeRejectedPrismaPromise(new Error("should not be called")),
      },
    };
    const { fetchImpl } = recordingFetch(() =>
      jsonResponse({
        [token]: {
          userId: "thibault",
          scopes: "web:mod",
          expires: null,
        },
      }),
    );
    const verify = createTokenVerifier({
      db: brokenDb,
      fetchImpl,
      now: () => FIXED_NOW,
      apiUrl: API_URL,
    });

    const result = await verify(token);

    expect(result).toEqual({
      kind: "valid",
      auth: {
        userId: "thibault",
        scopes: new Set(["web:mod"]),
        expiresAt: null,
      },
    });
  });

  it("posts to POST {apiUrl}/api/token/test with text/plain body = the raw token", async () => {
    const token = `test-token-${crypto.randomUUID()}`;
    cleanupHashes.add(hashOf(token));
    const { fetchImpl, calls } = recordingFetch(() =>
      jsonResponse({
        [token]: { userId: "thibault", scopes: "", expires: null },
      }),
    );
    const verify = createTokenVerifier({
      db,
      fetchImpl,
      now: () => FIXED_NOW,
      apiUrl: API_URL,
    });

    await verify(token);

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call).toBeDefined();
    if (call === undefined) return;
    expect(String(call.input)).toBe(`${API_URL}/api/token/test`);
    expect(call.init?.method).toBe("POST");
    const headers = new Headers(call.init?.headers);
    expect(headers.get("Content-Type")).toBe("text/plain");
    expect(call.init?.body).toBe(token);
  });

  it("stores the sha256 hash of the token as the row key; the raw token is nowhere in the stored row", async () => {
    const token = "super-secret-raw-lichess-token-value";
    const hash = hashOf(token);
    cleanupHashes.add(hash);
    const { fetchImpl } = recordingFetch(() =>
      jsonResponse({
        [token]: {
          userId: "thibault",
          scopes: "web:mod",
          expires: FIXED_NOW.getTime() + 1000,
        },
      }),
    );
    const verify = createTokenVerifier({
      db,
      fetchImpl,
      now: () => FIXED_NOW,
      apiUrl: API_URL,
    });

    await verify(token);

    const row = await db.lichessToken.findUnique({
      where: { tokenHash: hash },
    });
    expect(row).not.toBeNull();
    if (row === null) return;
    expect(row.tokenHash).toBe(hash);
    expect(JSON.stringify(row)).not.toContain(token);
  });

  describe("A. bounded admission under a flood of distinct cold tokens", () => {
    it("one held introspection plus N distinct cold tokens issues exactly one fetch, and each cold token resolves unavailable", async () => {
      const heldToken = `held-${crypto.randomUUID()}`;
      const floodTokens = makeTokens(5, "flood");
      const { fetchImpl, calls, release, whenCallCount } = deferredFetch();
      const verify = createTokenVerifier({
        db,
        fetchImpl,
        now: () => FIXED_NOW,
        apiUrl: API_URL,
      });

      const heldPromise = verify(heldToken);
      await whenCallCount(1);
      const floodResults = await Promise.all(floodTokens.map((t) => verify(t)));

      expect(calls).toHaveLength(1);
      for (const result of floodResults) {
        expect(result).toEqual({ kind: "unavailable" });
      }

      release(0, jsonResponse({ [heldToken]: null }));
      await heldPromise;
    });

    it("a token with a fresh positive row resolves valid with zero fetches while saturated", async () => {
      const heldToken = `held-${crypto.randomUUID()}`;
      const freshToken = `fresh-${crypto.randomUUID()}`;
      const freshHash = hashOf(freshToken);
      await seedTokenRow({ tokenHash: freshHash });
      const { fetchImpl, calls, release, whenCallCount } = deferredFetch();
      const verify = createTokenVerifier({
        db,
        fetchImpl,
        now: () => FIXED_NOW,
        apiUrl: API_URL,
      });

      const heldPromise = verify(heldToken);
      const freshResult = await verify(freshToken);
      await whenCallCount(1);

      expect(freshResult.kind).toBe("valid");
      expect(calls).toHaveLength(1);

      release(0, jsonResponse({ [heldToken]: null }));
      await heldPromise;
    });

    it("a negatively-cached token resolves invalid with zero fetches while saturated", async () => {
      const heldToken = `held-${crypto.randomUUID()}`;
      const negativeToken = `negative-${crypto.randomUUID()}`;
      const probeToken = `probe-${crypto.randomUUID()}`;
      let releaseHeld: ((response: Response) => void) | undefined;
      let fetchCount = 0;
      let notifyHeldCalled: (() => void) | undefined;
      const heldCalled = new Promise<void>((resolve) => {
        notifyHeldCalled = resolve;
      });
      const fetchImpl: typeof fetch = (_input, init) => {
        fetchCount += 1;
        const body = String(init?.body);
        if (body === negativeToken) {
          return Promise.resolve(jsonResponse({ [negativeToken]: null }));
        }
        return new Promise<Response>((resolve) => {
          releaseHeld = resolve;
          notifyHeldCalled?.();
        });
      };
      const verify = createTokenVerifier({
        db,
        fetchImpl,
        now: () => FIXED_NOW,
        apiUrl: API_URL,
      });

      const primeResult = await verify(negativeToken);
      expect(primeResult).toEqual({ kind: "invalid" });
      expect(fetchCount).toBe(1);

      const heldPromise = verify(heldToken);
      await heldCalled;
      const probeResult = await verify(probeToken);
      expect(probeResult).toEqual({ kind: "unavailable" });
      expect(fetchCount).toBe(2);

      const secondResult = await verify(negativeToken);

      expect(secondResult).toEqual({ kind: "invalid" });
      expect(fetchCount).toBe(2);

      releaseHeld?.(jsonResponse({ [heldToken]: null }));
      await heldPromise;
    });

    it("once the held introspection settles, the next cold token is admitted", async () => {
      const firstToken = `first-${crypto.randomUUID()}`;
      const secondToken = `second-${crypto.randomUUID()}`;
      const { fetchImpl, calls } = recordingFetch((call) =>
        jsonResponse({ [String(call.init?.body)]: null }),
      );
      const verify = createTokenVerifier({
        db,
        fetchImpl,
        now: () => FIXED_NOW,
        apiUrl: API_URL,
      });

      await verify(firstToken);
      const secondResult = await verify(secondToken);

      expect(calls).toHaveLength(2);
      expect(secondResult).toEqual({ kind: "invalid" });
    });

    it("maxConcurrentIntrospections: 2 admits two concurrent introspections and refuses the third", async () => {
      const tokenA = `admit2-a-${crypto.randomUUID()}`;
      const tokenB = `admit2-b-${crypto.randomUUID()}`;
      const tokenC = `admit2-c-${crypto.randomUUID()}`;
      const { fetchImpl, calls, release, whenCallCount } = deferredFetch();
      const verify = createTokenVerifier({
        db,
        fetchImpl,
        now: () => FIXED_NOW,
        apiUrl: API_URL,
        maxConcurrentIntrospections: 2,
      });

      const promiseA = verify(tokenA);
      const promiseB = verify(tokenB);
      await whenCallCount(2);
      const resultC = await verify(tokenC);

      expect(calls).toHaveLength(2);
      expect(resultC).toEqual({ kind: "unavailable" });

      release(0, jsonResponse({ [tokenA]: null }));
      release(1, jsonResponse({ [tokenB]: null }));
      await Promise.all([promiseA, promiseB]);
    });

    it("with maxConcurrentIntrospections: 1, released never exceeds acquired across three successive hold-then-release rounds", async () => {
      const { fetchImpl, calls, release, whenCallCount } = deferredFetch();
      const verify = createTokenVerifier({
        db,
        fetchImpl,
        now: () => FIXED_NOW,
        apiUrl: API_URL,
        maxConcurrentIntrospections: 1,
      });

      for (let round = 0; round < 3; round += 1) {
        const callsBefore = calls.length;
        const holdToken = `onein-hold-${round}-${crypto.randomUUID()}`;
        const concurrentToken = `onein-concurrent-${round}-${crypto.randomUUID()}`;

        const holdPromise = verify(holdToken);
        await whenCallCount(callsBefore + 1);

        const concurrentPromise = verify(concurrentToken);
        const raceOutcome = await Promise.race([
          concurrentPromise.then(
            (result) => ({ kind: "resolved", result }) as const,
          ),
          whenCallCount(callsBefore + 2).then(
            () => ({ kind: "admitted" }) as const,
          ),
        ]);

        expect(raceOutcome).toEqual({
          kind: "resolved",
          result: { kind: "unavailable" },
        });
        expect(calls).toHaveLength(callsBefore + 1);

        release(callsBefore, jsonResponse({ [holdToken]: null }));
        expect(await holdPromise).toEqual({ kind: "invalid" });
      }

      expect(calls).toHaveLength(3);
    });
  });

  describe("B. single-flight de-duplication", () => {
    it("two concurrent verifies of the same token issue exactly one introspection and resolve identically", async () => {
      const token = `dup-${crypto.randomUUID()}`;
      const { fetchImpl, calls } = recordingFetch(() =>
        jsonResponse({
          [token]: { userId: "thibault", scopes: "", expires: null },
        }),
      );
      const verify = createTokenVerifier({
        db,
        fetchImpl,
        now: () => FIXED_NOW,
        apiUrl: API_URL,
      });

      const [first, second] = await Promise.all([verify(token), verify(token)]);

      expect(calls).toHaveLength(1);
      expect(first).toEqual(second);
      expect(first.kind).toBe("valid");
    });

    it("a second verify started after the first settles issues its own second introspection", async () => {
      const token = `dup2-${crypto.randomUUID()}`;
      let fetchCount = 0;
      const fetchImpl: typeof fetch = async () => {
        fetchCount += 1;
        throw new Error("network down");
      };
      const verify = createTokenVerifier({
        db,
        fetchImpl,
        now: () => FIXED_NOW,
        apiUrl: API_URL,
      });

      await verify(token);
      await verify(token);

      expect(fetchCount).toBe(2);
    });

    it("concurrent verifies of different tokens do not share a result", async () => {
      const tokenA = `diffA-${crypto.randomUUID()}`;
      const tokenB = `diffB-${crypto.randomUUID()}`;
      const { fetchImpl, calls } = recordingFetch((call) => {
        const body = String(call.init?.body);
        return jsonResponse({
          [body]: { userId: body, scopes: "", expires: null },
        });
      });
      const verify = createTokenVerifier({
        db,
        fetchImpl,
        now: () => FIXED_NOW,
        apiUrl: API_URL,
        maxConcurrentIntrospections: 2,
      });

      const [resultA, resultB] = await Promise.all([
        verify(tokenA),
        verify(tokenB),
      ]);

      expect(calls).toHaveLength(2);
      expect(resultA).not.toEqual(resultB);
    });

    it("a joiner for an already in-flight token is admitted even while the concurrency budget is saturated", async () => {
      const heldToken = `held-joiner-${crypto.randomUUID()}`;
      const otherColdToken = `held-joiner-other-${crypto.randomUUID()}`;
      const { fetchImpl, calls, release, whenCallCount } = deferredFetch();
      const verify = createTokenVerifier({
        db,
        fetchImpl,
        now: () => FIXED_NOW,
        apiUrl: API_URL,
      });

      const heldPromise = verify(heldToken);
      await whenCallCount(1);
      const otherResult = await verify(otherColdToken);
      expect(otherResult).toEqual({ kind: "unavailable" });
      expect(calls).toHaveLength(1);

      const joinerPromise = verify(heldToken);
      release(
        0,
        jsonResponse({
          [heldToken]: { userId: "thibault", scopes: "", expires: null },
        }),
      );

      const [heldResult, joinerResult] = await Promise.all([
        heldPromise,
        joinerPromise,
      ]);

      expect(joinerResult).toEqual(heldResult);
      expect(joinerResult.kind).toBe("valid");
      expect(calls).toHaveLength(1);
    });

    it("exactly one negative-cache entry is written for a token deduped across N concurrent callers", async () => {
      const token = `dedup-neg-${crypto.randomUUID()}`;
      const { fetchImpl, calls } = recordingFetch(() =>
        jsonResponse({ [token]: null }),
      );
      const verify = createTokenVerifier({
        db,
        fetchImpl,
        now: () => FIXED_NOW,
        apiUrl: API_URL,
      });

      const results = await Promise.all(
        Array.from({ length: 5 }, () => verify(token)),
      );

      for (const result of results) {
        expect(result).toEqual({ kind: "invalid" });
      }
      expect(calls).toHaveLength(1);

      const later = await verify(token);
      expect(later).toEqual({ kind: "invalid" });
      expect(calls).toHaveLength(1);
    });
  });

  describe("C. cleanup on rejection — a leaked slot is a total, silent outage", () => {
    it("an unexpected internal throw during the shared introspection resolves unavailable instead of rejecting", async () => {
      const token = `boom-${crypto.randomUUID()}`;
      let nowCalls = 0;
      const now = (): Date => {
        nowCalls += 1;
        if (nowCalls === 1) return FIXED_NOW;
        throw new Error("clock exploded");
      };
      const fetchImpl: typeof fetch = async () => {
        throw new Error("network down");
      };
      const verify = createTokenVerifier({
        db,
        fetchImpl,
        now,
        apiUrl: API_URL,
      });

      const result = await verify(token);

      expect(result).toEqual({ kind: "unavailable" });
    });

    it("an unexpected internal throw reports the token hash and Error.name only, never the raw token or the message", async () => {
      const token = `boom-diagnostic-${crypto.randomUUID()}`;
      let nowCalls = 0;
      const now = (): Date => {
        nowCalls += 1;
        if (nowCalls === 1) return FIXED_NOW;
        throw new Error("clock exploded");
      };
      const fetchImpl: typeof fetch = async () => {
        throw new Error("network down");
      };
      const { onProblem, calls: problemCalls } = recordingSink();
      const verify = createTokenVerifier({
        db,
        fetchImpl,
        now,
        apiUrl: API_URL,
        onProblem,
      });

      const result = await verify(token);

      expect(result).toEqual({ kind: "unavailable" });
      expect(problemCalls).toEqual([
        {
          reason: { kind: "unexpected", errorName: "Error" },
          tokenHash: hashOf(token),
        },
      ]);
      expect(JSON.stringify(problemCalls)).not.toContain(token);
    });

    it("every caller of a token whose introspection fails resolves unavailable and none throws", async () => {
      const token = `fail-${crypto.randomUUID()}`;
      const fetchImpl: typeof fetch = async () => {
        throw new Error("network down");
      };
      const verify = createTokenVerifier({
        db,
        fetchImpl,
        now: () => FIXED_NOW,
        apiUrl: API_URL,
      });

      const [first, second] = await Promise.all([verify(token), verify(token)]);

      expect(first).toEqual({ kind: "unavailable" });
      expect(second).toEqual({ kind: "unavailable" });
    });

    it("a later verify of the same token after a failure issues its own fetch rather than joining a stale entry", async () => {
      const token = `fail2-${crypto.randomUUID()}`;
      let fetchCount = 0;
      const fetchImpl: typeof fetch = async () => {
        fetchCount += 1;
        throw new Error("network down");
      };
      const verify = createTokenVerifier({
        db,
        fetchImpl,
        now: () => FIXED_NOW,
        apiUrl: API_URL,
      });

      await verify(token);
      await verify(token);

      expect(fetchCount).toBe(2);
    });

    it("a later verify of a different cold token after a failure is still admitted — the slot was released", async () => {
      const failingToken = `fail3-${crypto.randomUUID()}`;
      const coldToken = `cold3-${crypto.randomUUID()}`;
      const { fetchImpl, calls } = recordingFetch((call) => {
        const body = String(call.init?.body);
        if (body === failingToken) {
          return jsonResponse({ error: "boom" }, 500);
        }
        return jsonResponse({ [coldToken]: null });
      });
      const verify = createTokenVerifier({
        db,
        fetchImpl,
        now: () => FIXED_NOW,
        apiUrl: API_URL,
      });

      const failResult = await verify(failingToken);
      const coldResult = await verify(coldToken);

      expect(failResult).toEqual({ kind: "unavailable" });
      expect(coldResult).toEqual({ kind: "invalid" });
      expect(calls).toHaveLength(2);
    });

    it("after a settled concurrent burst for one token, no in-flight entry remains and a fresh call re-fetches", async () => {
      const token = `burst-${crypto.randomUUID()}`;
      let fetchCount = 0;
      const fetchImpl: typeof fetch = async () => {
        fetchCount += 1;
        throw new Error("network down");
      };
      const verify = createTokenVerifier({
        db,
        fetchImpl,
        now: () => FIXED_NOW,
        apiUrl: API_URL,
      });

      await Promise.all(Array.from({ length: 4 }, () => verify(token)));
      await verify(token);

      expect(fetchCount).toBe(2);
    });

    it("a findUnique failure resolves unavailable without consuming a concurrency slot", async () => {
      const tokens = makeTokens(5, "readfail");
      const brokenDb: LichessTokenDb = {
        lichessToken: {
          findUnique: () =>
            makeRejectedPrismaPromise(new Error("connection reset")),
          upsert: () =>
            makeRejectedPrismaPromise(new Error("should not be called")),
          deleteMany: () =>
            makeRejectedPrismaPromise(new Error("should not be called")),
        },
      };
      const { fetchImpl, calls } = recordingFetch(() => jsonResponse({}));
      const verify = createTokenVerifier({
        db: brokenDb,
        fetchImpl,
        now: () => FIXED_NOW,
        apiUrl: API_URL,
      });

      const results = await Promise.all(tokens.map((t) => verify(t)));

      for (const result of results) {
        expect(result).toEqual({ kind: "unavailable" });
      }
      expect(calls).toHaveLength(0);
    });

    it("repeated findUnique failures never open the breaker: a later successful lookup still proceeds instead of being throttled", async () => {
      const tokens = makeTokens(5, "readfail2");
      const coldToken = `readfail2-final-${crypto.randomUUID()}`;
      let dbShouldFail = true;
      const brokenDb: LichessTokenDb = {
        lichessToken: {
          findUnique: () =>
            dbShouldFail
              ? makeRejectedPrismaPromise(new Error("connection reset"))
              : makePrismaPromise(Promise.resolve(null)),
          upsert: () =>
            makeRejectedPrismaPromise(new Error("should not be called")),
          deleteMany: () =>
            makeRejectedPrismaPromise(new Error("should not be called")),
        },
      };
      const { fetchImpl, calls } = recordingFetch(() =>
        jsonResponse({ [coldToken]: null }),
      );
      const verify = createTokenVerifier({
        db: brokenDb,
        fetchImpl,
        now: () => FIXED_NOW,
        apiUrl: API_URL,
        breakerFailureThreshold: 3,
      });

      for (const token of tokens) {
        const result = await verify(token);
        expect(result).toEqual({ kind: "unavailable" });
      }
      dbShouldFail = false;

      const finalResult = await verify(coldToken);

      expect(finalResult).toEqual({ kind: "invalid" });
      expect(calls).toHaveLength(1);
    });

    it("exactly breakerFailureThreshold consecutive cache-read failures do not open the breaker: an immediately-following legitimate cold-token call is not throttled", async () => {
      const breakerFailureThreshold = 3;
      const tokens = makeTokens(breakerFailureThreshold, "readfail-threshold");
      const coldToken = `readfail-threshold-final-${crypto.randomUUID()}`;
      let dbShouldFail = true;
      const brokenDb: LichessTokenDb = {
        lichessToken: {
          findUnique: () =>
            dbShouldFail
              ? makeRejectedPrismaPromise(new Error("connection reset"))
              : makePrismaPromise(Promise.resolve(null)),
          upsert: () =>
            makeRejectedPrismaPromise(new Error("should not be called")),
          deleteMany: () =>
            makeRejectedPrismaPromise(new Error("should not be called")),
        },
      };
      const { fetchImpl, calls } = recordingFetch(() =>
        jsonResponse({ [coldToken]: null }),
      );
      const verify = createTokenVerifier({
        db: brokenDb,
        fetchImpl,
        now: () => FIXED_NOW,
        apiUrl: API_URL,
        breakerFailureThreshold,
      });

      for (const token of tokens) {
        const result = await verify(token);
        expect(result).toEqual({ kind: "unavailable" });
      }
      dbShouldFail = false;

      const finalResult = await verify(coldToken);

      expect(finalResult).toEqual({ kind: "invalid" });
      expect(calls).toHaveLength(1);
    });
  });

  describe("D. circuit breaker on transport failures", () => {
    it("3 consecutive 429s open the breaker; the next cold token resolves unavailable with no fetch", async () => {
      const failTokens = makeTokens(3, "breaker429");
      const coldToken = `breaker429-cold-${crypto.randomUUID()}`;
      const { fetchImpl, calls } = recordingFetch(() =>
        jsonResponse({ error: "slow down" }, 429),
      );
      const verify = createTokenVerifier({
        db,
        fetchImpl,
        now: () => FIXED_NOW,
        apiUrl: API_URL,
      });

      for (const token of failTokens) {
        const result = await verify(token);
        expect(result).toEqual({ kind: "unavailable" });
      }
      expect(calls).toHaveLength(3);

      const coldResult = await verify(coldToken);

      expect(coldResult).toEqual({ kind: "unavailable" });
      expect(calls).toHaveLength(3);
    });

    it("network/timeout failures also count toward the breaker threshold", async () => {
      const failTokens = makeTokens(3, "breakernet");
      const coldToken = `breakernet-cold-${crypto.randomUUID()}`;
      let fetchCount = 0;
      const fetchImpl: typeof fetch = async () => {
        fetchCount += 1;
        throw new Error("timeout");
      };
      const verify = createTokenVerifier({
        db,
        fetchImpl,
        now: () => FIXED_NOW,
        apiUrl: API_URL,
      });

      for (const token of failTokens) {
        await verify(token);
      }
      expect(fetchCount).toBe(3);

      const coldResult = await verify(coldToken);

      expect(coldResult).toEqual({ kind: "unavailable" });
      expect(fetchCount).toBe(3);
    });

    it("5xx responses also count toward the breaker threshold", async () => {
      const failTokens = makeTokens(3, "breaker5xx");
      const coldToken = `breaker5xx-cold-${crypto.randomUUID()}`;
      const { fetchImpl, calls } = recordingFetch(() =>
        jsonResponse({ error: "boom" }, 503),
      );
      const verify = createTokenVerifier({
        db,
        fetchImpl,
        now: () => FIXED_NOW,
        apiUrl: API_URL,
      });

      for (const token of failTokens) {
        await verify(token);
      }
      expect(calls).toHaveLength(3);

      const coldResult = await verify(coldToken);

      expect(coldResult).toEqual({ kind: "unavailable" });
      expect(calls).toHaveLength(3);
    });

    it("schema-mismatch failures do not count toward the breaker, and the schema diagnostic keeps flowing", async () => {
      const failTokens = makeTokens(4, "breakerschema");
      const coldToken = `breakerschema-cold-${crypto.randomUUID()}`;
      const { fetchImpl } = recordingFetch((call) => {
        const body = String(call.init?.body);
        if (body === coldToken) {
          return jsonResponse({ [coldToken]: null });
        }
        return jsonResponse({
          [body]: { userId: "thibault", scopes: 42, expires: null },
        });
      });
      const { onProblem, calls: problemCalls } = recordingSink();
      const verify = createTokenVerifier({
        db,
        fetchImpl,
        now: () => FIXED_NOW,
        apiUrl: API_URL,
        onProblem,
        breakerFailureThreshold: 3,
      });

      for (const token of failTokens) {
        const result = await verify(token);
        expect(result).toEqual({ kind: "unavailable" });
      }

      expect(
        problemCalls.filter((call) => call.reason.kind === "schema"),
      ).toHaveLength(4);

      const coldResult = await verify(coldToken);

      expect(coldResult).toEqual({ kind: "invalid" });
    });

    it("unparseable-body failures do not count toward the breaker", async () => {
      const failTokens = makeTokens(4, "breakerbody");
      const coldToken = `breakerbody-cold-${crypto.randomUUID()}`;
      const fetchImpl: typeof fetch = async (_input, init) => {
        const body = String(init?.body);
        if (body === coldToken) {
          return jsonResponse({ [coldToken]: null });
        }
        return new Response("not json {{{", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      };
      const verify = createTokenVerifier({
        db,
        fetchImpl,
        now: () => FIXED_NOW,
        apiUrl: API_URL,
        breakerFailureThreshold: 3,
      });

      for (const token of failTokens) {
        const result = await verify(token);
        expect(result).toEqual({ kind: "unavailable" });
      }

      const coldResult = await verify(coldToken);

      expect(coldResult).toEqual({ kind: "invalid" });
    });

    it("missing-entry failures do not count toward the breaker", async () => {
      const failTokens = makeTokens(4, "breakermissing");
      const coldToken = `breakermissing-cold-${crypto.randomUUID()}`;
      const fetchImpl: typeof fetch = async (_input, init) => {
        const body = String(init?.body);
        if (body === coldToken) {
          return jsonResponse({ [coldToken]: null });
        }
        return jsonResponse({});
      };
      const verify = createTokenVerifier({
        db,
        fetchImpl,
        now: () => FIXED_NOW,
        apiUrl: API_URL,
        breakerFailureThreshold: 3,
      });

      for (const token of failTokens) {
        const result = await verify(token);
        expect(result).toEqual({ kind: "unavailable" });
      }

      const coldResult = await verify(coldToken);

      expect(coldResult).toEqual({ kind: "invalid" });
    });

    it("one success below the failure threshold resets the consecutive-failure count", async () => {
      const failToken1 = `resetfail1-${crypto.randomUUID()}`;
      const failToken2 = `resetfail2-${crypto.randomUUID()}`;
      const successToken = `resetsuccess-${crypto.randomUUID()}`;
      const failToken3 = `resetfail3-${crypto.randomUUID()}`;
      const failToken4 = `resetfail4-${crypto.randomUUID()}`;
      const coldToken = `resetcold-${crypto.randomUUID()}`;
      const fetchImpl: typeof fetch = async (_input, init) => {
        const body = String(init?.body);
        if (body === successToken || body === coldToken) {
          return jsonResponse({ [body]: null });
        }
        return jsonResponse({ error: "boom" }, 500);
      };
      const verify = createTokenVerifier({
        db,
        fetchImpl,
        now: () => FIXED_NOW,
        apiUrl: API_URL,
        breakerFailureThreshold: 3,
      });

      await verify(failToken1);
      await verify(failToken2);
      await verify(successToken);
      await verify(failToken3);
      await verify(failToken4);

      const coldResult = await verify(coldToken);

      expect(coldResult).toEqual({ kind: "invalid" });
    });

    it("while the breaker is open, a token lichess would call invalid resolves unavailable, never invalid", async () => {
      const failTokens = makeTokens(3, "breakerinvalid");
      const wouldBeInvalidToken = `breakerinvalid-target-${crypto.randomUUID()}`;
      const fetchImpl: typeof fetch = async (_input, init) => {
        const body = String(init?.body);
        if (body === wouldBeInvalidToken) {
          return jsonResponse({ [wouldBeInvalidToken]: null });
        }
        return jsonResponse({ error: "boom" }, 500);
      };
      const verify = createTokenVerifier({
        db,
        fetchImpl,
        now: () => FIXED_NOW,
        apiUrl: API_URL,
      });

      for (const token of failTokens) {
        await verify(token);
      }

      const result = await verify(wouldBeInvalidToken);

      expect(result).toEqual({ kind: "unavailable" });
    });

    it("while the breaker is open, a token with a fresh cached row still resolves valid", async () => {
      const failTokens = makeTokens(3, "breakerfresh");
      const freshToken = `breakerfresh-target-${crypto.randomUUID()}`;
      const freshHash = hashOf(freshToken);
      await seedTokenRow({ tokenHash: freshHash });
      const fetchImpl: typeof fetch = async () =>
        jsonResponse({ error: "boom" }, 500);
      const verify = createTokenVerifier({
        db,
        fetchImpl,
        now: () => FIXED_NOW,
        apiUrl: API_URL,
      });

      for (const token of failTokens) {
        await verify(token);
      }

      const result = await verify(freshToken);

      expect(result.kind).toBe("valid");
    });

    it("while the breaker is open, a negatively-cached token still resolves invalid", async () => {
      const negToken = `breakerneg-${crypto.randomUUID()}`;
      const failTokens = makeTokens(3, "breakerneg-fail");
      const fetchImpl: typeof fetch = async (_input, init) => {
        const body = String(init?.body);
        if (body === negToken) {
          return jsonResponse({ [negToken]: null });
        }
        return jsonResponse({ error: "boom" }, 500);
      };
      const verify = createTokenVerifier({
        db,
        fetchImpl,
        now: () => FIXED_NOW,
        apiUrl: API_URL,
      });

      await verify(negToken);
      for (const token of failTokens) {
        await verify(token);
      }

      const result = await verify(negToken);

      expect(result).toEqual({ kind: "invalid" });
    });

    it("after breakerOpenMs elapses on the injected clock, exactly one probe fetch is issued and concurrent callers get unavailable with no fetch", async () => {
      let currentTime = FIXED_NOW;
      const now = () => currentTime;
      const breakerOpenMs = 30_000;
      const failTokens = makeTokens(3, "probeopen");
      const probeToken = `probeopen-probe-${crypto.randomUUID()}`;
      const concurrentToken = `probeopen-concurrent-${crypto.randomUUID()}`;
      const calls: RecordedCall[] = [];
      const countWaiters: Array<{
        readonly count: number;
        readonly resolve: () => void;
      }> = [];
      const whenCallCount = (count: number): Promise<void> => {
        if (calls.length >= count) return Promise.resolve();
        return new Promise<void>((resolve) => {
          countWaiters.push({ count, resolve });
        });
      };
      let releaseProbe: ((response: Response) => void) | undefined;
      const fetchImpl: typeof fetch = (input, init) => {
        calls.push({ input, init });
        for (const waiter of countWaiters) {
          if (calls.length >= waiter.count) waiter.resolve();
        }
        const body = String(init?.body);
        if (body === probeToken) {
          return new Promise<Response>((resolve) => {
            releaseProbe = resolve;
          });
        }
        return Promise.resolve(jsonResponse({ error: "boom" }, 500));
      };
      const verify = createTokenVerifier({
        db,
        fetchImpl,
        now,
        apiUrl: API_URL,
        breakerOpenMs,
      });

      for (const token of failTokens) {
        await verify(token);
      }
      expect(calls).toHaveLength(3);

      currentTime = new Date(FIXED_NOW.getTime() + breakerOpenMs);

      const probePromise = verify(probeToken);
      await whenCallCount(4);
      const concurrentResult = await verify(concurrentToken);

      expect(calls).toHaveLength(4);
      expect(concurrentResult).toEqual({ kind: "unavailable" });
      expect(releaseProbe).toBeDefined();
      releaseProbe?.(jsonResponse({ [probeToken]: null }));
      const probeResult = await probePromise;
      expect(probeResult).toEqual({ kind: "invalid" });
    });

    it("a successful probe closes the breaker", async () => {
      let currentTime = FIXED_NOW;
      const now = () => currentTime;
      const breakerOpenMs = 30_000;
      const failTokens = makeTokens(3, "probesuccess");
      const probeToken = `probesuccess-probe-${crypto.randomUUID()}`;
      const afterToken = `probesuccess-after-${crypto.randomUUID()}`;
      const fetchImpl: typeof fetch = async (_input, init) => {
        const body = String(init?.body);
        if (body === probeToken || body === afterToken) {
          return jsonResponse({ [body]: null });
        }
        return jsonResponse({ error: "boom" }, 500);
      };
      const verify = createTokenVerifier({
        db,
        fetchImpl,
        now,
        apiUrl: API_URL,
        breakerOpenMs,
      });

      for (const token of failTokens) {
        await verify(token);
      }

      currentTime = new Date(FIXED_NOW.getTime() + breakerOpenMs);
      const probeResult = await verify(probeToken);
      expect(probeResult).toEqual({ kind: "invalid" });

      const afterResult = await verify(afterToken);
      expect(afterResult).toEqual({ kind: "invalid" });
    });

    it("a failed probe re-opens the breaker for a full window measured from the probe's own failure", async () => {
      let currentTime = FIXED_NOW;
      const now = () => currentTime;
      const breakerOpenMs = 30_000;
      const failTokens = makeTokens(3, "probefail");
      const probeToken = `probefail-probe-${crypto.randomUUID()}`;
      const tooSoonToken = `probefail-toosoon-${crypto.randomUUID()}`;
      const afterToken = `probefail-after-${crypto.randomUUID()}`;
      let fetchCount = 0;
      const fetchImpl: typeof fetch = async (_input, init) => {
        fetchCount += 1;
        const body = String(init?.body);
        if (body === afterToken) {
          return jsonResponse({ [afterToken]: null });
        }
        return jsonResponse({ error: "boom" }, 500);
      };
      const verify = createTokenVerifier({
        db,
        fetchImpl,
        now,
        apiUrl: API_URL,
        breakerOpenMs,
      });

      for (const token of failTokens) {
        await verify(token);
      }
      expect(fetchCount).toBe(3);

      currentTime = new Date(FIXED_NOW.getTime() + breakerOpenMs);
      const probeResult = await verify(probeToken);
      expect(probeResult).toEqual({ kind: "unavailable" });
      expect(fetchCount).toBe(4);

      currentTime = new Date(currentTime.getTime() + breakerOpenMs - 1);
      const tooSoonResult = await verify(tooSoonToken);
      expect(tooSoonResult).toEqual({ kind: "unavailable" });
      expect(fetchCount).toBe(4);

      currentTime = new Date(currentTime.getTime() + 2);
      const afterResult = await verify(afterToken);
      expect(afterResult).toEqual({ kind: "invalid" });
      expect(fetchCount).toBe(5);
    });

    it("a probe that consumes a whole window before ending on a non-transport outcome re-opens for a full window measured from when it settled", async () => {
      let currentTime = FIXED_NOW;
      const breakerOpenMs = 30_000;
      const failTokens = makeTokens(3, "settleopen-fail");
      const probeToken = `settleopen-probe-${crypto.randomUUID()}`;
      const tooSoonToken = `settleopen-toosoon-${crypto.randomUUID()}`;
      const afterToken = `settleopen-after-${crypto.randomUUID()}`;
      let fetchCount = 0;
      let releaseProbe: ((response: Response) => void) | undefined;
      let notifyProbeCalled: (() => void) | undefined;
      const probeCalled = new Promise<void>((resolve) => {
        notifyProbeCalled = resolve;
      });
      const fetchImpl: typeof fetch = (_input, init) => {
        fetchCount += 1;
        const body = String(init?.body);
        if (body === probeToken) {
          return new Promise<Response>((resolve) => {
            releaseProbe = resolve;
            notifyProbeCalled?.();
          });
        }
        if (body === afterToken) {
          return Promise.resolve(jsonResponse({ [afterToken]: null }));
        }
        return Promise.resolve(jsonResponse({ error: "boom" }, 503));
      };
      const verify = createTokenVerifier({
        db,
        fetchImpl,
        now: () => currentTime,
        apiUrl: API_URL,
        breakerOpenMs,
      });

      for (const token of failTokens) {
        await verify(token);
      }
      expect(fetchCount).toBe(3);

      currentTime = new Date(FIXED_NOW.getTime() + breakerOpenMs);
      const probePromise = verify(probeToken);
      await probeCalled;
      currentTime = new Date(FIXED_NOW.getTime() + 2 * breakerOpenMs);
      releaseProbe?.(jsonResponse({}));
      expect(await probePromise).toEqual({ kind: "unavailable" });
      expect(fetchCount).toBe(4);

      currentTime = new Date(FIXED_NOW.getTime() + 3 * breakerOpenMs - 1);
      expect(await verify(tooSoonToken)).toEqual({ kind: "unavailable" });
      expect(fetchCount).toBe(4);

      currentTime = new Date(FIXED_NOW.getTime() + 3 * breakerOpenMs);
      expect(await verify(afterToken)).toEqual({ kind: "invalid" });
      expect(fetchCount).toBe(5);
    });
  });

  describe("E. two-tier reverification TTL", () => {
    it("a web:mod row 10min minus 1ms old is served from cache with no fetch", async () => {
      const token = `ttl-mod-fresh-${crypto.randomUUID()}`;
      const hash = hashOf(token);
      const verifiedAt = new Date(FIXED_NOW.getTime() - (10 * 60 * 1000 - 1));
      await seedTokenRow({ tokenHash: hash, scopes: "web:mod", verifiedAt });
      const { fetchImpl, calls } = recordingFetch(() => jsonResponse({}));
      const verify = createTokenVerifier({
        db,
        fetchImpl,
        now: () => FIXED_NOW,
        apiUrl: API_URL,
      });

      const result = await verify(token);

      expect(result.kind).toBe("valid");
      expect(calls).toHaveLength(0);
    });

    it("the same web:mod row at exactly 10min reverifies (the < boundary)", async () => {
      const token = `ttl-mod-boundary-${crypto.randomUUID()}`;
      const hash = hashOf(token);
      const verifiedAt = new Date(FIXED_NOW.getTime() - 10 * 60 * 1000);
      await seedTokenRow({ tokenHash: hash, scopes: "web:mod", verifiedAt });
      const { fetchImpl, calls } = recordingFetch(() =>
        jsonResponse({
          [token]: { userId: "thibault", scopes: "web:mod", expires: null },
        }),
      );
      const verify = createTokenVerifier({
        db,
        fetchImpl,
        now: () => FIXED_NOW,
        apiUrl: API_URL,
      });

      const result = await verify(token);

      expect(result.kind).toBe("valid");
      expect(calls).toHaveLength(1);
    });

    it("a row without web:mod at 10min + 1ms old is still served from cache (the 24h window applies)", async () => {
      const token = `ttl-plain-${crypto.randomUUID()}`;
      const hash = hashOf(token);
      const verifiedAt = new Date(FIXED_NOW.getTime() - (10 * 60 * 1000 + 1));
      await seedTokenRow({ tokenHash: hash, verifiedAt });
      const { fetchImpl, calls } = recordingFetch(() => jsonResponse({}));
      const verify = createTokenVerifier({
        db,
        fetchImpl,
        now: () => FIXED_NOW,
        apiUrl: API_URL,
      });

      const result = await verify(token);

      expect(result.kind).toBe("valid");
      expect(calls).toHaveLength(0);
    });

    it("a row with web:mod plus ordinary scopes uses the short window", async () => {
      const token = `ttl-mod-plus-${crypto.randomUUID()}`;
      const hash = hashOf(token);
      const verifiedAt = new Date(FIXED_NOW.getTime() - (10 * 60 * 1000 + 1));
      await seedTokenRow({
        tokenHash: hash,
        scopes: "web:mod,tournament:write",
        verifiedAt,
      });
      const { fetchImpl, calls } = recordingFetch(() =>
        jsonResponse({
          [token]: {
            userId: "thibault",
            scopes: "web:mod,tournament:write",
            expires: null,
          },
        }),
      );
      const verify = createTokenVerifier({
        db,
        fetchImpl,
        now: () => FIXED_NOW,
        apiUrl: API_URL,
      });

      const result = await verify(token);

      expect(result.kind).toBe("valid");
      expect(calls).toHaveLength(1);
    });

    it.each(["web:modx", "web:moderator", "web:"])(
      "a row scoped %s — a prefix-lookalike of web:mod, not the scope itself — uses the 24h window",
      async (scope) => {
        const token = `ttl-lookalike-${crypto.randomUUID()}`;
        const hash = hashOf(token);
        const verifiedAt = new Date(FIXED_NOW.getTime() - (10 * 60 * 1000 + 1));
        await seedTokenRow({ tokenHash: hash, scopes: scope, verifiedAt });
        const { fetchImpl, calls } = recordingFetch(() => jsonResponse({}));
        const verify = createTokenVerifier({
          db,
          fetchImpl,
          now: () => FIXED_NOW,
          apiUrl: API_URL,
        });

        const result = await verify(token);

        expect(result.kind).toBe("valid");
        expect(calls).toHaveLength(0);
      },
    );
  });

  describe("F. refusal and an open breaker serve stale within the standing 24h ceiling", () => {
    it("a stale high-privilege row past 10min but inside 24h, refused admission, resolves valid from the row and reports throttled + stale-served", async () => {
      const heldToken = `stale-held-${crypto.randomUUID()}`;
      const staleToken = `stale-mod-${crypto.randomUUID()}`;
      const staleHash = hashOf(staleToken);
      const verifiedAt = new Date(FIXED_NOW.getTime() - (10 * 60 * 1000 + 1));
      await seedTokenRow({
        tokenHash: staleHash,
        scopes: "web:mod",
        verifiedAt,
      });
      const { fetchImpl, release, whenCallCount } = deferredFetch();
      const { onProblem, calls: problemCalls } = recordingSink();
      const verify = createTokenVerifier({
        db,
        fetchImpl,
        now: () => FIXED_NOW,
        apiUrl: API_URL,
        onProblem,
      });

      const heldPromise = verify(heldToken);
      await whenCallCount(1);
      const staleResult = await verify(staleToken);

      expect(staleResult).toEqual({
        kind: "valid",
        auth: {
          userId: "thibault",
          scopes: new Set(["web:mod"]),
          expiresAt: null,
        },
      });
      const relevantCalls = problemCalls.filter(
        (call) => call.tokenHash === staleHash,
      );
      expect(relevantCalls).toEqual([
        {
          reason: { kind: "throttled", reason: "saturated" },
          tokenHash: staleHash,
        },
        { reason: { kind: "stale-served" }, tokenHash: staleHash },
      ]);

      release(0, jsonResponse({ [heldToken]: null }));
      await heldPromise;
    });

    it("the same stale row under an open breaker also resolves valid", async () => {
      const staleToken = `stale-open-mod-${crypto.randomUUID()}`;
      const staleHash = hashOf(staleToken);
      const verifiedAt = new Date(FIXED_NOW.getTime() - (10 * 60 * 1000 + 1));
      await seedTokenRow({
        tokenHash: staleHash,
        scopes: "web:mod",
        verifiedAt,
      });
      const failTokens = makeTokens(3, "stale-open-fail");
      const fetchImpl: typeof fetch = async () =>
        jsonResponse({ error: "boom" }, 500);
      const verify = createTokenVerifier({
        db,
        fetchImpl,
        now: () => FIXED_NOW,
        apiUrl: API_URL,
      });

      for (const token of failTokens) {
        await verify(token);
      }

      const result = await verify(staleToken);

      expect(result.kind).toBe("valid");
    });

    it("a stale high-privilege row past the 24h ceiling resolves unavailable when refused", async () => {
      const heldToken = `stale-past24h-held-${crypto.randomUUID()}`;
      const staleToken = `stale-past24h-${crypto.randomUUID()}`;
      const staleHash = hashOf(staleToken);
      const verifiedAt = new Date(
        FIXED_NOW.getTime() - (24 * 60 * 60 * 1000 + 1),
      );
      await seedTokenRow({
        tokenHash: staleHash,
        scopes: "web:mod",
        verifiedAt,
      });
      const { fetchImpl, release, whenCallCount } = deferredFetch();
      const verify = createTokenVerifier({
        db,
        fetchImpl,
        now: () => FIXED_NOW,
        apiUrl: API_URL,
      });

      const heldPromise = verify(heldToken);
      await whenCallCount(1);
      const staleResult = await verify(staleToken);

      expect(staleResult).toEqual({ kind: "unavailable" });

      release(0, jsonResponse({ [heldToken]: null }));
      await heldPromise;
    });

    it("a stale row whose lichess expiry has already passed is invalid, not valid — expiry beats the grace", async () => {
      const staleToken = `stale-expired-${crypto.randomUUID()}`;
      const staleHash = hashOf(staleToken);
      const verifiedAt = new Date(FIXED_NOW.getTime() - (10 * 60 * 1000 + 1));
      const expiresAt = new Date(FIXED_NOW.getTime() - 1000);
      await seedTokenRow({
        tokenHash: staleHash,
        scopes: "web:mod",
        verifiedAt,
        expiresAt,
      });
      const { fetchImpl, calls } = recordingFetch(() => jsonResponse({}));
      const verify = createTokenVerifier({
        db,
        fetchImpl,
        now: () => FIXED_NOW,
        apiUrl: API_URL,
      });

      const result = await verify(staleToken);

      expect(result).toEqual({ kind: "invalid" });
      expect(calls).toHaveLength(0);
    });

    it("a row past its reverify window and past its own lichess expiry resolves invalid even when admission is refused, never stale-served as valid", async () => {
      const heldToken = `stale-expired-refused-held-${crypto.randomUUID()}`;
      const staleToken = `stale-expired-refused-${crypto.randomUUID()}`;
      const staleHash = hashOf(staleToken);
      const verifiedAt = new Date(FIXED_NOW.getTime() - (10 * 60 * 1000 + 1));
      const expiresAt = new Date(FIXED_NOW.getTime() - 1000);
      await seedTokenRow({
        tokenHash: staleHash,
        scopes: "web:mod",
        verifiedAt,
        expiresAt,
      });
      const { fetchImpl, release, whenCallCount } = deferredFetch();
      const verify = createTokenVerifier({
        db,
        fetchImpl,
        now: () => FIXED_NOW,
        apiUrl: API_URL,
      });

      const heldPromise = verify(heldToken);
      await whenCallCount(1);
      const staleResult = await verify(staleToken);

      expect(staleResult).toEqual({ kind: "invalid" });

      release(0, jsonResponse({ [heldToken]: null }));
      await heldPromise;
    });

    it("a cold token refused admission resolves unavailable, never valid", async () => {
      const heldToken = `stale-cold-held-${crypto.randomUUID()}`;
      const coldToken = `stale-cold-${crypto.randomUUID()}`;
      const { fetchImpl, release, whenCallCount } = deferredFetch();
      const verify = createTokenVerifier({
        db,
        fetchImpl,
        now: () => FIXED_NOW,
        apiUrl: API_URL,
      });

      const heldPromise = verify(heldToken);
      await whenCallCount(1);
      const coldResult = await verify(coldToken);

      expect(coldResult).toEqual({ kind: "unavailable" });

      release(0, jsonResponse({ [heldToken]: null }));
      await heldPromise;
    });
  });

  describe("G. no raw token anywhere in throttled/stale-served/saturated diagnostics", () => {
    it("a saturated refusal reports throttled+stale-served with the hash only, never the raw token", async () => {
      const heldToken = "raw-token-held-secret-value";
      const staleToken = "raw-token-stale-secret-value";
      const staleHash = hashOf(staleToken);
      const verifiedAt = new Date(FIXED_NOW.getTime() - (10 * 60 * 1000 + 1));
      await seedTokenRow({
        tokenHash: staleHash,
        scopes: "web:mod",
        verifiedAt,
      });
      const { fetchImpl, release, whenCallCount } = deferredFetch();
      const { onProblem, calls: problemCalls } = recordingSink();
      const verify = createTokenVerifier({
        db,
        fetchImpl,
        now: () => FIXED_NOW,
        apiUrl: API_URL,
        onProblem,
      });

      const heldPromise = verify(heldToken);
      await whenCallCount(1);
      const staleResult = await verify(staleToken);

      expect(staleResult.kind).toBe("valid");
      expect(JSON.stringify(problemCalls)).not.toContain(staleToken);
      expect(JSON.stringify(problemCalls)).not.toContain(heldToken);

      release(0, jsonResponse({ [heldToken]: null }));
      await heldPromise;
    });

    it("a throttled refusal from an open breaker reports the hash only, never the raw token", async () => {
      const rawToken = "raw-token-breaker-open-secret-value";
      const failTokens = makeTokens(3, "raw-token-breaker-fail");
      const fetchImpl: typeof fetch = async () =>
        jsonResponse({ error: "boom" }, 500);
      const { onProblem, calls: problemCalls } = recordingSink();
      const verify = createTokenVerifier({
        db,
        fetchImpl,
        now: () => FIXED_NOW,
        apiUrl: API_URL,
        onProblem,
      });

      for (const token of failTokens) {
        await verify(token);
      }
      const rawHash = hashOf(rawToken);
      const result = await verify(rawToken);

      expect(result).toEqual({ kind: "unavailable" });
      const relevantCalls = problemCalls.filter(
        (call) => call.tokenHash === rawHash,
      );
      expect(relevantCalls).toEqual([
        {
          reason: { kind: "throttled", reason: "breaker-open" },
          tokenHash: rawHash,
        },
      ]);
      expect(JSON.stringify(relevantCalls)).not.toContain(rawToken);
    });

    it("a schema-mismatch shared across N deduped callers never leaks the raw token to the sink", async () => {
      const token = "raw-token-dedup-schema-secret-value";
      const { fetchImpl } = recordingFetch(() =>
        jsonResponse({
          [token]: { userId: "thibault", scopes: 42, expires: null },
        }),
      );
      const { onProblem, calls: problemCalls } = recordingSink();
      const verify = createTokenVerifier({
        db,
        fetchImpl,
        now: () => FIXED_NOW,
        apiUrl: API_URL,
        onProblem,
      });

      const results = await Promise.all([
        verify(token),
        verify(token),
        verify(token),
      ]);

      for (const result of results) {
        expect(result).toEqual({ kind: "unavailable" });
      }
      expect(problemCalls).toHaveLength(1);
      expect(JSON.stringify(problemCalls)).not.toContain(token);
    });
  });

  describe("I. pre-existing gaps in negative-cache eviction and prototype-chain handling", () => {
    it("an expired negative-cache entry is swept before falling back to oldest-eviction, without evicting a still-live entry", async () => {
      let currentTime = FIXED_NOW;
      const now = () => currentTime;
      const t1 = `sweep1-${crypto.randomUUID()}`;
      const t2 = `sweep2-${crypto.randomUUID()}`;
      const t3 = `sweep3-${crypto.randomUUID()}`;
      const { fetchImpl, calls } = recordingFetch((call) =>
        jsonResponse({ [String(call.init?.body)]: null }),
      );
      const verify = createTokenVerifier({
        db,
        fetchImpl,
        now,
        apiUrl: API_URL,
        negativeCacheMax: 2,
      });

      await verify(t1);
      currentTime = new Date(FIXED_NOW.getTime() + 5 * 60 * 1000 + 1);
      await verify(t2);
      await verify(t3);
      expect(calls).toHaveLength(3);

      const t2Result = await verify(t2);
      expect(t2Result).toEqual({ kind: "invalid" });
      expect(calls).toHaveLength(3);

      const t1Result = await verify(t1);
      expect(t1Result).toEqual({ kind: "invalid" });
      expect(calls).toHaveLength(4);
    });

    it("a 200 body that legitimately contains a __proto__ key resolves unavailable, not a thrown error or a leaked entry", async () => {
      const token = "__proto__";
      const { fetchImpl } = recordingFetch(
        () =>
          new Response(
            '{"__proto__": {"userId": "thibault", "scopes": "", "expires": null}}',
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      );
      const { onProblem, calls: problemCalls } = recordingSink();
      const verify = createTokenVerifier({
        db,
        fetchImpl,
        now: () => FIXED_NOW,
        apiUrl: API_URL,
        onProblem,
      });

      const result = await verify(token);

      expect(result).toEqual({ kind: "unavailable" });
      expect(problemCalls).toEqual([
        { reason: { kind: "missing-entry" }, tokenHash: hashOf(token) },
      ]);
    });
  });

  describe("J. an invalid verdict invalidates the positive cache row", () => {
    it("a lichess null verdict on reverification deletes the positive row", async () => {
      const token = `revoked-${crypto.randomUUID()}`;
      const hash = hashOf(token);
      await seedTokenRow({
        tokenHash: hash,
        scopes: "web:mod",
        verifiedAt: new Date(FIXED_NOW.getTime() - (10 * 60 * 1000 + 1)),
      });
      const { fetchImpl } = recordingFetch(() =>
        jsonResponse({ [token]: null }),
      );
      const verify = createTokenVerifier({
        db,
        fetchImpl,
        now: () => FIXED_NOW,
        apiUrl: API_URL,
      });

      const result = await verify(token);

      expect(result).toEqual({ kind: "invalid" });
      const row = await db.lichessToken.findUnique({
        where: { tokenHash: hash },
      });
      expect(row).toBeNull();
    });

    it("a web:mod token revoked on lichess is not served as valid once its negative-cache entry lapses and admission is refused", async () => {
      const token = `revoked-stale-${crypto.randomUUID()}`;
      const hash = hashOf(token);
      const heldToken = `revoked-stale-held-${crypto.randomUUID()}`;
      await seedTokenRow({
        tokenHash: hash,
        scopes: "web:mod",
        verifiedAt: FIXED_NOW,
      });
      let currentTime = FIXED_NOW;
      let releaseHeld: ((response: Response) => void) | undefined;
      let notifyHeldCalled: (() => void) | undefined;
      const heldCalled = new Promise<void>((resolve) => {
        notifyHeldCalled = resolve;
      });
      const fetchImpl: typeof fetch = (_input, init) => {
        if (String(init?.body) === token) {
          return Promise.resolve(jsonResponse({ [token]: null }));
        }
        return new Promise<Response>((resolve) => {
          releaseHeld = resolve;
          notifyHeldCalled?.();
        });
      };
      const verify = createTokenVerifier({
        db,
        fetchImpl,
        now: () => currentTime,
        apiUrl: API_URL,
      });

      currentTime = new Date(FIXED_NOW.getTime() + 11 * 60 * 1000);
      expect(await verify(token)).toEqual({ kind: "invalid" });

      currentTime = new Date(FIXED_NOW.getTime() + 17 * 60 * 1000);
      const heldPromise = verify(heldToken);
      await heldCalled;

      const afterLapse = await verify(token);

      expect(afterLapse).toEqual({ kind: "unavailable" });

      releaseHeld?.(jsonResponse({ [heldToken]: null }));
      await heldPromise;
    });

    it("a freshly-introspected token whose lichess expiry has passed deletes the positive row and negatively caches it", async () => {
      const token = `expired-row-${crypto.randomUUID()}`;
      const hash = hashOf(token);
      await seedTokenRow({
        tokenHash: hash,
        scopes: "web:mod",
        verifiedAt: new Date(FIXED_NOW.getTime() - (10 * 60 * 1000 + 1)),
      });
      const { fetchImpl, calls } = recordingFetch(() =>
        jsonResponse({
          [token]: {
            userId: "thibault",
            scopes: "web:mod",
            expires: FIXED_NOW.getTime() - 1000,
          },
        }),
      );
      const verify = createTokenVerifier({
        db,
        fetchImpl,
        now: () => FIXED_NOW,
        apiUrl: API_URL,
      });

      const result = await verify(token);

      expect(result).toEqual({ kind: "invalid" });
      const row = await db.lichessToken.findUnique({
        where: { tokenHash: hash },
      });
      expect(row).toBeNull();

      expect(await verify(token)).toEqual({ kind: "invalid" });
      expect(calls).toHaveLength(1);
    });

    it("a revoked web:mod token whose row deletion fails stays invalid once the 5-minute negative window lapses and admission is refused", async () => {
      const token = `revoked-delete-fails-stale-${crypto.randomUUID()}`;
      const heldToken = `revoked-delete-fails-held-${crypto.randomUUID()}`;
      await seedTokenRow({
        tokenHash: hashOf(token),
        scopes: "web:mod",
        verifiedAt: FIXED_NOW,
      });
      const brokenDb: LichessTokenDb = {
        lichessToken: {
          findUnique: db.lichessToken.findUnique,
          upsert: () =>
            makeRejectedPrismaPromise(new Error("should not be called")),
          deleteMany: () => makeRejectedPrismaPromise(new Error("write down")),
        },
      };
      let currentTime = FIXED_NOW;
      let releaseHeld: ((response: Response) => void) | undefined;
      let notifyHeldCalled: (() => void) | undefined;
      const heldCalled = new Promise<void>((resolve) => {
        notifyHeldCalled = resolve;
      });
      const fetchImpl: typeof fetch = (_input, init) => {
        if (String(init?.body) === token) {
          return Promise.resolve(jsonResponse({ [token]: null }));
        }
        return new Promise<Response>((resolve) => {
          releaseHeld = resolve;
          notifyHeldCalled?.();
        });
      };
      const verify = createTokenVerifier({
        db: brokenDb,
        fetchImpl,
        now: () => currentTime,
        apiUrl: API_URL,
      });

      currentTime = new Date(FIXED_NOW.getTime() + 11 * 60 * 1000);
      expect(await verify(token)).toEqual({ kind: "invalid" });

      currentTime = new Date(FIXED_NOW.getTime() + 17 * 60 * 1000);
      const heldPromise = verify(heldToken);
      await heldCalled;
      expect(await verify(token)).toEqual({ kind: "invalid" });

      currentTime = new Date(FIXED_NOW.getTime() + 23 * 60 * 60 * 1000);
      expect(await verify(token)).toEqual({ kind: "invalid" });

      releaseHeld?.(jsonResponse({ [heldToken]: null }));
      await heldPromise;
    });

    it("a deleteMany failure still resolves invalid and reports revocation-write-failed, not the benign cache-write problem", async () => {
      const token = `revoked-delete-fails-${crypto.randomUUID()}`;
      const brokenDb: LichessTokenDb = {
        lichessToken: {
          findUnique: () => makePrismaPromise(Promise.resolve(null)),
          upsert: () =>
            makeRejectedPrismaPromise(new Error("should not be called")),
          deleteMany: () => makeRejectedPrismaPromise(new Error("write down")),
        },
      };
      const { fetchImpl } = recordingFetch(() =>
        jsonResponse({ [token]: null }),
      );
      const { onProblem, calls: problemCalls } = recordingSink();
      const verify = createTokenVerifier({
        db: brokenDb,
        fetchImpl,
        now: () => FIXED_NOW,
        apiUrl: API_URL,
        onProblem,
      });

      const result = await verify(token);

      expect(result).toEqual({ kind: "invalid" });
      expect(problemCalls).toEqual([
        {
          reason: { kind: "revocation-write-failed", errorName: "Error" },
          tokenHash: hashOf(token),
        },
      ]);
    });
  });

  describe("O. a revocation that lands after a caller read its pre-admission snapshot", () => {
    it("a caller refused admission does not serve a snapshot a concurrent introspection has since proved revoked", async () => {
      const token = `toctou-${crypto.randomUUID()}`;
      const slotHolderToken = `toctou-holder-${crypto.randomUUID()}`;
      await seedTokenRow({
        tokenHash: hashOf(token),
        scopes: "web:mod",
        verifiedAt: new Date(FIXED_NOW.getTime() - 11 * 60 * 1000),
      });
      let findUniqueCalls = 0;
      let releaseSnapshotRead: (() => void) | undefined;
      const snapshotReadHeld = new Promise<void>((resolve) => {
        releaseSnapshotRead = resolve;
      });
      let notifySnapshotRead: (() => void) | undefined;
      const snapshotRead = new Promise<void>((resolve) => {
        notifySnapshotRead = resolve;
      });
      const racingDb: LichessTokenDb = {
        lichessToken: {
          findUnique: (args) => {
            findUniqueCalls += 1;
            const read = db.lichessToken.findUnique(args);
            if (findUniqueCalls !== 1) {
              return read;
            }
            return makePrismaPromise(
              Promise.resolve(read).then((row) => {
                notifySnapshotRead?.();
                return snapshotReadHeld.then(() => row);
              }),
            );
          },
          upsert: () =>
            makeRejectedPrismaPromise(new Error("should not be called")),
          deleteMany: db.lichessToken.deleteMany,
        },
      };
      let releaseSlotHolder: ((response: Response) => void) | undefined;
      let notifySlotHolderCalled: (() => void) | undefined;
      const slotHolderCalled = new Promise<void>((resolve) => {
        notifySlotHolderCalled = resolve;
      });
      const fetchImpl: typeof fetch = (_input, init) => {
        if (String(init?.body) === token) {
          return Promise.resolve(jsonResponse({ [token]: null }));
        }
        return new Promise<Response>((resolve) => {
          releaseSlotHolder = resolve;
          notifySlotHolderCalled?.();
        });
      };
      const verify = createTokenVerifier({
        db: racingDb,
        fetchImpl,
        now: () => FIXED_NOW,
        apiUrl: API_URL,
      });

      const snapshotHolderPromise = verify(token);
      await snapshotRead;
      expect(await verify(token)).toEqual({ kind: "invalid" });
      const slotHolderPromise = verify(slotHolderToken);
      await slotHolderCalled;
      releaseSnapshotRead?.();

      expect(await snapshotHolderPromise).toEqual({ kind: "invalid" });

      releaseSlotHolder?.(jsonResponse({ [slotHolderToken]: null }));
      await slotHolderPromise;
    });
  });

  describe("K. the half-open probe returns the breaker token on every exit path", () => {
    const nonTransportProbeOutcomes: ReadonlyArray<{
      readonly name: string;
      readonly respond: (token: string) => Response;
    }> = [
      {
        name: "an unparseable body",
        respond: () =>
          new Response("not json {{{", {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      },
      {
        name: "a schema mismatch",
        respond: (token) =>
          jsonResponse({
            [token]: { userId: "thibault", scopes: 42, expires: null },
          }),
      },
      { name: "a missing entry", respond: () => jsonResponse({}) },
    ];

    it.each(nonTransportProbeOutcomes)(
      "a probe ending in $name re-opens the breaker rather than stranding it half-open, so a later window admits another probe",
      async ({ respond }) => {
        let currentTime = FIXED_NOW;
        const breakerOpenMs = 30_000;
        const failTokens = makeTokens(3, "probe-token-fail");
        const probeToken = `probe-token-probe-${crypto.randomUUID()}`;
        const tooSoonToken = `probe-token-toosoon-${crypto.randomUUID()}`;
        const recoveredToken = `probe-token-recovered-${crypto.randomUUID()}`;
        let fetchCount = 0;
        const fetchImpl: typeof fetch = async (_input, init) => {
          fetchCount += 1;
          const body = String(init?.body);
          if (body === probeToken) return respond(probeToken);
          if (body === recoveredToken) {
            return jsonResponse({ [recoveredToken]: null });
          }
          return jsonResponse({ error: "boom" }, 503);
        };
        const verify = createTokenVerifier({
          db,
          fetchImpl,
          now: () => currentTime,
          apiUrl: API_URL,
          breakerOpenMs,
        });

        for (const token of failTokens) {
          await verify(token);
        }
        expect(fetchCount).toBe(3);

        currentTime = new Date(FIXED_NOW.getTime() + breakerOpenMs);
        expect(await verify(probeToken)).toEqual({ kind: "unavailable" });
        expect(fetchCount).toBe(4);

        currentTime = new Date(currentTime.getTime() + breakerOpenMs - 1);
        expect(await verify(tooSoonToken)).toEqual({ kind: "unavailable" });
        expect(fetchCount).toBe(4);

        currentTime = new Date(currentTime.getTime() + 1);
        const recovered = await verify(recoveredToken);

        expect(recovered).toEqual({ kind: "invalid" });
        expect(fetchCount).toBe(5);
      },
    );

    it("a probe settling on a missing-entry outcome while the clock reports an invalid instant still re-opens the breaker for a finite window, not an immediately-probed one", async () => {
      let currentTime = FIXED_NOW;
      let clockIsInvalid = false;
      const now = (): Date =>
        clockIsInvalid ? new Date(Number.NaN) : currentTime;
      const breakerOpenMs = 30_000;
      const failTokens = makeTokens(3, "nanclock-fail");
      const probeToken = `nanclock-probe-${crypto.randomUUID()}`;
      const afterToken = `nanclock-after-${crypto.randomUUID()}`;
      const calls: RecordedCall[] = [];
      const countWaiters: Array<{
        readonly count: number;
        readonly resolve: () => void;
      }> = [];
      const whenCallCount = (count: number): Promise<void> => {
        if (calls.length >= count) return Promise.resolve();
        return new Promise<void>((resolve) => {
          countWaiters.push({ count, resolve });
        });
      };
      let releaseProbe: ((response: Response) => void) | undefined;
      const fetchImpl: typeof fetch = (input, init) => {
        calls.push({ input, init });
        for (const waiter of countWaiters) {
          if (calls.length >= waiter.count) waiter.resolve();
        }
        const body = String(init?.body);
        if (body === probeToken) {
          return new Promise<Response>((resolve) => {
            releaseProbe = resolve;
          });
        }
        if (body === afterToken) {
          return Promise.resolve(jsonResponse({ [afterToken]: null }));
        }
        return Promise.resolve(jsonResponse({ error: "boom" }, 503));
      };
      const verify = createTokenVerifier({
        db,
        fetchImpl,
        now,
        apiUrl: API_URL,
        breakerOpenMs,
      });

      for (const token of failTokens) {
        await verify(token);
      }
      expect(calls).toHaveLength(3);

      currentTime = new Date(FIXED_NOW.getTime() + breakerOpenMs);
      const probePromise = verify(probeToken);
      await whenCallCount(4);
      clockIsInvalid = true;
      releaseProbe?.(jsonResponse({}));
      const probeResult = await probePromise;
      clockIsInvalid = false;

      expect(probeResult).toEqual({ kind: "unavailable" });

      const refusedResult = await verify(afterToken);
      expect(refusedResult).toEqual({ kind: "unavailable" });
      expect(calls).toHaveLength(4);

      currentTime = new Date(FIXED_NOW.getTime() + 2 * breakerOpenMs);
      const admittedResult = await verify(afterToken);
      expect(admittedResult).toEqual({ kind: "invalid" });
      expect(calls).toHaveLength(5);
    });
  });

  describe("L. the in-flight entry is registered before the work can settle", () => {
    it("an introspection that settles without ever suspending leaves no permanent in-flight entry behind", async () => {
      const token = `sync-settle-${crypto.randomUUID()}`;
      let attempts = 0;
      const fetchImpl: typeof fetch = (_input, init) => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("synchronous transport failure");
        }
        return Promise.resolve(jsonResponse({ [String(init?.body)]: null }));
      };
      const verify = createTokenVerifier({
        db,
        fetchImpl,
        now: () => FIXED_NOW,
        apiUrl: API_URL,
      });

      expect(await verify(token)).toEqual({ kind: "unavailable" });
      expect(attempts).toBe(1);

      const second = await verify(token);

      expect(second).toEqual({ kind: "invalid" });
      expect(attempts).toBe(2);
    });
  });

  describe("M. an async problem sink cannot escape as an unhandled rejection", () => {
    it("an onProblem sink that rejects asynchronously still resolves unavailable and raises no unhandled rejection", async () => {
      const token = `async-sink-${crypto.randomUUID()}`;
      const fetchImpl: typeof fetch = async () => {
        throw new Error("network down");
      };
      const rejectingSink = async (): Promise<void> => {
        throw new Error("async sink is broken");
      };
      const verify = createTokenVerifier({
        db,
        fetchImpl,
        now: () => FIXED_NOW,
        apiUrl: API_URL,
        onProblem: rejectingSink,
      });

      const unhandled: unknown[] = [];
      const captureUnhandled = (reason: unknown): void => {
        unhandled.push(reason);
      };
      process.on("unhandledRejection", captureUnhandled);
      try {
        const result = await verify(token);
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 10);
        });

        expect(result).toEqual({ kind: "unavailable" });
      } finally {
        process.off("unhandledRejection", captureUnhandled);
      }

      expect(unhandled).toEqual([]);
    });
  });

  describe("N. the half-open probe respects the concurrency budget", () => {
    it("a probe is refused rather than over-admitted while an earlier introspection still holds the only slot", async () => {
      let currentTime = FIXED_NOW;
      const breakerOpenMs = 30_000;
      const slotHolderToken = `halfopen-cap-holder-${crypto.randomUUID()}`;
      const probeToken = `halfopen-cap-probe-${crypto.randomUUID()}`;
      let releaseCancel: (() => void) | undefined;
      let notifyCancelStarted: (() => void) | undefined;
      const cancelStarted = new Promise<void>((resolve) => {
        notifyCancelStarted = resolve;
      });
      let fetchCount = 0;
      const fetchImpl: typeof fetch = async (_input, init) => {
        fetchCount += 1;
        if (String(init?.body) !== slotHolderToken) {
          return jsonResponse({ [String(init?.body)]: null });
        }
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new Uint8Array([1]));
            },
            cancel() {
              notifyCancelStarted?.();
              return new Promise<void>((resolve) => {
                releaseCancel = resolve;
              });
            },
          }),
          { status: 503 },
        );
      };
      const { onProblem, calls: problemCalls } = recordingSink();
      const verify = createTokenVerifier({
        db,
        fetchImpl,
        now: () => currentTime,
        apiUrl: API_URL,
        breakerFailureThreshold: 1,
        breakerOpenMs,
        onProblem,
      });

      const slotHolderPromise = verify(slotHolderToken);
      await cancelStarted;
      expect(fetchCount).toBe(1);

      currentTime = new Date(FIXED_NOW.getTime() + breakerOpenMs);
      const probeResult = await verify(probeToken);

      expect(probeResult).toEqual({ kind: "unavailable" });
      expect(fetchCount).toBe(1);
      expect(
        problemCalls.filter((call) => call.tokenHash === hashOf(probeToken)),
      ).toEqual([
        {
          reason: { kind: "throttled", reason: "saturated" },
          tokenHash: hashOf(probeToken),
        },
      ]);

      releaseCancel?.();
      expect(await slotHolderPromise).toEqual({ kind: "unavailable" });
    });
  });

  describe("P. work done while holding the admission slot is deadline-bounded", () => {
    it("a row deletion that never settles still resolves invalid and leaves the slot free for the next token", async () => {
      const revokedToken = `hangdelete-${crypto.randomUUID()}`;
      const coldToken = `hangdelete-cold-${crypto.randomUUID()}`;
      const hangingDb: LichessTokenDb = {
        lichessToken: {
          findUnique: () => makePrismaPromise(Promise.resolve(null)),
          upsert: () =>
            makeRejectedPrismaPromise(new Error("should not be called")),
          deleteMany: () =>
            makePrismaPromise(
              new Promise<Prisma.BatchPayload>(() => undefined),
            ),
        },
      };
      const { fetchImpl, calls } = recordingFetch((call) =>
        jsonResponse({ [String(call.init?.body)]: null }),
      );
      const { onProblem, calls: problemCalls } = recordingSink();
      const verify = createTokenVerifier({
        db: hangingDb,
        fetchImpl,
        now: () => FIXED_NOW,
        apiUrl: API_URL,
        slotHeldWorkTimeoutMs: 5,
        onProblem,
      });

      expect(await verify(revokedToken)).toEqual({ kind: "invalid" });
      expect(await verify(coldToken)).toEqual({ kind: "invalid" });

      expect(calls).toHaveLength(2);
      expect(
        problemCalls.filter((call) => call.tokenHash === hashOf(revokedToken)),
      ).toEqual([
        {
          reason: {
            kind: "revocation-write-failed",
            errorName: "TimeoutError",
          },
          tokenHash: hashOf(revokedToken),
        },
      ]);
    });

    it("a positive-row upsert that never settles still resolves valid and leaves the slot free for the next token", async () => {
      const validToken = `hangupsert-${crypto.randomUUID()}`;
      const coldToken = `hangupsert-cold-${crypto.randomUUID()}`;
      const hangingDb: LichessTokenDb = {
        lichessToken: {
          findUnique: () => makePrismaPromise(Promise.resolve(null)),
          upsert: () => makePrismaPromise(new Promise<never>(() => undefined)),
          deleteMany: () => makePrismaPromise(Promise.resolve({ count: 0 })),
        },
      };
      const { fetchImpl, calls } = recordingFetch((call) => {
        const body = String(call.init?.body);
        if (body === coldToken) return jsonResponse({ [coldToken]: null });
        return jsonResponse({
          [body]: { userId: "thibault", scopes: "web:mod", expires: null },
        });
      });
      const { onProblem, calls: problemCalls } = recordingSink();
      const verify = createTokenVerifier({
        db: hangingDb,
        fetchImpl,
        now: () => FIXED_NOW,
        apiUrl: API_URL,
        slotHeldWorkTimeoutMs: 5,
        onProblem,
      });

      expect(await verify(validToken)).toEqual({
        kind: "valid",
        auth: {
          userId: "thibault",
          scopes: new Set(["web:mod"]),
          expiresAt: null,
        },
      });
      expect(await verify(coldToken)).toEqual({ kind: "invalid" });

      expect(calls).toHaveLength(2);
      expect(problemCalls).toEqual([
        {
          reason: { kind: "cache-write", errorName: "TimeoutError" },
          tokenHash: hashOf(validToken),
        },
      ]);
    });
  });

  describe("Q. createTokenVerifier has exactly one non-test importer", () => {
    function collectTsFiles(dir: string): string[] {
      const entries = readdirSync(dir, { withFileTypes: true });
      const files: string[] = [];
      for (const entry of entries) {
        if (entry.name === "node_modules" || entry.name === "generated") {
          continue;
        }
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          files.push(...collectTsFiles(fullPath));
          continue;
        }
        if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
          files.push(fullPath);
        }
      }
      return files;
    }

    it("only src/server/lichess/verifier.ts references createTokenVerifier outside test files", () => {
      const srcDir = fileURLToPath(new URL("../../", import.meta.url));
      const projectRoot = join(srcDir, "..");
      const definingFile = join(srcDir, "server/lichess/introspection.ts");

      const importingFiles = collectTsFiles(srcDir)
        .filter((file) => file !== definingFile)
        .filter(
          (file) => !file.endsWith(".test.ts") && !file.endsWith(".test.tsx"),
        )
        .filter((file) =>
          readFileSync(file, "utf8").includes("createTokenVerifier"),
        )
        .map((file) => relative(projectRoot, file));

      expect(importingFiles.sort()).toEqual(["src/server/lichess/verifier.ts"]);
    });
  });

  describe("R. recordBreakerFailure treats an already-open breaker as an invariant violation", () => {
    function extractFunctionSource(source: string, signature: string): string {
      const start = source.indexOf(signature);
      if (start === -1) {
        throw new Error(
          `extractFunctionSource: signature not found: ${signature}`,
        );
      }
      const braceStart = source.indexOf("{", start);
      let depth = 0;
      for (let i = braceStart; i < source.length; i += 1) {
        if (source[i] === "{") depth += 1;
        if (source[i] === "}") {
          depth -= 1;
          if (depth === 0) return source.slice(braceStart, i + 1);
        }
      }
      throw new Error(
        `extractFunctionSource: unbalanced braces for ${signature}`,
      );
    }

    it("the open case is a standalone arm that throws, never sharing the closed-reset fallthrough with case 'closed'", () => {
      const introspectionSource = readFileSync(
        fileURLToPath(new URL("./introspection.ts", import.meta.url)),
        "utf8",
      );
      const recordBreakerFailureSource = extractFunctionSource(
        introspectionSource,
        "function recordBreakerFailure(): void {",
      );

      expect(recordBreakerFailureSource).not.toMatch(
        /case "open":\s*\n\s*case "closed":/,
      );
      expect(recordBreakerFailureSource).toMatch(/case "open":\s*\n\s*throw /);
    });
  });
});
