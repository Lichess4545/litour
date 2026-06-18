// @vitest-environment node
import fc from "fast-check";
import { describe, expect, test } from "vitest";
import {
  passThroughScoring,
  phasedScoring,
  tableScoring,
} from "@/chess/scorings";
import type { Decision } from "@/tournament/core";
import { evalScoring } from "@/tournament/expr/scoring";
import type { ScoredLine, ScoredLineInput } from "@/tournament/registry";
import {
  PASS_THROUGH,
  type PhasedRule,
  phased,
  type TableRule,
  table,
} from "./definitions";

/**
 * The scoring differential oracle: each data-defined scoring rule must agree
 * with the legacy `points()` over random scored lines, leg indices, round
 * positions, and rule shapes. Points are multiples of 0.5 so `toBe` is exact.
 */

const halfPoints = fc.nat({ max: 12 }).map((x) => x / 2);
const sideArb = fc.constantFrom(0, 1);

const decisionArb: fc.Arbitrary<Decision> = fc.oneof(
  fc
    .record({
      winner: sideArb,
      leg: fc.option(fc.nat({ max: 5 }), { nil: undefined }),
    })
    .map(
      ({ winner, leg }): Decision => ({
        kind: "win",
        winner,
        by: "points",
        leg,
      }),
    ),
  fc.constant<Decision>({ kind: "draw" }),
  fc.constant<Decision>({ kind: "doubleLoss" }),
  fc.constant<Decision>({ kind: "pending" }),
);

const lineArb: fc.Arbitrary<ScoredLineInput> = fc
  .record({
    decision: decisionArb,
    p0: halfPoints,
    p1: halfPoints,
    side: sideArb,
  })
  .map(
    ({ decision, p0, p1, side }): ScoredLineInput => ({
      outcome: { points: [p0, p1], decision },
      side,
    }),
  );

// Only the length of the history matters (it fixes the round number).
const historyArb: fc.Arbitrary<readonly ScoredLine[]> = fc
  .nat({ max: 25 })
  .map((k): readonly ScoredLine[] =>
    Array.from({ length: k }, () => ({
      outcome: { points: [0, 0], decision: { kind: "pending" } },
      side: 0,
      points: 0,
    })),
  );

const tableRuleArb: fc.Arbitrary<TableRule> = fc
  .record({
    draw: halfPoints,
    legs: fc.array(fc.record({ win: halfPoints, loss: halfPoints }), {
      minLength: 1,
      maxLength: 4,
    }),
  })
  .map(({ draw, legs }): TableRule => ({ kind: "table", draw, legs }));

const phasedRuleArb: fc.Arbitrary<PhasedRule> = fc
  .record({
    phases: fc.array(
      fc.record({
        rounds: fc.integer({ min: 1, max: 5 }),
        win: halfPoints,
        draw: halfPoints,
        loss: halfPoints,
      }),
      { minLength: 1, maxLength: 3 },
    ),
  })
  .map(({ phases }): PhasedRule => ({ kind: "phased", phases }));

describe("scoring data == legacy scoring (differential)", () => {
  test("passThrough matches the legacy implementation", () => {
    fc.assert(
      fc.property(lineArb, historyArb, (line, history) => {
        expect(evalScoring(PASS_THROUGH, line, history.length + 1)).toBe(
          passThroughScoring.points({ kind: "passThrough" }, line, history),
        );
      }),
      { numRuns: 300 },
    );
  });

  test("table matches the legacy implementation (incl. leg-keyed)", () => {
    fc.assert(
      fc.property(tableRuleArb, lineArb, historyArb, (rule, line, history) => {
        expect(evalScoring(table(rule), line, history.length + 1)).toBe(
          tableScoring.points(rule, line, history),
        );
      }),
      { numRuns: 400 },
    );
  });

  test("phased matches the legacy implementation across rounds", () => {
    fc.assert(
      fc.property(phasedRuleArb, lineArb, historyArb, (rule, line, history) => {
        expect(evalScoring(phased(rule), line, history.length + 1)).toBe(
          phasedScoring.points(rule, line, history),
        );
      }),
      { numRuns: 400 },
    );
  });
});
