// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  armageddonShowdown,
  lichess4545Season,
  loneWolf,
  miniChampionship,
  norwayChess,
  scheveningen,
  worldChampionship,
} from "@/chess/formats";
import { chessRegistry, parseEventDef } from "@/chess/registry";
import type { ParsedEventDef } from "@/tournament/registry";
import { runEvent as runEventWith } from "./builder";
import type { Input } from "./core";
import { competitorId, compRootPath, nodePathSchema, playerId } from "./core";
import { materialize, proposePairings, withInput } from "./engine";

const runEvent = (def: Parameters<typeof runEventWith>[0]) =>
  runEventWith(def, chessRegistry);

const path = (raw: string) => nodePathSchema.parse(raw);

const errorsOf = (def: ParsedEventDef, inputs: Input[]) =>
  materialize(def, inputs, chessRegistry).errors.map((e) => e.reason);

describe("input validation", () => {
  it("rejects a result for a game whose colors are not drawn yet", () => {
    const reasons = errorsOf(worldChampionship, [
      {
        kind: "gameResult",
        game: path("comp-title/leg-1/leg-1"),
        result: "1-0",
      },
    ]);
    expect(reasons).toEqual([expect.stringContaining("colors")]);
  });

  it("rejects a result for a series leg that is not materialized yet", () => {
    const reasons = errorsOf(worldChampionship, [
      {
        kind: "colorDraw",
        node: path("comp-title/leg-1"),
        whiteSeat: 0,
      },
      {
        kind: "gameResult",
        game: path("comp-title/leg-1/leg-2"),
        result: "1-0",
      },
    ]);
    expect(reasons).toEqual([expect.stringContaining("not materialized")]);
  });

  it("rejects pairing round 2 before round 1, and re-pairing a paired round", () => {
    const pool = compRootPath("swiss");
    const pairings: Extract<Input, { kind: "pairingsSet" }>["pairings"] = [
      {
        kind: "pair",
        a: competitorId("alice"),
        b: competitorId("bob"),
        whiteSeat: 0,
      },
    ];
    const round2First = errorsOf(loneWolf, [
      { kind: "pairingsSet", pool, round: 2, pairings },
    ]);
    expect(round2First).toEqual([
      expect.stringContaining("round 1 must be paired first"),
    ]);

    const repaired = errorsOf(loneWolf, [
      { kind: "pairingsSet", pool, round: 1, pairings },
      { kind: "pairingsSet", pool, round: 1, pairings },
    ]);
    expect(repaired).toEqual([expect.stringContaining("already paired")]);
  });

  it("rejects a bye when the pool has no bye rule", () => {
    const pool = compRootPath("rr");
    const reasons = errorsOf(norwayChess, [
      {
        kind: "pairingsSet",
        pool,
        round: 1,
        pairings: [
          {
            kind: "pair",
            a: competitorId("magnus"),
            b: competitorId("fabiano"),
            whiteSeat: 0,
          },
          { kind: "bye", competitor: competitorId("hikaru") },
        ],
      },
    ]);
    expect(reasons).toEqual([expect.stringContaining("no bye rule")]);
  });

  it("rejects a color draw on a seat that is not drawn by lot", () => {
    const run = runEvent(norwayChess)
      .pairRound()
      .game("Magnus", "Praggnanandhaa", "1/2-1/2"); // armageddon leg materializes
    const state = withInput(run.state(), {
      kind: "colorDraw",
      node: path("comp-rr/round-1/pair-1/leg-2"),
      whiteSeat: 1,
    });
    expect(state.errors.map((e) => e.reason)).toEqual([
      expect.stringContaining("is not drawn by lot"),
    ]);
  });

  it("rejects a manual decision on a node that is not awaiting one", () => {
    const reasons = errorsOf(armageddonShowdown, [
      {
        kind: "manualDecision",
        node: compRootPath("duel"),
        winner: 0,
      },
    ]);
    expect(reasons).toEqual([
      expect.stringContaining("not awaiting a manual decision"),
    ]);
  });

  it("rejects a lineup containing a player from outside the roster", () => {
    const run = runEvent(lichess4545Season).pairRound();
    const awaitLineup = run
      .actions()
      .find((a) => a.kind === "awaitLineup" && a.competitor === "kni");
    expect(awaitLineup?.kind).toBe("awaitLineup");
    if (awaitLineup?.kind !== "awaitLineup") return;
    const state = withInput(run.state(), {
      kind: "lineupSet",
      match: awaitLineup.match,
      side: awaitLineup.side,
      players: ["dra1", "kni2", "kni3", "kni4"].map(playerId),
    });
    expect(state.errors.map((e) => e.reason)).toEqual([
      expect.stringContaining("not on the roster"),
    ]);
  });

  it("rejects board results until both lineups are submitted", () => {
    const run = runEvent(lichess4545Season).pairRound();
    const state = withInput(run.state(), {
      kind: "gameResult",
      game: path("comp-league/round-1/pair-1/board-1"),
      result: "1-0",
    });
    expect(state.errors.map((e) => e.reason)).toEqual([
      expect.stringContaining("lineup"),
    ]);
  });
});

