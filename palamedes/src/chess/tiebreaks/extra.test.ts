// @vitest-environment node
import { describe, expect, test } from "vitest";
import {
  type CompetitorId,
  competitorId,
  type Outcome,
  type Side,
} from "@/tournament/core";
import type { Expr } from "@/tournament/expr/ast";
import { evalMetric } from "@/tournament/expr/metric";
import type { MetricRow, PlayedLine } from "@/tournament/registry";
import {
  buchholz,
  CUMULATIVE,
  GAMES_WITH_BLACK,
  medianBuchholz,
  tiebreakExprs,
} from "./definitions";

/**
 * Golden checks for the deep-dive tiebreaks (no legacy oracle exists for these
 * — they are new). Hand-built rows with known answers, plus the structural
 * property that median Buchholz with no cut is plain Buchholz.
 */

const PENDING: Outcome = { points: [0, 0], decision: { kind: "pending" } };

const played = (
  round: number,
  opponent: CompetitorId,
  side: Side,
  standingsPoints: number,
): PlayedLine => ({
  kind: "played",
  round,
  opponent,
  side,
  color: side === 0 ? "white" : "black",
  outcome: PENDING,
  standingsPoints,
  encounterPoints: standingsPoints,
  opponentEncounterPoints: 0,
  gamesWon: 0,
  boardPoints: [],
  unplayed: false,
});

const row = (
  competitor: CompetitorId,
  lines: readonly PlayedLine[],
  standingsPoints = 0,
): MetricRow => ({
  competitor,
  standingsPoints,
  encounterPoints: standingsPoints,
  lines,
});

const run = (
  expr: Expr,
  rows: readonly MetricRow[],
  selfId: CompetitorId,
): number => {
  const all = new Map(rows.map((r) => [r.competitor, r] as const));
  const self = all.get(selfId);
  if (self === undefined) throw new Error("no self row");
  return evalMetric(expr, self, {
    all,
    named: (name) => tiebreakExprs.get(name),
    tiedGroup: () => [],
  });
};

describe("median Buchholz", () => {
  const a = competitorId("a");
  // A's five opponents stand on 1..5; A's own line points are irrelevant here.
  const opponents = [1, 2, 3, 4, 5].map((sp, i) =>
    row(competitorId(`o${i}`), [], sp),
  );
  const aRow = row(
    a,
    [0, 1, 2, 3, 4].map((i) => played(i + 1, competitorId(`o${i}`), 0, 0)),
  );
  const rows = [aRow, ...opponents];

  test("cut 1 drops the highest and lowest opponent (2 + 3 + 4)", () => {
    expect(run(medianBuchholz(1), rows, a)).toBe(9);
  });

  test("cut 0 is plain Buchholz (1 + … + 5)", () => {
    expect(run(medianBuchholz(0), rows, a)).toBe(run(buchholz(0), rows, a));
    expect(run(buchholz(0), rows, a)).toBe(15);
  });
});

describe("cumulative (progressive) score", () => {
  const a = competitorId("a");
  const o = competitorId("o");
  // Running totals 1, 1.5, 2.5 → progressive sum 5.
  const aRow = row(a, [
    played(1, o, 0, 1),
    played(2, o, 0, 0.5),
    played(3, o, 0, 1),
  ]);

  test("sums the running total after each round", () => {
    expect(run(CUMULATIVE, [aRow, row(o, [])], a)).toBe(5);
  });
});

describe("games with black", () => {
  const a = competitorId("a");
  const o = competitorId("o");
  // White, black, black → two black games.
  const aRow = row(a, [
    played(1, o, 0, 0),
    played(2, o, 1, 0),
    played(3, o, 1, 0),
  ]);

  test("counts played games on the black side", () => {
    expect(run(GAMES_WITH_BLACK, [aRow, row(o, [])], a)).toBe(2);
  });
});
