import {
  appendPath,
  type EncounterDef,
  type GameDef,
  type MatchDef,
  type NodePath,
  nominalLossPoints,
  nominalWinPoints,
  otherSide,
  type PlayerId,
  type SeriesColors,
  type SeriesDef,
  type Side,
  STANDARD_GAME_POINTS,
} from "./def";
import { classifyResult, type GameResultCode } from "./inputs";

/**
 * The recursive outcome evaluator. Every materialized encounter node derives
 * one Outcome by: summing its children's points (the only aggregator),
 * deciding a winner per its stop/tie rules, and passing the sums upward.
 * See design/tournament-model.md § "Outcome semantics".
 */

/** The slices of recorded input the evaluator reads. `EventState` satisfies this. */
export type EngineIndexes = {
  readonly results: ReadonlyMap<string, GameResultCode>;
  readonly lineups: ReadonlyMap<string, readonly PlayerId[]>;
  readonly decisions: ReadonlyMap<string, Side>;
  readonly colorDraws: ReadonlyMap<string, Side>;
  readonly forfeits: ReadonlyMap<string, Side>;
};

export const lineupKey = (matchPath: NodePath, side: Side): string =>
  `${matchPath}#${side}`;

export type DecisionBy = "points" | "drawOdds" | "forfeit" | "manual";

export type Decision =
  | { readonly kind: "pending" }
  | { readonly kind: "draw" }
  | { readonly kind: "doubleLoss" }
  | {
      readonly kind: "win";
      readonly winner: Side;
      readonly by: DecisionBy;
      /** For series: 0-based index of the deciding leg (drives byLeg scoring). */
      readonly leg?: number | undefined;
    };

export type Outcome = {
  /** Points in definition-side order; partial sums while pending. */
  readonly points: readonly [number, number];
  readonly decision: Decision;
};

export type EncounterCtx = {
  readonly def: EncounterDef;
  readonly path: NodePath;
  /** Which side holds the white-ish seat at this node; undefined while a color draw is awaited. */
  readonly whiteSeat: Side | undefined;
};

export type EvalNode = {
  readonly ctx: EncounterCtx;
  readonly outcome: Outcome;
  /** Fully played, tied, and waiting on an arbiter `manualDecision` at this node. */
  readonly needsManual: boolean;
  /** Materialized children in order: series legs played so far, or all match boards. */
  readonly children: readonly EvalNode[];
};

export const flipMaybe = (seat: Side | undefined): Side | undefined =>
  seat === undefined ? undefined : otherSide(seat);

const orient = (
  winner: Side,
  win: number,
  loss: number,
): readonly [number, number] => (winner === 0 ? [win, loss] : [loss, win]);

const node = (
  ctx: EncounterCtx,
  points: readonly [number, number],
  decision: Decision,
  children: readonly EvalNode[] = [],
  needsManual = false,
): EvalNode => ({ ctx, outcome: { points, decision }, children, needsManual });

export function evalEncounter(
  indexes: EngineIndexes,
  ctx: EncounterCtx,
): EvalNode {
  const forfeitWinner = indexes.forfeits.get(ctx.path);
  if (forfeitWinner !== undefined) {
    return node(
      ctx,
      orient(
        forfeitWinner,
        nominalWinPoints(ctx.def),
        nominalLossPoints(ctx.def),
      ),
      { kind: "win", winner: forfeitWinner, by: "forfeit" },
    );
  }
  switch (ctx.def.kind) {
    case "game":
      return evalGame(indexes, ctx, ctx.def);
    case "series":
      return evalSeries(indexes, ctx, ctx.def);
    case "match":
      return evalMatch(indexes, ctx, ctx.def);
  }
}

function evalGame(
  indexes: EngineIndexes,
  ctx: EncounterCtx,
  def: GameDef,
): EvalNode {
  const schedule = def.points ?? STANDARD_GAME_POINTS;
  const result = indexes.results.get(ctx.path);
  if (result === undefined || ctx.whiteSeat === undefined) {
    return node(ctx, [0, 0], { kind: "pending" });
  }
  const whiteSeat = ctx.whiteSeat;
  const cls = classifyResult(result);
  switch (cls.kind) {
    case "win": {
      const winner = cls.color === "white" ? whiteSeat : otherSide(whiteSeat);
      return node(ctx, orient(winner, schedule.win, schedule.loss), {
        kind: "win",
        winner,
        by: cls.forfeit ? "forfeit" : "points",
      });
    }
    case "doubleForfeit":
      return node(ctx, [schedule.loss, schedule.loss], { kind: "doubleLoss" });
    case "draw": {
      const points: readonly [number, number] = [schedule.draw, schedule.draw];
      const tie = def.tie ?? { kind: "draw" };
      switch (tie.kind) {
        case "draw":
          return node(ctx, points, { kind: "draw" });
        case "drawOdds": {
          const winner =
            tie.color === "white" ? whiteSeat : otherSide(whiteSeat);
          return node(ctx, points, { kind: "win", winner, by: "drawOdds" });
        }
        case "manual": {
          const decided = indexes.decisions.get(ctx.path);
          if (decided === undefined) {
            return node(ctx, points, { kind: "pending" }, [], true);
          }
          return node(ctx, points, {
            kind: "win",
            winner: decided,
            by: "manual",
          });
        }
      }
    }
  }
}