describe("corrections (last write wins, everything re-derives)", () => {
  it("flips the armageddon winner when the result is corrected", () => {
    const node = compRootPath("duel");
    const run = runEvent(armageddonShowdown).game("Magnus", "Hikaru", "1-0");
    expect(run.winnerName()).toBe("Magnus");
    run.submit({ kind: "gameResult", game: node, result: "1/2-1/2" });
    expect(run.winnerName()).toBe("Hikaru");
  });

  it("resurrects a skipped armageddon when a decisive classical is corrected to a draw", () => {
    const run = runEvent(norwayChess)
      .pairRound()
      .game("Magnus", "Praggnanandhaa", "1-0");
    const classicalPath = path("comp-rr/round-1/pair-1/leg-1");
    const armageddonPath = path("comp-rr/round-1/pair-1/leg-2");
    expect(run.scheduled().map((g) => g.path)).not.toContain(armageddonPath);

    run.submit({ kind: "gameResult", game: classicalPath, result: "1/2-1/2" }); // correction
    expect(run.scheduled().map((g) => g.path)).toContain(armageddonPath);
  });
});

describe("audit trail", () => {
  it("keeps rejected inputs in the log with their reasons", () => {
    const state = materialize(
      armageddonShowdown,
      [
        {
          kind: "manualDecision",
          node: compRootPath("duel"),
          winner: 0,
        },
        {
          kind: "gameResult",
          game: compRootPath("duel"),
          result: "1-0",
        },
      ],
      chessRegistry,
    );
    expect(state.inputs).toHaveLength(2);
    expect(state.errors).toHaveLength(1);
    expect(state.errors[0]?.index).toBe(0);
  });
});

