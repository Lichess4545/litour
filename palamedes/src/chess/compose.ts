/**
 * The authoring combinator library: named patterns that compose into event
 * definitions. Everything here is PLAIN DATA — no casts, no branded types.
 * A builder returns the same `unknown`-shaped literal an arbiter would write
 * by hand; `parseEventDef` validates the result against a registry, so an
 * invalid composition fails at parse with arbiter-grade errors, never at
 * compile time.
 *
 * Patterns are values, and composition is function application — a whole
 * competition built here (GRENKE) drops into another event (the Grand Chess
 * Tour) by reference, unchanged.
 */

type Kinded = { readonly kind: string; readonly [key: string]: unknown };

export type EncounterData = Kinded;
export type SeedData = Kinded;
export type ScoreData = Kinded;
export type TieData = Kinded;
export type ByeData = Kinded;
export type RunData = Kinded;
export type MetricData = {
  readonly metric: string;
  readonly [key: string]: unknown;
};

export type EntriesData = readonly SeedData[] | { readonly open: true };

export type CompetitorData = {
  readonly id: string;
  readonly name: string;
  readonly rating?: number | undefined;
  readonly roster?: readonly string[] | undefined;
};

export type CompetitionData = {
  readonly id: string;
  readonly name?: string | undefined;
  readonly entries?: EntriesData | undefined;
  readonly run: RunData;
};

export type EventData = {
  readonly id: string;
  readonly name: string;
  readonly competitors: readonly CompetitorData[];
  readonly competition: CompetitionData;
};

export type ClockData = {
  readonly initial: number;
  readonly increment: number;
  readonly whiteInitial?: number | undefined;
  readonly blackInitial?: number | undefined;
};

// ---------------------------------------------------------------------------
// The spine

export const event = (
  id: string,
  name: string,
  competitors: readonly CompetitorData[],
  competition: CompetitionData,
): EventData => ({ id, name, competitors, competition });

/** A leaf competition: it intakes entrants and runs a pool or an encounter. */
export const competition = (
  id: string,
  name: string | undefined,
  entries: EntriesData,
  run: RunData,
): CompetitionData => ({
  id,
  ...(name === undefined ? {} : { name }),
  entries,
  run,
});

/** A container competition: it runs sub-competitions and intakes nothing. */
export const container = (
  id: string,
  name: string | undefined,
  ...competitions: readonly CompetitionData[]
): CompetitionData => ({
  id,
  ...(name === undefined ? {} : { name }),
  run: { kind: "competitions", competitions },
});

// ---------------------------------------------------------------------------
// Intakes — where a leaf's entrants come from

/** Registration-bound: the field is unknown until entries are bound. */
export const open = { open: true } as const;

/** Registration slots 1..count. */
export const seeds = (count: number): readonly SeedData[] =>
  seedsFrom(1, count);

/** Registration slots start..start+count-1. */
export const seedsFrom = (start: number, count: number): readonly SeedData[] =>
  Array.from({ length: count }, (_, i) => ({
    kind: "registration",
    seed: start + i,
  }));

/** Ranks 1..count of a finished competition ("the top 16 advance"). */
export const top = (of: string, count: number): readonly SeedData[] =>
  ranks(of, ...Array.from({ length: count }, (_, i) => i + 1));

/** Specific ranks of a finished competition (cross-group semifinals). */
export const ranks = (
  of: string,
  ...ns: readonly number[]
): readonly SeedData[] => ns.map((rank) => ({ kind: "rank", of, rank }));

/**
 * Ranks 1..count of the aggregated standings over several competitions,
 * placements converted to points through a table (the tour).
 */
export const tourTop = (
  over: readonly string[],
  points: readonly number[],
  count: number,
): readonly SeedData[] =>
  Array.from({ length: count }, (_, i) => ({
    kind: "placements",
    over,
    points,
    rank: i + 1,
  }));

// ---------------------------------------------------------------------------
// Seats — how colors flow (cycle values, not concepts)

/** Series seats: colors alternate leg to leg. */
export const alternate = {
  source: "inherit",
  cycle: ["keep", "flip"],
} as const;
/** Series seats: every leg keeps the parent's colors. */
export const sameSeats = { source: "inherit", cycle: ["keep"] } as const;
/** Series seats: a drawing of lots decides who holds white. */
export const drawnSeats = { source: "draw" } as const;
/** Board seats: colors alternate down the boards. */
export const zigzag = { cycle: ["keep", "flip"] } as const;
/** Board seats: every board gets the team's color. */
export const uniformBoards = { cycle: ["keep"] } as const;

export type SeriesSeats =
  | { readonly source: "inherit"; readonly cycle: readonly ("keep" | "flip")[] }
  | { readonly source: "draw" };
export type BoardSeats = { readonly cycle: readonly ("keep" | "flip")[] };

// ---------------------------------------------------------------------------
// Scoring, ties, byes

/** Standings keep the encounter's own sums (game points). */
export const gamePoints: ScoreData = { kind: "passThrough" };
/** Plain match points: win 2, draw 1, loss 0. */
export const matchPoints: ScoreData = pointsTable(1, { win: 2, loss: 0 });

/** A win/loss table, optionally keyed by the deciding leg (Norway's 3/1.5/1/0). */
export function pointsTable(
  draw: number,
  ...legs: readonly { readonly win: number; readonly loss: number }[]
): ScoreData {
  return { kind: "table", draw, legs };
}

/** Consecutive round blocks scored differently (GCT rapid 2/1/0 then blitz 1/½/0). */
export const phased = (
  ...phases: readonly {
    readonly rounds: number;
    readonly win: number;
    readonly draw: number;
    readonly loss: number;
  }[]
): ScoreData => ({ kind: "phased", phases });

