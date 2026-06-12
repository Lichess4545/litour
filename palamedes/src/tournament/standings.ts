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
import { type PairingPlan, resultUnplayed } from "./inputs";
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
  /** Decided without play (forfeits, scheduling draws) — what pairing engines mark unplayed. */
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
      // Wins without a deciding leg (forfeits, manual decisions) pay the
      // FIRST leg's schedule — a Norway no-show concedes the full 3, not the
      // armageddon consolation.
      const leg = rule.legs[d.leg ?? 0];
      if (leg === undefined) return 0;
      return d.winner === side ? leg.win : leg.loss;
    }
  }
}

/**
 * Leaf games won by `side`: played wins, forfeit and adjudicated wins count;
 * drawOdds decisions don't (the game itself was drawn). A whole-encounter
 * forfeit materializes no games, so it contributes none.
 */
export function countGameWins(node: EvalNode, side: Side): number {
  if (node.ctx.def.kind === "game") {
    const d = node.outcome.decision;
    return d.kind === "win" && d.winner === side && d.by !== "drawOdds" ? 1 : 0;
  }
  return node.children.reduce(
    (sum, child) => sum + countGameWins(child, side),
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

/** The one way a pairing plan addresses and seats its encounter tree. */
export function evalPair(
  indexes: EngineIndexes,
  pool: PoolDef,
  poolPath: NodePath,
  round: number,
  index: number,
  plan: Extract<PairingPlan, { kind: "pair" }>,
): EvalNode {
  return evalEncounter(indexes, {
    def: pool.encounter,
    path: pairPath(poolPath, round, index + 1),
    whiteSeat: plan.whiteSeat,
  });
}

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

      const node = evalPair(indexes, pool, poolPath, round, index, plan);
      const sides: readonly (readonly [CompetitorId, Side])[] = [
        [plan.a, 0],
        [plan.b, 1],
      ];
      for (const [competitor, side] of sides) {
        // A plan can reference a competitor no longer in the entrant set
        // after a rank-source correction; materialize() flags that in
        // state.errors, so here it is only skipped, not swallowed.
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
          gamesWon: countGameWins(node, side),
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
      // FIDE direct encounter applies to everyone on equal SCORE (standings
      // points); secondary channels stay out of the tie key.
      const tied = [...all.values()].filter(
        (row) => row.standingsPoints === draft.standingsPoints,
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

// Sentinels above any reachable "rounds survived" key; relative order encodes
// the podium, with .5 marking "pair still undecided" midpoints.
const PODIUM = 1_000_000;
const FINAL_KEYS = {
  champion: PODIUM + 4,
  finalist: PODIUM + 3.5,
  runnerUp: PODIUM + 3,
  bronzeWinner: PODIUM + 2,
  bronze: PODIUM + 1.5,
  bronzeLoser: PODIUM + 1,
} as const;

/**
 * Knockout progression key: champion, runner-up, bronze winner/loser (or tied
 * semifinalists), then by rounds survived. Larger is better. Assumes the last
 * round lists the final as pair 1 and the bronze playoff (if any) as pair 2 —
 * the order `proposePairings` emits and manual pairings must follow.
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
  const raise = (competitor: CompetitorId, key: number): void => {
    keys.set(competitor, Math.max(keys.get(competitor) ?? 0, key));
  };

  for (const [round, plans] of rounds) {
    plans.forEach((plan, index) => {
      if (plan.kind === "bye") {
        raise(plan.competitor, round);
        return;
      }
      const node = evalPair(indexes, pool, poolPath, round, index, plan);
      const d = node.outcome.decision;
      const winner =
        d.kind === "win" ? (d.winner === 0 ? plan.a : plan.b) : undefined;

      const podium = (top: number, undecided: number, low: number): void => {
        for (const side of [plan.a, plan.b]) {
          keys.set(
            side,
            winner === undefined ? undecided : winner === side ? top : low,
          );
        }
      };
      if (round === totalRounds && index === 0) {
        podium(FINAL_KEYS.champion, FINAL_KEYS.finalist, FINAL_KEYS.runnerUp);
        return;
      }
      if (round === totalRounds && index === 1) {
        podium(
          FINAL_KEYS.bronzeWinner,
          FINAL_KEYS.bronze,
          FINAL_KEYS.bronzeLoser,
        );
        return;
      }
      if (winner !== undefined) {
        raise(winner, round);
        raise(plan.a === winner ? plan.b : plan.a, round - 1 + 0.5);
      } else {
        // Undecided: both sides have survived up to this round so far.
        raise(plan.a, round - 1 + 0.5);
        raise(plan.b, round - 1 + 0.5);
      }
    });
  }
  return keys;
}

// ---------------------------------------------------------------------------
// Public entry point

/**
 * Live standings for one pool. `rounds` may be partial (mid-event tables are
 * fine); `totalRounds` is the full schedule — progression ranking needs it to
 * recognize the final round.
 */
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
