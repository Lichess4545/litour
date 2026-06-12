// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  armageddonShowdown,
  clubRoundRobin,
  lichess4545,
  lichess4545Season,
  miniChampionship,
  worldChampionship,
  worldUniversityChampionship,
} from "@/chess/formats";
import { chessRegistry } from "@/chess/registry";
import { concretify } from "./concrete";

describe("concretify — sizes are explicit", () => {
  it("open entries with declared rounds: all rounds known, pairings open with exemplars", () => {
    const event = concretify(lichess4545, chessRegistry);
    const group = event.stages[0]?.groups[0];
    expect(group?.entrants).toBe("open");
    const run = group?.run;
    if (run?.kind !== "rounds") throw new Error("expected a rounds run");
    expect(run.rounds.open).toBe(false);
    expect(run.rounds.items).toHaveLength(8);
    const round1 = run.rounds.items[0];
    if (round1?.pairings.open !== true)
      throw new Error("expected open pairings");
    expect(round1.pairings.items.map((p) => p.label)).toEqual([
      "pairing 1",
      "pairing 2",
    ]);
    expect(round1.pairings.more.label).toBe("… pairing n");
  });

  it("open entries with derived rounds: rounds open too", () => {
    const event = concretify(clubRoundRobin, chessRegistry);
    const run = event.stages[0]?.groups[0]?.run;
    if (run?.kind !== "rounds") throw new Error("expected a rounds run");
    if (run.rounds.open !== true) throw new Error("expected open rounds");
    expect(run.rounds.items.map((r) => r.label)).toEqual([
      "Round 1",
      "Round 2",
    ]);
    expect(run.rounds.more.label).toBe("… Round n");
  });

  it("a bound field materializes every round and pairing — no exemplars", () => {
    const event = concretify(lichess4545Season, chessRegistry);
    const group = event.stages[0]?.groups[0];
    expect(group?.entrants).toBe(4);
    const run = group?.run;
    if (run?.kind !== "rounds") throw new Error("expected a rounds run");
    expect(run.rounds.open).toBe(false);
    expect(run.rounds.items).toHaveLength(2);
    const round1 = run.rounds.items[0];
    expect(round1?.pairings.open).toBe(false);
    expect(round1?.pairings.items.map((p) => p.label)).toEqual([
      "pairing 1",
      "pairing 2",
    ]);
  });

  it("a round outputs its scoring; standings and re-pairing live between rounds", () => {
    const event = concretify(lichess4545Season, chessRegistry);
    const run = event.stages[0]?.groups[0]?.run;
    if (run?.kind !== "rounds") throw new Error("expected a rounds run");
    expect(run.rounds.items[0]?.scoring.title).toBe("Points table");
    expect(run.rounds.items[0]?.scoring.lines).toEqual([
      "win → 2 · loss → 0",
      "draw → 1",
    ]);
    expect(run.between.standings.lines).toEqual([
      "tie: matchWins",
      "tie: gamesWon",
      "tie: boardPoints-1",
      "tie: boardPoints-2",
    ]);
    expect(run.between.repair?.kind).toBe("swiss");
    // After the final round only the standings remain — nothing to pair.
    expect(run.final.repair).toBeUndefined();
  });

  it("a truncated knockout plays two rounds; its seed links aggregate per source", () => {
    const event = concretify(worldUniversityChampionship, chessRegistry);
    const ko = event.stages[1]?.groups[0];
    expect(ko?.entrants).toBe(32);
    expect(ko?.seededFrom.map((link) => link.label)).toEqual([
      "top 16",
      "top 16",
    ]);
    const run = ko?.run;
    if (run?.kind !== "rounds") throw new Error("expected a rounds run");
    expect(run.rounds.open).toBe(false);
    expect(run.rounds.items.map((round) => round.label)).toEqual([
      "Round 1",
      "Round 2",
    ]);
    expect(
      run.rounds.items.map((round) =>
        round.pairings.open ? "open" : round.pairings.items.length,
      ),
    ).toEqual([16, 8]);
    // The eight survivors split into the two over-the-board groups.
    expect(
      event.stages[2]?.groups.map((g) => [g.entrants, g.seededFrom[0]?.label]),
    ).toEqual([
      [4, "4 seeds"],
      [4, "4 seeds"],
    ]);
  });

  it("an eliminative pool shrinks per round and seats the bronze final", () => {
    const event = concretify(miniChampionship, chessRegistry);
    const finals = event.stages[1]?.groups[0];
    const run = finals?.run;
    if (run?.kind !== "rounds") throw new Error("expected a rounds run");
    expect(
      run.rounds.items.map((round) =>
        round.pairings.open ? "open" : round.pairings.items.length,
      ),
    ).toEqual([2, 2]); // semifinals, then final + bronze
  });
});

describe("concretify — colors travel the seat algebra as names", () => {
  it("zigzag boards alternate the white seat between the sides", () => {
    const event = concretify(lichess4545Season, chessRegistry);
    const run = event.stages[0]?.groups[0]?.run;
    if (run?.kind !== "rounds") throw new Error("expected a rounds run");
    const match = run.rounds.items[0]?.pairings.items[0]?.node;
    expect(match?.children.map((board) => [board.role, board.sides])).toEqual([
      ["board 1", { white: "A", black: "B" }],
      ["board 2", { white: "B", black: "A" }],
      ["board 3", { white: "A", black: "B" }],
      ["board 4", { white: "B", black: "A" }],
    ]);
  });

  it("a two-entry encounter group names real competitors", () => {
    const event = concretify(armageddonShowdown, chessRegistry);
    const run = event.stages[0]?.groups[0]?.run;
    if (run?.kind !== "encounter") throw new Error("expected an encounter run");
    expect(run.node.sides).toEqual({ white: "Magnus", black: "Hikaru" });
  });

  it("a drawing of lots hides the holder and resets exemplars below", () => {
    const event = concretify(worldChampionship, chessRegistry);
    const run = event.stages[0]?.groups[0]?.run;
    if (run?.kind !== "encounter") throw new Error("expected an encounter run");
    // Every segment's colors are drawn fresh: no chips on the legs…
    const classicalSet = run.node.children[0];
    expect(classicalSet?.lines).toContain("colors drawn by lot");
    expect(classicalSet?.sides).toBeUndefined();
    // …and inside, exemplars relative to that draw alternate per game.
    expect(classicalSet?.children).toHaveLength(14);
    expect(classicalSet?.children[0]?.sides).toEqual({
      white: "A",
      black: "B",
    });
    expect(classicalSet?.children[1]?.sides).toEqual({
      white: "B",
      black: "A",
    });
  });
});
