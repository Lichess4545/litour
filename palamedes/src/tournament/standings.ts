import {
  type Color,
  type CompetitorId,
  defaultedByeRule,
  defaultedRank,
  type MetricRef,
  type NodePath,
  otherSide,
  type PoolDef,
  pairPath,
  type ScoreRule,
  type Side,
} from "./def";
import { classifyResult, type PairingPlan, resultUnplayed } from "./inputs";
import {
  type Decision,
  type EngineIndexes,
  type EvalNode,
  evalEncounter,
  type Outcome,
} from "./outcome";

/**
 * Standings keep both points channels per line: the raw encounter outcome
 * (game/board points) and the pool's score rule applied to it (match
 * points). Tiebreak metrics are pure functions over these lines — they never
 * re-walk encounter trees (per-board and games-won detail is precomputed
 * onto the line).
 */

export type PlayedLine = {
  readonly kind: "played";
  readonly round: number;
  readonly opponent: CompetitorId;
  /** My side within the encounter, in definition order. */
  readonly side: Side;
  /** My color at the encounter level (the "team color" for matches). */
  readonly color: Color;
  readonly outcome: Outcome;
  readonly standingsPoints: number;
  readonly encounterPoints: number;
  readonly opponentEncounterPoints: number;
  readonly gamesWon: number;
  /** My points per board (index b-1 = board b); empty for non-match encounters. */
  readonly boardPoints: readonly number[];
  /** Decided without play (forfeit walkover) — what pairing engines mark unplayed. */
  readonly unplayed: boolean;
};

export type RoundLine =
  | PlayedLine
  | {
      readonly kind: "bye";
      readonly round: number;
      readonly standingsPoints: number;
      readonly encounterPoints: number;
    }
  | { readonly kind: "absent"; readonly round: number };

export type StandingsRow = {
  readonly competitor: CompetitorId;
  readonly standingsPoints: number;
  readonly encounterPoints: number;
  readonly lines: readonly RoundLine[];
  /** Tiebreak values keyed by `metricLabel`, in the pool's declared order. */
  readonly metrics: ReadonlyMap<string, number>;
  /** Competition ranking (ties share a rank). */
  readonly rank: number;
};

export function metricLabel(ref: MetricRef): string {
  switch (ref.metric) {
    case "boardPoints":
      return `boardPoints-${ref.board}`;
    case "buchholz":
      return ref.cut === undefined ? "buchholz" : `buchholz-cut${ref.cut}`;
    case "extendedSB": {
      const code = (basis: "standings" | "encounter"): string =>
        basis === "standings" ? "m" : "g";
      return `extendedSB-${code(ref.opponentTotal)}${code(ref.scored)}`;
    }
    default:
      return ref.metric;
  }
}

export function scoreRulePoints(
  rule: ScoreRule,
  outcome: Outcome,
  side: Side,
): number {
  switch (rule.kind) {
    case "encounterPoints":
      return outcome.points[side];
    case "perEncounter":
      return perEncounterPoints(rule, outcome.decision, side);
    case "byLeg":
      return byLegPoints(rule, outcome.decision, side);
  }
}

function perEncounterPoints(
  rule: Extract<ScoreRule, { kind: "perEncounter" }>,
  d: Decision,
  side: Side,
): number {
  switch (d.kind) {
    case "pending":
      return 0;
    case "draw":
      return rule.draw;
    case "doubleLoss":
      return rule.loss;
    case "win":
      return d.winner === side ? rule.win : rule.loss;
  }
}

function byLegPoints(
  rule: Extract<ScoreRule, { kind: "byLeg" }>,
  d: Decision,
  side: Side,
): number {
  switch (d.kind) {
    case "pending":
    case "doubleLoss":
      return 0;
    case "draw":
      return rule.draw ?? 0;
    case "win": {
      const leg = rule.legs[d.leg ?? rule.legs.length - 1];
      if (leg === undefined) return 0;
      return d.winner === side ? leg.win : leg.loss;
    }
  }
}

/** Leaf games actually won by `side` (forfeit wins count; drawOdds decisions don't). */
export function countGameWins(
  indexes: EngineIndexes,
  node: EvalNode,
  side: Side,
): number {
  if (node.ctx.def.kind === "game") {
    const result = indexes.results.get(node.ctx.path);
    if (result === undefined || node.ctx.whiteSeat === undefined) return 0;
    const cls = classifyResult(result);
    if (cls.kind !== "win") return 0;
    const winner =
      cls.color === "white"
        ? node.ctx.whiteSeat
        : otherSide(node.ctx.whiteSeat);
    return winner === side ? 1 : 0;
  }
  return node.children.reduce(
    (sum, child) => sum + countGameWins(indexes, child, side),
    0,
  );
}

