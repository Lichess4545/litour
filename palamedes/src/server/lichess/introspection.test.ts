// @vitest-environment node
import { createHash } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
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

describeWithDb("createTokenVerifier", () => {
  const cleanupHashes = new Set<string>();

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
});
