// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  armageddonShowdown,
  clubRoundRobin,
  grandChessTour,
  grenke,
  lichess4545,
  lichess4545Season,
  miniChampionship,
  worldChampionship,
  worldUniversityChampionship,
} from "@/chess/formats";
import { chessRegistry } from "@/chess/registry";
import { concretify } from "./concrete";
import { competitorIdSchema } from "./core";

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

  it("stages carry their own card and aggregated inflows for the event level", () => {
    const event = concretify(worldUniversityChampionship, chessRegistry);
    expect(event.stages.map((s) => s.card.title)).toEqual([
      "qualifiers",
      "knockout",
      "otb-groups",
      "medals",
    ]);
    expect(event.stages[0]?.card.lines).toEqual([
      "q1 · open entry",
      "q2 · open entry",
    ]);
    // The knockout's participants arrive through two standings outputs.
    expect(
      event.stages[1]?.intakes.map((intake) => [
        intake.card.title,
        intake.take,
      ]),
    ).toEqual([
      ["q1 standings", "top 16"],
      ["q2 standings", "top 16"],
    ]);
    // Each finals source group sends its top two — merged per source.
    expect(event.stages[3]?.intakes.map((intake) => intake.take)).toEqual([
      "top 2",
      "top 2",
    ]);
  });

  it("a truncated knockout plays two rounds; its seed links aggregate per source", () => {
    const event = concretify(worldUniversityChampionship, chessRegistry);
    const ko = event.stages[1]?.groups[0];
    expect(ko?.entrants).toBe(32);
    expect(ko?.intakes.map((intake) => intake.take)).toEqual([
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
      event.stages[2]?.groups.map((g) => [g.entrants, g.intakes[0]?.take]),
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

describe("sectioned events — parallel divisions in one stage", () => {
  it("sections register and score separately, in one contemporaneous stage", () => {
    const event = concretify(grenke, chessRegistry);
    expect(event.stages).toHaveLength(1);
    const groups = event.stages[0]?.groups ?? [];
    expect(groups.map((g) => g.header.title)).toEqual([
      "GRENKE Classic",
      "GRENKE Open",
    ]);
    // Completely different formats side by side.
    expect(
      groups.map((g) => (g.run.kind === "rounds" ? g.run.system : "—")),
    ).toEqual(["roundRobin", "swiss"]);
    // Each section has its own participant source.
    expect(groups.map((g) => g.intakes[0]?.card.kind)).toEqual([
      "registration",
      "registration",
    ]);
    expect(groups.map((g) => g.entrants)).toEqual([6, "open"]);
  });
});

describe("the Grand Chess Tour — terminology and tour standings", () => {
  it("every word on the cards comes from the definition", () => {
    const event = concretify(grandChessTour, chessRegistry);
    expect(event.stages.map((s) => s.card.title)).toEqual([
      "Superbet Chess Classic",
      "SuperUnited Zagreb Rapid & Blitz",
      "SuperUnited Warsaw Rapid & Blitz",
      "Saint Louis Rapid & Blitz",
      "Sinquefield Cup",
      "GCT Finals São Paulo",
    ]);
    // The five events are independent (tier 0, runnable concurrently);
    // only the finals depend on them.
    expect(event.stages.map((s) => s.tier)).toEqual([0, 0, 0, 0, 0, 1]);
    const finals = event.stages[5]?.groups[0];
    // The tour aggregation is one intake: all five events feed one
    // standings node, whose top 4 feed the finals.
    const [intake] = finals?.intakes ?? [];
    expect(finals?.intakes).toHaveLength(1);
    expect(intake?.card.title).toBe("Tour standings");
    expect(intake?.from).toHaveLength(5);
    expect(intake?.take).toBe("top 4");
    const run = finals?.run;
    if (run?.kind !== "rounds") throw new Error("expected a rounds run");
    const semis = run.rounds.items[0];
    if (semis?.pairings.open !== false)
      throw new Error("expected known pairings");
    // The knockout names its pairings; the bracket flows carry
    // winners to the final and losers to the bronze.
    expect(semis.pairings.items.map((p) => p.label)).toEqual([
      "semifinal 1",
      "semifinal 2",
    ]);
    const finalRound = run.rounds.items[1];
    if (finalRound?.pairings.open !== false)
      throw new Error("expected known pairings");
    expect(finalRound.pairings.items.map((p) => p.label)).toEqual([
      "final",
      "bronze final",
    ]);
    expect(finalRound.inflows).toEqual([
      {
        pair: 1,
        from: [
          { pair: 1, take: "winner" },
          { pair: 2, take: "winner" },
        ],
      },
      {
        pair: 2,
        from: [
          { pair: 1, take: "loser" },
          { pair: 2, take: "loser" },
        ],
      },
    ]);
    const match = semis.pairings.items[0]?.node;
    expect(match?.title).toBe("Finals match");
    expect(match?.children[0]?.role).toBe("game 1");
    expect(match?.children[0]?.title).toBe("Classical");
    // A Rapid & Blitz stop: 27 rounds, scoring describing its phases.
    const zagreb = event.stages[1]?.groups[0]?.run;
    if (zagreb?.kind !== "rounds") throw new Error("expected a rounds run");
    expect(zagreb.rounds.open).toBe(false);
    expect(zagreb.rounds.items).toHaveLength(27);
    expect(zagreb.scoring.title).toBe("Phased points");
  });

  it("placements aggregate rankings through a points table", () => {
    const placements = chessRegistry.seeds.get("placements");
    const [a, b, c] = ["a", "b", "c"].map((x) => competitorIdSchema.parse(x));
    if (a === undefined || b === undefined || c === undefined) {
      throw new Error("ids");
    }
    const rankings = new Map([
      ["e1/field", [a, b, c]],
      ["e2/field", [a, c, b]],
    ]);
    const resolve = (rank: number) =>
      placements?.resolve(
        {
          kind: "placements",
          sources: [
            { stage: "e1", group: "field" },
            { stage: "e2", group: "field" },
          ],
          points: [3, 1, 0],
          rank,
        },
        {
          competitors: [],
          ranking: (stage, group) => rankings.get(`${stage}/${group}`),
        },
      );
    // a sweeps both; b and c tie on points and best placement — source
    // order breaks the tie deterministically.
    expect([resolve(1), resolve(2), resolve(3)]).toEqual([a, b, c]);
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

  it("stop rules surface as gates between legs", () => {
    const event = concretify(worldChampionship, chessRegistry);
    const run = event.stages[0]?.groups[0]?.run;
    if (run?.kind !== "encounter") throw new Error("expected an encounter run");
    const [classicalSet, rapid] = run.node.children;
    // The first leg always plays; every later leg is gated by the stop rule.
    expect(classicalSet?.gate).toBeUndefined();
    expect(rapid?.gate).toEqual({
      when: "still tied?",
      otherwise: "winner decided",
    });
    // Inside the classical set, first-to-7.5 gates every game after the first.
    expect(classicalSet?.children[0]?.gate).toBeUndefined();
    expect(classicalSet?.children[1]?.gate).toEqual({
      when: "no one at 7.5?",
      otherwise: "first to 7.5 wins",
    });
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