/** My points per board, summed across all match nodes in the encounter (legs of a multi-match tie add up). */
export function boardPointsFor(node: EvalNode, side: Side): readonly number[] {
  const acc: number[] = [];
  const walk = (n: EvalNode): void => {
    if (n.ctx.def.kind === "match") {
      n.children.forEach((board, i) => {
        acc[i] = (acc[i] ?? 0) + board.outcome.points[side];
      });
      return;
    }
    for (const child of n.children) walk(child);
  };
  walk(node);
  return acc;
}

const isForfeitDecision = (d: Decision): boolean =>
  (d.kind === "win" && d.by === "forfeit") || d.kind === "doubleLoss";

function lineUnplayed(indexes: EngineIndexes, node: EvalNode): boolean {
  if (node.ctx.def.kind === "game") {
    const result = indexes.results.get(node.ctx.path);
    return result !== undefined && resultUnplayed(result);
  }
  return isForfeitDecision(node.outcome.decision);
}

export type PoolRoundPlans = ReadonlyMap<number, readonly PairingPlan[]>;

type RowDraft = {
  readonly competitor: CompetitorId;
  standingsPoints: number;
  encounterPoints: number;
  readonly lines: RoundLine[];
};

function buildRowDrafts(
  indexes: EngineIndexes,
  pool: PoolDef,
  poolPath: NodePath,
  entrants: readonly CompetitorId[],
  rounds: PoolRoundPlans,
): Map<CompetitorId, RowDraft> {
  const drafts = new Map<CompetitorId, RowDraft>(
    entrants.map((competitor) => [
      competitor,
      { competitor, standingsPoints: 0, encounterPoints: 0, lines: [] },
    ]),
  );
  const byeRule = defaultedByeRule(pool);

  for (const round of [...rounds.keys()].sort((a, b) => a - b)) {
    const plans = rounds.get(round) ?? [];
    const seen = new Set<CompetitorId>();

    plans.forEach((plan, index) => {
      if (plan.kind === "bye") {
        const draft = drafts.get(plan.competitor);
        if (draft === undefined) return;
        const standingsPoints =
          byeRule?.kind === "points" ? byeRule.standings : 0;
        const encounterPoints =
          byeRule?.kind === "points" ? byeRule.encounter : 0;
        draft.lines.push({
          kind: "bye",
          round,
          standingsPoints,
          encounterPoints,
        });
        draft.standingsPoints += standingsPoints;
        draft.encounterPoints += encounterPoints;
        seen.add(plan.competitor);
        return;
      }

      const path = pairPath(poolPath, round, index + 1);
      const node = evalEncounter(indexes, {
        def: pool.encounter,
        path,
        whiteSeat: plan.whiteSeat,
      });
      const sides: readonly (readonly [CompetitorId, Side])[] = [
        [plan.a, 0],
        [plan.b, 1],
      ];
      for (const [competitor, side] of sides) {
        const draft = drafts.get(competitor);
        if (draft === undefined) continue;
        const standingsPoints = scoreRulePoints(pool.score, node.outcome, side);
        const encounterPoints = node.outcome.points[side];
        draft.lines.push({
          kind: "played",
          round,
          opponent: side === 0 ? plan.b : plan.a,
          side,
          color: side === plan.whiteSeat ? "white" : "black",
          outcome: node.outcome,
          standingsPoints,
          encounterPoints,
          opponentEncounterPoints: node.outcome.points[otherSide(side)],
          gamesWon: countGameWins(indexes, node, side),
          boardPoints: boardPointsFor(node, side),
          unplayed: lineUnplayed(indexes, node),
        });
        draft.standingsPoints += standingsPoints;
        draft.encounterPoints += encounterPoints;
        seen.add(competitor);
      }
    });

    for (const competitor of entrants) {
      if (!seen.has(competitor)) {
        drafts.get(competitor)?.lines.push({ kind: "absent", round });
      }
    }
  }

  return drafts;
}

// ---------------------------------------------------------------------------
// Tiebreak metrics

