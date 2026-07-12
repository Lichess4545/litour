// @vitest-environment node
import { describe, expect, test } from "vitest";
import {
  type CompetitorId,
  competitorId,
  type Outcome,
  type Side,
} from "../core";
import type { MetricRow, PlayedLine } from "../registry";
import type { Env, Expr } from "./ast";
import { evaluate, evaluateTraced } from "./evaluate";

// --- fixture builders -------------------------------------------------------

const pts = (a: number, b: number): readonly [number, number] => [a, b];
const winFor = (winner: Side): Outcome => ({
  points: winner === 0 ? pts(1, 0) : pts(0, 1),
  decision: { kind: "win", winner, by: "points" },
});
const drawn: Outcome = { points: pts(0.5, 0.5), decision: { kind: "draw" } };

const line = (
  opponent: CompetitorId,
  side: Side,
  outcome: Outcome,
  standingsPoints: number,
): PlayedLine => ({
  kind: "played",
  round: 1,
  opponent,
  side,
  color: side === 0 ? "white" : "black",
  outcome,
  standingsPoints,
  encounterPoints: standingsPoints,
  opponentEncounterPoints: 0,
  gamesWon: 0,
  boardPoints: [],
  unplayed: false,
});

const row = (
  competitor: CompetitorId,
  standingsPoints: number,
  lines: readonly PlayedLine[],
): MetricRow => ({
  competitor,
  standingsPoints,
  encounterPoints: standingsPoints,
  lines,
});

const makeEnv = (
  rows: readonly MetricRow[],
  self: CompetitorId,
  extras?: Partial<Pick<Env, "attribute" | "tiedGroup" | "named">>,
): Env => ({
  self,
  all: new Map(rows.map((r) => [r.competitor, r] as const)),
  attribute: extras?.attribute ?? (() => undefined),
  tiedGroup: extras?.tiedGroup ?? (() => []),
  named: extras?.named ?? (() => undefined),
});

const a = competitorId("a");
const b = competitorId("b");
const c = competitorId("c");
const d = competitorId("d");

// A beat B, drew C, lost to D; opponents stand on 3 / 2 / 1.
const standardRows: readonly MetricRow[] = [
  row(a, 1.5, [
    line(b, 0, winFor(0), 1),
    line(c, 0, drawn, 0.5),
    line(d, 0, winFor(1), 0),
  ]),
  row(b, 3, []),
  row(c, 2, []),
  row(d, 1, []),
];

// --- expression fixtures ----------------------------------------------------

const self: Expr = { op: "self" };
const oppScores: Expr = {
  op: "map",
  over: { op: "opponents", of: self },
  as: "o",
  body: {
    op: "score",
    of: { op: "opponent", line: { op: "var", name: "o" } },
    key: "standings",
  },
};

const buchholz: Expr = { op: "sum", over: oppScores };

const buchholzCut1: Expr = {
  op: "sum",
  over: {
    op: "drop",
    over: {
      op: "sortBy",
      over: oppScores,
      as: "x",
      by: { op: "var", name: "x" },
      dir: "asc",
    },
    n: { op: "lit", value: 1 },
  },
};

const oppScore: Expr = {
  op: "score",
  of: { op: "opponent", line: { op: "var", name: "o" } },
  key: "standings",
};
const sonnebornBerger: Expr = {
  op: "sum",
  over: {
    op: "map",
    over: { op: "opponents", of: self },
    as: "o",
    body: {
      op: "match",
      line: { op: "var", name: "o" },
      cases: [
        { when: "win", result: oppScore },
        {
          when: "draw",
          result: {
            op: "arith",
            f: "/",
            a: oppScore,
            b: { op: "lit", value: 2 },
          },
        },
      ],
      otherwise: { op: "lit", value: 0 },
    },
  },
};

const headToHead: Expr = {
  op: "sum",
  over: {
    op: "map",
    over: {
      op: "filter",
      over: { op: "opponents", of: self },
      as: "o",
      pred: {
        op: "member",
        of: { op: "opponent", line: { op: "var", name: "o" } },
        container: { op: "tiedWith", of: self },
      },
    },
    as: "o",
    body: {
      op: "lineNum",
      line: { op: "var", name: "o" },
      field: "standingsPoints",
    },
  },
};

// --- tests ------------------------------------------------------------------

describe("evaluate — real tiebreak shapes", () => {
  test("Buchholz sums every opponent's score (3 + 2 + 1)", () => {
    expect(evaluate(buchholz, makeEnv(standardRows, a))).toEqual({
      ok: true,
      value: { t: "num", v: 6 },
    });
  });

  test("Buchholz cut-1 drops the lowest opponent (2 + 3)", () => {
    expect(evaluate(buchholzCut1, makeEnv(standardRows, a))).toEqual({
      ok: true,
      value: { t: "num", v: 5 },
    });
  });

  test("Sonneborn-Berger weights win full, draw half, loss zero (3 + 1 + 0)", () => {
    expect(evaluate(sonnebornBerger, makeEnv(standardRows, a))).toEqual({
      ok: true,
      value: { t: "num", v: 4 },
    });
  });

  test("head-to-head sums points scored against tied competitors only", () => {
    // A and B are tied; A scored 1 against B and nothing counts vs C/D.
    const env = makeEnv(standardRows, a, { tiedGroup: () => [a, b] });
    expect(evaluate(headToHead, env)).toEqual({
      ok: true,
      value: { t: "num", v: 1 },
    });
  });
});

