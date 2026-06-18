import type { Expr } from "./ast";

/**
 * A scoring expression rendered as a labeled tree for the viewer — the
 * "how it's computed" structure you zoom into. No values (the viewer is the
 * static how-it-works view, not a played instance); just the shape of the
 * calculation, each node drillable into its inputs.
 */
export type ComputationNode = {
  readonly label: string;
  readonly op: Expr["op"];
  readonly children: readonly ComputationNode[];
};

const ARITH: Record<"+" | "-" | "*" | "/", string> = {
  "+": "add",
  "-": "subtract",
  "*": "multiply",
  "/": "divide",
};

const node = (
  op: Expr["op"],
  label: string,
  children: readonly ComputationNode[] = [],
): ComputationNode => ({ label, op, children });

/** Turn a scoring expression into a labeled, drillable computation tree. */
export function describeExpr(expr: Expr): ComputationNode {
  const d = describeExpr;
  switch (expr.op) {
    case "lit":
      return node("lit", String(expr.value));
    case "self":
      return node("self", "this competitor");
    case "var":
      return node("var", expr.name);
    case "metric":
      return node("metric", `reuse "${expr.name}"`);
    case "opponents":
      return node("opponents", "opponents", [d(expr.of)]);
    case "opponent":
      return node("opponent", "opponent in", [d(expr.line)]);
    case "rounds":
      return node("rounds", "every round of", [d(expr.of)]);
    case "lineNum":
      return node("lineNum", expr.field, [d(expr.line)]);
    case "score":
      return node("score", `score (${expr.key})`, [d(expr.of)]);
    case "attribute":
      return node("attribute", `attribute "${expr.key}"`, [d(expr.of)]);
    case "tiedWith":
      return node("tiedWith", "competitors tied with", [d(expr.of)]);
    case "member":
      return node("member", "is one of", [d(expr.of), d(expr.container)]);
    case "kindIs":
      return node("kindIs", `round is a ${expr.kind}`, [d(expr.line)]);
    case "colorIs":
      return node("colorIs", `played as ${expr.color}`, [d(expr.line)]);
    case "boardPoint":
      return node("boardPoint", `board ${expr.board} points`, [d(expr.line)]);
    case "concat":
      return node("concat", "combined with", [d(expr.left), d(expr.right)]);
    case "map":
      return node("map", "for each, take", [d(expr.over), d(expr.body)]);
    case "filter":
      return node("filter", "keep where", [d(expr.over), d(expr.pred)]);
    case "sortBy":
      return node("sortBy", `sort ${expr.dir}`, [d(expr.over), d(expr.by)]);
    case "take":
      return node("take", "take", [d(expr.over), d(expr.n)]);
    case "drop":
      return node("drop", "drop", [d(expr.over), d(expr.n)]);
    case "sum":
      return node("sum", "sum of", [d(expr.over)]);
    case "count":
      return node("count", "count of", [d(expr.over)]);
    case "min":
      return node("min", "minimum of", [d(expr.over)]);
    case "max":
      return node("max", "maximum of", [d(expr.over)]);
    case "avg":
      return node("avg", "average of", [d(expr.over)]);
    case "scan":
      return node("scan", "running totals of", [d(expr.over), d(expr.body)]);
    case "arith":
      return node("arith", ARITH[expr.f], [d(expr.a), d(expr.b)]);
    case "cmp":
      return node("cmp", `compare ${expr.f}`, [d(expr.a), d(expr.b)]);
    case "eq":
      return node("eq", "equal?", [d(expr.a), d(expr.b)]);
    case "if":
      return node("if", "if", [
        d(expr.cond),
        node("if", "then", [d(expr.whenTrue)]),
        node("if", "else", [d(expr.whenFalse)]),
      ]);
    case "match":
      return node("match", "by result", [
        d(expr.line),
        ...expr.cases.map((c) =>
          node("match", `when ${c.when}`, [d(c.result)]),
        ),
        node("match", "otherwise", [d(expr.otherwise)]),
      ]);
    case "outcome":
      return node("outcome", "by result", [
        ...expr.cases.map((c) =>
          node("outcome", `when ${c.when}`, [d(c.result)]),
        ),
        node("outcome", "otherwise", [d(expr.otherwise)]),
      ]);
    case "let":
      return node("let", "where", [
        ...expr.bindings.map((b) => node("let", `${b.name} =`, [d(b.value)])),
        d(expr.body),
      ]);
    case "linePoints":
      return node("linePoints", "points scored");
    case "round":
      return node("round", "round number");
    case "legIndex":
      return node("legIndex", "deciding leg");
  }
}
