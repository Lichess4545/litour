import { z } from "zod";

/**
 * Tournament definitions: the recursive meta-model described in
 * design/tournament-model.md.
 *
 * Two sorts of things exist. An Encounter (game | series | match) is a
 * contest between two sides producing a two-sided outcome; encounters nest
 * freely. A Pool schedules N competitors into encounters via a pairing
 * system and produces standings. An Event is a flat list of stages of
 * parallel groups, each running one pool or one root encounter, with seed
 * rules carrying competitors between stages.
 *
 * Definitions are data: authored as JSON, validated by `parseEventDef`.
 */

// ---------------------------------------------------------------------------
// Identifiers and node paths

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

const PATH_ID = "[a-z0-9][a-z0-9-]*";
const PATH_N = "[1-9][0-9]*";
// The full address grammar, not just segment syntax: every path starts at a
// group, optionally descends into a pool round/pair, then encounter legs and
// boards. (The lone round-without-pair form is pairPath's intermediate step.)
const NODE_PATH_REGEX = new RegExp(
  `^stage-${PATH_ID}/group-${PATH_ID}(?:/round-${PATH_N}(?:/pair-${PATH_N})?)?(?:/(?:leg|board)-${PATH_N})*$`,
);

/**
 * Stable, serializable address of a materialized node:
 * `stage-<id>/group-<id>[/round-<n>/pair-<n>][/leg-<n>|/board-<n>...]`.
 * The schema enforces the grammar above; whether a path resolves to a live
 * node is checked when it is used. Construct via the path helpers below.
 */
export const nodePathSchema = z
  .string()
  .regex(NODE_PATH_REGEX)
  .brand<"NodePath">();
export type NodePath = z.infer<typeof nodePathSchema>;

export type PathSegment =
  | { readonly kind: "stage"; readonly id: string }
  | { readonly kind: "group"; readonly id: string }
  | { readonly kind: "round"; readonly n: number }
  | { readonly kind: "pair"; readonly n: number }
  | { readonly kind: "leg"; readonly n: number }
  | { readonly kind: "board"; readonly n: number };

const segmentToString = (segment: PathSegment): string =>
  segment.kind === "stage" || segment.kind === "group"
    ? `${segment.kind}-${segment.id}`
    : `${segment.kind}-${segment.n}`;

export const nodePath = (segments: readonly PathSegment[]): NodePath =>
  nodePathSchema.parse(segments.map(segmentToString).join("/"));

export const appendPath = (parent: NodePath, segment: PathSegment): NodePath =>
  nodePathSchema.parse(`${parent}/${segmentToString(segment)}`);

export const groupRootPath = (stageId: string, groupId: string): NodePath =>
  nodePath([
    { kind: "stage", id: stageId },
    { kind: "group", id: groupId },
  ]);

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
    const kind = raw.slice(0, dash);
    const rest = raw.slice(dash + 1);
    switch (kind) {
      case "stage":
      case "group":
        return { kind, id: rest };
      case "round":
      case "pair":
      case "leg":
      case "board":
        return { kind, n: Number.parseInt(rest, 10) };
      default:
        throw new Error(`invalid node path segment: ${raw}`);
    }
  });
}

// ---------------------------------------------------------------------------
// Encounter definitions (the recursive sort)

export type PointSchedule = {
  readonly win: number;
  readonly draw: number;
  readonly loss: number;
};

export const STANDARD_GAME_POINTS: PointSchedule = {
  win: 1,
  draw: 0.5,
  loss: 0,
};

/** Tie rules available on composite encounters (series, match). */
export type CompositeTieRule =
  | { readonly kind: "draw" }
  | { readonly kind: "manual" };

/** Tie rules available on games; `drawOdds` makes the game an armageddon. */
export type GameTieRule =
  | CompositeTieRule
  | { readonly kind: "drawOdds"; readonly color: Color };

export type Clock = {
  /** Base time in seconds for both players unless overridden per side. */
  readonly initial: number;
  /** Increment in seconds per move. */
  readonly increment: number;
  readonly whiteInitial?: number | undefined;
  readonly blackInitial?: number | undefined;
};

export type GameDef = {
  readonly kind: "game";
  readonly clock: Clock;
  /** Points the game contributes upward; defaults to 1 / 0.5 / 0. */
  readonly points?: PointSchedule | undefined;
  readonly tie?: GameTieRule | undefined;
};

