import type { CompetitorId } from "../core";
import type { MetricRow } from "../registry";
import type { Expr } from "./ast";
import { evaluate } from "./evaluate";

/**
 * Run a metric expression over one standings row, yielding its tiebreak value.
 * `evalMetricResult` is the Result-returning core, for callers (organizer-authored
 * metrics, ranking) that must not crash on a bad expression. `evalMetric` unwraps
 * it by throwing: builtin tiebreaks are differential-tested against the legacy
 * implementations, so an evaluation error there is a bug in a builtin — not bad
 * user input — and it throws loudly rather than silently scoring 0.
 */

export type MetricEnv = {
  readonly all: ReadonlyMap<CompetitorId, MetricRow>;
  readonly named: (name: string) => Expr | undefined;
  readonly tiedGroup: (comp: CompetitorId) => readonly CompetitorId[];
  readonly attribute?: (comp: CompetitorId, key: string) => number | undefined;
};

export type MetricEvalResult =
  | { readonly ok: true; readonly value: number }
  | { readonly ok: false; readonly error: { readonly reason: string } };

export function evalMetricResult(
  expr: Expr,
  row: MetricRow,
  env: MetricEnv,
): MetricEvalResult {
  const result = evaluate(expr, {
    self: row.competitor,
    all: env.all,
    named: env.named,
    tiedGroup: env.tiedGroup,
    attribute: env.attribute ?? (() => undefined),
  });
  if (!result.ok) {
    return {
      ok: false,
      error: {
        reason: `metric expression failed: ${JSON.stringify(result.error)}`,
      },
    };
  }
  if (result.value.t !== "num") {
    return {
      ok: false,
      error: {
        reason: `metric expression must yield a number, got "${result.value.t}"`,
      },
    };
  }
  return { ok: true, value: result.value.v };
}

export function evalMetric(expr: Expr, row: MetricRow, env: MetricEnv): number {
  const result = evalMetricResult(expr, row, env);
  if (!result.ok) throw new Error(result.error.reason);
  return result.value;
}
