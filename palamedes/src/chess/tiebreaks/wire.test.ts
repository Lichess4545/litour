// @vitest-environment node
import { describe, expect, test } from "vitest";
import { safeParseEventDef } from "@/chess/registry";
import {
  type CompetitorId,
  competitorId,
  type MetricRef,
} from "@/tournament/core";
import type { Expr } from "@/tournament/expr/ast";
import type { MetricRow } from "@/tournament/registry";
import { exprWireMetric } from "./wire";

const a = competitorId("a");
const b = competitorId("b");

const aRow: MetricRow = {
  competitor: a,
  standingsPoints: 3,
  encounterPoints: 3,
  lines: [
    {
      kind: "played",
      round: 1,
      opponent: b,
      side: 0,
      color: "white",
      outcome: {
        points: [1, 0],
        decision: { kind: "win", winner: 0, by: "points" },
      },
      standingsPoints: 3,
      encounterPoints: 3,
      opponentEncounterPoints: 0,
      gamesWon: 1,
      boardPoints: [],
      unplayed: false,
    },
  ],
};

const bRow: MetricRow = {
  competitor: b,
  standingsPoints: 2,
  encounterPoints: 2,
  lines: [],
};

const all = new Map([
  [a, aRow],
  [b, bRow],
]);

const pointsSquared: MetricRef = {
  metric: "expr",
  label: "points squared",
  expr: {
    op: "arith",
    f: "*",
    a: { op: "score", of: { op: "self" }, key: "standings" },
    b: { op: "score", of: { op: "self" }, key: "standings" },
  },
};

describe("exprWireMetric", () => {
  test("evaluates an inline formula over a hand-built standings row", () => {
    expect(exprWireMetric.value(pointsSquared, aRow, all)).toBe(9);
  });

  test("evaluates an expr that reuses a builtin tiebreak by name", () => {
    const reuseBuchholz: MetricRef = {
      metric: "expr",
      label: "buchholz reuse",
      expr: { op: "metric", name: "buchholz" },
    };
    expect(exprWireMetric.value(reuseBuchholz, aRow, all)).toBe(2);
  });

  test("valueResult reports an unknown var without throwing; value still throws", () => {
    const broken: MetricRef = {
      metric: "expr",
      label: "broken",
      expr: { op: "var", name: "nope" },
    };
    const result = exprWireMetric.valueResult?.(broken, aRow, all);
    expect(result?.ok).toBe(false);
    expect(() => exprWireMetric.value(broken, aRow, all)).toThrow(/nope/);
  });

  test("safeParseEventDef rejects a malformed inline expr at the schema gate", () => {
    const parsed = safeParseEventDef({
      id: "wire-metric-reject",
      name: "Wire metric reject",
      competitors: [
        { id: "a", name: "A" },
        { id: "b", name: "B" },
      ],
      competition: {
        id: "g",
        entries: [1, 2].map((seed) => ({ kind: "registration", seed })),
        run: {
          kind: "pool",
          pairing: { system: "roundRobin", cycles: 1 },
          encounter: { kind: "game", clock: { initial: 300, increment: 2 } },
          score: { kind: "passThrough" },
          tiebreaks: [
            { metric: "expr", label: "bad", expr: { op: "not-a-real-op" } },
          ],
        },
      },
    });
    expect(parsed.success).toBe(false);
  });
});

function calcChainOfMaxDepth(maxDepth: number): Expr {
  let expr: Expr = { op: "lit", value: 1 };
  for (let i = 0; i < maxDepth - 1; i += 1) {
    expr = { op: "calc", f: "floor", a: expr };
  }
  return expr;
}