export type StopRule =
  | { readonly kind: "all" }
  | { readonly kind: "firstTo"; readonly points: number }
  | { readonly kind: "untilDecisive" };

export type SeriesColors = "alternate" | "fixed" | "redraw";

/** Ordered legs between the same two sides (mini-matches, tiebreak chains). */
export type SeriesDef = {
  readonly kind: "series";
  readonly legs: readonly EncounterDef[];
  readonly stop: StopRule;
  readonly colors: SeriesColors;
  readonly tie?: CompositeTieRule | undefined;
};

export type MatchColors = "zigzag" | "uniform";

/** Parallel boards between two rosters; lineups arrive as inputs. */
export type MatchDef = {
  readonly kind: "match";
  readonly boards: number;
  readonly board: EncounterDef;
  readonly colors: MatchColors;
  readonly tie?: CompositeTieRule | undefined;
};

export type EncounterDef = GameDef | SeriesDef | MatchDef;

// ---------------------------------------------------------------------------
// Pool definitions

export type PairingRef =
  | { readonly system: "roundRobin"; readonly cycles: 1 | 2 }
  | { readonly system: "swiss" }
  | {
      readonly system: "knockout";
      readonly seeding: "traditional" | "adjacent" | "manual";
      readonly thirdPlace?: boolean | undefined;
    }
  | { readonly system: "manual" };

export type ScoreRule =
  | { readonly kind: "encounterPoints" }
  | {
      readonly kind: "perEncounter";
      readonly win: number;
      readonly draw: number;
      readonly loss: number;
    }
  | {
      readonly kind: "byLeg";
      readonly legs: readonly { readonly win: number; readonly loss: number }[];
      readonly draw?: number | undefined;
    };

export type ByeRule =
  | {
      readonly kind: "points";
      readonly standings: number;
      readonly encounter: number;
    }
  | { readonly kind: "advance" };

export type MetricRef =
  | { readonly metric: "encounterPoints" }
  | { readonly metric: "matchWins" }
  | { readonly metric: "gamesWon" }
  | { readonly metric: "boardPoints"; readonly board: number }
  | { readonly metric: "buchholz"; readonly cut?: number | undefined }
  | { readonly metric: "sonnebornBerger" }
  | {
      readonly metric: "extendedSB";
      readonly opponentTotal: "standings" | "encounter";
      readonly scored: "standings" | "encounter";
    }
  | { readonly metric: "headToHead" };

export type PoolDef = {
  readonly kind: "pool";
  readonly pairing: PairingRef;
  /** Required for swiss/manual pairing; derived for roundRobin/knockout. */
  readonly rounds?: number | undefined;
  readonly encounter: EncounterDef;
  readonly score: ScoreRule;
  /** Defaults to `advance` for knockout pools; other pools must configure it before a bye can be accepted. */
  readonly bye?: ByeRule | undefined;
  /** `lockstep` holds series leg N+1 until every pair in the round finished leg N. Scheduling only. */
  readonly legRelease?: "independent" | "lockstep" | undefined;
  readonly tiebreaks: readonly MetricRef[];
};

export type RunDef = PoolDef | EncounterDef;

// ---------------------------------------------------------------------------
// Event definitions (flat staging — deliberately not recursive)

export type SeedSource =
  | { readonly kind: "registration"; readonly seed: number }
  | { readonly kind: "fixed"; readonly id: CompetitorId }
  | {
      readonly kind: "rank";
      readonly stage: string;
      readonly group: string;
      readonly rank: number;
    };

export type GroupDef = {
  readonly id: string;
  readonly entries: readonly SeedSource[];
  readonly run: RunDef;
};

export type StageDef = {
  readonly id: string;
  readonly groups: readonly GroupDef[];
};

export type CompetitorDef = {
  readonly id: CompetitorId;
  readonly name: string;
  readonly rating?: number | undefined;
  /** Board-order roster; required when the competitor plays match encounters. */
  readonly roster?: readonly PlayerId[] | undefined;
};

export type EventDef = {
  readonly id: string;
  readonly name: string;
  readonly competitors: readonly CompetitorDef[];
  readonly stages: readonly StageDef[];
};

// ---------------------------------------------------------------------------
// Structural helpers shared by validation and the engine

