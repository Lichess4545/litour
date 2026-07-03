// @vitest-environment node
import { afterAll, expect, it } from "vitest";
import {
  candidates,
  FORMAT_EXAMPLES,
  lichess4545Season,
  wuccKnockoutUpfront,
} from "@/chess/formats";
import { parseEventDef } from "@/chess/registry";
import { db } from "@/server/db";
import { describeWithDb } from "@/test/db";
import { definitionToChanges } from "@/tournament/changes/decompose";
import type { ParsedEventDef } from "@/tournament/registry";
import { appendChanges, readDefinition } from "./change-store";

const streamIds: string[] = [];
const reIdentify = (def: ParsedEventDef): ParsedEventDef => {
  const id = `fmt-${crypto.randomUUID()}`;
  streamIds.push(id);
  return parseEventDef({ ...def, id });
};

const LIBRARY: readonly {
  readonly slug: string;
  readonly def: ParsedEventDef;
}[] = [
  ...FORMAT_EXAMPLES.map(({ slug, def }) => ({ slug, def })),
  { slug: "candidates-const", def: candidates },
  { slug: "lichess4545-season-const", def: lichess4545Season },
  { slug: "wucc-knockout-upfront-const", def: wuccKnockoutUpfront },
];

describeWithDb("format library round-trip through the change store", () => {
  afterAll(async () => {
    await db.definitionChange.deleteMany({
      where: { streamId: { in: streamIds } },
    });
  });

  it.each(LIBRARY)(
    "$slug: decompose → append → readDefinition ≡ original",
    async ({ def }) => {
      const fresh = reIdentify(def);
      const appended = await appendChanges(
        db,
        fresh.id,
        0,
        definitionToChanges(fresh),
      );
      expect(appended.ok).toBe(true);

      const rehydrated = await readDefinition(db, fresh.id);
      expect(rehydrated.ok).toBe(true);
      if (rehydrated.ok) {
        expect(rehydrated.def).toEqual(fresh);
        expect(rehydrated.version).toBe(1 + fresh.competitors.length);
      }
    },
  );
});