describe("exprWireMetric.schema — bounded admission at the wire boundary", () => {
  test("rejects an inline expr nested one level past the depth ceiling", () => {
    const ref: MetricRef = {
      metric: "expr",
      label: "too deep",
      expr: calcChainOfMaxDepth(201),
    };
    let result: ReturnType<typeof exprWireMetric.schema.safeParse> | undefined;
    expect(() => {
      result = exprWireMetric.schema.safeParse(ref);
    }).not.toThrow();
    expect(result?.success).toBe(false);
    if (result?.success !== false) return;
    expect(result.error.issues.map((i) => i.message).join("\n")).toContain(
      "nests deeper",
    );
  });

  test("accepts an inline expr nested exactly at the depth ceiling", () => {
    const ref: MetricRef = {
      metric: "expr",
      label: "deep",
      expr: calcChainOfMaxDepth(200),
    };
    expect(exprWireMetric.schema.safeParse(ref).success).toBe(true);
  });

  test("rejects an inline expr exceeding the node ceiling", () => {
    const ref = {
      metric: "expr",
      label: "wide",
      expr: {
        op: "lit",
        value: 1,
        extra: Array.from({ length: 60_000 }, (_, i) => i),
      },
    };
    const result = exprWireMetric.schema.safeParse(ref);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((i) => i.message).join("\n")).toContain(
      "exceeds",
    );
  });

  test("a small valid expr still round-trips through the wire schema unchanged", () => {
    const pointsSquared: MetricRef = {
      metric: "expr",
      label: "points squared",
      expr: {
        op: "arith",
        f: "*",
        a: { op: "score", of: { op: "self" }, key: "standings" },
        b: { op: "score", of: { op: "self" }, key: "standings" },
      },
    };
    expect(exprWireMetric.schema.safeParse(pointsSquared).success).toBe(true);
  });
});

describe("attribute — competitor ratings feed the expr engine", () => {
  const self = competitorId("self");
  const opp1500 = competitorId("opp1500");
  const opp1700 = competitorId("opp1700");
  const opp1900 = competitorId("opp1900");

  const opponentLine = (round: number, opponent: string) => ({
    kind: "played" as const,
    round,
    opponent: competitorId(opponent),
    side: 0 as const,
    color: "white" as const,
    outcome: {
      points: [1, 0] as const,
      decision: {
        kind: "win" as const,
        winner: 0 as const,
        by: "points" as const,
      },
    },
    standingsPoints: 1,
    encounterPoints: 1,
    opponentEncounterPoints: 0,
    gamesWon: 1,
    boardPoints: [],
    unplayed: false,
  });

  const selfRow: MetricRow = {
    competitor: self,
    standingsPoints: 3,
    encounterPoints: 3,
    lines: [
      opponentLine(1, "opp1500"),
      opponentLine(2, "opp1700"),
      opponentLine(3, "opp1900"),
    ],
  };

  const ratedRow = (id: CompetitorId, rating: number): MetricRow => ({
    competitor: id,
    standingsPoints: 0,
    encounterPoints: 0,
    lines: [],
    attributes: new Map([["rating", rating]]),
  });

  const unratedRow = (id: CompetitorId): MetricRow => ({
    competitor: id,
    standingsPoints: 0,
    encounterPoints: 0,
    lines: [],
  });

  const aroExpr: Expr = {
    op: "avg",
    over: {
      op: "map",
      over: { op: "opponents", of: { op: "self" } },
      as: "o",
      body: {
        op: "attribute",
        of: { op: "opponent", line: { op: "var", name: "o" } },
        key: "rating",
      },
    },
  };
  const aroRef: MetricRef = { metric: "expr", label: "aro", expr: aroExpr };

  test("avg of opponents' rating computes the real average once attributes are fed", () => {
    const all = new Map([
      [self, selfRow],
      [opp1500, ratedRow(opp1500, 1500)],
      [opp1700, ratedRow(opp1700, 1700)],
      [opp1900, ratedRow(opp1900, 1900)],
    ]);
    expect(exprWireMetric.valueResult?.(aroRef, selfRow, all)).toEqual({
      ok: true,
      value: 1700,
    });
  });

  test("errors cleanly — never 0 — when opponent rows carry no attributes", () => {
    const all = new Map([
      [self, selfRow],
      [opp1500, unratedRow(opp1500)],
      [opp1700, unratedRow(opp1700)],
      [opp1900, unratedRow(opp1900)],
    ]);
    const result = exprWireMetric.valueResult?.(aroRef, selfRow, all);
    expect(result?.ok).toBe(false);
    // The map over opponents hits opp1500 first (round 1) and short-circuits
    // there — the exact ExprError evaluate.ts's "attribute" case constructs,
    // wrapped in the reason string evalMetricResult reports.
    expect(result?.ok === false ? result.error.reason : undefined).toBe(
      `metric expression failed: ${JSON.stringify({
        kind: "unknownAttribute",
        id: opp1500,
        key: "rating",
      })}`,
    );
  });
});
