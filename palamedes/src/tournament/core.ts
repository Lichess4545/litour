import { z } from "zod";

/**
 * The fixed algebra — the laws every kind composes against. This file
 * deliberately contains NO tournament vocabulary (no swiss, no zigzag, no
 * match points): those are registered instances in `kinds/`. What is fixed:
 *
 * - identities and node paths;
 * - the two-sided `Outcome` every encounter produces;
 * - the seat algebra (how the white-ish seat flows to children);
 * - the input/work vocabulary — the wire protocol between the engine and
 *   the host (game results in, games-to-create out);
 * - the event spine: ONE recursive competition node, all the way down.
 */

// ---------------------------------------------------------------------------
// Identities

export const competitorIdSchema = z.string().min(1).brand<"CompetitorId">();
export type CompetitorId = z.infer<typeof competitorIdSchema>;
export const competitorId = (value: string): CompetitorId =>
  competitorIdSchema.parse(value);

export const playerIdSchema = z.string().min(1).brand<"PlayerId">();
export type PlayerId = z.infer<typeof playerIdSchema>;
export const playerId = (value: string): PlayerId =>
  playerIdSchema.parse(value);

/** Either kind of participant in a scheduled game. */
export type ParticipantId = CompetitorId | PlayerId;

export type Side = 0 | 1;
export const sideSchema: z.ZodType<Side> = z.union([
  z.literal(0),
  z.literal(1),
]);
export type Color = "white" | "black";

export const otherSide = (side: Side): Side => (side === 0 ? 1 : 0);

// ---------------------------------------------------------------------------
// Node paths
//
// `comp-<id>` roots a leaf competition — competition ids are globally unique
// within an event, so addressing is flat and containers never appear in
// paths; `/round-<n>/pair-<n>` addresses a pool pairing; below that,
// encounter kinds mint their own child segments (`leg-2`, `board-1`,
// anything `<label>-<n>`).

const PATH_ID = "[a-z0-9][a-z0-9-]*";
const PATH_N = "[1-9][0-9]*";
// Child segment labels are kind-chosen but may not shadow the spine's own.
const CHILD_LABEL = "(?!(?:comp|round|pair)-)[a-z]+";
const NODE_PATH_REGEX = new RegExp(
  `^comp-${PATH_ID}(?:/round-${PATH_N}(?:/pair-${PATH_N})?)?(?:/${CHILD_LABEL}-${PATH_N})*$`,
);

export const nodePathSchema = z
  .string()
  .regex(NODE_PATH_REGEX)
  .brand<"NodePath">();
export type NodePath = z.infer<typeof nodePathSchema>;

export type PathSegment =
  | { readonly kind: "comp"; readonly id: string }
  | { readonly kind: "round"; readonly n: number }
  | { readonly kind: "pair"; readonly n: number }
  | { readonly kind: "child"; readonly label: string; readonly n: number };

const segmentToString = (segment: PathSegment): string => {
  switch (segment.kind) {
    case "comp":
      return `comp-${segment.id}`;
    case "round":
    case "pair":
      return `${segment.kind}-${segment.n}`;
    case "child":
      return `${segment.label}-${segment.n}`;
  }
};

export const nodePath = (segments: readonly PathSegment[]): NodePath =>
  nodePathSchema.parse(segments.map(segmentToString).join("/"));

export const appendPath = (parent: NodePath, segment: PathSegment): NodePath =>
  nodePathSchema.parse(`${parent}/${segmentToString(segment)}`);

export const compRootPath = (competitionId: string): NodePath =>
  nodePath([{ kind: "comp", id: competitionId }]);

/** Address of pairing `pair` (1-based) of round `round` within a pool. */
export const pairPath = (
  pool: NodePath,
  round: number,
  pair: number,
): NodePath =>
  appendPath(appendPath(pool, { kind: "round", n: round }), {
    kind: "pair",
    n: pair,
  });

/** The path's first `length` segments (e.g. a board's enclosing match). */
export const pathPrefix = (path: NodePath, length: number): NodePath =>
  nodePathSchema.parse(path.split("/").slice(0, length).join("/"));

