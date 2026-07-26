import { z } from "zod";
import type { Expr } from "./ast";

/**
 * The recursion is broken with `z.lazy` exactly as the engine breaks its own
 * recursive `encounterSchema` (see `registry.ts`); a closed `op` set means a
 * `discriminatedUnion`, which yields a precise "unknown op" error rather than
 * a soup of union mismatches.
 */
const rawExprSchema: z.ZodType<Expr> = z.lazy(() =>
  z.discriminatedUnion("op", [
    z.object({
      op: z.literal("lit"),
      value: z.union([z.number(), z.boolean()]),
    }),
    z.object({ op: z.literal("self") }),
    z.object({ op: z.literal("var"), name: z.string().min(1).max(200) }),
    z.object({ op: z.literal("metric"), name: z.string().min(1).max(200) }),
    z.object({ op: z.literal("opponents"), of: rawExprSchema }),
    z.object({ op: z.literal("opponent"), line: rawExprSchema }),
    z.object({
      op: z.literal("lineNum"),
      line: rawExprSchema,
      field: z.enum([
        "standingsPoints",
        "encounterPoints",
        "opponentEncounterPoints",
        "gamesWon",
        "round",
      ]),
    }),
    z.object({
      op: z.literal("score"),
      of: rawExprSchema,
      key: z.enum(["standings", "encounter"]),
    }),
    z.object({
      op: z.literal("attribute"),
      of: rawExprSchema,
      key: z.string().min(1).max(200),
    }),
    z.object({ op: z.literal("tiedWith"), of: rawExprSchema }),
    z.object({
      op: z.literal("member"),
      of: rawExprSchema,
      container: rawExprSchema,
    }),
    z.object({ op: z.literal("rounds"), of: rawExprSchema }),
    z.object({
      op: z.literal("kindIs"),
      line: rawExprSchema,
      kind: z.enum(["played", "bye", "absent"]),
    }),
    z.object({ op: z.literal("unplayed"), line: rawExprSchema }),
    z.object({
      op: z.literal("boardPoint"),
      line: rawExprSchema,
      board: z.number().int().min(1),
    }),
    z.object({
      op: z.literal("colorIs"),
      line: rawExprSchema,
      color: z.enum(["white", "black"]),
    }),
    z.object({
      op: z.literal("concat"),
      left: rawExprSchema,
      right: rawExprSchema,
    }),
    z.object({ op: z.literal("linePoints") }),
    z.object({ op: z.literal("round") }),
    z.object({ op: z.literal("legIndex") }),
    z.object({
      op: z.literal("outcome"),
      cases: z.array(
        z.object({
          when: z.enum(["win", "loss", "draw", "doubleLoss", "pending"]),
          result: rawExprSchema,
        }),
      ),
      otherwise: rawExprSchema,
    }),
    z.object({
      op: z.literal("map"),
      over: rawExprSchema,
      as: z.string().min(1).max(200),
      body: rawExprSchema,
    }),
    z.object({
      op: z.literal("filter"),
      over: rawExprSchema,
      as: z.string().min(1).max(200),
      pred: rawExprSchema,
    }),
    z.object({
      op: z.literal("sortBy"),
      over: rawExprSchema,
      as: z.string().min(1).max(200),
      by: rawExprSchema,
      dir: z.enum(["asc", "desc"]),
    }),
    z.object({ op: z.literal("take"), over: rawExprSchema, n: rawExprSchema }),
    z.object({ op: z.literal("drop"), over: rawExprSchema, n: rawExprSchema }),
    z.object({ op: z.literal("sum"), over: rawExprSchema }),
    z.object({ op: z.literal("count"), over: rawExprSchema }),
    z.object({ op: z.literal("min"), over: rawExprSchema }),
    z.object({ op: z.literal("max"), over: rawExprSchema }),
    z.object({ op: z.literal("avg"), over: rawExprSchema }),
    z.object({
      op: z.literal("scan"),
      over: rawExprSchema,
      init: rawExprSchema,
      item: z.string().min(1).max(200),
      acc: z.string().min(1).max(200),
      body: rawExprSchema,
    }),
    z.object({
      op: z.literal("arith"),
      f: z.enum(["+", "-", "*", "/"]),
      a: rawExprSchema,
      b: rawExprSchema,
    }),
    z.object({
      op: z.literal("calc"),
      f: z.enum(["floor", "ceil", "abs", "round"]),
      a: rawExprSchema,
    }),
    z.object({
      op: z.literal("cmp"),
      f: z.enum(["<", "<=", "==", ">=", ">"]),
      a: rawExprSchema,
      b: rawExprSchema,
    }),
    z.object({ op: z.literal("eq"), a: rawExprSchema, b: rawExprSchema }),
    z.object({
      op: z.literal("if"),
      cond: rawExprSchema,
      whenTrue: rawExprSchema,
      whenFalse: rawExprSchema,
    }),
    z.object({
      op: z.literal("match"),
      line: rawExprSchema,
      cases: z.array(
        z.object({
          when: z.enum(["win", "loss", "draw", "doubleLoss", "pending"]),
          result: rawExprSchema,
        }),
      ),
      otherwise: rawExprSchema,
    }),
    z.object({
      op: z.literal("let"),
      bindings: z
        .array(
          z.object({
            name: z.string().min(1).max(200),
            value: rawExprSchema,
          }),
        )
        .min(1),
      body: rawExprSchema,
    }),
  ]),
);

