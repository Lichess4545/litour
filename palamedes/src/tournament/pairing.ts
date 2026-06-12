import type { Color, CompetitorId, PairingRef, Side } from "./def";
import type { PairingPlan } from "./inputs";

/**
 * Pairing systems are pure proposers: they look at a pool's state and
 * suggest the next round. Proposals only take effect once recorded as a
 * `pairingsSet` input, so external engines (bbpPairings/JavaFo) and manual
 * arbiter pairings go through exactly the same door. `PairingContext`
 * deliberately carries everything a JavaFo TRF file encodes.
 */

export type PairingHistoryEntry =
  | {
      readonly kind: "played";
      readonly opponent: CompetitorId;
      readonly color: Color | undefined;
      /** Standings points taken from this round (what swiss pairing sorts on). */
      readonly points: number;
      /** Decided without play — TRF marks these so engines can ignore the color. */
      readonly unplayed: boolean;
    }
  | { readonly kind: "bye"; readonly points: number }
  | { readonly kind: "absent" };

export type PairingCompetitor = {
  readonly id: CompetitorId;
  /** 1-based position in the group's entry order. */
  readonly seed: number;
  readonly rating: number | undefined;
};

export type PairingContext = {
  readonly options: PairingRef;
  /** The round to pair, 1-based. */
  readonly round: number;
  readonly totalRounds: number;
  readonly competitors: readonly PairingCompetitor[];
  readonly scores: ReadonlyMap<CompetitorId, number>;
  readonly history: ReadonlyMap<CompetitorId, readonly PairingHistoryEntry[]>;
  /** Bracket-ordered pairings and decided winners of the previous round (knockouts). */
  readonly previousRound?:
    | {
        readonly pairings: readonly PairingPlan[];
        readonly winners: readonly (CompetitorId | null)[];
      }
    | undefined;
};

export type PairingResult =
  | { readonly ok: true; readonly pairings: readonly PairingPlan[] }
  | { readonly ok: false; readonly error: string };

export type PairingSystem = (ctx: PairingContext) => PairingResult;

const pair = (
  a: CompetitorId,
  b: CompetitorId,
  whiteSeat: Side = 0,
): PairingPlan => ({
  kind: "pair",
  a,
  b,
  whiteSeat,
});

// ---------------------------------------------------------------------------
// Round robin (Berger tables via the circle method)

function roundRobin(ctx: PairingContext): PairingResult {
  if (ctx.options.system !== "roundRobin") {
    return {
      ok: false,
      error: "round-robin pairing invoked for a different system",
    };
  }
  const ids = ctx.competitors.map((c) => c.id);
  const n = ids.length;
  if (n < 2)
    return { ok: false, error: "round robin needs at least 2 competitors" };

  const size = n % 2 === 0 ? n : n + 1; // odd fields add a phantom in the fixed seat
  const roundsPerCycle = size - 1;
  const cycle = Math.floor((ctx.round - 1) / roundsPerCycle);
  if (cycle >= ctx.options.cycles) {
    return { ok: false, error: `round ${ctx.round} exceeds the schedule` };
  }
  const r = ((ctx.round - 1) % roundsPerCycle) + 1;
  const flip = cycle % 2 === 1;

  // Rotating members 0..size-2; member size-1 stays fixed. Right-rotation by
  // (r-1) reproduces the canonical tables (n=4: 1-4 2-3 / 4-3 1-2 / 2-4 3-1).
  const rotating = (i: number): number =>
    (((i - (r - 1)) % roundsPerCycle) + roundsPerCycle) % roundsPerCycle;

  const pairings: PairingPlan[] = [];
  const emit = (white: number, black: number): void => {
    const w = flip ? black : white;
    const b = flip ? white : black;
    const wId = ids[w];
    const bId = ids[b];
    if (wId === undefined && bId !== undefined) {
      pairings.push({ kind: "bye", competitor: bId });
    } else if (bId === undefined && wId !== undefined) {
      pairings.push({ kind: "bye", competitor: wId });
    } else if (wId !== undefined && bId !== undefined) {
      pairings.push(pair(wId, bId));
    }
  };

  const first = rotating(0);
  const fixed = size - 1;
  if (r % 2 === 1) emit(first, fixed);
  else emit(fixed, first);

  for (let k = 1; k < size / 2; k += 1) {
    emit(rotating(k), rotating(size - 1 - k));
  }
  return { ok: true, pairings };
}

// ---------------------------------------------------------------------------
// Naive swiss — a demo-grade proposer (real events adapt bbpPairings/JavaFo)

function colorBalance(history: readonly PairingHistoryEntry[]): number {
  let balance = 0;
  for (const entry of history) {
    if (entry.kind !== "played" || entry.unplayed) continue;
    if (entry.color === "white") balance += 1;
    if (entry.color === "black") balance -= 1;
  }
  return balance;
}

