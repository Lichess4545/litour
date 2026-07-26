import { env } from "@/env";
import { db } from "@/server/db";
import {
  createTokenVerifier,
  type VerifyResult,
} from "@/server/lichess/introspection";

const globalForLichessVerifier: typeof globalThis & {
  lichessTokenVerifierGlobal?: (token: string) => Promise<VerifyResult>;
} = globalThis;

export const verifyLichessToken =
  globalForLichessVerifier.lichessTokenVerifierGlobal ??
  createTokenVerifier({
    db,
    fetchImpl: fetch,
    now: () => new Date(),
    apiUrl: env.LICHESS_API_URL,
  });

// Unconditional, unlike `db.ts`'s dev-only `NODE_ENV` guard on its own
// globalThis pin: a duplicate PrismaClient there only costs connections, but
// a duplicate verifier here means two concurrency counters, two breakers, and
// two negative caches — doubling lichess-facing concurrency against a global
// limit of one, silently, in every environment, not just dev hot-reload.
globalForLichessVerifier.lichessTokenVerifierGlobal = verifyLichessToken;
