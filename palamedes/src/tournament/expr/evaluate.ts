import type { CompetitorId, Outcome, Side } from "../core";
import type { PlayedLine, RoundLine } from "../registry";
import type {
  ArithOp,
  CalcOp,
  CmpOp,
  DecisionTag,
  Env,
  EvalResult,
  Expr,
  ExprError,
  LineField,
  Scope,
  Value,
} from "./ast";

/**
 * Evaluate an expression to a value, or to a typed error. Total: it never
 * throws on parsed input — the `op` switch is exhaustive, so every
 * schema-validated `Expr` hits a handled case and failures come back as
 * `ExprError` values. Because expressions are untrusted, a step budget bounds
 * work — runaway reuse (a metric referencing itself) stops with a `budget`
 * error rather than hanging. The same recursive walk can later carry a value
 * trace for the visualizer; this version returns only the result.
 */

const DEFAULT_MAX_STEPS = 100_000;

type Budget = {
  steps: number;
  readonly limit: number;
  readonly trace?: TraceState;
};

/** A node of the computation tree the viewer renders: an op, its value, its inputs. */
export type TraceNode = {
  readonly op: Expr["op"];
  value: Value | undefined;
  readonly children: TraceNode[];
};

type TraceState = { readonly stack: TraceNode[]; root?: TraceNode };

const EMPTY_SCOPE: Scope = new Map();

const ok = (value: Value): EvalResult => ({ ok: true, value });
const fail = (error: ExprError): EvalResult => ({ ok: false, error });

const num = (v: number): Value => ({ t: "num", v });
const bool = (v: boolean): Value => ({ t: "bool", v });
const listVal = (v: readonly Value[]): Value => ({ t: "list", v });

export function evaluate(
  expr: Expr,
  env: Env,
  options?: { readonly maxSteps?: number; readonly scope?: Scope },
): EvalResult {
  const limit = options?.maxSteps ?? DEFAULT_MAX_STEPS;
  return ev(expr, env, options?.scope ?? EMPTY_SCOPE, { steps: limit, limit });
}

/**
 * Evaluate, and also return the computation tree — every op with its resulting
 * value and its inputs — for the viewer to render as a drillable graph. Off the
 * hot path: plain `evaluate` carries no trace overhead.
 */
export function evaluateTraced(
  expr: Expr,
  env: Env,
  options?: { readonly maxSteps?: number },
): { readonly result: EvalResult; readonly trace: TraceNode | undefined } {
  const limit = options?.maxSteps ?? DEFAULT_MAX_STEPS;
  const trace: TraceState = { stack: [] };
  const result = ev(expr, env, EMPTY_SCOPE, { steps: limit, limit, trace });
  return { result, trace: trace.root };
}

// ---------------------------------------------------------------------------
// Narrowing helpers: evaluate a sub-expression and require a specific tag.

type Narrow<T> =
  | { readonly ok: true; readonly v: T }
  | { readonly ok: false; readonly error: ExprError };

const typeError = (
  expected: Value["t"],
  got: Value["t"],
  at: string,
): ExprError => ({
  kind: "type",
  expected,
  got,
  at,
});

const asNum = (value: Value, at: string): Narrow<number> =>
  value.t === "num"
    ? { ok: true, v: value.v }
    : { ok: false, error: typeError("num", value.t, at) };
const asBool = (value: Value, at: string): Narrow<boolean> =>
  value.t === "bool"
    ? { ok: true, v: value.v }
    : { ok: false, error: typeError("bool", value.t, at) };
const asList = (value: Value, at: string): Narrow<readonly Value[]> =>
  value.t === "list"
    ? { ok: true, v: value.v }
    : { ok: false, error: typeError("list", value.t, at) };
const asComp = (value: Value, at: string): Narrow<CompetitorId> =>
  value.t === "comp"
    ? { ok: true, v: value.v }
    : { ok: false, error: typeError("comp", value.t, at) };
const asLine = (value: Value, at: string): Narrow<RoundLine> =>
  value.t === "line"
    ? { ok: true, v: value.v }
    : { ok: false, error: typeError("line", value.t, at) };

