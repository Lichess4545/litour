// @vitest-environment node
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { norwayChess, olympiad } from "@/chess/formats";
import { chessRegistry, parseEventDef } from "@/chess/registry";
import {
  defineMetricKind,
  extendRegistry,
  type ParsedEventDef,
  parseEventDef as parseEventDefFor,
} from "@/tournament/registry";
import {
  type EventRun,
  expectStandings,
  runEvent as runEventWith,
} from "./builder";
import { compRootPath, pairPath } from "./core";

const runEvent = (def: Parameters<typeof runEventWith>[0]) =>
  runEventWith(def, chessRegistry);

/**
 * Scoring semantics the format scripts don't reach: whole-encounter
 * forfeits, the doubleLoss/scheduling-draw distinction, the head-to-head
 * gate, and buchholz cuts.
 */

describe("encounterForfeit", () => {
  it("a forfeited team match pays nominal points, awards no game wins, and is marked unplayed", () => {
    const run = runEvent(olympiad).pairManual([
      ["India", "USA"],
      ["China", "Uzbekistan"],
    ]);
    const pair = pairPath(compRootPath("swiss"), 1, 1);
    run.submit({ kind: "encounterForfeit", node: pair, winner: 0 });

    expect(run.outcome(pair).decision).toMatchObject({
      kind: "win",
      winner: 0,
      by: "forfeit",
    });
    expectStandings(run)
      .competitor("India")
      .points(2)
      .encounterPoints(4)
      .metric("gamesWon", 0);
    expectStandings(run).competitor("USA").points(0).encounterPoints(0);
    // No games are created for the forfeited tie.
    expect(
      run.scheduled().filter((g) => g.path.includes("pair-1")),
    ).toHaveLength(0);
  });

  it("a Norway no-show concedes the full 3 points, not the armageddon consolation", () => {
    const run = runEvent(norwayChess).pairRound();
    run.submit({
      kind: "encounterForfeit",
      node: pairPath(compRootPath("rr"), 1, 1),
      winner: 0,
    });
    expectStandings(run).competitor("Magnus").points(3);
    expectStandings(run).competitor("Praggnanandhaa").points(0);
  });
});

const duelPool = (): ParsedEventDef =>
  parseEventDef({
    id: "duel-pool",
    name: "Two-round duel",
    competitors: [
      { id: "a", name: "Ann" },
      { id: "b", name: "Ben" },
    ],
    competition: {
      id: "p",
      entries: [
        { kind: "registration", seed: 1 },
        { kind: "registration", seed: 2 },
      ],
      run: {
        kind: "pool",
        pairing: { system: "manual" },
        rounds: 2,
        encounter: {
          kind: "game",
          clock: { initial: 300, increment: 2 },
        },
        score: { kind: "table", draw: 1, legs: [{ win: 2, loss: 0 }] },
        tiebreaks: [],
      },
    },
  });

describe("forfeit-shaped results under match points", () => {
  it("0F-0F is a loss for BOTH (not a draw); 1/2Z-1/2Z is a draw but unplayed", () => {
    const run = runEvent(duelPool())
      .pairManual([["Ann", "Ben"]])
      .game("Ann", "Ben", "0F-0F")
      .pairManual([["Ben", "Ann"]])
      .game("Ben", "Ann", "1/2Z-1/2Z");

    expectStandings(run).competitor("Ann").points(1); // 0 + 1, not 1 + 1
    expectStandings(run).competitor("Ben").points(1);
    const lines = run
      .standings()
      .find((row) => row.competitor === "a")
      ?.lines.filter((line) => line.kind === "played");
    expect(lines?.map((line) => line.unplayed)).toEqual([true, true]);
    expect(lines?.[0]?.outcome.decision).toEqual({ kind: "doubleLoss" });
  });
});

