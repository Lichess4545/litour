// @vitest-environment node
import { describe, expect, test } from "vitest";
import { competitorId } from "../core";
import type { MetricRow } from "../registry";
import type { Expr } from "./ast";
import { evalMetric, evalMetricResult, type MetricEnv } from "./metric";

const someRow: MetricRow = {
  competitor: competitorId("a"),
  standingsPoints: 1,
  encounterPoints: 1,
  lines: [],
};

const someEnv: MetricEnv = {
  all: new Map([[someRow.competitor, someRow]]),
  named: () => undefined,
  tiedGroup: () => [],
};

const bad: Expr = { op: "var", name: "no-such-binding" };

describe("evalMetricResult", () => {
  test("returns a typed error instead of throwing on an unknown var", () => {
    const result = evalMetricResult(bad, someRow, someEnv);
    expect(result.ok).toBe(false);
  });

  test("returns ok:true with the numeric value for a valid expression", () => {
    const expr: Expr = { op: "lit", value: 7 };
    expect(evalMetricResult(expr, someRow, someEnv)).toEqual({
      ok: true,
      value: 7,
    });
  });
});

describe("evalMetric", () => {
  test("still throws on the same input (builtin contract preserved)", () => {
    expect(() => evalMetric(bad, someRow, someEnv)).toThrow();
  });

  test("throws the same message evalMetricResult reports as its error reason", () => {
    const result = evalMetricResult(bad, someRow, someEnv);
    if (result.ok) throw new Error("expected an error result");
    expect(() => evalMetric(bad, someRow, someEnv)).toThrow(
      result.error.reason,
    );
    // Literal pin: catches a silent change to the message format itself, not
    // just a mismatch between evalMetric and evalMetricResult.
    expect(() => evalMetric(bad, someRow, someEnv)).toThrow(
      'metric expression failed: {"kind":"unknownVar","name":"no-such-binding"}',
    );
  });
});