describe("review-driven regressions", () => {
  it("rejects a color redraw once results exist under the node", () => {
    const run = runEvent(worldChampionship)
      .drawColors("Ding")
      .game("Ding", "Gukesh", "1-0");
    const state = withInput(run.state(), {
      kind: "colorDraw",
      node: path("comp-title/leg-1"),
      whiteSeat: 1,
    });
    expect(state.errors.map((e) => e.reason)).toEqual([
      expect.stringContaining("results are already recorded"),
    ]);
  });

  it("locks lineups once the match has results", () => {
    const run = runEvent(lichess4545Season).pairManual([
      ["Knights", "Dragons"],
      ["Pawnstars", "Rooks"],
    ]);
    for (const [team, prefix] of [
      ["Knights", "kni"],
      ["Dragons", "dra"],
    ] as const) {
      run.lineup(
        team,
        [1, 2, 3, 4].map((i) => `${prefix}${i}`),
      );
    }
    run.game("kni1", "dra1", "1-0");
    const awaiting = run
      .actions()
      .find((a) => a.kind === "awaitLineup" && a.competitor === "kni");
    expect(awaiting).toBeUndefined(); // already submitted
    const state = withInput(run.state(), {
      kind: "lineupSet",
      match: path("comp-league/round-1/pair-1"),
      side: 0,
      players: ["kni4", "kni3", "kni2", "kni1"].map(playerId),
    });
    expect(state.errors.map((e) => e.reason)).toEqual([
      expect.stringContaining("lineups are locked"),
    ]);
  });

  it("refuses to pair a knockout round with an odd number of advancers", () => {
    const def = parseEventDef({
      id: "odd-ko",
      name: "Knockout with byes",
      competitors: ["W", "X", "Y", "Z"].map((name) => ({
        id: name.toLowerCase(),
        name,
      })),
      competition: {
        id: "ko",
        entries: [1, 2, 3, 4].map((seed) => ({
          kind: "registration",
          seed,
        })),
        run: {
          kind: "pool",
          pairing: { system: "knockout", seeding: "manual" },
          encounter: {
            kind: "game",
            clock: { initial: 300, increment: 2 },
            tie: { kind: "drawOdds", color: "black" },
          },
          score: { kind: "passThrough" },
          tiebreaks: [],
        },
      },
    });
    const ko = compRootPath("ko");
    const run = runEvent(def)
      .submit({
        kind: "pairingsSet",
        pool: ko,
        round: 1,
        pairings: [
          {
            kind: "pair",
            a: competitorId("w"),
            b: competitorId("x"),
            whiteSeat: 0,
          },
          { kind: "bye", competitor: competitorId("y") },
          { kind: "bye", competitor: competitorId("z") },
        ],
      })
      .game("W", "X", "1-0");
    const proposed = proposePairings(run.state(), ko);
    expect(proposed).toMatchObject({
      ok: false,
      error: expect.stringContaining("odd bracket"),
    });
  });

  it("surfaces knockout pairings orphaned by a correction in their seeding source", () => {
    const run = runEvent(miniChampionship);
    const a = compRootPath("a");
    const b = compRootPath("b");
    const ko = compRootPath("ko");
    run.pairRound(a).game("David", "Elena", "1-0");
    run.pairRound(a).game("Anna", "David", "1-0");
    run.pairRound(a).game("Elena", "Anna", "0-1");
    run.pairRound(b).game("Clara", "Felix", "1-0");
    run.pairRound(b).game("Boris", "Clara", "0-1");
    run.pairRound(b).game("Felix", "Boris", "1-0");
    run.pairRound(ko); // semis seeded with David as A2

    // Correction: Elena actually beat David in round 1 — she overtakes him.
    const corrected = withInput(run.state(), {
      kind: "gameResult",
      game: path("comp-a/round-1/pair-2"),
      result: "0-1",
    });
    expect(corrected.errors.map((e) => e.reason)).toEqual([
      expect.stringContaining("no longer an entrant"),
    ]);
  });

  it("a drawn deciding match completes the event with no champion", () => {
    const run = runEvent(scheveningen);
    run.lineup("Hammers", ["ham1", "ham2"]);
    run.lineup("Anvils", ["anv1", "anv2"]);
    run.game("ham1", "anv1", "1-0").game("ham2", "anv2", "0-1");
    run.lineup("Hammers", ["ham1", "ham2"]);
    run.lineup("Anvils", ["anv1", "anv2"]);
    run.game("anv1", "ham1", "1/2-1/2").game("anv2", "ham2", "1/2-1/2");

    expect(run.outcome(compRootPath("tie")).decision).toEqual({
      kind: "draw",
    });
    expect(run.actions()).toContainEqual({
      kind: "eventComplete",
      winner: undefined,
    });
    expect(run.winnerName()).toBeUndefined();
  });
});