/** A draw is a win for this color (armageddon). */
export const drawOdds = (color: "white" | "black"): TieData => ({
  kind: "drawOdds",
  color,
});
/** Ties go to the arbiter. */
export const manualTie: TieData = { kind: "manual" };

export const byePoints = (standings: number, encounter: number): ByeData => ({
  kind: "points",
  standings,
  encounter,
});
export const byeAdvance: ByeData = { kind: "advance" };

// ---------------------------------------------------------------------------
// Pools — N entrants, a pairing system, ONE encounter template, a scoring rule

export type PoolOpts = {
  readonly bye?: ByeData | undefined;
  readonly tiebreaks?: readonly MetricData[] | undefined;
  readonly terms?:
    | { readonly round?: string; readonly pairing?: string }
    | undefined;
  readonly legRelease?: "independent" | "lockstep" | undefined;
};

const poolOpts = (opts: PoolOpts | undefined) => ({
  tiebreaks: opts?.tiebreaks ?? [],
  ...(opts?.bye === undefined ? {} : { bye: opts.bye }),
  ...(opts?.terms === undefined ? {} : { terms: opts.terms }),
  ...(opts?.legRelease === undefined ? {} : { legRelease: opts.legRelease }),
});

export const swiss = (
  rounds: number,
  encounter: EncounterData,
  score: ScoreData,
  opts?: PoolOpts,
): RunData => ({
  kind: "pool",
  pairing: { system: "swiss" },
  rounds,
  encounter,
  score,
  ...poolOpts(opts),
});

export const roundRobin = (
  cycles: number,
  encounter: EncounterData,
  score: ScoreData,
  opts?: PoolOpts,
): RunData => ({
  kind: "pool",
  pairing: { system: "roundRobin", cycles },
  encounter,
  score,
  ...poolOpts(opts),
});

export type KnockoutOpts = PoolOpts & {
  readonly seeding?: "traditional" | "adjacent" | "manual" | undefined;
  readonly thirdPlace?: boolean | undefined;
  /** Truncate the bracket: play only this many rounds, survivors advance. */
  readonly rounds?: number | undefined;
  readonly score?: ScoreData | undefined;
};

export const knockout = (
  encounter: EncounterData,
  opts?: KnockoutOpts,
): RunData => ({
  kind: "pool",
  pairing: {
    system: "knockout",
    seeding: opts?.seeding ?? "traditional",
    ...(opts?.thirdPlace === undefined ? {} : { thirdPlace: opts.thirdPlace }),
    ...(opts?.rounds === undefined ? {} : { rounds: opts.rounds }),
  },
  encounter,
  score: opts?.score ?? gamePoints,
  ...poolOpts(opts),
});

// ---------------------------------------------------------------------------
// Encounters

export type GameOpts = {
  readonly name?: string | undefined;
  readonly points?:
    | { readonly win: number; readonly draw: number; readonly loss: number }
    | undefined;
  readonly tie?: TieData | undefined;
};

export const game = (clock: ClockData, opts?: GameOpts): EncounterData => ({
  kind: "game",
  clock,
  ...(opts?.name === undefined ? {} : { name: opts.name }),
  ...(opts?.points === undefined ? {} : { points: opts.points }),
  ...(opts?.tie === undefined ? {} : { tie: opts.tie }),
});

export type SeriesOpts = {
  readonly stop?:
    | {
        readonly untilScore?: number;
        readonly untilMargin?: number;
        readonly untilDecided?: true;
      }
    | undefined;
  /** Defaults to alternating colors. */
  readonly seats?: SeriesSeats | undefined;
  readonly tie?: TieData | undefined;
  readonly name?: string | undefined;
  readonly legName?: string | undefined;
};

export const seriesOf = (
  legs: readonly EncounterData[],
  opts?: SeriesOpts,
): EncounterData => ({
  kind: "series",
  legs,
  seats: opts?.seats ?? alternate,
  ...(opts?.stop === undefined ? {} : { stop: opts.stop }),
  ...(opts?.tie === undefined ? {} : { tie: opts.tie }),
  ...(opts?.name === undefined ? {} : { name: opts.name }),
  ...(opts?.legName === undefined ? {} : { legName: opts.legName }),
});

export type MatchOpts = {
  /** Defaults to zigzag board colors. */
  readonly seats?: BoardSeats | undefined;
  readonly tie?: TieData | undefined;
  readonly name?: string | undefined;
  readonly boardName?: string | undefined;
};

export const matchOf = (
  boards: number,
  board: EncounterData,
  opts?: MatchOpts,
): EncounterData => ({
  kind: "match",
  boards,
  board,
  seats: opts?.seats ?? zigzag,
  ...(opts?.tie === undefined ? {} : { tie: opts.tie }),
  ...(opts?.name === undefined ? {} : { name: opts.name }),
  ...(opts?.boardName === undefined ? {} : { boardName: opts.boardName }),
});

/** N legs, colors alternating, first past half the points (the WC's 14 games). */
export const bestOf = (count: number, leg: EncounterData): EncounterData =>
  seriesOf(
    Array.from({ length: count }, () => leg),
    { stop: { untilScore: count / 2 + 0.5 } },
  );

/** Two legs, colors alternating — the World Cup's basic tiebreak unit. */
export const duel = (leg: EncounterData): EncounterData => seriesOf([leg, leg]);

/**
 * A tiebreak chain: play legs in order until one decides, colors drawn
 * fresh before each leg (the WC and World Cup cascade shape).
 */
export const untilDecided = (
  ...legs: readonly EncounterData[]
): EncounterData =>
  seriesOf(legs, { stop: { untilDecided: true }, seats: drawnSeats });