export function pathSegments(path: NodePath): readonly PathSegment[] {
  return path.split("/").map((raw): PathSegment => {
    const dash = raw.indexOf("-");
    const label = raw.slice(0, dash);
    const rest = raw.slice(dash + 1);
    if (label === "comp") return { kind: "comp", id: rest };
    const n = Number.parseInt(rest, 10);
    if (label === "round" || label === "pair") return { kind: label, n };
    return { kind: "child", label, n };
  });
}

// ---------------------------------------------------------------------------
// Outcomes — what every encounter node produces

/**
 * How a win came about. Open vocabulary; these names carry meaning elsewhere:
 * `drawOdds` wins are not counted as games won, `forfeit` marks the node
 * unplayed for pairing history. New kinds may mint their own names.
 */
export type DecisionBy = string;
export const DECIDED_BY = {
  points: "points",
  drawOdds: "drawOdds",
  forfeit: "forfeit",
  manual: "manual",
} as const;

export type Decision =
  | { readonly kind: "pending" }
  | { readonly kind: "draw" }
  | { readonly kind: "doubleLoss" }
  | {
      readonly kind: "win";
      readonly winner: Side;
      readonly by: DecisionBy;
      /** For sequential kinds: 0-based index of the deciding child (drives leg-keyed scoring). */
      readonly leg?: number | undefined;
    };

export type Outcome = {
  /** Points in definition-side order; partial sums while pending. */
  readonly points: readonly [number, number];
  readonly decision: Decision;
};

export const PENDING: Outcome = {
  points: [0, 0],
  decision: { kind: "pending" },
};

export const orient = (
  winner: Side,
  win: number,
  loss: number,
): readonly [number, number] => (winner === 0 ? [win, loss] : [loss, win]);

// ---------------------------------------------------------------------------
// The seat algebra — how the white-ish seat flows to children
//
// A node holds a seat (which side is "white-ish"). Each child either derives
// its seat from the parent through a repeating keep/flip cycle, or awaits a
// recorded lot-drawing input. zigzag boards, alternating legs, fixed colors
// are all just cycle values — see helpers.ts for the named vocabulary.

export const seatCycleSchema = z.array(z.enum(["keep", "flip"])).min(1);
export type SeatCycle = z.infer<typeof seatCycleSchema>;

export const seatRuleSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("inherit"), cycle: seatCycleSchema }),
  z.object({ source: z.literal("draw") }),
]);
export type SeatRule = z.infer<typeof seatRuleSchema>;

export const applyCycle = (
  cycle: SeatCycle,
  index: number,
  seat: Side | undefined,
): Side | undefined => {
  if (seat === undefined) return undefined;
  return cycle[index % cycle.length] === "flip" ? otherSide(seat) : seat;
};

// ---------------------------------------------------------------------------
// Inputs — the recorded log the engine folds (the host-facing wire protocol)

// TRF-style codes: X = forfeit win, F = forfeit loss, Z = unplayed scheduled draw.
export const GAME_RESULT_CODES = [
  "1-0",
  "0-1",
  "1/2-1/2",
  "1X-0F",
  "0F-1X",
  "0F-0F",
  "1/2Z-1/2Z",
] as const;
export const gameResultCodeSchema = z.enum(GAME_RESULT_CODES);
export type GameResultCode = z.infer<typeof gameResultCodeSchema>;

export type ResultClass =
  | { readonly kind: "win"; readonly color: Color; readonly forfeit: boolean }
  | { readonly kind: "draw"; readonly played: boolean }
  | { readonly kind: "doubleForfeit" };

export function classifyResult(result: GameResultCode): ResultClass {
  switch (result) {
    case "1-0":
      return { kind: "win", color: "white", forfeit: false };
    case "0-1":
      return { kind: "win", color: "black", forfeit: false };
    case "1X-0F":
      return { kind: "win", color: "white", forfeit: true };
    case "0F-1X":
      return { kind: "win", color: "black", forfeit: true };
    case "1/2-1/2":
      return { kind: "draw", played: true };
    case "1/2Z-1/2Z":
      return { kind: "draw", played: false };
    case "0F-0F":
      return { kind: "doubleForfeit" };
  }
}

