// @vitest-environment node
import { describe, expect, test } from "vitest";
import type { Outcome } from "../core";
import type { ScoredLineInput } from "../registry";
import type { Expr } from "./ast";
import { evalScoring, evalScoringResult } from "./scoring";

const someOutcome: Outcome = {
  points: [1, 0],
  decision: { kind: "win", winner: 0, by: "points" },
};

const someLine: ScoredLineInput = { outcome: someOutcome, side: 0 };

const bad: Expr = { op: "var", name: "no-such-binding" };

describe("evalScoringResult", () => {
  test("returns a typed error instead of throwing on an unknown var", () => {
    const result = evalScoringResult(bad, someLine, 1);
    expect(result.ok).toBe(false);
  });

  test("returns ok:true with the numeric value for a valid expression", () => {
    const expr: Expr = { op: "lit", value: 3 };
    expect(evalScoringResult(expr, someLine, 1)).toEqual({
      ok: true,
      value: 3,
    });
  });
});

describe("evalScoring", () => {
  test("still throws on the same input (builtin contract preserved)", () => {
    expect(() => evalScoring(bad, someLine, 1)).toThrow();
  });

  test("throws the same message evalScoringResult reports as its error reason", () => {
    const result = evalScoringResult(bad, someLine, 1);
    if (result.ok) throw new Error("expected an error result");
    expect(() => evalScoring(bad, someLine, 1)).toThrow(result.error.reason);
    // Literal pin: catches a silent change to the message format itself, not
    // just a mismatch between evalScoring and evalScoringResult.
    expect(() => evalScoring(bad, someLine, 1)).toThrow(
      'scoring expression failed: {"kind":"unknownVar","name":"no-such-binding"}',
    );
  });
});
