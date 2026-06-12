import {
  type CompetitorId,
  DECIDED_BY,
  type NodePath,
  otherSide,
  type PairingPlan,
  type PoolDef,
  pairPath,
  resultUnplayed,
  type Side,
} from "./core";
import { type EngineIndexes, type EvalNode, evalNode } from "./evaluate";
import type {
  MetricRow,
  ModelRegistry,
  RoundLine,
  ScoredLine,
} from "./registry";

/**
 * Standings keep both points channels per line: the raw encounter outcome
 * (game/board points) and the pool's scoring kind applied to it (match
 * points). Tiebreak metrics are registry instances over these lines — they
 * never re-walk encounter trees (per-board and games-won detail is
 * precomputed onto the line, kind-agnostically).
 */

export type StandingsRow = MetricRow & {
  /** Tiebreak values keyed by each metric's label, in declared order. */
  readonly metrics: ReadonlyMap<string, number>;
  /** Competition ranking (ties share a rank). */
  readonly rank: number;
};

export type PoolRoundPlans = ReadonlyMap<number, readonly PairingPlan[]>;

/** The one way a pairing plan addresses and seats its encounter tree. */
export function evalPair(
  registry: ModelRegistry,
  indexes: EngineIndexes,
  pool: PoolDef,
  poolPath: NodePath,
  round: number,
  index: number,
  plan: Extract<PairingPlan, { kind: "pair" }>,
): EvalNode {
  return evalNode(registry, indexes, {
    def: pool.encounter,
    path: pairPath(poolPath, round, index + 1),
    whiteSeat: plan.whiteSeat,
    participants: [plan.a, plan.b],
  });
}

// ---------------------------------------------------------------------------
// Kind-agnostic line detail

/**
 * Leaf games won by `side`: a structural leaf (no children in its
 * definition) decided for the side by anything except draw odds. A
 * whole-encounter forfeit on a composite contributes none (no leaves
 * materialize), while a forfeited leaf counts — matching over-the-board
 * practice.
 */
export function gamesWonFor(
  registry: ModelRegistry,
  node: EvalNode,
  side: Side,
): number {
  if (registry.ops.structure(node.def).length === 0) {
    const d = node.outcome.decision;
    return d.kind === "win" && d.winner === side && d.by !== DECIDED_BY.drawOdds
      ? 1
      : 0;
  }
  return node.children.reduce(
    (sum, child) => sum + gamesWonFor(registry, child.node, side),
    0,
  );
}

/** Points per board slot ("board-n" segments), summed across the whole tree. */
export function boardPointsFor(node: EvalNode, side: Side): readonly number[] {
  const acc: number[] = [];
  const walk = (n: EvalNode): void => {
    for (const child of n.children) {
      if (child.slot.segment.label === "board") {
        const i = child.slot.segment.n - 1;
        acc[i] = (acc[i] ?? 0) + child.node.outcome.points[side];
      } else {
        walk(child.node);
      }
    }
  };
  walk(node);
  return acc;
}

function lineUnplayed(indexes: EngineIndexes, node: EvalNode): boolean {
  if (node.children.length === 0 && !node.forfeited) {
    const result = indexes.results.get(node.path);
    return result !== undefined && resultUnplayed(result);
  }
  const d = node.outcome.decision;
  return (
    node.forfeited ||
    (d.kind === "win" && d.by === DECIDED_BY.forfeit) ||
    d.kind === "doubleLoss"
  );
}

// ---------------------------------------------------------------------------
// Row building

type RowDraft = {
  readonly competitor: CompetitorId;
  standingsPoints: number;
  encounterPoints: number;
  readonly lines: RoundLine[];
  readonly scored: ScoredLine[];
};

function buildRowDrafts(
  registry: ModelRegistry,
  indexes: EngineIndexes,
  pool: PoolDef,
  poolPath: NodePath,
  entrants: readonly CompetitorId[],
  rounds: PoolRoundPlans,
): Map<CompetitorId, RowDraft> {
  const scoring = registry.scorings.get(pool.score.kind);
  if (scoring === undefined) {
    throw new Error(
      `unknown scoring kind "${pool.score.kind}" — the def was not parsed against this registry`,
    );
  }
  const byeRule =
    pool.bye ?? registry.pairings.get(pool.pairing.system)?.defaultBye;

  const drafts = new Map<CompetitorId, RowDraft>(
    entrants.map((competitor) => [
      competitor,
      {
        competitor,
        standingsPoints: 0,
        encounterPoints: 0,
        lines: [],
        scored: [],
      },
    ]),
  );

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

      const node = evalPair(
        registry,
        indexes,
        pool,
        poolPath,
        round,
        index,
        plan,
      );
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
        const line = { outcome: node.outcome, side };
        const standingsPoints = scoring.points(pool.score, line, draft.scored);
        draft.scored.push({ ...line, points: standingsPoints });
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
          gamesWon: gamesWonFor(registry, node, side),
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
 * Progression key for eliminative pairings: champion, runner-up, bronze
 * winner/loser (or tied semifinalists), then by rounds survived. Assumes the
 * last round lists the final as pair 1 and the bronze playoff (if any) as
 * pair 2 — the order the built-in knockout proposer emits and manual
 * pairings must follow.
 */
function progressionKeys(
  registry: ModelRegistry,
  indexes: EngineIndexes,
  drafts: ReadonlyMap<CompetitorId, RowDraft>,
  rounds: PoolRoundPlans,
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
      const node = evalPair(
        registry,
        indexes,
        pool,
        poolPath,
        round,
        index,
        plan,
      );
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
 * fine); `totalRounds` is the full schedule — progression ranking needs it
 * to recognize the final round.
 */
export function poolStandings(
  registry: ModelRegistry,
  indexes: EngineIndexes,
  pool: PoolDef,
  poolPath: NodePath,
  entrants: readonly CompetitorId[],
  rounds: PoolRoundPlans,
  totalRounds: number,
): readonly StandingsRow[] {
  const drafts = buildRowDrafts(
    registry,
    indexes,
    pool,
    poolPath,
    entrants,
    rounds,
  );

  const metrics = new Map<CompetitorId, Map<string, number>>();
  const metricRows: ReadonlyMap<CompetitorId, MetricRow> = drafts;
  for (const draft of drafts.values()) {
    const values = new Map<string, number>();
    for (const ref of pool.tiebreaks) {
      const metric = registry.metrics.get(ref.metric);
      if (metric === undefined) {
        throw new Error(
          `unknown tiebreak metric "${ref.metric}" — the def was not parsed against this registry`,
        );
      }
      values.set(metric.label(ref), metric.value(ref, draft, metricRows));
    }
    metrics.set(draft.competitor, values);
  }

  const sortKeys = new Map<CompetitorId, readonly number[]>();
  const progression =
    registry.pairings.get(pool.pairing.system)?.progression === true;
  if (progression) {
    const keys = progressionKeys(
      registry,
      indexes,
      drafts,
      rounds,
      pool,
      poolPath,
      totalRounds,
    );
    for (const [competitor, key] of keys) sortKeys.set(competitor, [key]);
  } else {
    for (const draft of drafts.values()) {
      sortKeys.set(draft.competitor, [
        draft.standingsPoints,
        ...(metrics.get(draft.competitor)?.values() ?? []),
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
