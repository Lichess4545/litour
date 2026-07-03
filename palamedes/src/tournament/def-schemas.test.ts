// @vitest-environment node
import { describe, expect, it } from "vitest";
import { lichess4545Season } from "@/chess/formats";
import { chessRegistry } from "@/chess/registry";

describe("ModelRegistry.defSchemas", () => {
  const { competition, run, entries, competitor } = chessRegistry.defSchemas;

  it("competitor: accepts a full competitor, rejects an empty name", () => {
    const ok = competitor.safeParse({
      id: "kni",
      name: "Knights",
      rating: 1800,
      roster: ["kni1", "kni2"],
    });
    expect(ok.success).toBe(true);
    expect(competitor.safeParse({ id: "kni", name: "" }).success).toBe(false);
  });

  it("entries: accepts open and seed lists, rejects the empty list", () => {
    expect(entries.safeParse({ open: true }).success).toBe(true);
    expect(entries.safeParse([{ kind: "registration", seed: 1 }]).success).toBe(
      true,
    );
    expect(entries.safeParse([]).success).toBe(false);
  });

  it("entries: rejects { open: false }, open must be literal true", () => {
    expect(entries.safeParse({ open: false }).success).toBe(false);
  });

  it("run: accepts a pool, rejects an unknown encounter kind", () => {
    const pool = {
      kind: "pool",
      pairing: { system: "swiss" },
      rounds: 3,
      encounter: { kind: "game", clock: { initial: 180, increment: 2 } },
      score: { kind: "passThrough" },
      tiebreaks: [],
    };
    expect(run.safeParse(pool).success).toBe(true);
    expect(run.safeParse({ kind: "no-such-kind" }).success).toBe(false);
  });

  it("competition: accepts a catalog competition subtree", () => {
    expect(competition.safeParse(lichess4545Season.competition).success).toBe(
      true,
    );
  });

  it("competition: rejects a pool whose encounter kind is not in the registry", () => {
    expect(
      competition.safeParse({
        id: "x",
        run: {
          kind: "pool",
          pairing: { system: "swiss" },
          rounds: 3,
          encounter: { kind: "no-such-kind" },
          score: { kind: "passThrough" },
          tiebreaks: [],
        },
      }).success,
    ).toBe(false);
  });

  it("eventSchema still parses a catalog def (regression)", () => {
    expect(chessRegistry.eventSchema.safeParse(lichess4545Season).success).toBe(
      true,
    );
  });
});