const rrWithTiebreaksData = (
  tiebreaks: readonly Record<string, unknown>[],
) => ({
  id: "rr-tb",
  name: "Round robin with tiebreaks",
  competitors: ["Ada", "Boe", "Cal", "Dee"].map((name) => ({
    id: name.toLowerCase(),
    name,
  })),
  competition: {
    id: "rr",
    entries: [1, 2, 3, 4].map((seed) => ({
      kind: "registration",
      seed,
    })),
    run: {
      kind: "pool",
      pairing: { system: "roundRobin", cycles: 1 },
      encounter: {
        kind: "game",
        clock: { initial: 300, increment: 2 },
      },
      score: { kind: "passThrough" },
      tiebreaks,
    },
  },
});

const rrWithTiebreaks = (
  tiebreaks: readonly Record<string, unknown>[],
): ParsedEventDef => parseEventDef(rrWithTiebreaksData(tiebreaks));

describe("head-to-head", () => {
  it("decides a two-way tie when the tied pair has met", () => {
    const run = runEvent(rrWithTiebreaks([{ metric: "headToHead" }]))
      .pairRound() // R1: Ada-Dee, Boe-Cal
      .game("Ada", "Dee", "1/2-1/2")
      .game("Boe", "Cal", "1-0")
      .pairRound() // R2: Dee-Cal, Ada-Boe
      .game("Dee", "Cal", "0-1")
      .game("Ada", "Boe", "1-0")
      .pairRound() // R3: Boe-Dee, Cal-Ada
      .game("Boe", "Dee", "1-0")
      .game("Cal", "Ada", "1/2-1/2");

    // Ada and Boe both finish on 2; Ada won their game.
    expectStandings(run)
      .competitor("Ada")
      .points(2)
      .metric("headToHead", 1)
      .rank(1);
    expectStandings(run)
      .competitor("Boe")
      .points(2)
      .metric("headToHead", 0)
      .rank(2);
  });

  it("stays out of it (zero) while a tied pair has not met", () => {
    const run = runEvent(rrWithTiebreaks([{ metric: "headToHead" }]))
      .pairRound()
      .game("Ada", "Dee", "1/2-1/2")
      .game("Boe", "Cal", "1/2-1/2");
    // All four tied on 1/2; e.g. Ada and Boe have not played each other.
    for (const name of ["Ada", "Boe", "Cal", "Dee"]) {
      expectStandings(run).competitor(name).metric("headToHead", 0).rank(1);
    }
  });
});

