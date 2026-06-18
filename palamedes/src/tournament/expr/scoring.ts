import { type CompetitorId, competitorId } from "../core";
import type { MetricRow, ScoredLineInput } from "../registry";
import type { Expr } from "./ast";
import { evaluate } from "./evaluate";

/**
 * Run a scoring expression over one scored line, yielding its standings points.
 * Scoring rules are line-local (decision, own points, round, deciding leg), so
 * the evaluation env carries the scoring context and an empty competitor table.
 * Builtin scorings are differential-tested against the legacy implementations;
 * an evaluation error here is a bug in a builtin and throws loudly.
 */

const SCORING_SELF = competitorId("scoring");
const NO_ROWS: ReadonlyMap<CompetitorId, MetricRow> = new Map();

export function evalScoring(
  expr: Expr,
  line: ScoredLineInput,
  round: number,
): number {
  const result = evaluate(expr, {
    self: SCORING_SELF,
    all: NO_ROWS,
    attribute: () => undefined,
    tiedGroup: () => [],
    named: () => undefined,
    scoring: { line, round },
  });
  if (!result.ok) {
    throw new Error(
      `scoring expression failed: ${JSON.stringify(result.error)}`,
    );
  }
  if (result.value.t !== "num") {
    throw new Error(
      `scoring expression must yield a number, got "${result.value.t}"`,
    );
  }
  return result.value.v;
}