/** Upper bound on the points one side can take from an encounter (used for `firstTo` validation and forfeits). */
export function nominalWinPoints(def: EncounterDef): number {
  switch (def.kind) {
    case "game":
      return (def.points ?? STANDARD_GAME_POINTS).win;
    case "series":
      return def.legs.reduce((sum, leg) => sum + nominalWinPoints(leg), 0);
    case "match":
      return def.boards * nominalWinPoints(def.board);
  }
}

/** Points the losing side of a forfeited encounter receives. */
export function nominalLossPoints(def: EncounterDef): number {
  switch (def.kind) {
    case "game":
      return (def.points ?? STANDARD_GAME_POINTS).loss;
    case "series":
      return def.legs.reduce((sum, leg) => sum + nominalLossPoints(leg), 0);
    case "match":
      return def.boards * nominalLossPoints(def.board);
  }
}

/** Deepest board count of any match node in the encounter tree (0 when none). */
export function maxBoards(def: EncounterDef): number {
  switch (def.kind) {
    case "game":
      return 0;
    case "series":
      return def.legs.reduce((max, leg) => Math.max(max, maxBoards(leg)), 0);
    case "match":
      return Math.max(def.boards, maxBoards(def.board));
  }
}

export function defaultedByeRule(pool: PoolDef): ByeRule | undefined {
  if (pool.bye !== undefined) return pool.bye;
  return pool.pairing.system === "knockout" ? { kind: "advance" } : undefined;
}

/** Knockouts rank by elimination depth; every other pool ranks by points. */
export function defaultedRank(pool: PoolDef): "points" | "progression" {
  return pool.pairing.system === "knockout" ? "progression" : "points";
}

/**
 * True when this encounter can never end undecided: its tie rule is
 * drawOdds/manual, or it is an untilDecisive series whose last leg cannot
 * tie. Knockout pools require this — a drawn tie would block advancement.
 */
export function decisivenessGuaranteed(def: EncounterDef): boolean {
  switch (def.kind) {
    case "game":
      return def.tie?.kind === "drawOdds" || def.tie?.kind === "manual";
    case "series":
      if (def.tie?.kind === "manual") return true;
      if (def.stop.kind === "untilDecisive") {
        const last = def.legs[def.legs.length - 1];
        return last !== undefined && decisivenessGuaranteed(last);
      }
      return false;
    case "match":
      return def.tie?.kind === "manual";
  }
}

export const isPowerOfTwo = (n: number): boolean =>
  Number.isInteger(n) && n > 1 && (n & (n - 1)) === 0;

/** Total rounds a pool plays, given its entrant count. */
export function poolTotalRounds(pool: PoolDef, entrantCount: number): number {
  switch (pool.pairing.system) {
    case "roundRobin": {
      const perCycle = entrantCount % 2 === 0 ? entrantCount - 1 : entrantCount;
      return perCycle * pool.pairing.cycles;
    }
    case "knockout":
      return Math.round(Math.log2(entrantCount));
    case "swiss":
    case "manual":
      return pool.rounds ?? 0;
  }
}

// ---------------------------------------------------------------------------
// Zod schemas (hand-written types above are the source of truth)

const idSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/, "lowercase alphanumeric with dashes");

// Quarter-point granularity: decisions compare point sums exactly, so the
// schedule values must be float-exact (every quarter is, in binary).
const finitePoints = z.number().finite().nonnegative().multipleOf(0.25);

const pointScheduleSchema = z.object({
  win: finitePoints,
  draw: finitePoints,
  loss: finitePoints,
}) satisfies z.ZodType<PointSchedule>;

const compositeTieRuleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("draw") }),
  z.object({ kind: z.literal("manual") }),
]) satisfies z.ZodType<CompositeTieRule>;

const gameTieRuleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("draw") }),
  z.object({ kind: z.literal("manual") }),
  z.object({ kind: z.literal("drawOdds"), color: z.enum(["white", "black"]) }),
]) satisfies z.ZodType<GameTieRule>;

const clockSchema = z.object({
  initial: z.number().int().positive(),
  increment: z.number().int().nonnegative(),
  whiteInitial: z.number().int().positive().optional(),
  blackInitial: z.number().int().positive().optional(),
}) satisfies z.ZodType<Clock>;

const gameDefSchema = z.object({
  kind: z.literal("game"),
  clock: clockSchema,
  points: pointScheduleSchema.optional(),
  tie: gameTieRuleSchema.optional(),
}) satisfies z.ZodType<GameDef>;

