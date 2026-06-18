// @vitest-environment node
import fc from "fast-check";
import { describe, expect, test } from "vitest";
import {
  boardPointsMetric,
  buchholzMetric,
  encounterPointsMetric,
  extendedSBMetric,
  gamesWonMetric,
  headToHeadMetric,
  matchWinsMetric,
  sonnebornBergerMetric,
} from "@/chess/metrics";
import {
  type CompetitorId,
  competitorId,
  type Decision,
  type MetricRef,
  otherSide,
  type Side,
} from "@/tournament/core";
import type { Expr } from "@/tournament/expr/ast";
import { evalMetric } from "@/tournament/expr/metric";
import type { MetricKind, MetricRow, RoundLine } from "@/tournament/registry";
import {
  boardPoints,
  buchholz,
  ENCOUNTER_POINTS,
  extendedSB,
  GAMES_WON,
  HEAD_TO_HEAD,
  MATCH_WINS,
  SONNEBORN_BERGER,
  tiebreakExprs,
} from "./definitions";

/**
 * The differential oracle: every data-defined tiebreak must agree with the
 * legacy hand-written metric on every competitor of every random tournament —
 * byes, absences, and unresolvable ("ghost") opponents included, because those
 * are exactly where the line-handling conventions differ. Points are multiples
 * of 0.5 so float sums stay exact and `toBe` is safe.
 */

type LineSpec = {
  readonly kind: "played" | "bye" | "absent";
  readonly opp: number; // index into the field, or -1 for an unresolvable opponent
  readonly side: Side;
  readonly result: "winMe" | "winOpp" | "draw";
  readonly sp: number;
  readonly ep: number;
  readonly oppEnc: number;
  readonly gw: number;
  readonly boards: readonly number[];
};

const halfPoints = fc.nat({ max: 12 }).map((x) => x / 2);

const lineSpecArb = (n: number): fc.Arbitrary<LineSpec> =>
  fc.record({
    kind: fc.constantFrom("played", "bye", "absent"),
    opp: fc.oneof(fc.nat({ max: n - 1 }), fc.constant(-1)),
    side: fc.constantFrom(0, 1),
    result: fc.constantFrom("winMe", "winOpp", "draw"),
    sp: halfPoints,
    ep: halfPoints,
    oppEnc: halfPoints,
    gw: fc.nat({ max: 4 }),
    boards: fc.array(halfPoints, { maxLength: 3 }),
  });

const buildLine = (
  spec: LineSpec,
  ids: readonly CompetitorId[],
  selfIdx: number,
): RoundLine | undefined => {
  if (spec.kind === "absent") return { kind: "absent", round: 1 };
  if (spec.kind === "bye") {
    return {
      kind: "bye",
      round: 1,
      standingsPoints: spec.sp,
      encounterPoints: spec.ep,
    };
  }
  if (spec.opp === selfIdx) return undefined; // no self-play
  const opponent = spec.opp === -1 ? competitorId("ghost") : ids[spec.opp];
  if (opponent === undefined) return undefined;
  const decision: Decision =
    spec.result === "draw"
      ? { kind: "draw" }
      : {
          kind: "win",
          winner: spec.result === "winMe" ? spec.side : otherSide(spec.side),
          by: "points",
        };
  const line: RoundLine = {
    kind: "played",
    round: 1,
    opponent,
    side: spec.side,
    color: spec.side === 0 ? "white" : "black",
    outcome: { points: [1, 0], decision },
    standingsPoints: spec.sp,
    encounterPoints: spec.ep,
    opponentEncounterPoints: spec.oppEnc,
    gamesWon: spec.gw,
    boardPoints: spec.boards,
    unplayed: false,
  };
  return line;
};

const rowsArb: fc.Arbitrary<readonly MetricRow[]> = fc
  .integer({ min: 2, max: 5 })
  .chain((n) =>
    fc
      .array(
        fc.record({
          sp: halfPoints,
          ep: halfPoints,
          lines: fc.array(lineSpecArb(n), { maxLength: n + 2 }),
        }),
        { minLength: n, maxLength: n },
      )
      .map((specs) => {
        const ids = specs.map((_, i) => competitorId(`c${i}`));
        return specs.map((spec, i): MetricRow => {
          const id = ids[i];
          if (id === undefined) throw new Error("unreachable: row in range");
          const lines = spec.lines
            .map((ls) => buildLine(ls, ids, i))
            .filter((l): l is RoundLine => l !== undefined);
          return {
            competitor: id,
            standingsPoints: spec.sp,
            encounterPoints: spec.ep,
            lines,
          };
        });
      }),
  );