const evNum = (
  e: Expr,
  env: Env,
  scope: Scope,
  budget: Budget,
  at: string,
): Narrow<number> => {
  const r = ev(e, env, scope, budget);
  return r.ok ? asNum(r.value, at) : r;
};
const evBool = (
  e: Expr,
  env: Env,
  scope: Scope,
  budget: Budget,
  at: string,
): Narrow<boolean> => {
  const r = ev(e, env, scope, budget);
  return r.ok ? asBool(r.value, at) : r;
};
const evList = (
  e: Expr,
  env: Env,
  scope: Scope,
  budget: Budget,
  at: string,
): Narrow<readonly Value[]> => {
  const r = ev(e, env, scope, budget);
  return r.ok ? asList(r.value, at) : r;
};
const evComp = (
  e: Expr,
  env: Env,
  scope: Scope,
  budget: Budget,
  at: string,
): Narrow<CompetitorId> => {
  const r = ev(e, env, scope, budget);
  return r.ok ? asComp(r.value, at) : r;
};
const evLine = (
  e: Expr,
  env: Env,
  scope: Scope,
  budget: Budget,
  at: string,
): Narrow<RoundLine> => {
  const r = ev(e, env, scope, budget);
  return r.ok ? asLine(r.value, at) : r;
};

/** A list whose every element is a number (for sum/min/max/avg). */
const evNumList = (
  e: Expr,
  env: Env,
  scope: Scope,
  budget: Budget,
  at: string,
): Narrow<readonly number[]> => {
  const r = evList(e, env, scope, budget, at);
  if (!r.ok) return r;
  const out: number[] = [];
  for (const el of r.v) {
    if (el.t !== "num") return { ok: false, error: typeError("num", el.t, at) };
    out.push(el.v);
  }
  return { ok: true, v: out };
};

// ---------------------------------------------------------------------------
// Pure leaves

const bind = (scope: Scope, name: string, value: Value): Scope => {
  const next = new Map(scope);
  next.set(name, value);
  return next;
};

const requirePlayed = (line: RoundLine, at: string): Narrow<PlayedLine> =>
  line.kind === "played"
    ? { ok: true, v: line }
    : { ok: false, error: { kind: "notPlayed", at } };

/** Read a numeric field off a round line, honoring which fields each kind has. */
const lineFieldOf = (
  line: RoundLine,
  field: LineField,
  at: string,
): Narrow<number> => {
  if (field === "round") return { ok: true, v: line.round };
  if (line.kind === "absent")
    return { ok: false, error: { kind: "notPlayed", at } };
  if (field === "standingsPoints") return { ok: true, v: line.standingsPoints };
  if (field === "encounterPoints") return { ok: true, v: line.encounterPoints };
  if (line.kind !== "played")
    return { ok: false, error: { kind: "notPlayed", at } };
  return {
    ok: true,
    v:
      field === "opponentEncounterPoints"
        ? line.opponentEncounterPoints
        : line.gamesWon,
  };
};

const applyArith = (f: ArithOp, a: number, b: number): number => {
  switch (f) {
    case "+":
      return a + b;
    case "-":
      return a - b;
    case "*":
      return a * b;
    case "/":
      return a / b;
  }
};

const applyCalc = (f: CalcOp, a: number): number => {
  switch (f) {
    case "floor":
      return Math.floor(a);
    case "ceil":
      return Math.ceil(a);
    case "abs":
      return Math.abs(a);
    case "round":
      return Math.round(a);
  }
};

const applyCmp = (f: CmpOp, a: number, b: number): boolean => {
  switch (f) {
    case "<":
      return a < b;
    case "<=":
      return a <= b;
    case "==":
      return a === b;
    case ">=":
      return a >= b;
    case ">":
      return a > b;
  }
};

const valuesEqual = (a: Value, b: Value): boolean => {
  if (a.t === "num" && b.t === "num") return a.v === b.v;
  if (a.t === "bool" && b.t === "bool") return a.v === b.v;
  if (a.t === "comp" && b.t === "comp") return a.v === b.v;
  return false;
};

