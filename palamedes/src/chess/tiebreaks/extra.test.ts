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
import type { MetricRow, PlayedLine, RoundLine } from "@/tournament/registry";
import {
  buchholz,
  CUMULATIVE,
  CUMULATIVE_OPPOSITION,
  GAMES_WITH_BLACK,
  MODIFIED_MEDIAN,
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

const bye = (round: number, standingsPoints: number): RoundLine => ({
  kind: "bye",
  round,
  standingsPoints,
  encounterPoints: standingsPoints,
});

const row = (
  competitor: CompetitorId,
  lines: readonly RoundLine[],
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

describe("modified median", () => {
  const a = competitorId("a");
  const fiveOpponents = [1, 2, 3, 4, 5].map((sp, i) =>
    row(competitorId(`o${i}`), [], sp),
  );
  const fivePlayed = [0, 1, 2, 3, 4].map((i) =>
    played(i + 1, competitorId(`o${i}`), 0, 0),
  );
  const withOwn = (standingsPoints: number): readonly MetricRow[] => [
    row(a, fivePlayed, standingsPoints),
    ...fiveOpponents,
  ];

  test("plus score (3 of 5) discards the lowest: 2+3+4+5", () => {
    expect(run(MODIFIED_MEDIAN, withOwn(3), a)).toBe(14);
  });

  test("minus score (2 of 5) discards the highest: 1+2+3+4", () => {
    expect(run(MODIFIED_MEDIAN, withOwn(2), a)).toBe(10);
  });

  test("even score (2.5 of 5) discards both — and equals median Buchholz cut 1 with no byes", () => {
    expect(run(MODIFIED_MEDIAN, withOwn(2.5), a)).toBe(9);
    expect(run(MODIFIED_MEDIAN, withOwn(2.5), a)).toBe(
      run(medianBuchholz(1), withOwn(2.5), a),
    );
  });

  test("nine rounds discard two per side", () => {
    const nineOpponents = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((sp, i) =>
      row(competitorId(`n${i}`), [], sp),
    );
    const ninePlayed = nineOpponents.map((o, i) =>
      played(i + 1, o.competitor, 0, 0),
    );
    const at = (own: number): readonly MetricRow[] => [
      row(a, ninePlayed, own),
      ...nineOpponents,
    ];
    expect(run(MODIFIED_MEDIAN, at(5), a)).toBe(42);
    expect(run(MODIFIED_MEDIAN, at(4), a)).toBe(28);
    expect(run(MODIFIED_MEDIAN, at(4.5), a)).toBe(25);
  });

  test("a bye adds a round (shifting plus/minus) but no opponent score", () => {
    const fourOpponents = [1, 2, 3, 4].map((sp, i) =>
      row(competitorId(`b${i}`), [], sp),
    );
    const lines: readonly RoundLine[] = [
      ...fourOpponents.map((o, i) => played(i + 1, o.competitor, 0, 0)),
      bye(5, 1),
    ];
    const rows = [row(a, lines, 3), ...fourOpponents];
    expect(run(MODIFIED_MEDIAN, rows, a)).toBe(9);
  });

  test("the bye counts in the round denominator: own 2.5 of 5 rounds is even, not plus", () => {
    const fourOpponents = [1, 2, 3, 4].map((sp, i) =>
      row(competitorId(`b${i}`), [], sp),
    );
    const lines: readonly RoundLine[] = [
      ...fourOpponents.map((o, i) => played(i + 1, o.competitor, 0, 0)),
      bye(5, 1),
    ];
    const rows = [row(a, lines, 2.5), ...fourOpponents];
    expect(run(MODIFIED_MEDIAN, rows, a)).toBe(5);
  });
});

describe("cumulative opposition", () => {
  const a = competitorId("a");
  const o1 = competitorId("o1");
  const o2 = competitorId("o2");
  const o1Row = row(o1, [
    played(1, a, 0, 1),
    played(2, a, 0, 1),
    played(3, a, 0, 0),
  ]);
  const o2Row = row(o2, [
    played(1, a, 0, 0.5),
    played(2, a, 0, 0.5),
    played(3, a, 0, 1),
  ]);

  test("sums opponents' cumulative scores", () => {
    const aRow = row(a, [played(1, o1, 0, 0), played(2, o2, 0, 1)]);
    expect(run(CUMULATIVE_OPPOSITION, [aRow, o1Row, o2Row], a)).toBe(8.5);
  });

  test("a twice-met opponent counts twice", () => {
    const aRow = row(a, [played(1, o1, 0, 0), played(2, o1, 0, 1)]);
    expect(run(CUMULATIVE_OPPOSITION, [aRow, o1Row, o2Row], a)).toBe(10);
  });

  test("an opponent's bye feeds their cumulative", () => {
    const withBye = row(o1, [played(1, a, 0, 1), bye(2, 0.5)]);
    const aRow = row(a, [played(1, o1, 0, 0)]);
    expect(run(CUMULATIVE_OPPOSITION, [aRow, withBye], a)).toBe(2.5);
  });

  test("matches the reuse-registry entry", () => {
    const aRow = row(a, [played(1, o1, 0, 0)]);
    expect(tiebreakExprs.get("cumulativeOpposition")).toBeDefined();
    expect(tiebreakExprs.get("modifiedMedian")).toBeDefined();
    expect(run(CUMULATIVE_OPPOSITION, [aRow, o1Row], a)).toBe(5);
  });
});
