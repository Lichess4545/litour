// @vitest-environment node
import { describe, expect, test } from "vitest";
import { buchholz } from "@/chess/tiebreaks/definitions";
import type { Expr } from "./ast";
import { type ComputationNode, describeExpr } from "./describe";

describe("describeExpr", () => {
  test("renders Buchholz as a fully-labeled computation tree", () => {
    const tree = describeExpr(buchholz());
    expect(tree.op).toBe("sum");
    expect(tree.label).toBe("sum of");

    const labels: string[] = [];
    const walk = (n: ComputationNode): void => {
      labels.push(n.label);
      for (const child of n.children) walk(child);
    };
    walk(tree);

    // Every node carries a non-empty, human-readable label.
    expect(labels.every((l) => l.length > 0)).toBe(true);
    // The shape of Buchholz is visible in the tree.
    expect(labels).toContain("opponents");
    expect(labels).toContain("score (standings)");
    expect(labels).toContain("combined with");
    expect(labels).toContain("sort asc");
  });

  test("renders calc with the floor label", () => {
    const expr: Expr = { op: "calc", f: "floor", a: { op: "lit", value: 1 } };
    const tree = describeExpr(expr);
    expect(tree.op).toBe("calc");
    expect(tree.label).toBe("round down");
  });

  test("renders unplayed with its label", () => {
    const expr: Expr = { op: "unplayed", line: { op: "self" } };
    const tree = describeExpr(expr);
    expect(tree.op).toBe("unplayed");
    expect(tree.label).toBe("decided without play");
  });
});
