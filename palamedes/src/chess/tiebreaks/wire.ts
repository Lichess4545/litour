import { z } from "zod";
import type { CompetitorId } from "@/tournament/core";
import {
  evalMetricResult,
  type MetricEvalResult,
} from "@/tournament/expr/metric";
import { exprSchema } from "@/tournament/expr/schema";
import {
  defineMetricKind,
  type MetricKind,
  type MetricRow,
} from "@/tournament/registry";
import { tiebreakExprs } from "./definitions";
import { equalPointsTied } from "./expr-metric";

const exprMetricRef = z.object({
  metric: z.literal("expr"),
  label: z.string().min(1).max(200),
  expr: exprSchema,
});

type ExprMetricRef = z.infer<typeof exprMetricRef>;

const evalRef = (
  ref: ExprMetricRef,
  row: MetricRow,
  all: ReadonlyMap<CompetitorId, MetricRow>,
  tied: ReadonlySet<CompetitorId> | undefined,
): MetricEvalResult =>
  evalMetricResult(ref.expr, row, {
    all,
    named: (name) => tiebreakExprs.get(name),
    tiedGroup:
      tied === undefined
        ? equalPointsTied(all)
        : (comp) => (tied.has(comp) ? [...tied] : [comp]),
  });

export const exprWireMetric: MetricKind = defineMetricKind<ExprMetricRef>({
  metric: "expr",
  schema: exprMetricRef,
  label: (ref) => ref.label,
  expr: (ref) => ref.expr,
  valueResult: evalRef,
  value: (ref, row, all, tied) => {
    const result = evalRef(ref, row, all, tied);
    if (!result.ok) throw new Error(result.error.reason);
    return result.value;
  },
});