function computeMetric(
  ref: MetricRef,
  draft: RowDraft,
  all: ReadonlyMap<CompetitorId, RowDraft>,
): number {
  const played = draft.lines.filter(
    (line): line is PlayedLine => line.kind === "played",
  );
  switch (ref.metric) {
    case "encounterPoints":
      return draft.encounterPoints;
    case "matchWins":
      return played.filter(
        (line) =>
          line.outcome.decision.kind === "win" &&
          line.outcome.decision.winner === line.side,
      ).length;
    case "gamesWon":
      return played.reduce((sum, line) => sum + line.gamesWon, 0);
    case "boardPoints":
      return played.reduce(
        (sum, line) => sum + (line.boardPoints[ref.board - 1] ?? 0),
        0,
      );
    case "buchholz": {
      const values: number[] = [];
      for (const line of draft.lines) {
        if (line.kind === "bye") values.push(draft.standingsPoints);
        if (line.kind === "played") {
          const opponent = all.get(line.opponent);
          if (opponent !== undefined) values.push(opponent.standingsPoints);
        }
      }
      values.sort((a, b) => a - b);
      return values.slice(ref.cut ?? 0).reduce((sum, v) => sum + v, 0);
    }
    case "sonnebornBerger": {
      let sum = 0;
      for (const line of played) {
        const opponent = all.get(line.opponent);
        if (opponent === undefined) continue;
        const d = line.outcome.decision;
        if (d.kind === "win" && d.winner === line.side)
          sum += opponent.standingsPoints;
        else if (d.kind === "draw") sum += opponent.standingsPoints / 2;
      }
      return sum;
    }
    case "extendedSB": {
      const total = (
        row: RowDraft,
        basis: "standings" | "encounter",
      ): number =>
        basis === "standings" ? row.standingsPoints : row.encounterPoints;
      const scored = (line: PlayedLine): number =>
        ref.scored === "standings"
          ? line.standingsPoints
          : line.encounterPoints;
      let sum = 0;
      for (const line of draft.lines) {
        if (line.kind === "bye") {
          // FIDE Art. 16.4: the virtual opponent has the participant's own
          // total — applied to the game-points × game-points variant only.
          if (ref.opponentTotal === "encounter" && ref.scored === "encounter") {
            sum += draft.encounterPoints * line.encounterPoints;
          }
          continue;
        }
        if (line.kind !== "played") continue;
        const opponent = all.get(line.opponent);
        if (opponent === undefined) continue;
        sum += total(opponent, ref.opponentTotal) * scored(line);
      }
      return sum;
    }
    case "headToHead": {
      const tied = [...all.values()].filter(
        (row) =>
          row.standingsPoints === draft.standingsPoints &&
          row.encounterPoints === draft.encounterPoints,
      );
      if (tied.length < 2) return 0;
      const tiedIds = new Set(tied.map((row) => row.competitor));
      // Only meaningful when every tied pair has actually met.
      for (const row of tied) {
        const met = new Set(
          row.lines
            .filter((line): line is PlayedLine => line.kind === "played")
            .map((line) => line.opponent),
        );
        for (const other of tiedIds) {
          if (other !== row.competitor && !met.has(other)) return 0;
        }
      }
      return played
        .filter((line) => tiedIds.has(line.opponent))
        .reduce((sum, line) => sum + line.standingsPoints, 0);
    }
  }
}

// ---------------------------------------------------------------------------
// Ranking

function competitionRanks(
  sortKeys: ReadonlyMap<CompetitorId, readonly number[]>,
  order: readonly CompetitorId[],
): Map<CompetitorId, number> {
  const ranks = new Map<CompetitorId, number>();
  let previousKey: readonly number[] | undefined;
  let previousRank = 1;
  order.forEach((competitor, index) => {
    const key = sortKeys.get(competitor) ?? [];
    const tied = previousKey !== undefined && keysEqual(previousKey, key);
    const rank = tied ? previousRank : index + 1;
    ranks.set(competitor, rank);
    previousKey = key;
    previousRank = rank;
  });
  return ranks;
}

const keysEqual = (a: readonly number[], b: readonly number[]): boolean =>
  a.length === b.length && a.every((value, i) => value === b[i]);

/**
 * Knockout progression key: champion, runner-up, bronze winner/loser (or tied
 * semifinalists), then by rounds survived. Larger is better.
 */