export const encounterDefSchema: z.ZodType<EncounterDef> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    gameDefSchema,
    seriesDefSchema,
    matchDefSchema,
  ]),
);

const stopRuleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("all") }),
  z.object({
    kind: z.literal("firstTo"),
    points: z.number().finite().positive(),
  }),
  z.object({ kind: z.literal("untilDecisive") }),
]) satisfies z.ZodType<StopRule>;

const seriesDefSchema = z.object({
  kind: z.literal("series"),
  legs: z.array(encounterDefSchema).min(1),
  stop: stopRuleSchema,
  colors: z.enum(["alternate", "fixed", "redraw"]),
  tie: compositeTieRuleSchema.optional(),
}) satisfies z.ZodType<SeriesDef>;

const matchDefSchema = z.object({
  kind: z.literal("match"),
  boards: z.number().int().min(1),
  board: encounterDefSchema,
  colors: z.enum(["zigzag", "uniform"]),
  tie: compositeTieRuleSchema.optional(),
}) satisfies z.ZodType<MatchDef>;

const pairingRefSchema = z.discriminatedUnion("system", [
  z.object({
    system: z.literal("roundRobin"),
    cycles: z.union([z.literal(1), z.literal(2)]),
  }),
  z.object({ system: z.literal("swiss") }),
  z.object({
    system: z.literal("knockout"),
    seeding: z.enum(["traditional", "adjacent", "manual"]),
    thirdPlace: z.boolean().optional(),
  }),
  z.object({ system: z.literal("manual") }),
]) satisfies z.ZodType<PairingRef>;

const scoreRuleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("encounterPoints") }),
  z.object({
    kind: z.literal("perEncounter"),
    win: finitePoints,
    draw: finitePoints,
    loss: finitePoints,
  }),
  z.object({
    kind: z.literal("byLeg"),
    legs: z.array(z.object({ win: finitePoints, loss: finitePoints })).min(1),
    draw: finitePoints.optional(),
  }),
]) satisfies z.ZodType<ScoreRule>;

const byeRuleSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("points"),
    standings: finitePoints,
    encounter: finitePoints,
  }),
  z.object({ kind: z.literal("advance") }),
]) satisfies z.ZodType<ByeRule>;

const metricRefSchema = z.discriminatedUnion("metric", [
  z.object({ metric: z.literal("encounterPoints") }),
  z.object({ metric: z.literal("matchWins") }),
  z.object({ metric: z.literal("gamesWon") }),
  z.object({
    metric: z.literal("boardPoints"),
    board: z.number().int().min(1),
  }),
  z.object({
    metric: z.literal("buchholz"),
    cut: z.number().int().min(1).optional(),
  }),
  z.object({ metric: z.literal("sonnebornBerger") }),
  z.object({
    metric: z.literal("extendedSB"),
    opponentTotal: z.enum(["standings", "encounter"]),
    scored: z.enum(["standings", "encounter"]),
  }),
  z.object({ metric: z.literal("headToHead") }),
]) satisfies z.ZodType<MetricRef>;

const poolDefSchema = z.object({
  kind: z.literal("pool"),
  pairing: pairingRefSchema,
  rounds: z.number().int().min(1).optional(),
  encounter: encounterDefSchema,
  score: scoreRuleSchema,
  bye: byeRuleSchema.optional(),
  legRelease: z.enum(["independent", "lockstep"]).optional(),
  tiebreaks: z.array(metricRefSchema),
}) satisfies z.ZodType<PoolDef>;

export const runDefSchema: z.ZodType<RunDef> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    poolDefSchema,
    gameDefSchema,
    seriesDefSchema,
    matchDefSchema,
  ]),
);

const seedSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("registration"), seed: z.number().int().min(1) }),
  z.object({ kind: z.literal("fixed"), id: competitorIdSchema }),
  z.object({
    kind: z.literal("rank"),
    stage: idSchema,
    group: idSchema,
    rank: z.number().int().min(1),
  }),
]) satisfies z.ZodType<SeedSource>;

const groupDefSchema = z.object({
  id: idSchema,
  entries: z.array(seedSourceSchema).min(1),
  run: runDefSchema,
}) satisfies z.ZodType<GroupDef>;

const stageDefSchema = z.object({
  id: idSchema,
  groups: z.array(groupDefSchema).min(1),
}) satisfies z.ZodType<StageDef>;