function naiveSwiss(ctx: PairingContext): PairingResult {
  const standingsOrder = [...ctx.competitors].sort((a, b) => {
    const sa = ctx.scores.get(a.id) ?? 0;
    const sb = ctx.scores.get(b.id) ?? 0;
    if (sa !== sb) return sb - sa;
    return a.seed - b.seed;
  });

  const queue = standingsOrder.map((c) => c.id);
  const pairings: PairingPlan[] = [];
  let bye: PairingPlan | undefined;

  if (queue.length % 2 === 1) {
    const hadBye = (id: CompetitorId): boolean =>
      (ctx.history.get(id) ?? []).some((entry) => entry.kind === "bye");
    const candidate =
      [...queue].reverse().find((id) => !hadBye(id)) ?? queue[queue.length - 1];
    if (candidate !== undefined) {
      queue.splice(queue.indexOf(candidate), 1);
      bye = { kind: "bye", competitor: candidate };
    }
  }

  const playedBefore = (a: CompetitorId, b: CompetitorId): boolean =>
    (ctx.history.get(a) ?? []).some(
      (entry) => entry.kind === "played" && entry.opponent === b,
    );

  // Backtracking matching: take the leader, try opponents in standings order,
  // and only accept a rematch if no rematch-free perfect matching exists.
  // Exponential in the worst case — fine for a demo-grade proposer.
  const matchUp = (
    rest: readonly CompetitorId[],
    allowRematch: boolean,
  ): readonly (readonly [CompetitorId, CompetitorId])[] | undefined => {
    const [top, ...others] = rest;
    if (top === undefined) return [];
    for (let i = 0; i < others.length; i += 1) {
      const opponent = others[i];
      if (opponent === undefined) continue;
      if (!allowRematch && playedBefore(top, opponent)) continue;
      const sub = matchUp(
        others.filter((_, j) => j !== i),
        allowRematch,
      );
      if (sub !== undefined) return [[top, opponent], ...sub];
    }
    return undefined;
  };

  const matched = matchUp(queue, false) ?? matchUp(queue, true) ?? [];
  matched.forEach(([top, opponent], index) => {
    const topBalance = colorBalance(ctx.history.get(top) ?? []);
    const oppBalance = colorBalance(ctx.history.get(opponent) ?? []);
    const topWhite =
      topBalance === oppBalance ? index % 2 === 0 : topBalance < oppBalance;
    pairings.push(topWhite ? pair(top, opponent) : pair(opponent, top));
  });

  // The bye (if any) takes the last pair number.
  return {
    ok: true,
    pairings: bye === undefined ? pairings : [...pairings, bye],
  };
}

// ---------------------------------------------------------------------------
// Knockout brackets

/**
 * Bracket positions for traditional seeding, ported from
 * heltour/tournament_core/knockout.py so seeds 1 and 2 can only meet in the
 * final. Index = traditional pairing number (1vN is pairing 0), value = its
 * position in the bracket.
 */
function bracketPositions(numMatches: number): readonly number[] {
  if (numMatches <= 2) return numMatches === 2 ? [0, 1] : [0];
  if (numMatches === 4) return [0, 3, 2, 1];
  if (numMatches === 8) return [0, 7, 2, 5, 4, 3, 6, 1];
  if (numMatches === 16)
    return [0, 8, 2, 10, 4, 12, 6, 14, 15, 7, 13, 5, 11, 3, 9, 1];
  const half = bracketPositions(numMatches / 2);
  return [...half, ...half.map((p) => p + numMatches / 2)];
}

function knockout(ctx: PairingContext): PairingResult {
  if (ctx.options.system !== "knockout") {
    return {
      ok: false,
      error: "knockout pairing invoked for a different system",
    };
  }

  if (ctx.round === 1) {
    if (ctx.options.seeding === "manual") {
      return {
        ok: false,
        error: "manual seeding: record round 1 with a pairingsSet input",
      };
    }
    const ids = ctx.competitors.map((c) => c.id);
    const half = ids.length / 2;
    if (ctx.options.seeding === "adjacent") {
      const pairings: PairingPlan[] = [];
      for (let i = 0; i < ids.length; i += 2) {
        const a = ids[i];
        const b = ids[i + 1];
        if (a !== undefined && b !== undefined) pairings.push(pair(a, b));
      }
      return { ok: true, pairings };
    }
    const traditional: PairingPlan[] = [];
    for (let i = 0; i < half; i += 1) {
      const a = ids[i];
      const b = ids[ids.length - 1 - i];
      if (a !== undefined && b !== undefined) traditional.push(pair(a, b));
    }
    const positions = bracketPositions(half);
    const ordered: PairingPlan[] = new Array<PairingPlan>(traditional.length);
    traditional.forEach((p, i) => {
      const position = positions[i];
      if (position !== undefined) ordered[position] = p;
    });
    return { ok: true, pairings: ordered };
  }

  const previous = ctx.previousRound;
  if (previous === undefined) {
    return {
      ok: false,
      error: `round ${ctx.round - 1} has no recorded pairings yet`,
    };
  }
  const winners: CompetitorId[] = [];
  const losers: CompetitorId[] = [];
  for (let i = 0; i < previous.pairings.length; i += 1) {
    const plan = previous.pairings[i];
    const winner = previous.winners[i];
    if (winner === undefined || winner === null) {
      return { ok: false, error: "previous round is not fully decided" };
    }
    winners.push(winner);
    if (plan !== undefined && plan.kind === "pair") {
      losers.push(plan.a === winner ? plan.b : plan.a);
    }
  }

  const pairings: PairingPlan[] = [];
  for (let i = 0; i + 1 < winners.length; i += 2) {
    const a = winners[i];
    const b = winners[i + 1];
    if (a !== undefined && b !== undefined) pairings.push(pair(a, b));
  }
  const isFinal = winners.length === 2;
  if (isFinal && ctx.options.thirdPlace === true && losers.length === 2) {
    const a = losers[0];
    const b = losers[1];
    if (a !== undefined && b !== undefined) pairings.push(pair(a, b));
  }
  return { ok: true, pairings };
}

// ---------------------------------------------------------------------------

const manual: PairingSystem = () => ({
  ok: false,
  error: "manual pairing: record a pairingsSet input",
});

export const pairingSystems: Readonly<
  Record<PairingRef["system"], PairingSystem>
> = {
  roundRobin,
  swiss: naiveSwiss,
  knockout,
  manual,
};