/** True when no game was actually played — what TRF marks unplayed. */
export function resultUnplayed(result: GameResultCode): boolean {
  const cls = classifyResult(result);
  switch (cls.kind) {
    case "win":
      return cls.forfeit;
    case "draw":
      return !cls.played;
    case "doubleForfeit":
      return true;
  }
}

export const pairingPlanSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("pair"),
    a: competitorIdSchema,
    b: competitorIdSchema,
    whiteSeat: sideSchema,
  }),
  z.object({ kind: z.literal("bye"), competitor: competitorIdSchema }),
]);
export type PairingPlan = z.infer<typeof pairingPlanSchema>;

export const inputSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("pairingsSet"),
    pool: nodePathSchema,
    round: z.number().int().min(1),
    pairings: z.array(pairingPlanSchema).min(1),
  }),
  z.object({
    kind: z.literal("lineupSet"),
    match: nodePathSchema,
    side: sideSchema,
    players: z.array(playerIdSchema).min(1),
  }),
  z.object({
    kind: z.literal("gameResult"),
    game: nodePathSchema,
    result: gameResultCodeSchema,
  }),
  z.object({
    kind: z.literal("manualDecision"),
    node: nodePathSchema,
    winner: sideSchema,
  }),
  z.object({
    kind: z.literal("colorDraw"),
    node: nodePathSchema,
    whiteSeat: sideSchema,
  }),
  z.object({
    kind: z.literal("encounterForfeit"),
    node: nodePathSchema,
    winner: sideSchema,
  }),
]);
export type Input = z.infer<typeof inputSchema>;
export type PairingsSetInput = Extract<Input, { kind: "pairingsSet" }>;

// ---------------------------------------------------------------------------
// NodeView — how a kind instance reads the recorded inputs at its node

export const clockSchema = z.object({
  initial: z.number().int().positive(),
  increment: z.number().int().nonnegative(),
  whiteInitial: z.number().int().positive().optional(),
  blackInitial: z.number().int().positive().optional(),
});
export type Clock = z.infer<typeof clockSchema>;

export const pointScheduleSchema = z.object({
  win: z.number().finite().nonnegative().multipleOf(0.25),
  draw: z.number().finite().nonnegative().multipleOf(0.25),
  loss: z.number().finite().nonnegative().multipleOf(0.25),
});
export type PointSchedule = z.infer<typeof pointScheduleSchema>;

export const STANDARD_GAME_POINTS: PointSchedule = {
  win: 1,
  draw: 0.5,
  loss: 0,
};

/**
 * Read access to the log, scoped to one materialized node. Instances see the
 * world only through this — they never touch the raw input list.
 */
export type NodeView = {
  readonly path: NodePath;
  /** Which side holds the white-ish seat here; undefined while a draw is awaited. */
  readonly whiteSeat: Side | undefined;
  /** The two participants playing at this node (players under a match; competitors above). */
  readonly participants: readonly [ParticipantId, ParticipantId] | undefined;
  readonly result: () => GameResultCode | undefined;
  readonly manualDecision: () => Side | undefined;
  readonly lineup: (side: Side) => readonly PlayerId[] | undefined;
};

/** Work a node asks of the host or the arbiter, surfaced via nextActions. */
export type NodeWork =
  | {
      readonly kind: "createGame";
      readonly white: ParticipantId;
      readonly black: ParticipantId;
      readonly clock: Clock;
    }
  | {
      readonly kind: "awaitLineup";
      readonly side: Side;
      readonly boards: number;
    }
  | { readonly kind: "awaitManualDecision" };

/**
 * A child a kind materializes: where it lives, what it is, and how its seat
 * derives from the parent's — already resolved by the instance to keep /
 * flip / draw (the engine turns `draw` into a colorDraw await).
 */
