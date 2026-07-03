import { isDeepStrictEqual } from "node:util";
import {
  buildLoneWolfLeague,
  buildTeam4545League,
  LONEWOLF_STREAM_ID,
  TEAM4545_STREAM_ID,
} from "@/chess/leagues";
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

export type SeedOutcome = {
  readonly streamId: string;
  readonly league: "team4545" | "lonewolf";
  readonly status: "created" | "unchanged" | "divergent";
};

// NOTE: never overwrites — a divergent existing stream is reported and left unchanged.
// Pass idPrefix to isolate seeds under distinct stream ids (used by tests on a shared database).
export async function seedLeagues(
  db: ChangeStoreClient,
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
    if (existing.ok) {
      outcomes.push({
        streamId: def.id,
        league,
        status: isDeepStrictEqual(existing.def, def)
          ? "unchanged"
          : "divergent",
      });
      continue;
    }
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
    outcomes.push({ streamId: def.id, league, status: "created" });
  }
  return outcomes;
}