describe("evaluate — primitives", () => {
  test("count returns list length", () => {
    const expr: Expr = { op: "count", over: { op: "opponents", of: self } };
    expect(evaluate(expr, makeEnv(standardRows, a))).toEqual({
      ok: true,
      value: { t: "num", v: 3 },
    });
  });

  test("let binds a value reusable in its body", () => {
    const expr: Expr = {
      op: "let",
      bindings: [{ name: "x", value: { op: "lit", value: 5 } }],
      body: {
        op: "arith",
        f: "+",
        a: { op: "var", name: "x" },
        b: { op: "var", name: "x" },
      },
    };
    expect(evaluate(expr, makeEnv(standardRows, a))).toEqual({
      ok: true,
      value: { t: "num", v: 10 },
    });
  });

  test("if takes the branch its condition selects", () => {
    const expr: Expr = {
      op: "if",
      cond: {
        op: "cmp",
        f: ">",
        a: { op: "lit", value: 3 },
        b: { op: "lit", value: 2 },
      },
      whenTrue: { op: "lit", value: 10 },
      whenFalse: { op: "lit", value: 20 },
    };
    expect(evaluate(expr, makeEnv(standardRows, a))).toEqual({
      ok: true,
      value: { t: "num", v: 10 },
    });
  });
});

describe("evaluate — typed errors (never throws)", () => {
  test("a type mismatch reports expected vs got", () => {
    const expr: Expr = {
      op: "arith",
      f: "+",
      a: { op: "lit", value: true },
      b: { op: "lit", value: 1 },
    };
    const r = evaluate(expr, makeEnv(standardRows, a));
    if (r.ok) throw new Error("expected a type error");
    expect(r.error).toEqual({
      kind: "type",
      expected: "num",
      got: "bool",
      at: "arith.a",
    });
  });

  test("division by zero is a typed error, not NaN/Infinity", () => {
    const expr: Expr = {
      op: "arith",
      f: "/",
      a: { op: "lit", value: 1 },
      b: { op: "lit", value: 0 },
    };
    const r = evaluate(expr, makeEnv(standardRows, a));
    if (r.ok) throw new Error("expected a divByZero error");
    expect(r.error.kind).toBe("divByZero");
  });

  test("an unbound variable is reported by name", () => {
    const r = evaluate({ op: "var", name: "nope" }, makeEnv(standardRows, a));
    if (r.ok) throw new Error("expected an unknownVar error");
    expect(r.error).toEqual({ kind: "unknownVar", name: "nope" });
  });

  test("reading an unpopulated attribute (the ratings seam) errors cleanly", () => {
    const expr: Expr = { op: "attribute", of: self, key: "rating" };
    const r = evaluate(expr, makeEnv(standardRows, a));
    if (r.ok) throw new Error("expected an unknownAttribute error");
    expect(r.error).toEqual({ kind: "unknownAttribute", id: a, key: "rating" });
  });

  test("min of an empty list is an emptyReduce error, not Infinity", () => {
    const expr: Expr = {
      op: "min",
      over: {
        op: "filter",
        over: { op: "opponents", of: self },
        as: "o",
        pred: { op: "lit", value: false },
      },
    };
    const r = evaluate(expr, makeEnv(standardRows, a));
    if (r.ok) throw new Error("expected an emptyReduce error");
    expect(r.error).toEqual({ kind: "emptyReduce", op: "min" });
  });

  test("the step budget bounds runaway evaluation", () => {
    const r = evaluate(buchholz, makeEnv(standardRows, a), { maxSteps: 1 });
    if (r.ok) throw new Error("expected a budget error");
    expect(r.error).toEqual({ kind: "budget", limit: 1 });
  });
});

describe("evaluateTraced", () => {
  test("captures the computation tree with each op's value", () => {
    const { result, trace } = evaluateTraced(
      buchholz,
      makeEnv(standardRows, a),
    );
    expect(result).toEqual({ ok: true, value: { t: "num", v: 6 } });
    expect(trace?.op).toBe("sum");
    expect(trace?.value).toEqual({ t: "num", v: 6 });
    // sum's input is the map of opponent scores [3, 2, 1].
    const map = trace?.children[0];
    expect(map?.op).toBe("map");
    expect(map?.value).toEqual({
      t: "list",
      v: [
        { t: "num", v: 3 },
        { t: "num", v: 2 },
        { t: "num", v: 1 },
      ],
    });
    // map's children: the `opponents` list, then one `score` body per opponent.
    expect(map?.children[0]?.op).toBe("opponents");
    expect(map?.children.length).toBe(4);
  });
});