export type Slot = {
  readonly segment: { readonly label: string; readonly n: number };
  readonly def: AnyEncounterDef;
  readonly seat: "keep" | "flip" | "draw";
  /**
   * Replace the participants for this child (match boards from lineups);
   * "pending" means they are not known yet (lineups outstanding), so the
   * child cannot schedule games.
   */
  readonly participants?:
    | readonly [ParticipantId, ParticipantId]
    | "pending"
    | undefined;
};

// ---------------------------------------------------------------------------
// The event spine — one recursive node

/** An encounter def is its kind name plus a kind-owned payload. */
export type AnyEncounterDef = { readonly kind: string } & Record<
  string,
  unknown
>;

export type PairingRef = { readonly system: string } & Record<string, unknown>;
export type ScoreRef = { readonly kind: string } & Record<string, unknown>;
export type MetricRef = { readonly metric: string } & Record<string, unknown>;
export type SeedRef = { readonly kind: string } & Record<string, unknown>;
export type TieRef = { readonly kind: string } & Record<string, unknown>;

export type ByeRule =
  | {
      readonly kind: "points";
      readonly standings: number;
      readonly encounter: number;
    }
  | { readonly kind: "advance" };

export type PoolDef = {
  readonly kind: "pool";
  readonly pairing: PairingRef;
  /** Required when the pairing kind cannot derive it (swiss, manual, unregistered). */
  readonly rounds?: number | undefined;
  readonly encounter: AnyEncounterDef;
  readonly score: ScoreRef;
  readonly bye?: ByeRule | undefined;
  /** `lockstep` holds child slot N+1 until every pair in the round resolved slot N. Scheduling only. */
  readonly legRelease?: "independent" | "lockstep" | undefined;
  readonly tiebreaks: readonly MetricRef[];
  /** What this pool calls its schedule units ("Round"/"pairing" by default). */
  readonly terms?:
    | {
        readonly round?: string | undefined;
        readonly pairing?: string | undefined;
      }
    | undefined;
};

/** A container's run: sub-competitions, recursively. */
export type CompetitionsDef = {
  readonly kind: "competitions";
  readonly competitions: readonly CompetitionDef[];
};

export type RunDef = PoolDef | AnyEncounterDef | CompetitionsDef;

/**
 * A leaf's field is either known (a seed list) or open: entrants arrive by
 * registration, so the definition cannot assume a count. Open leaves stay
 * unresolved (no pairings, no standings) until entries are bound.
 */
export type OpenEntries = { readonly open: true };
export type EntriesDef = readonly SeedRef[] | OpenEntries;

export const isOpenEntries = (entries: EntriesDef): entries is OpenEntries =>
  !Array.isArray(entries);

/**
 * THE spine node. A "leaf" runs a pool or an encounter and intakes its own
 * entrants; a "container" runs sub-competitions and intakes nothing. Same
 * attributes at every level, so a whole tournament drops into another
 * tournament unchanged. Ids are globally unique within an event — flat
 * addressing; containers never appear in node paths.
 */
export type CompetitionDef = {
  readonly id: string;
  /** Display name; the id stays the structural key. */
  readonly name?: string | undefined;
  /** Intake; REQUIRED on leaves, FORBIDDEN on containers. */
  readonly entries?: EntriesDef | undefined;
  readonly run: RunDef;
};

export type CompetitorDef = {
  readonly id: CompetitorId;
  readonly name: string;
  readonly rating?: number | undefined;
  readonly roster?: readonly PlayerId[] | undefined;
};

export type EventDef = {
  readonly id: string;
  readonly name: string;
  readonly competitors: readonly CompetitorDef[];
  /** The root (usually a container). */
  readonly competition: CompetitionDef;
};

// Quarter-point granularity: decisions compare point sums exactly, so
// schedule values must be float-exact (every quarter is, in binary).
export const finitePoints = z.number().finite().nonnegative().multipleOf(0.25);

export const idSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/, "lowercase alphanumeric with dashes");

export const isPowerOfTwo = (n: number): boolean =>
  Number.isInteger(n) && n > 1 && (n & (n - 1)) === 0;
