import { z } from "zod";
import type { ComputationNode } from "@/tournament/expr/describe";
import { describeExpr } from "@/tournament/expr/describe";
import { boundedExprSchema } from "@/tournament/expr/schema";
import { evalScoring, evalScoringResult } from "@/tournament/expr/scoring";
import {
  defineScoringKind,
  type ScoredLineInput,
  type ScoringKind,
} from "@/tournament/registry";

const exprScoringRef = z.object({
  kind: z.literal("expr"),
  label: z.string().min(1).max(200),
  expr: boundedExprSchema,
});

type ExprScoringRef = z.infer<typeof exprScoringRef>;

// NOTE: exercised at validate time, not materialize time — a bad expr fails
// here instead of surfacing as a thrown error mid-engine-run.
const SMOKE_LINES: readonly {
  readonly tag: string;
  readonly line: ScoredLineInput;
}[] = [
  {
    tag: "win",
    line: {
      side: 0,
      outcome: {
        points: [1, 0],
        decision: { kind: "win", winner: 0, by: "points" },
      },
    },
  },
  {
    tag: "loss",
    line: {
      side: 1,
      outcome: {
        points: [0, 1],
        decision: { kind: "win", winner: 0, by: "points" },
      },
    },
  },
  {
    tag: "draw",
    line: {
      side: 0,
      outcome: { points: [0.5, 0.5], decision: { kind: "draw" } },
    },
  },
  {
    tag: "doubleLoss",
    line: {
      side: 0,
      outcome: { points: [0, 0], decision: { kind: "doubleLoss" } },
    },
  },
  {
    tag: "pending",
    line: {
      side: 0,
      outcome: { points: [0, 0], decision: { kind: "pending" } },
    },
  },
];

const flattenNode = (node: ComputationNode, depth = 0): readonly string[] => [
  `${"  ".repeat(depth)}${node.label}`,
  ...node.children.flatMap((child) => flattenNode(child, depth + 1)),
];

export const exprWireScoring: ScoringKind = defineScoringKind<ExprScoringRef>({
  kind: "expr",
  schema: exprScoringRef,
  points: (rule, line, history) =>
    evalScoring(rule.expr, line, history.length + 1),
  validate: (rule, _encounter, _ops, issue) => {
    for (const { tag, line } of SMOKE_LINES) {
      const result = evalScoringResult(rule.expr, line, 1);
      if (!result.ok) {
        issue(
          `expr scoring "${rule.label}" fails evaluating a ${tag} line: ${result.error.reason}`,
          ["expr"],
        );
      }
    }
  },
  card: (rule) => ({
    title: rule.label,
    lines: flattenNode(describeExpr(rule.expr)),
  }),
});