// `rawExprSchema` recurses natively (via `z.lazy`) over whatever shape the
// caller hands it, so a sufficiently deep or wide untrusted payload can
// overflow the stack before a single zod issue is ever raised — the same
// hazard `admitDefData` (`tournament/registry.ts`) exists to close for whole
// event definitions. The caps mirror `admitDefData`'s exactly (200 /
// 50,000): an expression tree is normally far shallower than a full
// definition, but there's no reason to invent a second, unexplained ceiling
// for the same class of attack.
const MAX_EXPR_DEPTH = 200;
const MAX_EXPR_NODES = 50_000;

type Admitted =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly reason: string };

/**
 * Iterative (explicit-stack) depth+node walk over untrusted data, run before
 * zod ever sees it — mirrors `admitDefData`'s shape exactly, including
 * severing aliasing with the caller's object via `structuredClone` so the
 * parsed value can't change underneath a caller holding the original.
 */
function admitExprData(data: unknown): Admitted {
  const stack: { readonly value: unknown; readonly depth: number }[] = [
    { value: data, depth: 0 },
  ];
  let nodes = 0;
  for (let frame = stack.pop(); frame !== undefined; frame = stack.pop()) {
    if (frame.depth > MAX_EXPR_DEPTH) {
      return {
        ok: false,
        reason: `expression nests deeper than ${MAX_EXPR_DEPTH} levels`,
      };
    }
    nodes += 1;
    if (nodes > MAX_EXPR_NODES) {
      return {
        ok: false,
        reason: `expression exceeds ${MAX_EXPR_NODES} nodes`,
      };
    }
    const value = frame.value;
    if (Array.isArray(value)) {
      for (const item of value) {
        stack.push({ value: item, depth: frame.depth + 1 });
      }
    } else if (value !== null && typeof value === "object") {
      for (const item of Object.values(value)) {
        stack.push({ value: item, depth: frame.depth + 1 });
      }
    }
  }
  try {
    return { ok: true, value: structuredClone(data) };
  } catch {
    // Functions, symbols, and other non-data refuse to clone: expressions
    // are PLAIN DATA by contract, so refuse them as data, with a reason.
    return { ok: false, reason: "expression contains non-data values" };
  }
}

export const boundedExprSchema: z.ZodType<Expr> = z
  .unknown()
  .transform((data, ctx): Expr => {
    const admitted = admitExprData(data);
    if (!admitted.ok) {
      ctx.addIssue({ code: "custom", message: admitted.reason });
      return z.NEVER;
    }
    const parsed = rawExprSchema.safeParse(admitted.value);
    if (parsed.success) return parsed.data;
    for (const issue of parsed.error.issues) {
      ctx.addIssue({
        code: "custom",
        message: issue.message,
        path: issue.path,
      });
    }
    return z.NEVER;
  });

/** Parse and fully validate a standalone expression; throws listing every issue. */
export function parseExpr(data: unknown): Expr {
  return boundedExprSchema.parse(data);
}

/** Like `parseExpr` but returns the issues instead of throwing. */
export function safeParseExpr(data: unknown) {
  return boundedExprSchema.safeParse(data);
}