const toMap = (
  rows: readonly MetricRow[],
): ReadonlyMap<CompetitorId, MetricRow> =>
  new Map(rows.map((r) => [r.competitor, r] as const));

const named = (name: string) => tiebreakExprs.get(name);
const equalPointsTied =
  (all: ReadonlyMap<CompetitorId, MetricRow>) =>
  (comp: CompetitorId): readonly CompetitorId[] => {
    const me = all.get(comp);
    if (me === undefined) return [];
    return [...all.values()]
      .filter((r) => r.standingsPoints === me.standingsPoints)
      .map((r) => r.competitor);
  };

type Case = {
  readonly label: string;
  readonly expr: Expr;
  readonly metric: MetricKind;
  readonly ref: MetricRef;
};

const cases: readonly Case[] = [
  {
    label: "encounterPoints",
    expr: ENCOUNTER_POINTS,
    metric: encounterPointsMetric,
    ref: { metric: "encounterPoints" },
  },
  {
    label: "gamesWon",
    expr: GAMES_WON,
    metric: gamesWonMetric,
    ref: { metric: "gamesWon" },
  },
  {
    label: "matchWins",
    expr: MATCH_WINS,
    metric: matchWinsMetric,
    ref: { metric: "matchWins" },
  },
  {
    label: "sonnebornBerger",
    expr: SONNEBORN_BERGER,
    metric: sonnebornBergerMetric,
    ref: { metric: "sonnebornBerger" },
  },
  {
    label: "buchholz",
    expr: buchholz(),
    metric: buchholzMetric,
    ref: { metric: "buchholz" },
  },
  {
    label: "buchholz-cut1",
    expr: buchholz(1),
    metric: buchholzMetric,
    ref: { metric: "buchholz", cut: 1 },
  },
  {
    label: "extendedSB-mm",
    expr: extendedSB("standings", "standings"),
    metric: extendedSBMetric,
    ref: {
      metric: "extendedSB",
      opponentTotal: "standings",
      scored: "standings",
    },
  },
  {
    label: "extendedSB-mg",
    expr: extendedSB("standings", "encounter"),
    metric: extendedSBMetric,
    ref: {
      metric: "extendedSB",
      opponentTotal: "standings",
      scored: "encounter",
    },
  },
  {
    label: "extendedSB-gm",
    expr: extendedSB("encounter", "standings"),
    metric: extendedSBMetric,
    ref: {
      metric: "extendedSB",
      opponentTotal: "encounter",
      scored: "standings",
    },
  },
  {
    label: "extendedSB-gg",
    expr: extendedSB("encounter", "encounter"),
    metric: extendedSBMetric,
    ref: {
      metric: "extendedSB",
      opponentTotal: "encounter",
      scored: "encounter",
    },
  },
  {
    label: "headToHead",
    expr: HEAD_TO_HEAD,
    metric: headToHeadMetric,
    ref: { metric: "headToHead" },
  },
  {
    label: "boardPoints-1",
    expr: boardPoints(1),
    metric: boardPointsMetric,
    ref: { metric: "boardPoints", board: 1 },
  },
  {
    label: "boardPoints-2",
    expr: boardPoints(2),
    metric: boardPointsMetric,
    ref: { metric: "boardPoints", board: 2 },
  },
];

describe("tiebreak data == legacy metric (differential)", () => {
  for (const { label, expr, metric, ref } of cases) {
    test(`${label} matches the legacy implementation over random tournaments`, () => {
      fc.assert(
        fc.property(rowsArb, (rows) => {
          const all = toMap(rows);
          const tiedGroup = equalPointsTied(all);
          for (const row of rows) {
            const fromData = evalMetric(expr, row, { all, named, tiedGroup });
            const fromCode = metric.value(ref, row, all);
            expect(fromData).toBe(fromCode);
          }
        }),
        { numRuns: 300 },
      );
    });
  }
});