const competitorDefSchema = z.object({
  id: competitorIdSchema,
  name: z.string().min(1),
  rating: z.number().int().positive().optional(),
  roster: z.array(playerIdSchema).min(1).optional(),
}) satisfies z.ZodType<CompetitorDef>;

const eventDefBaseSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  competitors: z.array(competitorDefSchema).min(1),
  stages: z.array(stageDefSchema).min(1),
}) satisfies z.ZodType<EventDef>;

// ---------------------------------------------------------------------------
// Cross-cutting validation

type Issue = {
  readonly message: string;
  readonly path: readonly (string | number)[];
};

function validateEncounter(
  enc: EncounterDef,
  path: readonly (string | number)[],
  issues: Issue[],
): void {
  switch (enc.kind) {
    case "game":
      if (
        (enc.clock.whiteInitial === undefined) !==
        (enc.clock.blackInitial === undefined)
      ) {
        issues.push({
          message:
            "per-side clock overrides must set both whiteInitial and blackInitial",
          path: [...path, "clock"],
        });
      }
      return;
    case "series": {
      if (enc.stop.kind === "firstTo") {
        const max = nominalWinPoints(enc);
        if (enc.stop.points > max) {
          issues.push({
            message: `firstTo target ${enc.stop.points} exceeds the ${max} points reachable in this series`,
            path: [...path, "stop", "points"],
          });
        }
      }
      enc.legs.forEach((leg, i) => {
        validateEncounter(leg, [...path, "legs", i], issues);
      });
      return;
    }
    case "match":
      validateEncounter(enc.board, [...path, "board"], issues);
      return;
  }
}

function validatePool(
  pool: PoolDef,
  entryCount: number,
  path: readonly (string | number)[],
  issues: Issue[],
): void {
  const needsRounds =
    pool.pairing.system === "swiss" || pool.pairing.system === "manual";
  if (needsRounds && pool.rounds === undefined) {
    issues.push({
      message: `${pool.pairing.system} pools must declare rounds`,
      path: [...path, "rounds"],
    });
  }
  if (!needsRounds && pool.rounds !== undefined) {
    issues.push({
      message: `${pool.pairing.system} pools derive their round count; omit rounds`,
      path: [...path, "rounds"],
    });
  }
  if (pool.pairing.system === "knockout" && !isPowerOfTwo(entryCount)) {
    issues.push({
      message: `knockout pools need a power-of-two field; got ${entryCount} entries`,
      path: [...path],
    });
  }
  if (
    pool.pairing.system === "knockout" &&
    !decisivenessGuaranteed(pool.encounter)
  ) {
    issues.push({
      message:
        "knockout encounters must always produce a winner: give the top node a manual tie rule, " +
        "draw odds, or end an untilDecisive series with an armageddon",
      path: [...path, "encounter"],
    });
  }
  if (pool.score.kind === "byLeg") {
    if (pool.encounter.kind !== "series") {
      issues.push({
        message: "byLeg scoring requires a series encounter",
        path: [...path, "score"],
      });
    } else if (pool.score.legs.length !== pool.encounter.legs.length) {
      issues.push({
        message: `byLeg declares ${pool.score.legs.length} legs but the series has ${pool.encounter.legs.length}`,
        path: [...path, "score", "legs"],
      });
    }
  }
  validateEncounter(pool.encounter, [...path, "encounter"], issues);
}

