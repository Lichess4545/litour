// @vitest-environment node
import { afterAll, expect, it } from "vitest";
import { lichess4545Season, wuccKnockoutLockstep } from "@/chess/formats";
import { chessRegistry, parseEventDef } from "@/chess/registry";
import { db } from "@/server/db";
import { describeWithDb } from "@/test/db";
import { type EventRun, expectStandings, runEvent } from "@/tournament/builder";
import { definitionToChanges } from "@/tournament/changes/decompose";
import type { ParsedEventDef } from "@/tournament/registry";
import { appendChanges, readDefinition } from "./change-store";

const streamIds: string[] = [];

const rehydrate = async (def: ParsedEventDef): Promise<ParsedEventDef> => {
  const id = `diff-${crypto.randomUUID()}`;
  streamIds.push(id);
  const fresh = parseEventDef({ ...def, id });
  const appended = await appendChanges(db, id, 0, definitionToChanges(fresh));
  if (!appended.ok) {
    throw new Error(`differential append failed: ${JSON.stringify(appended)}`);
  }
  const read = await readDefinition(db, id);
  if (!read.ok) {
    throw new Error(`differential read failed: ${JSON.stringify(read)}`);
  }
  return read.def;
};

const driveSeason = (def: ParsedEventDef): EventRun => {
  const run = runEvent(def, chessRegistry);
  const fullRosters = () => {
    for (const [team, prefix] of [
      ["Knights", "kni"],
      ["Dragons", "dra"],
      ["Rooks", "roo"],
      ["Pawnstars", "paw"],
    ] as const) {
      run.lineup(
        team,
        [1, 2, 3, 4].map((i) => `${prefix}${i}`),
      );
    }
  };

  run.pairManual([
    ["Knights", "Dragons"],
    ["Pawnstars", "Rooks"],
  ]);
  fullRosters();
  run.match("Knights", "Dragons", "1-0", "0-1", "1-0", "1-0");
  run.match("Pawnstars", "Rooks", "1-0", "0-1", "1/2-1/2", "1-0");

  run.pairManual([
    ["Knights", "Pawnstars"],
    ["Rooks", "Dragons"],
  ]);
  fullRosters();
  run.match("Knights", "Pawnstars", "1/2-1/2", "1/2-1/2", "1/2-1/2", "1/2-1/2");
  run.match("Rooks", "Dragons", "1-0", "1-0", "0-1", "0-1");
  return run;
};

const driveWucc = (def: ParsedEventDef): EventRun => {
  const teams = {
    yale: ["yale1", "yale2"],
    pret: ["pret1", "pret2"],
    mona: ["mona1", "mona2"],
    auck: ["auck1", "auck2"],
  } as const;
  const run = runEvent(def, chessRegistry).pairRound();

  run.lineup("Yale University", teams.yale);
  run.lineup("Auckland University", teams.auck);
  run.match("Yale University", "Auckland University", "1-0", "0-1");

  run.lineup("University of Pretoria", teams.pret);
  run.lineup("Monash University", teams.mona);
  run.match("University of Pretoria", "Monash University", "1-0", "1/2-1/2");

  run.lineup("Yale University", teams.yale);
  run.lineup("Auckland University", teams.auck);
  run.match("Auckland University", "Yale University", "1-0", "0-1");

  run.lineup("University of Pretoria", teams.pret);
  run.lineup("Monash University", teams.mona);
  run.match("Monash University", "University of Pretoria", "0-1", "1-0");

  run.decide("Yale University");

  run.pairRound();
  run.lineup("Yale University", teams.yale);
  run.lineup("University of Pretoria", teams.pret);
  run.match("Yale University", "University of Pretoria", "1-0", "1/2-1/2");
  run.lineup("Yale University", teams.yale);
  run.lineup("University of Pretoria", teams.pret);
  run.match("University of Pretoria", "Yale University", "1/2-1/2", "1/2-1/2");
  return run;
};

describeWithDb("engine differential — original vs rehydrated", () => {
  afterAll(async () => {
    await db.definitionChange.deleteMany({
      where: { streamId: { in: streamIds } },
    });
  });

  it("lichess4545Season: identical standings under the same script", async () => {
    const original = driveSeason(lichess4545Season);
    const rehydrated = driveSeason(await rehydrate(lichess4545Season));

    expect(rehydrated.standings()).toEqual(original.standings());
    for (const run of [original, rehydrated]) {
      expectStandings(run)
        .competitor("Knights")
        .points(3)
        .metric("gamesWon", 3)
        .rank(1);
      expectStandings(run)
        .competitor("Pawnstars")
        .points(3)
        .metric("gamesWon", 2)
        .rank(2);
      expectStandings(run).competitor("Knights").metric("boardPoints-1", 1.5);
      expectStandings(run)
        .competitor("Rooks")
        .points(1)
        .metric("gamesWon", 3)
        .metric("boardPoints-1", 1)
        .rank(3);
      expectStandings(run)
        .competitor("Dragons")
        .points(1)
        .metric("gamesWon", 3)
        .metric("boardPoints-1", 0)
        .rank(4);
    }
  });

  it("wuccKnockoutLockstep: identical standings and the same champion", async () => {
    const original = driveWucc(wuccKnockoutLockstep);
    const rehydrated = driveWucc(await rehydrate(wuccKnockoutLockstep));

    expect(rehydrated.standings()).toEqual(original.standings());
    expect(rehydrated.winnerName()).toBe(original.winnerName());
    for (const run of [original, rehydrated]) {
      expect(run.winnerName()).toBe("Yale University");
      expectStandings(run).competitor("Yale University").rank(1);
      expectStandings(run).competitor("University of Pretoria").rank(2);
      expectStandings(run).competitor("Auckland University").rank(3);
      expectStandings(run).competitor("Monash University").rank(3);
    }
  });
});
