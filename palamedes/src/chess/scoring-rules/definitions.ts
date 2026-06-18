import type { Expr, MatchCase } from "@/tournament/expr/ast";

/**
 * Scoring rules as data — how a pool turns one encounter outcome into standings
 * points. The same formulas that lived as hand-written `points()` functions in
 * `scorings.ts` (now the differential oracle), expressed in the scoring
 * language: `passThrough` keeps the side's own points, `table` maps the outcome
 * through a win/draw/loss table (optionally keyed by the deciding leg), and
 * `phased` varies the table by round block.
 */

export type TableRule = {
  readonly kind: "table";
  readonly draw: number;
  readonly legs: readonly { readonly win: number; readonly loss: number }[];
};

export type PhasedRule = {
  readonly kind: "phased";
  readonly phases: readonly {
    readonly rounds: number;
    readonly win: number;
    readonly draw: number;
    readonly loss: number;
  }[];
};

const lit = (value: number | boolean): Expr => ({ op: "lit", value });
const cmp = (f: "<" | "<=" | "==" | ">=" | ">", a: Expr, b: Expr): Expr => ({
  op: "cmp",
  f,
  a,
  b,
});
const ifE = (cond: Expr, whenTrue: Expr, whenFalse: Expr): Expr => ({
  op: "if",
  cond,
  whenTrue,
  whenFalse,
});
const outcome = (cases: readonly MatchCase[], otherwise: Expr): Expr => ({
  op: "outcome",
  cases,
  otherwise,
});
const legIndex: Expr = { op: "legIndex" };
const round: Expr = { op: "round" };

/** passThrough: each side keeps its own encounter points. */
export const PASS_THROUGH: Expr = { op: "linePoints" };

/**
 * table: win/draw/loss → points, optionally keyed by the deciding leg (one row
 * = plain match points; Norway's 3/1.5/1/0 is two rows). A win pays the leg's
 * `win` to the winner and `loss` to the loser; the leg index is capped at the
 * last row.
 */
export const table = (rule: TableRule): Expr => {
  const last = rule.legs.length - 1;
  const legValue = (field: "win" | "loss"): Expr => {
    let e: Expr = lit(rule.legs[last]?.[field] ?? 0);
    for (let i = last - 1; i >= 0; i -= 1) {
      e = ifE(cmp("==", legIndex, lit(i)), lit(rule.legs[i]?.[field] ?? 0), e);
    }
    return e;
  };
  return outcome(
    [
      { when: "win", result: legValue("win") },
      { when: "loss", result: legValue("loss") },
      { when: "draw", result: lit(rule.draw) },
      { when: "doubleLoss", result: lit(rule.legs[0]?.loss ?? 0) },
    ],
    lit(0),
  );
};

/**
 * phased: consecutive round blocks score differently (Grand Chess Tour: rapid
 * rounds 2/1/0, then blitz 1/½/0). The competitor's round (history length + 1)
 * selects the block; rounds beyond the last block use the last block.
 */
export const phased = (rule: PhasedRule): Expr => {
  const phaseValue = (p: PhasedRule["phases"][number]): Expr =>
    outcome(
      [
        { when: "win", result: lit(p.win) },
        { when: "loss", result: lit(p.loss) },
        { when: "draw", result: lit(p.draw) },
        { when: "doubleLoss", result: lit(p.loss) },
      ],
      lit(0),
    );
  const blocks = rule.phases.map(phaseValue);
  const thresholds: number[] = [];
  let acc = 0;
  for (const p of rule.phases) {
    acc += p.rounds;
    thresholds.push(acc);
  }
  const lastBlock = blocks[blocks.length - 1];
  if (lastBlock === undefined) return lit(0);
  let e = lastBlock;
  for (let i = blocks.length - 2; i >= 0; i -= 1) {
    const block = blocks[i];
    const t = thresholds[i];
    if (block === undefined || t === undefined) continue;
    e = ifE(cmp("<=", round, lit(t)), block, e);
  }
  return e;
};
