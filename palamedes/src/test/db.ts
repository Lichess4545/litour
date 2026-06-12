import { describe } from "vitest";
import { db } from "@/server/db";

/**
 * DB-backed suites run only when DATABASE_URL is reachable; otherwise they
 * are skipped VISIBLY (they show up as skipped in the vitest summary).
 */
async function databaseIsReachable(): Promise<boolean> {
  try {
    await db.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

const reachable = await databaseIsReachable();

if (!reachable) {
  console.warn(
    "[test/db] Postgres is not reachable at DATABASE_URL — DB-backed suites are SKIPPED. Run `devenv up` to start it.",
  );
}

export const describeWithDb = reachable ? describe : describe.skip;