function legSeat(
  indexes: EngineIndexes,
  colors: SeriesColors,
  parentSeat: Side | undefined,
  legPath: NodePath,
  legIndex: number,
): Side | undefined {
  switch (colors) {
    case "alternate":
      return legIndex % 2 === 0 ? parentSeat : flipMaybe(parentSeat);
    case "fixed":
      return parentSeat;
    case "redraw":
      return indexes.colorDraws.get(legPath);
  }
}

function evalSeries(
  indexes: EngineIndexes,
  ctx: EncounterCtx,
  def: SeriesDef,
): EvalNode {
  const children: EvalNode[] = [];
  let p0 = 0;
  let p1 = 0;
  let pending = false;
  let decision: Decision | undefined;

  for (let i = 0; i < def.legs.length; i += 1) {
    const legDef = def.legs[i];
    if (legDef === undefined) break;
    const legPath = appendPath(ctx.path, { kind: "leg", n: i + 1 });
    const child = evalEncounter(indexes, {
      def: legDef,
      path: legPath,
      whiteSeat: legSeat(indexes, def.colors, ctx.whiteSeat, legPath, i),
    });
    children.push(child);
    p0 += child.outcome.points[0];
    p1 += child.outcome.points[1];

    const d = child.outcome.decision;
    if (d.kind === "pending") {
      pending = true;
      // Under firstTo/untilDecisive, later legs are not materialized until
      // this one resolves; under `all`, every leg exists regardless.
      if (def.stop.kind !== "all") break;
      continue;
    }
    if (def.stop.kind === "firstTo") {
      const target = def.stop.points;
      if (p0 >= target && p0 > p1) {
        decision = { kind: "win", winner: 0, by: "points", leg: i };
        break;
      }
      if (p1 >= target && p1 > p0) {
        decision = { kind: "win", winner: 1, by: "points", leg: i };
        break;
      }
    }
    if (def.stop.kind === "untilDecisive" && d.kind === "win") {
      // Inherit the deciding leg's winner structurally: a drawOdds win has no
      // points margin, so re-comparing sums could not decide the chain.
      decision = { kind: "win", winner: d.winner, by: d.by, leg: i };
      break;
    }
  }

  const points: readonly [number, number] = [p0, p1];
  if (decision !== undefined) {
    return node(ctx, points, decision, children);
  }
  if (pending) {
    return node(ctx, points, { kind: "pending" }, children);
  }
  return decideBySums(indexes, ctx, points, children, def.tie);
}

function evalMatch(
  indexes: EngineIndexes,
  ctx: EncounterCtx,
  def: MatchDef,
): EvalNode {
  const children: EvalNode[] = [];
  let p0 = 0;
  let p1 = 0;
  let pending = false;

  for (let b = 1; b <= def.boards; b += 1) {
    const seat =
      def.colors === "uniform" || b % 2 === 1
        ? ctx.whiteSeat
        : flipMaybe(ctx.whiteSeat);
    const child = evalEncounter(indexes, {
      def: def.board,
      path: appendPath(ctx.path, { kind: "board", n: b }),
      whiteSeat: seat,
    });
    children.push(child);
    p0 += child.outcome.points[0];
    p1 += child.outcome.points[1];
    if (child.outcome.decision.kind === "pending") pending = true;
  }

  const points: readonly [number, number] = [p0, p1];
  if (pending) {
    return node(ctx, points, { kind: "pending" }, children);
  }
  return decideBySums(indexes, ctx, points, children, def.tie);
}

/** All children resolved: higher sum wins; equal sums go to the tie rule. */
function decideBySums(
  indexes: EngineIndexes,
  ctx: EncounterCtx,
  points: readonly [number, number],
  children: readonly EvalNode[],
  tie: { readonly kind: "draw" } | { readonly kind: "manual" } | undefined,
): EvalNode {
  if (points[0] !== points[1]) {
    return node(
      ctx,
      points,
      { kind: "win", winner: points[0] > points[1] ? 0 : 1, by: "points" },
      children,
    );
  }
  const rule = tie ?? { kind: "draw" };
  if (rule.kind === "draw") {
    return node(ctx, points, { kind: "draw" }, children);
  }
  const decided = indexes.decisions.get(ctx.path);
  if (decided === undefined) {
    return node(ctx, points, { kind: "pending" }, children, true);
  }
  return node(
    ctx,
    points,
    { kind: "win", winner: decided, by: "manual" },
    children,
  );
}
