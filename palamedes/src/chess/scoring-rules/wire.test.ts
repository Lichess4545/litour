// @vitest-environment node
import { describe, expect, test } from "vitest";
import { safeParseEventDef } from "@/chess/registry";
import type { ScoreRef } from "@/tournament/core";
import type { Expr } from "@/tournament/expr/ast";
import type { ScoredLineInput } from "@/tournament/registry";
import { exprWireScoring } from "./wire";

const outcomeTable = (draw: Expr): Expr => ({
  op: "outcome",
  cases: [
    { when: "win", result: { op: "lit", value: 3 } },
    { when: "draw", result: draw },
    { when: "loss", result: { op: "lit", value: 0 } },
    { when: "doubleLoss", result: { op: "lit", value: 0 } },
  ],
  otherwise: { op: "lit", value: 0 },
});

const winThreeDrawOne: ScoreRef = {
  kind: "expr",
  label: "win3draw1",
  expr: outcomeTable({ op: "lit", value: 1 }),
};

const wonLine: ScoredLineInput = {
  side: 0,
  outcome: {
    points: [1, 0],
    decision: { kind: "win", winner: 0, by: "points" },
  },
};

describe("exprWireScoring", () => {
  test("a table-equivalent expr scores a won line by its win value", () => {
    expect(exprWireScoring.points(winThreeDrawOne, wonLine, [])).toBe(3);
  });

  test("safeParseEventDef rejects a def whose inline scoring expr errors on a draw line", () => {
    const brokenOnDraw: ScoreRef = {
      kind: "expr",
      label: "broken on draw",
      expr: outcomeTable({ op: "var", name: "nope" }),
    };
    const parsed = safeParseEventDef({
      id: "wire-scoring-reject",
      name: "Wire scoring reject",
      competitors: [
        { id: "a", name: "A" },
        { id: "b", name: "B" },
      ],
      competition: {
        id: "g",
        entries: [1, 2].map((seed) => ({ kind: "registration", seed })),
        run: {
          kind: "pool",
          pairing: { system: "roundRobin", cycles: 1 },
          encounter: { kind: "game", clock: { initial: 300, increment: 2 } },
          score: brokenOnDraw,
          tiebreaks: [],
        },
      },
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const messages = parsed.error.issues.map((i) => i.message).join("\n");
      expect(messages).toContain("draw");
    }
  });

  test("safeParseEventDef rejects a def whose inline scoring expr errors only on doubleLoss", () => {
    const brokenOnDoubleLoss: ScoreRef = {
      kind: "expr",
      label: "broken on double loss",
      expr: {
        op: "outcome",
        cases: [
          { when: "win", result: { op: "lit", value: 3 } },
          { when: "draw", result: { op: "lit", value: 1 } },
          { when: "loss", result: { op: "lit", value: 0 } },
          { when: "doubleLoss", result: { op: "var", name: "nope" } },
        ],
        otherwise: { op: "lit", value: 0 },
      },
    };
    const parsed = safeParseEventDef({
      id: "wire-scoring-reject-double-loss",
      name: "Wire scoring reject double loss",
      competitors: [
        { id: "a", name: "A" },
        { id: "b", name: "B" },
      ],
      competition: {
        id: "g",
        entries: [1, 2].map((seed) => ({ kind: "registration", seed })),
        run: {
          kind: "pool",
          pairing: { system: "roundRobin", cycles: 1 },
          encounter: { kind: "game", clock: { initial: 300, increment: 2 } },
          score: brokenOnDoubleLoss,
          tiebreaks: [],
        },
      },
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const messages = parsed.error.issues.map((i) => i.message).join("\n");
      expect(messages).toContain("doubleLoss");
    }
  });
});

describe("exprWireScoring.card", () => {
  test("titles the card with the rule's label and flattens describeExpr into non-empty, indented lines", () => {
    const card = exprWireScoring.card?.(winThreeDrawOne);
    expect(card?.title).toBe("win3draw1");
    expect(card?.lines.length).toBeGreaterThan(0);
    for (const line of card?.lines ?? [])
      expect(line.length).toBeGreaterThan(0);
    // The root line (the "outcome" node) is unindented; at least one child
    // line (a case's result) is indented under it.
    expect(card?.lines[0]?.startsWith(" ")).toBe(false);
    expect(card?.lines.some((line) => line.startsWith(" "))).toBe(true);
  });
});

function calcChainOfMaxDepth(maxDepth: number): Expr {
  let expr: Expr = { op: "lit", value: 1 };
  for (let i = 0; i < maxDepth - 1; i += 1) {
    expr = { op: "calc", f: "floor", a: expr };
  }
  return expr;
}

describe("exprWireScoring.schema — bounded admission at the wire boundary", () => {
  test("rejects an inline expr nested one level past the depth ceiling", () => {
    const ref: ScoreRef = {
      kind: "expr",
      label: "too deep",
      expr: calcChainOfMaxDepth(201),
    };
    let result: ReturnType<typeof exprWireScoring.schema.safeParse> | undefined;
    expect(() => {
      result = exprWireScoring.schema.safeParse(ref);
    }).not.toThrow();
    expect(result?.success).toBe(false);
    if (result?.success !== false) return;
    expect(result.error.issues.map((i) => i.message).join("\n")).toContain(
      "nests deeper",
    );
  });

  test("accepts an inline expr nested exactly at the depth ceiling", () => {
    const ref: ScoreRef = {
      kind: "expr",
      label: "deep",
      expr: calcChainOfMaxDepth(200),
    };
    expect(exprWireScoring.schema.safeParse(ref).success).toBe(true);
  });

  test("rejects an inline expr exceeding the node ceiling", () => {
    const ref = {
      kind: "expr",
      label: "wide",
      expr: {
        op: "lit",
        value: 1,
        extra: Array.from({ length: 60_000 }, (_, i) => i),
      },
    };
    const result = exprWireScoring.schema.safeParse(ref);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((i) => i.message).join("\n")).toContain(
      "exceeds",
    );
  });

  test("a small valid expr still round-trips through the wire schema unchanged", () => {
    expect(exprWireScoring.schema.safeParse(winThreeDrawOne).success).toBe(
      true,
    );
  });
});