/** A played line's result from the competitor's own perspective. */
const decisionTag = (line: {
  readonly outcome: Outcome;
  readonly side: Side;
}): DecisionTag => {
  const d = line.outcome.decision;
  switch (d.kind) {
    case "pending":
      return "pending";
    case "draw":
      return "draw";
    case "doubleLoss":
      return "doubleLoss";
    case "win":
      return d.winner === line.side ? "win" : "loss";
  }
};

// ---------------------------------------------------------------------------
// The recursive worker

function ev(expr: Expr, env: Env, scope: Scope, budget: Budget): EvalResult {
  if (budget.steps <= 0) return fail({ kind: "budget", limit: budget.limit });
  budget.steps -= 1;
  const trace = budget.trace;
  if (trace === undefined) return evalOp(expr, env, scope, budget);
  // Tracing: link a node for this op under its parent, recurse, then record
  // the value. Every recursive `ev` flows through here, so the whole tree is
  // captured without touching a single case below.
  const node: TraceNode = { op: expr.op, value: undefined, children: [] };
  const parent = trace.stack[trace.stack.length - 1];
  if (parent === undefined) trace.root = node;
  else parent.children.push(node);
  trace.stack.push(node);
  const result = evalOp(expr, env, scope, budget);
  node.value = result.ok ? result.value : undefined;
  trace.stack.pop();
  return result;
}

