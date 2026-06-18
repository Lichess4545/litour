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
    z.object({ op: z.literal("var"), name: z.string().min(1) }),
    z.object({ op: z.literal("metric"), name: z.string().min(1) }),
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
      key: z.string().min(1),
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
      as: z.string().min(1),
      body: exprSchema,
    }),
    z.object({
      op: z.literal("filter"),
      over: exprSchema,
      as: z.string().min(1),
      pred: exprSchema,
    }),
    z.object({
      op: z.literal("sortBy"),
      over: exprSchema,
      as: z.string().min(1),
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
      item: z.string().min(1),
      acc: z.string().min(1),
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
        .array(z.object({ name: z.string().min(1), value: exprSchema }))
        .min(1),
      body: exprSchema,
    }),
  ]),
);

export const parseExpr = (data: unknown): Expr => exprSchema.parse(data);
export const safeParseExpr = (data: unknown) => exprSchema.safeParse(data);
