// @vitest-environment node
import { describe, expect, test } from "vitest";
import type { Expr } from "./ast";
import { parseExpr, safeParseExpr } from "./schema";

/**
 * The must-reject corpus for the standalone expr boundary: one case per
 * structurally distinct zod failure, asserted on the issue's PATH (not just
 * `success: false`) so a schema refactor that keeps rejecting but moves the
 * blame to the wrong field would be caught here.
 */
describe("safeParseExpr — must-reject corpus", () => {
  test("unknown op discriminator", () => {
    const result = safeParseExpr({ op: "nope" });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual(["op"]);
  });

  test("missing required field", () => {
    const result = safeParseExpr({ op: "var" });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual(["name"]);
  });

  test("wrong field type", () => {
    const result = safeParseExpr({ op: "var", name: 123 });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual(["name"]);
  });

  test("empty string where .min(1) applies", () => {
    const result = safeParseExpr({ op: "var", name: "" });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual(["name"]);
  });

  test("wrong enum value", () => {
    const result = safeParseExpr({
      op: "lineNum",
      line: { op: "self" },
      field: "notAField",
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual(["field"]);
  });

  test("unknown calc function", () => {
    const result = safeParseExpr({
      op: "calc",
      f: "sqrt",
      a: { op: "lit", value: 1 },
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual(["f"]);
  });

  test("unplayed missing its required line", () => {
    const result = safeParseExpr({ op: "unplayed" });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual(["line"]);
  });

  test("non-object", () => {
    const result = safeParseExpr("just a string");
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual([]);
  });

  test("array instead of object", () => {
    const result = safeParseExpr([{ op: "self" }]);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual([]);
  });
});

/** An untrusted payload nested `count` levels deep, to probe the admission bound. */
function buildDepthBomb(count: number): unknown {
  let deep: unknown = { a: 1 };
  for (let i = 0; i < count; i += 1) deep = { a: deep };
  return deep;
}

describe("safeParseExpr — admission bounds (typed rejection, never a thrown RangeError)", () => {
  test("a depth bomb is rejected with a typed error, not a stack overflow", () => {
    const deep = buildDepthBomb(1000);
    let result: ReturnType<typeof safeParseExpr> | undefined;
    expect(() => {
      result = safeParseExpr(deep);
    }).not.toThrow();
    expect(result?.success).toBe(false);
    if (result?.success !== false) return;
    expect(result.error.issues[0]?.message).toContain("nests deeper");
  });

  test("a node-count bomb is rejected with a typed error, not a stack overflow", () => {
    const wide = { items: Array.from({ length: 60_000 }, (_, i) => i) };
    let result: ReturnType<typeof safeParseExpr> | undefined;
    expect(() => {
      result = safeParseExpr(wide);
    }).not.toThrow();
    expect(result?.success).toBe(false);
    if (result?.success !== false) return;
    expect(result.error.issues[0]?.message).toContain("exceeds");
  });

  test("parseExpr on a depth bomb throws a ZodError (typed), not a RangeError", () => {
    const deep = buildDepthBomb(1000);
    expect(() => parseExpr(deep)).toThrow(/nests deeper/);
  });

  test("accepts a valid expression nested exactly at the depth ceiling", () => {
    const result = safeParseExpr(calcChainOfMaxDepth(200));
    expect(result.success).toBe(true);
  });

  test("rejects a valid expression nested one level past the depth ceiling", () => {
    const result = safeParseExpr(calcChainOfMaxDepth(201));
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.message).toContain("nests deeper");
  });
});

function calcChainOfMaxDepth(maxDepth: number): Expr {
  let expr: Expr = { op: "lit", value: 1 };
  for (let i = 0; i < maxDepth - 1; i += 1) {
    expr = { op: "calc", f: "floor", a: expr };
  }
  return expr;
}

describe("parseExpr / safeParseExpr — valid input", () => {
  const valid: Expr = {
    op: "arith",
    f: "+",
    a: { op: "lit", value: 1 },
    b: { op: "score", of: { op: "self" }, key: "standings" },
  };

  test("round-trips a valid expression", () => {
    expect(parseExpr(valid)).toEqual(valid);
  });

  test("safeParseExpr accepts the same expression", () => {
    const result = safeParseExpr(valid);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual(valid);
  });

  test("round-trips a calc expression", () => {
    const expr: Expr = { op: "calc", f: "floor", a: { op: "lit", value: 1 } };
    expect(parseExpr(expr)).toEqual(expr);
  });

  test("round-trips an unplayed expression", () => {
    const expr: Expr = { op: "unplayed", line: { op: "self" } };
    expect(parseExpr(expr)).toEqual(expr);
  });
});
