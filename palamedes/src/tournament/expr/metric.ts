import type { CompetitorId } from "../core";
import type { MetricRow } from "../registry";
import type { Expr } from "./ast";
import { evaluate } from "./evaluate";

/**
 * Run a metric expression over one standings row, yielding its tiebreak value.
 * Builtin tiebreaks are differential-tested against the legacy implementations,
 * so an evaluation error here is a bug in a builtin — not bad user input — and
 * it throws loudly rather than silently scoring 0. (Organizer-authored metrics,
 * when they arrive, will surface errors through a non-throwing path instead.)
 */

export type MetricEnv = {
  readonly all: ReadonlyMap<CompetitorId, MetricRow>;
  readonly named: (name: string) => Expr | undefined;
  readonly tiedGroup: (comp: CompetitorId) => readonly CompetitorId[];
  readonly attribute?: (comp: CompetitorId, key: string) => number | undefined;
};

export function evalMetric(expr: Expr, row: MetricRow, env: MetricEnv): number {
  const result = evaluate(expr, {
    self: row.competitor,
    all: env.all,
    named: env.named,
    tiedGroup: env.tiedGroup,
    attribute: env.attribute ?? (() => undefined),
  });
  if (!result.ok) {
    throw new Error(
      `metric expression failed: ${JSON.stringify(result.error)}`,
    );
  }
  if (result.value.t !== "num") {
    throw new Error(
      `metric expression must yield a number, got "${result.value.t}"`,
    );
  }
  return result.value.v;
}