function progressionKeys(
  drafts: ReadonlyMap<CompetitorId, RowDraft>,
  rounds: PoolRoundPlans,
  indexes: EngineIndexes,
  pool: PoolDef,
  poolPath: NodePath,
  totalRounds: number,
): Map<CompetitorId, number> {
  const keys = new Map<CompetitorId, number>();
  for (const competitor of drafts.keys()) keys.set(competitor, 0);

  for (const [round, plans] of rounds) {
    plans.forEach((plan, index) => {
      if (plan.kind === "bye") {
        keys.set(
          plan.competitor,
          Math.max(keys.get(plan.competitor) ?? 0, round),
        );
        return;
      }
      const node = evalEncounter(indexes, {
        def: pool.encounter,
        path: pairPath(poolPath, round, index + 1),
        whiteSeat: plan.whiteSeat,
      });
      const d = node.outcome.decision;
      const isFinalRound = round === totalRounds;
      const winner =
        d.kind === "win" ? (d.winner === 0 ? plan.a : plan.b) : undefined;
      const loser =
        d.kind === "win" ? (d.winner === 0 ? plan.b : plan.a) : undefined;
      if (isFinalRound && index === 0) {
        // The final: fix the top two ranks outright.
        keys.set(
          plan.a,
          winner === plan.a
            ? FINAL_KEYS.champion
            : winner === undefined
              ? FINAL_KEYS.finalist
              : FINAL_KEYS.runnerUp,
        );
        keys.set(
          plan.b,
          winner === plan.b
            ? FINAL_KEYS.champion
            : winner === undefined
              ? FINAL_KEYS.finalist
              : FINAL_KEYS.runnerUp,
        );
        return;
      }
      if (isFinalRound && index === 1) {
        // Third-place playoff.
        keys.set(
          plan.a,
          winner === plan.a
            ? FINAL_KEYS.bronzeWinner
            : winner === undefined
              ? FINAL_KEYS.bronze
              : FINAL_KEYS.bronzeLoser,
        );
        keys.set(
          plan.b,
          winner === plan.b
            ? FINAL_KEYS.bronzeWinner
            : winner === undefined
              ? FINAL_KEYS.bronze
              : FINAL_KEYS.bronzeLoser,
        );
        return;
      }
      if (winner !== undefined && loser !== undefined) {
        keys.set(winner, Math.max(keys.get(winner) ?? 0, round));
        keys.set(loser, Math.max(keys.get(loser) ?? 0, round - 1 + 0.5));
      } else {
        // Undecided: both sides have survived up to this round so far.
        keys.set(plan.a, Math.max(keys.get(plan.a) ?? 0, round - 1 + 0.5));
        keys.set(plan.b, Math.max(keys.get(plan.b) ?? 0, round - 1 + 0.5));
      }
    });
  }
  return keys;
}

const FINAL_KEYS = {
  champion: 1_000_000,
  finalist: 999_998.5,
  runnerUp: 999_998,
  bronzeWinner: 999_997,
  bronze: 999_996.5,
  bronzeLoser: 999_996,
} as const;

// ---------------------------------------------------------------------------
// Public entry point

export function poolStandings(
  indexes: EngineIndexes,
  pool: PoolDef,
  poolPath: NodePath,
  entrants: readonly CompetitorId[],
  rounds: PoolRoundPlans,
  totalRounds: number,
): readonly StandingsRow[] {
  const drafts = buildRowDrafts(indexes, pool, poolPath, entrants, rounds);

  const metrics = new Map<CompetitorId, Map<string, number>>();
  for (const draft of drafts.values()) {
    const values = new Map<string, number>();
    for (const ref of pool.tiebreaks) {
      values.set(metricLabel(ref), computeMetric(ref, draft, drafts));
    }
    metrics.set(draft.competitor, values);
  }

  const sortKeys = new Map<CompetitorId, readonly number[]>();
  if (defaultedRank(pool) === "progression") {
    const keys = progressionKeys(
      drafts,
      rounds,
      indexes,
      pool,
      poolPath,
      totalRounds,
    );
    for (const [competitor, key] of keys) sortKeys.set(competitor, [key]);
  } else {
    for (const draft of drafts.values()) {
      sortKeys.set(draft.competitor, [
        draft.standingsPoints,
        ...[...(metrics.get(draft.competitor)?.values() ?? [])],
      ]);
    }
  }

  const order = [...entrants].sort((a, b) => {
    const ka = sortKeys.get(a) ?? [];
    const kb = sortKeys.get(b) ?? [];
    for (let i = 0; i < Math.max(ka.length, kb.length); i += 1) {
      const va = ka[i] ?? Number.NEGATIVE_INFINITY;
      const vb = kb[i] ?? Number.NEGATIVE_INFINITY;
      if (va !== vb) return vb - va;
    }
    return entrants.indexOf(a) - entrants.indexOf(b);
  });

  const ranks = competitionRanks(sortKeys, order);

  return order.map((competitor) => {
    const draft = drafts.get(competitor);
    return {
      competitor,
      standingsPoints: draft?.standingsPoints ?? 0,
      encounterPoints: draft?.encounterPoints ?? 0,
      lines: draft?.lines ?? [],
      metrics: metrics.get(competitor) ?? new Map<string, number>(),
      rank: ranks.get(competitor) ?? order.length,
    };
  });
}
