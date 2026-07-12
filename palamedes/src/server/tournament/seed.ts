import { isDeepStrictEqual } from "node:util";
import {
  buildLoneWolfLeague,
  buildTeam4545League,
  LONEWOLF_STREAM_ID,
  TEAM4545_STREAM_ID,
} from "@/chess/leagues";
import type { PrismaClient } from "@/generated/prisma/client";
import { definitionToChanges } from "@/tournament/changes/decompose";
import {
  appendChanges,
  type ChangeStoreClient,
  readDefinition,
} from "./change-store";

export const SEED_DEVIATIONS: readonly string[] = [
  "lonewolf: acceleration seeded as plain swiss (FAQ says Baku; rules page silent) — ADR 0005",
  "team4545: team bye uses palamedes bye semantics (1 MP + 4 GP); the live site's JavaFo pairing-history wart is not modeled — ADR 0005",
];

export type SeedClient = ChangeStoreClient & {
  readonly definitionStream: Pick<PrismaClient["definitionStream"], "upsert">;
};

export type SeedOutcome = {
  readonly streamId: string;
  readonly league: "team4545" | "lonewolf";
  readonly status: "created" | "unchanged" | "divergent";
};

// NOTE: never overwrites — a divergent existing stream is reported and left unchanged.
// Pass idPrefix to isolate seeds under distinct stream ids (used by tests on a shared database).
export async function seedLeagues(
  db: SeedClient,
  opts?: { readonly idPrefix?: string },
): Promise<readonly SeedOutcome[]> {
  const prefix = opts?.idPrefix ?? "";
  const targets = [
    {
      league: "team4545",
      def: buildTeam4545League(`${prefix}${TEAM4545_STREAM_ID}`),
    },
    {
      league: "lonewolf",
      def: buildLoneWolfLeague(`${prefix}${LONEWOLF_STREAM_ID}`),
    },
  ] as const;

  const outcomes: SeedOutcome[] = [];
  for (const { league, def } of targets) {
    const existing = await readDefinition(db, def.id);
    let status: SeedOutcome["status"];
    if (existing.ok) {
      status = isDeepStrictEqual(existing.def, def) ? "unchanged" : "divergent";
    } else {
      if (existing.error.kind !== "notFound") {
        throw new Error(
          `seed: stream ${def.id} unreadable (${existing.error.kind}) — refusing to touch it`,
        );
      }
      const appended = await appendChanges(
        db,
        def.id,
        0,
        definitionToChanges(def),
      );
      if (!appended.ok) {
        throw new Error(
          `seed: append failed for ${def.id}: ${JSON.stringify(appended.error)}`,
        );
      }
      status = "created";
    }
    // NOTE: runs unconditionally on every outcome (created/unchanged/divergent) to
    // backfill an ownership row for streams that already existed before this upsert
    // was added — don't narrow this to the "created" branch only.
    await db.definitionStream.upsert({
      where: { streamId: def.id },
      create: { streamId: def.id, ownerId: null, createdAt: new Date() },
      update: {},
    });
    outcomes.push({ streamId: def.id, league, status });
  }
  return outcomes;
}
