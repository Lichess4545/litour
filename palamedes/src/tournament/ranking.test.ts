// @vitest-environment node
import { describe, expect, test } from "vitest";
import { chessRegistry } from "@/chess/registry";
import { type CompetitorId, competitorId } from "./core";
import type { MetricRow, PlayedLine } from "./registry";

/**
 * The data-driven ranking refines tied blocks one criterion at a time and
 * evaluates each tiebreak with the *current* block as its tied group (see
 * `refineRanking` in standings.ts). This pins the mechanism that makes that
 * correct for head-to-head: the live metric must honour the passed-in tied set,
 * not just everyone on equal points.
 *
 * The scenario is a perfect 3-cycle on equal points — Ada beat Boe, Boe beat
 * Cal, Cal beat Ada. Over the whole {Ada,Boe,Cal} group head-to-head is
 * symmetric (no separation); but once a prior tiebreak has narrowed the tie to
 * {Ada,Boe}, head-to-head must rank Ada over Boe on their direct game. The old
 * equal-points-only behaviour could never do that.
 */

const headToHead = chessRegistry.metrics.get("headToHead");
if (headToHead === undefined) throw new Error("headToHead metric missing");

const ada = competitorId("ada");
const boe = competitorId("boe");
const cal = competitorId("cal");

/** A played game in which `competitor` scored `mine` (1 = win, 0 = loss). */
const line = (opponent: CompetitorId, mine: number): PlayedLine => ({
  kind: "played",
  round: 1,
  opponent,
  side: 0,
  color: "white",
  outcome: {
    points: [mine, 1 - mine],
    decision: { kind: "win", winner: mine === 1 ? 0 : 1, by: "points" },
  },
  standingsPoints: mine,
  encounterPoints: mine,
  opponentEncounterPoints: 1 - mine,
  gamesWon: mine,
  boardPoints: [],
  unplayed: false,
});

const row = (
  competitor: CompetitorId,
  lines: readonly PlayedLine[],
): MetricRow => ({
  competitor,
  standingsPoints: 1,
  encounterPoints: 1,
  lines,
});

const adaRow = row(ada, [line(boe, 1), line(cal, 0)]);
const boeRow = row(boe, [line(ada, 0), line(cal, 1)]);
const calRow = row(cal, [line(ada, 1), line(boe, 0)]);
const all = new Map(
  [adaRow, boeRow, calRow].map((r) => [r.competitor, r] as const),
);

describe("head-to-head respects the ranking's tied block", () => {
  test("over the full equal-points 3-cycle, head-to-head is symmetric", () => {
    expect(headToHead.value({ metric: "headToHead" }, adaRow, all)).toBe(1);
    expect(headToHead.value({ metric: "headToHead" }, boeRow, all)).toBe(1);
  });

  test("narrowed to the tied pair, it separates them by their direct game", () => {
    const block = new Set([ada, boe]);
    expect(headToHead.value({ metric: "headToHead" }, adaRow, all, block)).toBe(
      1,
    );
    expect(headToHead.value({ metric: "headToHead" }, boeRow, all, block)).toBe(
      0,
    );
  });
});