describe("an erroring tiebreak metric cannot split a tied block", () => {
  const erroringMetric = defineMetricKind({
    metric: "erroring",
    schema: z.object({ metric: z.literal("erroring") }),
    label: () => "erroring",
    value: () => {
      throw new Error("value() must not run once valueResult is set");
    },
    valueResult: () => ({ ok: false, error: { reason: "boom" } }),
  });
  // A synthetic, competitor-keyed criterion that always splits a block,
  // independent of any game result — isolates "does erroring get skipped"
  // from "does this particular builtin happen to split these competitors".
  const splitterOrder = new Map([
    ["ada", 3],
    ["cal", 2],
    ["boe", 1],
  ]);
  const splitterMetric = defineMetricKind({
    metric: "splitter",
    schema: z.object({ metric: z.literal("splitter") }),
    label: () => "splitter",
    value: (_ref, row) => splitterOrder.get(row.competitor) ?? 0,
  });
  const registryWithErroring = extendRegistry(chessRegistry, {
    id: "chess-test/erroring-metric",
    metrics: [erroringMetric, splitterMetric],
  });
  const runEventWithErroring = (
    tiebreaks: readonly Record<string, unknown>[],
  ) =>
    runEventWith(
      parseEventDefFor(rrWithTiebreaksData(tiebreaks), registryWithErroring),
      registryWithErroring,
    );

  it("passes an errored criterion through unsplit, leaving the final order to the next one", () => {
    // Same scenario as "head-to-head decides a two-way tie" above, but with
    // an always-erroring criterion placed ahead of headToHead in the list.
    const run = runEventWithErroring([
      { metric: "erroring" },
      { metric: "headToHead" },
    ])
      .pairRound() // R1: Ada-Dee, Boe-Cal
      .game("Ada", "Dee", "1/2-1/2")
      .game("Boe", "Cal", "1-0")
      .pairRound() // R2: Dee-Cal, Ada-Boe
      .game("Dee", "Cal", "0-1")
      .game("Ada", "Boe", "1-0")
      .pairRound() // R3: Boe-Dee, Cal-Ada
      .game("Boe", "Dee", "1-0")
      .game("Cal", "Ada", "1/2-1/2");

    // Same order as headToHead alone: Ada beats Boe on their direct game.
    expectStandings(run).competitor("Ada").points(2).rank(1);
    expectStandings(run).competitor("Boe").points(2).rank(2);
  });

  // Three-way tied block: Ada, Boe, and Cal each draw the other two and beat
  // Dee, so all three finish on 2 points against Dee's 0.
  const threeWayTieScenario = (tiebreaks: readonly Record<string, unknown>[]) =>
    runEventWithErroring(tiebreaks)
      .pairRound() // R1: Ada-Dee, Boe-Cal
      .game("Ada", "Dee", "1-0")
      .game("Boe", "Cal", "1/2-1/2")
      .pairRound() // R2: Dee-Cal, Ada-Boe
      .game("Dee", "Cal", "0-1")
      .game("Ada", "Boe", "1/2-1/2")
      .pairRound() // R3: Boe-Dee, Cal-Ada
      .game("Boe", "Dee", "1-0")
      .game("Cal", "Ada", "1/2-1/2");

  it("a three-way tie survives an erroring criterion to reach the same order the splitter alone would produce", () => {
    const withErroring = threeWayTieScenario([
      { metric: "erroring" },
      { metric: "splitter" },
    ]);
    const splitterAlone = threeWayTieScenario([{ metric: "splitter" }]);

    const orderOf = (run: EventRun) =>
      run
        .standings()
        .slice()
        .sort((a, b) => a.rank - b.rank)
        .map((row) => row.competitor);
    expect(orderOf(withErroring)).toEqual(orderOf(splitterAlone));
    expectStandings(withErroring).competitor("ada").rank(1);
    expectStandings(withErroring).competitor("cal").rank(2);
    expectStandings(withErroring).competitor("boe").rank(3);
    expectStandings(withErroring).competitor("dee").rank(4);

    // The erroring criterion (index 1) reported the whole tied block as
    // unsplit; the splitter-alone run never hit an error.
    expect(withErroring.unsplitCriteria()).toEqual([
      { criterion: 1, block: ["ada", "boe", "cal"], reason: "boom" },
    ]);
    expect(splitterAlone.unsplitCriteria()).toEqual([]);
  });

  it("keeps a tied block's original order when the erroring criterion is LAST — no downstream sort can hide a reordering bug", () => {
    // headToHead is first and genuinely fails to split this block (all three
    // drew their one game against each other), so the block is still tied
    // and unsorted when the erroring criterion (last) receives it.
    const run = threeWayTieScenario([
      { metric: "headToHead" },
      { metric: "erroring" },
    ]);

    // Original entrant order (Ada, Boe, Cal) preserved — not re-sorted by
    // anything downstream, since nothing follows the erroring criterion.
    expectStandings(run).competitor("ada").rank(1);
    expectStandings(run).competitor("boe").rank(1);
    expectStandings(run).competitor("cal").rank(1);
    expect(
      run
        .standings()
        .filter((row) => row.rank === 1)
        .map((row) => row.competitor),
    ).toEqual(["ada", "boe", "cal"]);

    expect(run.unsplitCriteria()).toEqual([
      { criterion: 2, block: ["ada", "boe", "cal"], reason: "boom" },
    ]);
  });

  it("records the errored cell honestly, distinguishable from a genuine 0", () => {
    const run = threeWayTieScenario([{ metric: "erroring" }]);
    for (const name of ["ada", "boe", "cal", "dee"]) {
      const row = run.standings().find((r) => r.competitor === name);
      expect(row?.metrics.get("erroring")).toEqual({ error: "boom" });
    }
  });
});

