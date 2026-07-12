import { type CompetitorId, competitorId } from "../core";
import type { MetricRow, ScoredLineInput } from "../registry";
import type { Expr } from "./ast";
import { evaluate } from "./evaluate";
import type { MetricEvalResult } from "./metric";

/**
 * Run a scoring expression over one scored line, yielding its standings points.
 * Scoring rules are line-local (decision, own points, round, deciding leg), so
 * the evaluation env carries the scoring context and an empty competitor table.
 * `evalScoringResult` is the Result-returning core; `evalScoring` unwraps it by
 * throwing. Builtin scorings are differential-tested against the legacy
 * implementations, so an evaluation error there is a bug in a builtin and
 * throws loudly.
 */

const SCORING_SELF = competitorId("scoring");
const NO_ROWS: ReadonlyMap<CompetitorId, MetricRow> = new Map();

export type ScoringEvalResult = MetricEvalResult;

export function evalScoringResult(
  expr: Expr,
  line: ScoredLineInput,
  round: number,
): ScoringEvalResult {
  const result = evaluate(expr, {
    self: SCORING_SELF,
    all: NO_ROWS,
    attribute: () => undefined,
    tiedGroup: () => [],
    named: () => undefined,
    scoring: { line, round },
  });
  if (!result.ok) {
    return {
      ok: false,
      error: {
        reason: `scoring expression failed: ${JSON.stringify(result.error)}`,
      },
    };
  }
  if (result.value.t !== "num") {
    return {
      ok: false,
      error: {
        reason: `scoring expression must yield a number, got "${result.value.t}"`,
      },
    };
  }
  return { ok: true, value: result.value.v };
}

export function evalScoring(
  expr: Expr,
  line: ScoredLineInput,
  round: number,
): number {
  const result = evalScoringResult(expr, line, round);
  if (!result.ok) throw new Error(result.error.reason);
  return result.value;
}
