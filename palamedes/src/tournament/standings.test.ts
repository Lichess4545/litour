// @vitest-environment node
import { describe, expect, it } from "vitest";
import { expectStandings, runEvent } from "./builder";
import {
  groupRootPath,
  type ParsedEventDef,
  pairPath,
  parseEventDef,
} from "./def";
import { norwayChess, olympiad } from "./formats";

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
    const pair = pairPath(groupRootPath("main", "swiss"), 1, 1);
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
      node: pairPath(groupRootPath("main", "rr"), 1, 1),
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
    stages: [
      {
        id: "main",
        groups: [
          {
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
              score: { kind: "perEncounter", win: 2, draw: 1, loss: 0 },
              tiebreaks: [],
            },
          },
        ],
      },
    ],
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

const rrWithTiebreaks = (
  tiebreaks: readonly Record<string, unknown>[],
): ParsedEventDef =>
  parseEventDef({
    id: "rr-tb",
    name: "Round robin with tiebreaks",
    competitors: ["Ada", "Boe", "Cal", "Dee"].map((name) => ({
      id: name.toLowerCase(),
      name,
    })),
    stages: [
      {
        id: "main",
        groups: [
          {
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
              score: { kind: "encounterPoints" },
              tiebreaks,
            },
          },
        ],
      },
    ],
  });

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

describe("buchholz cut", () => {
  it("drops the lowest opponent score (bye counting as own total)", () => {
    const def = parseEventDef({
      id: "cut-swiss",
      name: "Swiss with buchholz cut",
      competitors: ["Alice", "Bob", "Carol", "Dave", "Erin"].map((name) => ({
        id: name.toLowerCase(),
        name,
      })),
      stages: [
        {
          id: "main",
          groups: [
            {
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
                score: { kind: "encounterPoints" },
                bye: { kind: "points", standings: 1, encounter: 1 },
                tiebreaks: [{ metric: "buchholz", cut: 1 }],
              },
            },
          ],
        },
      ],
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
