// @vitest-environment node
import { describe, expect, it } from "vitest";
import { lichess4545Season, loneWolf } from "@/chess/formats";
import { chessRegistry } from "@/chess/registry";
import { buildDefChangeSchema } from "./schema";
import type { DefChange } from "./types";

const schema = buildDefChangeSchema(chessRegistry);

const roundTrips = (change: DefChange): void => {
  const parsed = schema.safeParse(change);
  expect(parsed.success).toBe(true);
  if (parsed.success) expect(parsed.data).toEqual(change);
};

describe("buildDefChangeSchema", () => {
  it("round-trips every change type", () => {
    const competitor = loneWolf.competitors[0];
    if (competitor === undefined) throw new Error("fixture has competitors");
    roundTrips({
      type: "definition-created",
      name: "A league",
      competition: lichess4545Season.competition,
    });
    roundTrips({ type: "definition-renamed", name: "Renamed" });
    roundTrips({ type: "competitor-added", competitor });
    roundTrips({ type: "competitor-added", competitor, index: 0 });
    roundTrips({
      type: "competitor-updated",
      competitorId: competitor.id,
      competitor,
    });
    roundTrips({ type: "competitor-removed", competitorId: "alice" });
    roundTrips({
      type: "competition-added",
      parentId: "season",
      competition: loneWolf.competition,
    });
    roundTrips({
      type: "competition-added",
      parentId: "season",
      competition: loneWolf.competition,
      index: 0,
    });
    roundTrips({ type: "competition-renamed", competitionId: "league" });
    roundTrips({
      type: "competition-renamed",
      competitionId: "league",
      name: "Div A",
    });
    roundTrips({ type: "competition-removed", competitionId: "league" });
    roundTrips({
      type: "run-set",
      competitionId: "league",
      run: lichess4545Season.competition.run,
    });
    roundTrips({ type: "entries-set", competitionId: "league", entries: null });
    roundTrips({
      type: "entries-set",
      competitionId: "league",
      entries: { open: true },
    });
    roundTrips({
      type: "entries-set",
      competitionId: "league",
      entries: [{ kind: "registration", seed: 1 }],
    });
  });

  it("rejects unknown discriminants and malformed payloads", () => {
    expect(schema.safeParse({ type: "definition-deleted" }).success).toBe(
      false,
    );
    expect(schema.safeParse({ type: "definition-renamed" }).success).toBe(
      false,
    );
    expect(
      schema.safeParse({
        type: "competitor-added",
        competitor: { id: "", name: "x" },
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        type: "run-set",
        competitionId: "league",
        run: { kind: "no-such-encounter" },
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        type: "competitor-added",
        competitor: { id: "a", name: "A" },
        index: -1,
      }).success,
    ).toBe(false);
  });

  it("accepts structurally valid pool runs; kind registration semantics stay with eventSchema", () => {
    const run = {
      kind: "pool",
      pairing: { system: "swiss" },
      rounds: 3,
      encounter: { kind: "game", clock: { initial: 180, increment: 2 } },
      score: { kind: "passThrough" },
      tiebreaks: [],
    };
    expect(
      schema.safeParse({ type: "run-set", competitionId: "x", run }).success,
    ).toBe(true);
  });
});
