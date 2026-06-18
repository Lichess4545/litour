import type { z } from "zod";
import type { CompetitorId } from "@/tournament/core";
import type { Expr } from "@/tournament/expr/ast";
import { evalMetric } from "@/tournament/expr/metric";
import {
  defineMetricKind,
  type MetricKind,
  type MetricRow,
} from "@/tournament/registry";
import { tiebreakExprs } from "./definitions";

/**
 * Turns a named, data-defined tiebreak into a `MetricKind` the registry can
 * hold — the single adapter between the expression engine and the standings
 * pipeline. Every chess tiebreak registers through here, so the system itself
 * stays free of tiebreak code.
 */

/** The legacy head-to-head rule: tied = equal standings points. Phase 4 replaces this with the live ranking partition. */
const equalPointsTied =
  (all: ReadonlyMap<CompetitorId, MetricRow>) =>
  (comp: CompetitorId): readonly CompetitorId[] => {
    const me = all.get(comp);
    if (me === undefined) return [];
    const out: CompetitorId[] = [];
    for (const r of all.values()) {
      if (r.standingsPoints === me.standingsPoints) out.push(r.competitor);
    }
    return out;
  };

export type ExprMetricSpec<R extends { readonly metric: string }> = {
  readonly metric: string;
  readonly schema: z.ZodType<R>;
  readonly label: (ref: R) => string;
  /** The expression to evaluate; may depend on ref parameters (cut, board, …). */
  readonly expr: (ref: R) => Expr;
};

export const exprMetric = <R extends { readonly metric: string }>(
  spec: ExprMetricSpec<R>,
): MetricKind =>
  defineMetricKind<R>({
    metric: spec.metric,
    schema: spec.schema,
    label: spec.label,
    expr: spec.expr,
    value: (ref, row, all, tied) =>
      evalMetric(spec.expr(ref), row, {
        all,
        named: (name) => tiebreakExprs.get(name),
        tiedGroup:
          tied === undefined
            ? equalPointsTied(all)
            : (comp) => (tied.has(comp) ? [...tied] : [comp]),
      }),
  });
