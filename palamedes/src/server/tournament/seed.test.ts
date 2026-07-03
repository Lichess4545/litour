// @vitest-environment node
import { afterAll, expect, it } from "vitest";
import {
  buildLoneWolfLeague,
  buildTeam4545League,
  LONEWOLF_STREAM_ID,
  TEAM4545_STREAM_ID,
} from "@/chess/leagues";
import { db } from "@/server/db";
import { describeWithDb } from "@/test/db";
import { appendChanges, readDefinition } from "./change-store";
import { seedLeagues } from "./seed";

const prefix = `seedtest-${crypto.randomUUID()}-`;
const teamId = `${prefix}${TEAM4545_STREAM_ID}`;
const loneId = `${prefix}${LONEWOLF_STREAM_ID}`;

describeWithDb("seedLeagues", () => {
  afterAll(async () => {
    await db.definitionChange.deleteMany({
      where: { streamId: { in: [teamId, loneId] } },
    });
  });

  it("first run creates both league streams with valid definitions", async () => {
    const outcomes = await seedLeagues(db, { idPrefix: prefix });
    expect(outcomes.map((o) => o.status)).toEqual(["created", "created"]);
    expect(outcomes.map((o) => o.streamId)).toEqual([teamId, loneId]);

    const team = await readDefinition(db, teamId);
    expect(team.ok).toBe(true);
    if (team.ok) expect(team.def).toEqual(buildTeam4545League(teamId));

    const lone = await readDefinition(db, loneId);
    expect(lone.ok).toBe(true);
    if (lone.ok) expect(lone.def).toEqual(buildLoneWolfLeague(loneId));
  });

  it("second run is idempotent: both unchanged", async () => {
    const outcomes = await seedLeagues(db, { idPrefix: prefix });
    expect(outcomes.map((o) => o.status)).toEqual(["unchanged", "unchanged"]);
  });

  it("divergent content is reported and NOT clobbered", async () => {
    const renamed = await appendChanges(db, teamId, 1, [
      { type: "definition-renamed", name: "Some Other League" },
    ]);
    expect(renamed.ok).toBe(true);

    const outcomes = await seedLeagues(db, { idPrefix: prefix });
    const team = outcomes.find((o) => o.league === "team4545");
    expect(team?.status).toBe("divergent");
    const lone = outcomes.find((o) => o.league === "lonewolf");
    expect(lone?.status).toBe("unchanged");

    const after = await readDefinition(db, teamId);
    expect(after.ok).toBe(true);
    if (after.ok) {
      expect(after.version).toBe(2);
      expect(after.def.name).toBe("Some Other League");
    }
  });
});
