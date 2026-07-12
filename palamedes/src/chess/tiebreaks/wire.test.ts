// @vitest-environment node
import { describe, expect, test } from "vitest";
import { safeParseEventDef } from "@/chess/registry";
import { competitorId, type MetricRef } from "@/tournament/core";
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