describe("buchholz cut", () => {
  it("drops the lowest opponent score (bye counting as own total)", () => {
    const def = parseEventDef({
      id: "cut-swiss",
      name: "Swiss with buchholz cut",
      competitors: ["Alice", "Bob", "Carol", "Dave", "Erin"].map((name) => ({
        id: name.toLowerCase(),
        name,
      })),
      competition: {
        id: "swiss",
        entries: [1, 2, 3, 4, 5].map((seed) => ({
          kind: "registration",
          seed,
        })),
        run: {
          kind: "pool",
          pairing: { system: "swiss" },
          rounds: 3,
          encounter: {
            kind: "game",
            clock: { initial: 300, increment: 2 },
          },
          score: { kind: "passThrough" },
          bye: { kind: "points", standings: 1, encounter: 1 },
          tiebreaks: [{ metric: "buchholz", cut: 1 }],
        },
      },
    });
    // The LoneWolf script with pinned pairings.
    const run = runEvent(def)
      .pairManual(
        [
          ["Alice", "Bob"],
          ["Dave", "Carol"],
        ],
        { byes: ["Erin"] },
      )
      .game("Alice", "Bob", "1-0")
      .game("Dave", "Carol", "0-1")
      .pairManual(
        [
          ["Carol", "Alice"],
          ["Bob", "Erin"],
        ],
        { byes: ["Dave"] },
      )
      .game("Carol", "Alice", "1-0")
      .game("Bob", "Erin", "1X-0F")
      .pairManual(
        [
          ["Carol", "Erin"],
          ["Alice", "Dave"],
        ],
        { byes: ["Bob"] },
      )
      .game("Carol", "Erin", "1/2-1/2")
      .game("Alice", "Dave", "1-0");

    // Alice's opponents total [2, 2.5, 1] → drop 1 → 4.5.
    // Bob's are [2, 1.5, own 2 for the bye] → drop 1.5 → 4.
    expectStandings(run)
      .competitor("Alice")
      .metric("buchholz-cut1", 4.5)
      .rank(2);
    expectStandings(run).competitor("Bob").metric("buchholz-cut1", 4).rank(3);
  });
});

const phasedPool = (): ParsedEventDef =>
  parseEventDef({
    id: "phased-pool",
    name: "Phased scoring",
    competitors: ["A", "B", "C", "D"].map((name) => ({
      id: name.toLowerCase(),
      name,
    })),
    competition: {
      id: "rr",
      entries: [1, 2, 3, 4].map((seed) => ({ kind: "registration", seed })),
      run: {
        kind: "pool",
        pairing: { system: "manual" },
        rounds: 3,
        encounter: { kind: "game", clock: { initial: 300, increment: 2 } },
        // Round 1 scores 2/1/0; rounds 2–3 score 1/0.5/0 — the GCT
        // rapid-then-blitz shape, keyed off each competitor's own round.
        score: {
          kind: "phased",
          phases: [
            { rounds: 1, win: 2, draw: 1, loss: 0 },
            { rounds: 2, win: 1, draw: 0.5, loss: 0 },
          ],
        },
        tiebreaks: [],
      },
    },
  });

describe("phased scoring", () => {
  it("scores each competitor's game by the phase its own round falls in", () => {
    const run = runEvent(phasedPool())
      .pairManual([
        ["A", "B"],
        ["C", "D"],
      ])
      .game("A", "B", "1-0")
      .game("C", "D", "1-0")
      .pairManual([
        ["A", "C"],
        ["B", "D"],
      ])
      .game("A", "C", "1-0")
      .game("B", "D", "1/2-1/2")
      .pairManual([
        ["A", "D"],
        ["B", "C"],
      ])
      .game("A", "D", "1-0")
      .game("B", "C", "1/2-1/2");

    // A wins all three: 2 (round 1, phase 1) + 1 + 1 (phase 2) = 4 — flat
    // scoring would give 3, phase-1-throughout would give 6.
    expectStandings(run).competitor("A").points(4);
    // C: phase-1 win (2), then loss (0), then phase-2 draw (0.5) = 2.5.
    expectStandings(run).competitor("C").points(2.5);
    // B: phase-1 loss (0) + two phase-2 draws (0.5 each) = 1.
    expectStandings(run).competitor("B").points(1);
    expectStandings(run).competitor("D").points(0.5);
  });
});
