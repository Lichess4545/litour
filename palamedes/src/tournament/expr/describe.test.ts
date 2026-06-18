// @vitest-environment node
import { describe, expect, test } from "vitest";
import { buchholz } from "@/chess/tiebreaks/definitions";
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
});
