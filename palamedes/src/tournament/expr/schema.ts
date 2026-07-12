import { z } from "zod";
import type { Expr } from "./ast";

/**
 * The wire schema for `Expr`. Organizer-authored expressions are untrusted
 * input, so nothing reaches the evaluator without passing through here. The
 * recursion is broken with `z.lazy` exactly as the engine breaks its own
 * recursive `encounterSchema` (see `registry.ts`); a closed `op` set means a
 * `discriminatedUnion`, which yields a precise "unknown op" error rather than
 * a soup of union mismatches.
 */
export const exprSchema: z.ZodType<Expr> = z.lazy(() =>
  z.discriminatedUnion("op", [
    z.object({
      op: z.literal("lit"),
      value: z.union([z.number(), z.boolean()]),
    }),
    z.object({ op: z.literal("self") }),
    z.object({ op: z.literal("var"), name: z.string().min(1).max(200) }),
    z.object({ op: z.literal("metric"), name: z.string().min(1).max(200) }),
    z.object({ op: z.literal("opponents"), of: exprSchema }),
    z.object({ op: z.literal("opponent"), line: exprSchema }),
    z.object({
      op: z.literal("lineNum"),
      line: exprSchema,
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
      of: exprSchema,
      key: z.enum(["standings", "encounter"]),
    }),
    z.object({
      op: z.literal("attribute"),
      of: exprSchema,
      key: z.string().min(1).max(200),
    }),
    z.object({ op: z.literal("tiedWith"), of: exprSchema }),
    z.object({
      op: z.literal("member"),
      of: exprSchema,
      container: exprSchema,
    }),
    z.object({ op: z.literal("rounds"), of: exprSchema }),
    z.object({
      op: z.literal("kindIs"),
      line: exprSchema,
      kind: z.enum(["played", "bye", "absent"]),
    }),
    z.object({
      op: z.literal("boardPoint"),
      line: exprSchema,
      board: z.number().int().min(1),
    }),
    z.object({
      op: z.literal("colorIs"),
      line: exprSchema,
      color: z.enum(["white", "black"]),
    }),
    z.object({ op: z.literal("concat"), left: exprSchema, right: exprSchema }),
    z.object({ op: z.literal("linePoints") }),
    z.object({ op: z.literal("round") }),
    z.object({ op: z.literal("legIndex") }),
    z.object({
      op: z.literal("outcome"),
      cases: z.array(
        z.object({
          when: z.enum(["win", "loss", "draw", "doubleLoss", "pending"]),
          result: exprSchema,
        }),
      ),
      otherwise: exprSchema,
    }),
    z.object({
      op: z.literal("map"),
      over: exprSchema,
      as: z.string().min(1).max(200),
      body: exprSchema,
    }),
    z.object({
      op: z.literal("filter"),
      over: exprSchema,
      as: z.string().min(1).max(200),
      pred: exprSchema,
    }),
    z.object({
      op: z.literal("sortBy"),
      over: exprSchema,
      as: z.string().min(1).max(200),
      by: exprSchema,
      dir: z.enum(["asc", "desc"]),
    }),
    z.object({ op: z.literal("take"), over: exprSchema, n: exprSchema }),
    z.object({ op: z.literal("drop"), over: exprSchema, n: exprSchema }),
    z.object({ op: z.literal("sum"), over: exprSchema }),
    z.object({ op: z.literal("count"), over: exprSchema }),
    z.object({ op: z.literal("min"), over: exprSchema }),
    z.object({ op: z.literal("max"), over: exprSchema }),
    z.object({ op: z.literal("avg"), over: exprSchema }),
    z.object({
      op: z.literal("scan"),
      over: exprSchema,
      init: exprSchema,
      item: z.string().min(1).max(200),
      acc: z.string().min(1).max(200),
      body: exprSchema,
    }),
    z.object({
      op: z.literal("arith"),
      f: z.enum(["+", "-", "*", "/"]),
      a: exprSchema,
      b: exprSchema,
    }),
    z.object({
      op: z.literal("cmp"),
      f: z.enum(["<", "<=", "==", ">=", ">"]),
      a: exprSchema,
      b: exprSchema,
    }),
    z.object({ op: z.literal("eq"), a: exprSchema, b: exprSchema }),
    z.object({
      op: z.literal("if"),
      cond: exprSchema,
      whenTrue: exprSchema,
      whenFalse: exprSchema,
    }),
    z.object({
      op: z.literal("match"),
      line: exprSchema,
      cases: z.array(
        z.object({
          when: z.enum(["win", "loss", "draw", "doubleLoss", "pending"]),
          result: exprSchema,
        }),
      ),
      otherwise: exprSchema,
    }),
    z.object({
      op: z.literal("let"),
      bindings: z
        .array(
          z.object({ name: z.string().min(1).max(200), value: exprSchema }),
        )
        .min(1),
      body: exprSchema,
    }),
  ]),
);

// `exprSchema` recurses natively (via `z.lazy`) over whatever shape the
// caller hands it, so a sufficiently deep or wide untrusted payload can
// overflow the stack before a single zod issue is ever raised — the same
// hazard `admitDefData` (`tournament/registry.ts`) exists to close for whole
// event definitions. `exprSchema` used *inside* registry parsing is already
// behind that guard; these two bounds exist for `parseExpr`/`safeParseExpr`
// as standalone entry points, which are not. The caps mirror
// `admitDefData`'s exactly (200 / 50,000): an expression tree is normally far
// shallower than a full definition, but there's no reason to invent a
// second, unexplained ceiling for the same class of attack.
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

/** A schema that fails with the admission reason — typed issues, no throw. */
const refuseSchema = (reason: string): z.ZodType<Expr> =>
  z.custom<Expr>(() => false, { message: reason });

/** Parse and fully validate a standalone expression; throws listing every issue. */
export function parseExpr(data: unknown): Expr {
  const admitted = admitExprData(data);
  if (!admitted.ok) return refuseSchema(admitted.reason).parse(data);
  return exprSchema.parse(admitted.value);
}

/** Like `parseExpr` but returns the issues instead of throwing. */
export function safeParseExpr(data: unknown) {
  const admitted = admitExprData(data);
  if (!admitted.ok) return refuseSchema(admitted.reason).safeParse(data);
  return exprSchema.safeParse(admitted.value);
}