function evalOp(
  expr: Expr,
  env: Env,
  scope: Scope,
  budget: Budget,
): EvalResult {
  switch (expr.op) {
    case "lit":
      return ok(
        typeof expr.value === "number" ? num(expr.value) : bool(expr.value),
      );

    case "self":
      return ok({ t: "comp", v: env.self });

    case "var": {
      const v = scope.get(expr.name);
      return v === undefined
        ? fail({ kind: "unknownVar", name: expr.name })
        : ok(v);
    }

    case "metric": {
      const e = env.named(expr.name);
      return e === undefined
        ? fail({ kind: "unknownMetric", name: expr.name })
        : ev(e, env, EMPTY_SCOPE, budget);
    }

    case "opponents": {
      const c = evComp(expr.of, env, scope, budget, "opponents.of");
      if (!c.ok) return c;
      const row = env.all.get(c.v);
      const lines =
        row === undefined
          ? []
          : row.lines.filter(
              (l): l is PlayedLine =>
                l.kind === "played" && env.all.has(l.opponent),
            );
      return ok(listVal(lines.map((l): Value => ({ t: "line", v: l }))));
    }

    case "opponent": {
      const l = evLine(expr.line, env, scope, budget, "opponent.line");
      if (!l.ok) return l;
      const p = requirePlayed(l.v, "opponent.line");
      return p.ok ? ok({ t: "comp", v: p.v.opponent }) : p;
    }

    case "lineNum": {
      const l = evLine(expr.line, env, scope, budget, "lineNum.line");
      if (!l.ok) return l;
      const n = lineFieldOf(l.v, expr.field, "lineNum.line");
      return n.ok ? ok(num(n.v)) : n;
    }

    case "rounds": {
      const c = evComp(expr.of, env, scope, budget, "rounds.of");
      if (!c.ok) return c;
      const row = env.all.get(c.v);
      const lines = row === undefined ? [] : row.lines;
      return ok(listVal(lines.map((l): Value => ({ t: "line", v: l }))));
    }

    case "kindIs": {
      const l = evLine(expr.line, env, scope, budget, "kindIs.line");
      return l.ok ? ok(bool(l.v.kind === expr.kind)) : l;
    }

    case "unplayed": {
      const l = evLine(expr.line, env, scope, budget, "unplayed.line");
      return l.ok ? ok(bool(l.v.kind === "played" && l.v.unplayed)) : l;
    }

    case "boardPoint": {
      const l = evLine(expr.line, env, scope, budget, "boardPoint.line");
      if (!l.ok) return l;
      const p = requirePlayed(l.v, "boardPoint.line");
      if (!p.ok) return p;
      return ok(num(p.v.boardPoints[expr.board - 1] ?? 0));
    }

    case "colorIs": {
      const l = evLine(expr.line, env, scope, budget, "colorIs.line");
      if (!l.ok) return l;
      return ok(bool(l.v.kind === "played" && l.v.color === expr.color));
    }

    case "concat": {
      const left = evList(expr.left, env, scope, budget, "concat.left");
      if (!left.ok) return left;
      const right = evList(expr.right, env, scope, budget, "concat.right");
      if (!right.ok) return right;
      return ok(listVal([...left.v, ...right.v]));
    }

    case "linePoints": {
      const s = env.scoring;
      if (s === undefined)
        return fail({ kind: "noScoringContext", op: "linePoints" });
      return ok(num(s.line.outcome.points[s.line.side] ?? 0));
    }

    case "round": {
      const s = env.scoring;
      if (s === undefined)
        return fail({ kind: "noScoringContext", op: "round" });
      return ok(num(s.round));
    }

    case "legIndex": {
      const s = env.scoring;
      if (s === undefined)
        return fail({ kind: "noScoringContext", op: "legIndex" });
      const d = s.line.outcome.decision;
      return ok(num(d.kind === "win" ? (d.leg ?? 0) : 0));
    }

    case "outcome": {
      const s = env.scoring;
      if (s === undefined)
        return fail({ kind: "noScoringContext", op: "outcome" });
      const tag = decisionTag(s.line);
      const chosen = expr.cases.find((c) => c.when === tag);
      return ev(
        chosen === undefined ? expr.otherwise : chosen.result,
        env,
        scope,
        budget,
      );
    }

    case "eq": {
      const a = ev(expr.a, env, scope, budget);
      if (!a.ok) return a;
      const b = ev(expr.b, env, scope, budget);
      if (!b.ok) return b;
      return ok(bool(valuesEqual(a.value, b.value)));
    }

    case "score": {
      const c = evComp(expr.of, env, scope, budget, "score.of");
      if (!c.ok) return c;
      const row = env.all.get(c.v);
      if (row === undefined)
        return fail({ kind: "unknownCompetitor", id: c.v });
      return ok(
        num(
          expr.key === "standings" ? row.standingsPoints : row.encounterPoints,
        ),
      );
    }

    case "attribute": {
      const c = evComp(expr.of, env, scope, budget, "attribute.of");
      if (!c.ok) return c;
      const a = env.attribute(c.v, expr.key);
      return a === undefined
        ? fail({ kind: "unknownAttribute", id: c.v, key: expr.key })
        : ok(num(a));
    }

    case "tiedWith": {
      const c = evComp(expr.of, env, scope, budget, "tiedWith.of");
      if (!c.ok) return c;
      return ok(
        listVal(env.tiedGroup(c.v).map((id): Value => ({ t: "comp", v: id }))),
      );
    }

    case "member": {
      const o = ev(expr.of, env, scope, budget);
      if (!o.ok) return o;
      const c = evList(expr.container, env, scope, budget, "member.container");
      if (!c.ok) return c;
      return ok(bool(c.v.some((el) => valuesEqual(o.value, el))));
    }

    case "map": {
      const over = evList(expr.over, env, scope, budget, "map.over");
      if (!over.ok) return over;
      const out: Value[] = [];
      for (const item of over.v) {
        const r = ev(expr.body, env, bind(scope, expr.as, item), budget);
        if (!r.ok) return r;
        out.push(r.value);
      }
      return ok(listVal(out));
    }

    case "filter": {
      const over = evList(expr.over, env, scope, budget, "filter.over");
      if (!over.ok) return over;
      const out: Value[] = [];
      for (const item of over.v) {
        const p = evBool(
          expr.pred,
          env,
          bind(scope, expr.as, item),
          budget,
          "filter.pred",
        );
        if (!p.ok) return p;
        if (p.v) out.push(item);
      }
      return ok(listVal(out));
    }

    case "sortBy": {
      const over = evList(expr.over, env, scope, budget, "sortBy.over");
      if (!over.ok) return over;
      const keyed: { item: Value; key: number }[] = [];
      for (const item of over.v) {
        const k = evNum(
          expr.by,
          env,
          bind(scope, expr.as, item),
          budget,
          "sortBy.by",
        );
        if (!k.ok) return k;
        keyed.push({ item, key: k.v });
      }
      keyed.sort((x, y) =>
        expr.dir === "asc" ? x.key - y.key : y.key - x.key,
      );
      return ok(listVal(keyed.map((p) => p.item)));
    }

    case "take":
    case "drop": {
      const over = evList(expr.over, env, scope, budget, `${expr.op}.over`);
      if (!over.ok) return over;
      const n = evNum(expr.n, env, scope, budget, `${expr.op}.n`);
      if (!n.ok) return n;
      if (!Number.isInteger(n.v) || n.v < 0)
        return fail({ kind: "badCount", op: expr.op, n: n.v });
      return ok(
        listVal(expr.op === "take" ? over.v.slice(0, n.v) : over.v.slice(n.v)),
      );
    }

    case "sum": {
      const xs = evNumList(expr.over, env, scope, budget, "sum");
      return xs.ok ? ok(num(xs.v.reduce((s, x) => s + x, 0))) : xs;
    }

    case "count": {
      const xs = evList(expr.over, env, scope, budget, "count.over");
      return xs.ok ? ok(num(xs.v.length)) : xs;
    }

    case "min":
    case "max":
    case "avg": {
      const xs = evNumList(expr.over, env, scope, budget, expr.op);
      if (!xs.ok) return xs;
      if (xs.v.length === 0) return fail({ kind: "emptyReduce", op: expr.op });
      if (expr.op === "avg")
        return ok(num(xs.v.reduce((s, x) => s + x, 0) / xs.v.length));
      const reducer = expr.op === "min" ? Math.min : Math.max;
      return ok(num(xs.v.reduce((acc, x) => reducer(acc, x))));
    }

    case "scan": {
      const over = evList(expr.over, env, scope, budget, "scan.over");
      if (!over.ok) return over;
      const seed = ev(expr.init, env, scope, budget);
      if (!seed.ok) return seed;
      let acc = seed.value;
      const out: Value[] = [];
      for (const item of over.v) {
        const next = ev(
          expr.body,
          env,
          bind(bind(scope, expr.item, item), expr.acc, acc),
          budget,
        );
        if (!next.ok) return next;
        acc = next.value;
        out.push(acc);
      }
      return ok(listVal(out));
    }

    case "arith": {
      const a = evNum(expr.a, env, scope, budget, "arith.a");
      if (!a.ok) return a;
      const b = evNum(expr.b, env, scope, budget, "arith.b");
      if (!b.ok) return b;
      if (expr.f === "/" && b.v === 0) return fail({ kind: "divByZero" });
      return ok(num(applyArith(expr.f, a.v, b.v)));
    }

    case "calc": {
      const a = evNum(expr.a, env, scope, budget, "calc.a");
      return a.ok ? ok(num(applyCalc(expr.f, a.v))) : a;
    }

    case "cmp": {
      const a = evNum(expr.a, env, scope, budget, "cmp.a");
      if (!a.ok) return a;
      const b = evNum(expr.b, env, scope, budget, "cmp.b");
      if (!b.ok) return b;
      return ok(bool(applyCmp(expr.f, a.v, b.v)));
    }

    case "if": {
      const c = evBool(expr.cond, env, scope, budget, "if.cond");
      if (!c.ok) return c;
      return ev(c.v ? expr.whenTrue : expr.whenFalse, env, scope, budget);
    }

    case "match": {
      const l = evLine(expr.line, env, scope, budget, "match.line");
      if (!l.ok) return l;
      const p = requirePlayed(l.v, "match.line");
      if (!p.ok) return p;
      const tag = decisionTag(p.v);
      const chosen = expr.cases.find((c) => c.when === tag);
      return ev(
        chosen === undefined ? expr.otherwise : chosen.result,
        env,
        scope,
        budget,
      );
    }

    case "let": {
      let s = scope;
      for (const b of expr.bindings) {
        const r = ev(b.value, env, s, budget);
        if (!r.ok) return r;
        s = bind(s, b.name, r.value);
      }
      return ev(expr.body, env, s, budget);
    }
  }
}