function validateEvent(event: EventDef): readonly Issue[] {
  const issues: Issue[] = [];

  const competitorIds = new Set<string>();
  const competitorNames = new Set<string>();
  const allPlayerIds = new Set<string>();
  event.competitors.forEach((competitor, i) => {
    if (competitorIds.has(competitor.id)) {
      issues.push({
        message: `duplicate competitor id ${competitor.id}`,
        path: ["competitors", i, "id"],
      });
    }
    competitorIds.add(competitor.id);
    if (competitorNames.has(competitor.name)) {
      issues.push({
        message: `duplicate competitor name ${competitor.name}`,
        path: ["competitors", i, "name"],
      });
    }
    competitorNames.add(competitor.name);
    competitor.roster?.forEach((player, j) => {
      if (allPlayerIds.has(player)) {
        issues.push({
          message: `player ${player} appears in more than one roster`,
          path: ["competitors", i, "roster", j],
        });
      }
      allPlayerIds.add(player);
    });
  });

  const stageIds = new Set<string>();
  const groupEntryCounts = new Map<string, number>();
  event.stages.forEach((stage, si) => {
    if (stageIds.has(stage.id)) {
      issues.push({
        message: `duplicate stage id ${stage.id}`,
        path: ["stages", si, "id"],
      });
    }
    stageIds.add(stage.id);

    const groupIds = new Set<string>();
    stage.groups.forEach((group, gi) => {
      const path = ["stages", si, "groups", gi] as const;
      if (groupIds.has(group.id)) {
        issues.push({
          message: `duplicate group id ${group.id} in stage ${stage.id}`,
          path: [...path, "id"],
        });
      }
      groupIds.add(group.id);
      groupEntryCounts.set(`${stage.id}/${group.id}`, group.entries.length);

      group.entries.forEach((entry, ei) => {
        const entryPath = [...path, "entries", ei] as const;
        switch (entry.kind) {
          case "registration":
            if (entry.seed > event.competitors.length) {
              issues.push({
                message: `registration seed ${entry.seed} exceeds the ${event.competitors.length} declared competitors`,
                path: [...entryPath, "seed"],
              });
            }
            break;
          case "fixed":
            if (!competitorIds.has(entry.id)) {
              issues.push({
                message: `unknown competitor ${entry.id}`,
                path: [...entryPath, "id"],
              });
            }
            break;
          case "rank": {
            const sourceStageIndex = event.stages.findIndex(
              (s) => s.id === entry.stage,
            );
            if (sourceStageIndex === -1 || sourceStageIndex >= si) {
              issues.push({
                message: `rank source must reference an earlier stage; ${entry.stage} is not one`,
                path: [...entryPath, "stage"],
              });
            } else {
              const count = groupEntryCounts.get(
                `${entry.stage}/${entry.group}`,
              );
              if (count === undefined) {
                issues.push({
                  message: `unknown group ${entry.group} in stage ${entry.stage}`,
                  path: [...entryPath, "group"],
                });
              } else if (entry.rank > count) {
                issues.push({
                  message: `rank ${entry.rank} exceeds the ${count} entries of ${entry.stage}/${entry.group}`,
                  path: [...entryPath, "rank"],
                });
              }
            }
            break;
          }
        }
      });

      if (group.run.kind === "pool") {
        validatePool(group.run, group.entries.length, [...path, "run"], issues);
      } else {
        if (group.entries.length !== 2) {
          issues.push({
            message: `a root encounter needs exactly 2 entries; group ${group.id} has ${group.entries.length}`,
            path: [...path, "entries"],
          });
        }
        validateEncounter(group.run, [...path, "run"], issues);
      }

      const boards = maxBoards(
        group.run.kind === "pool" ? group.run.encounter : group.run,
      );
      if (boards > 0) {
        group.entries.forEach((entry, ei) => {
          const fixedId =
            entry.kind === "fixed"
              ? entry.id
              : entry.kind === "registration"
                ? event.competitors[entry.seed - 1]?.id
                : undefined;
          if (fixedId === undefined) return;
          const competitor = event.competitors.find((c) => c.id === fixedId);
          if (
            competitor !== undefined &&
            (competitor.roster?.length ?? 0) < boards
          ) {
            issues.push({
              message: `${competitor.name} needs a roster of at least ${boards} players for this group`,
              path: [...path, "entries", ei],
            });
          }
        });
      }
    });
  });

  return issues;
}

export const eventDefSchema = eventDefBaseSchema
  .superRefine((event, ctx) => {
    for (const issue of validateEvent(event)) {
      ctx.addIssue({
        code: "custom",
        message: issue.message,
        path: [...issue.path],
      });
    }
  })
  .brand<"ParsedEventDef">();

/**
 * An EventDef that has passed every cross-cutting refinement. The engine only
 * accepts this brand, so an unparsed literal can't reach it carrying broken
 * invariants (non-power-of-two knockouts, missing swiss rounds, ...).
 */
export type ParsedEventDef = z.infer<typeof eventDefSchema>;

/** Parse and fully validate an event definition; throws listing every issue. */
export function parseEventDef(data: unknown): ParsedEventDef {
  return eventDefSchema.parse(data);
}

/** Like `parseEventDef` but returns the issues instead of throwing. */
export function safeParseEventDef(data: unknown) {
  return eventDefSchema.safeParse(data);
}
