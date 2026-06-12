import { z } from "zod";
import {
  type AnyEncounterDef,
  type Clock,
  classifyResult,
  clockSchema,
  DECIDED_BY,
  type Decision,
  type NodeView,
  type NodeWork,
  type Outcome,
  orient,
  otherSide,
  PENDING,
  type PointSchedule,
  pointScheduleSchema,
  type SeatRule,
  STANDARD_GAME_POINTS,
  seatCycleSchema,
  seatRuleSchema,
  type TieRef,
} from "@/tournament/core";
import {
  type BoundTies,
  defineEncounterKind,
  type EncounterKind,
  type SlotOutcome,
  type TieDecision,
} from "@/tournament/registry";

/**
 * The built-in encounter kinds: game (the leaf), series (ordered legs
 * between the same two sides), match (parallel boards between two rosters).
 * Each is an ordinary registry instance — nothing here is privileged, and a
 * new kind follows exactly this shape.
 */

const minutes = (seconds: number): string =>
  seconds % 60 === 0 ? `${seconds / 60}m` : `${seconds}s`;

const clockLabel = (clock: Clock): string =>
  clock.whiteInitial !== undefined && clock.blackInitial !== undefined
    ? `${minutes(clock.whiteInitial)} vs ${minutes(clock.blackInitial)} +${clock.increment}s`
    : `${minutes(clock.initial)} +${clock.increment}s`;

/** All children resolved with equal sums → the tie rule; unequal → points win. */
function decideBySums(
  tie: TieRef | undefined,
  ties: BoundTies,
  view: NodeView,
  points: readonly [number, number],
): { outcome: Outcome; work?: readonly NodeWork[] } {
  if (points[0] !== points[1]) {
    const decision: Decision = {
      kind: "win",
      winner: points[0] > points[1] ? 0 : 1,
      by: DECIDED_BY.points,
    };
    return { outcome: { points, decision } };
  }
  const tied: TieDecision = ties.decide(tie, { view, points });
  return {
    outcome: { points, decision: tied.decision },
    ...(tied.work === undefined ? {} : { work: tied.work }),
  };
}

// Child points are in definition-side order; seats affect colors only.
const sumPoints = (
  children: readonly SlotOutcome[],
): readonly [number, number] => {
  let p0 = 0;
  let p1 = 0;
  for (const child of children) {
    p0 += child.outcome.points[0];
    p1 += child.outcome.points[1];
  }
  return [p0, p1];
};

// ---------------------------------------------------------------------------
// game — the leaf

type GameDef = {
  kind: "game";
  clock: Clock;
  points?: PointSchedule | undefined;
  tie?: TieRef | undefined;
};

export const gameKind: EncounterKind = defineEncounterKind<GameDef>({
  kind: "game",
  schema: (deps) =>
    z.object({
      kind: z.literal("game"),
      clock: clockSchema,
      points: pointScheduleSchema.optional(),
      tie: deps.tie.optional(),
    }),
  nextSlot: () => undefined,
  outcome: (def, view, _children, ties) => {
    const schedule = def.points ?? STANDARD_GAME_POINTS;
    const result = view.result();
    if (result === undefined || view.whiteSeat === undefined) {
      return { outcome: PENDING };
    }
    const whiteSeat = view.whiteSeat;
    const cls = classifyResult(result);
    switch (cls.kind) {
      case "win": {
        const winner = cls.color === "white" ? whiteSeat : otherSide(whiteSeat);
        return {
          outcome: {
            points: orient(winner, schedule.win, schedule.loss),
            decision: {
              kind: "win",
              winner,
              by: cls.forfeit ? DECIDED_BY.forfeit : DECIDED_BY.points,
            },
          },
        };
      }
      case "doubleForfeit":
        return {
          outcome: {
            points: [schedule.loss, schedule.loss],
            decision: { kind: "doubleLoss" },
          },
        };
      case "draw": {
        const points: readonly [number, number] = [
          schedule.draw,
          schedule.draw,
        ];
        const tied = ties.decide(def.tie, { view, points });
        return {
          outcome: { points, decision: tied.decision },
          ...(tied.work === undefined ? {} : { work: tied.work }),
        };
      }
    }
  },
  work: (def, view) => {
    if (view.result() !== undefined) return [];
    const seat = view.whiteSeat;
    const players = view.participants;
    if (seat === undefined || players === undefined) return [];
    return [
      {
        kind: "createGame",
        white: players[seat],
        black: players[otherSide(seat)],
        clock: def.clock,
      },
    ];
  },
  validate: (def, _ops, issue) => {
    if (
      (def.clock.whiteInitial === undefined) !==
      (def.clock.blackInitial === undefined)
    ) {
      issue(
        "per-side clock overrides must set both whiteInitial and blackInitial",
        ["clock"],
      );
    }
  },
  structure: () => [],
  nominalPoints: (def) => {
    const schedule = def.points ?? STANDARD_GAME_POINTS;
    return { win: schedule.win, loss: schedule.loss };
  },
  alwaysDecisive: (def, _ops, ties) => ties.decisive(def.tie),
  card: (def) => {
    const oddsColor =
      def.tie?.kind === "drawOdds" && typeof def.tie["color"] === "string"
        ? def.tie["color"]
        : undefined;
    const lines = [clockLabel(def.clock)];
    if (def.points !== undefined) {
      lines.push(
        `points ${def.points.win}/${def.points.draw}/${def.points.loss}`,
      );
    }
    if (def.tie?.kind === "manual") lines.push("ties: arbiter decides");
    return {
      title: oddsColor === undefined ? "Game" : "Armageddon",
      ...(oddsColor === undefined ? {} : { badge: `${oddsColor} wins draws` }),
      lines,
    };
  },
});

// ---------------------------------------------------------------------------
// series — ordered legs between the same two sides

type StopRule = {
  untilScore?: number | undefined;
  untilMargin?: number | undefined;
  untilDecided?: boolean | undefined;
};

type SeriesDef = {
  kind: "series";
  legs: AnyEncounterDef[];
  stop?: StopRule | undefined;
  seats: SeatRule;
  tie?: TieRef | undefined;
};

const stopSchema = z.object({
  untilScore: z.number().finite().positive().optional(),
  untilMargin: z.number().finite().positive().optional(),
  untilDecided: z.literal(true).optional(),
});

const isLazy = (stop: StopRule | undefined): boolean =>
  stop !== undefined &&
  (stop.untilScore !== undefined ||
    stop.untilMargin !== undefined ||
    stop.untilDecided === true);

/** The decision the stop rule produces after `children`, if it fires. */
function stopDecision(
  stop: StopRule | undefined,
  children: readonly SlotOutcome[],
): Decision | undefined {
  if (stop === undefined) return undefined;
  let p0 = 0;
  let p1 = 0;
  for (let i = 0; i < children.length; i += 1) {
    const child = children[i];
    if (child === undefined) break;
    p0 += child.outcome.points[0];
    p1 += child.outcome.points[1];
    const d = child.outcome.decision;
    if (d.kind === "pending") return undefined;

    if (stop.untilDecided === true && d.kind === "win") {
      // Inherit the deciding leg's winner structurally: a drawOdds win has
      // no points margin, so re-comparing sums could not decide the chain.
      return { kind: "win", winner: d.winner, by: d.by, leg: i };
    }
    const target = stop.untilScore;
    if (target !== undefined) {
      if (p0 >= target && p0 > p1)
        return { kind: "win", winner: 0, by: DECIDED_BY.points, leg: i };
      if (p1 >= target && p1 > p0)
        return { kind: "win", winner: 1, by: DECIDED_BY.points, leg: i };
    }
    const margin = stop.untilMargin;
    if (margin !== undefined && Math.abs(p0 - p1) >= margin) {
      return {
        kind: "win",
        winner: p0 > p1 ? 0 : 1,
        by: DECIDED_BY.points,
        leg: i,
      };
    }
  }
  return undefined;
}

export const seriesKind: EncounterKind = defineEncounterKind<SeriesDef>({
  kind: "series",
  schema: (deps) =>
    z.object({
      kind: z.literal("series"),
      legs: z.array(deps.encounter).min(1),
      stop: stopSchema.optional(),
      seats: seatRuleSchema,
      tie: deps.tie.optional(),
    }),
  nextSlot: (def, _view, resolved) => {
    const i = resolved.length;
    if (i >= def.legs.length) return undefined;
    if (isLazy(def.stop)) {
      // One leg at a time: later legs exist only once earlier ones resolved
      // without satisfying the stop rule.
      if (resolved.some((c) => c.outcome.decision.kind === "pending"))
        return undefined;
      if (stopDecision(def.stop, resolved) !== undefined) return undefined;
    }
    const legDef = def.legs[i];
    if (legDef === undefined) return undefined;
    return {
      segment: { label: "leg", n: i + 1 },
      def: legDef,
      seat:
        def.seats.source === "draw"
          ? "draw"
          : (def.seats.cycle[i % def.seats.cycle.length] ?? "keep"),
    };
  },
  outcome: (def, view, children, ties) => {
    const decided = stopDecision(def.stop, children);
    const points = sumPoints(children);
    if (decided !== undefined) {
      return { outcome: { points, decision: decided } };
    }
    if (children.some((c) => c.outcome.decision.kind === "pending")) {
      return { outcome: { points, decision: { kind: "pending" } } };
    }
    if (children.length < def.legs.length) {
      // Lazy legs still unmaterialized (e.g. awaiting a color draw).
      return { outcome: { points, decision: { kind: "pending" } } };
    }
    return decideBySums(def.tie, ties, view, points);
  },
  validate: (def, ops, issue) => {
    const target = def.stop?.untilScore;
    if (target !== undefined) {
      const max = def.legs.reduce(
        (sum, leg) => sum + ops.nominalPoints(leg).win,
        0,
      );
      if (target > max) {
        issue(
          `untilScore ${target} exceeds the ${max} points reachable in this series`,
          ["stop", "untilScore"],
        );
      }
    }
    def.legs.forEach((leg, i) => {
      ops.validate(leg, (message, path = []) =>
        issue(message, ["legs", i, ...path]),
      );
    });
  },
  structure: (def) =>
    def.legs.map((leg, i) => ({ def: leg, role: `leg ${i + 1}` })),
  nominalPoints: (def, ops) =>
    def.legs.reduce(
      (acc, leg) => {
        const n = ops.nominalPoints(leg);
        return { win: acc.win + n.win, loss: acc.loss + n.loss };
      },
      { win: 0, loss: 0 },
    ),
  alwaysDecisive: (def, ops, ties) => {
    if (ties.decisive(def.tie)) return true;
    if (def.stop?.untilDecided === true) {
      const last = def.legs[def.legs.length - 1];
      return last !== undefined && ops.alwaysDecisive(last);
    }
    return false;
  },
  rosterNeed: (def, ops) =>
    def.legs.reduce((max, leg) => Math.max(max, ops.rosterNeed(leg)), 0),
  card: (def) => {
    const stop = def.stop;
    const badge =
      stop?.untilScore !== undefined
        ? `first to ${stop.untilScore}`
        : stop?.untilMargin !== undefined
          ? `win by ${stop.untilMargin}`
          : stop?.untilDecided === true
            ? "until decided"
            : `all ${def.legs.length} legs`;
    const seats =
      def.seats.source === "draw"
        ? "colors drawn per leg"
        : def.seats.cycle.every((s) => s === "keep")
          ? "colors fixed"
          : `seat cycle ${def.seats.cycle.join("/")}`;
    return { title: "Series", badge, lines: [seats] };
  },
});

// ---------------------------------------------------------------------------
// match — parallel boards between two rosters

type MatchDef = {
  kind: "match";
  boards: number;
  board: AnyEncounterDef;
  seats: { cycle: z.infer<typeof seatCycleSchema> };
  tie?: TieRef | undefined;
};

export const matchKind: EncounterKind = defineEncounterKind<MatchDef>({
  kind: "match",
  schema: (deps) =>
    z.object({
      kind: z.literal("match"),
      boards: z.number().int().min(1),
      board: deps.encounter,
      seats: z.object({ cycle: seatCycleSchema }),
      tie: deps.tie.optional(),
    }),
  nextSlot: (def, view, resolved) => {
    const i = resolved.length;
    if (i >= def.boards) return undefined;
    const a = view.lineup(0);
    const b = view.lineup(1);
    const pa = a?.[i];
    const pb = b?.[i];
    return {
      segment: { label: "board", n: i + 1 },
      def: def.board,
      seat: def.seats.cycle[i % def.seats.cycle.length] ?? "keep",
      participants: pa !== undefined && pb !== undefined ? [pa, pb] : "pending",
    };
  },
  outcome: (def, view, children, ties) => {
    const points = sumPoints(children);
    if (
      children.length < def.boards ||
      children.some((c) => c.outcome.decision.kind === "pending")
    ) {
      return { outcome: { points, decision: { kind: "pending" } } };
    }
    return decideBySums(def.tie, ties, view, points);
  },
  work: (def, view) => {
    const work: NodeWork[] = [];
    for (const side of [0, 1] as const) {
      if (view.lineup(side) === undefined) {
        work.push({ kind: "awaitLineup", side, boards: def.boards });
      }
    }
    return work;
  },
  validate: (def, ops, issue) => {
    ops.validate(def.board, (message, path = []) =>
      issue(message, ["board", ...path]),
    );
  },
  structure: (def) => [
    { def: def.board, role: "per board", count: def.boards },
  ],
  nominalPoints: (def, ops) => {
    const per = ops.nominalPoints(def.board);
    return { win: per.win * def.boards, loss: per.loss * def.boards };
  },
  alwaysDecisive: (def, _ops, ties) => ties.decisive(def.tie),
  rosterNeed: (def, ops) => Math.max(def.boards, ops.rosterNeed(def.board)),
  card: (def) => ({
    title: "Team match",
    badge: `${def.boards} boards`,
    lines: [
      def.seats.cycle.every((s) => s === "keep")
        ? "all boards take the team color"
        : `board seat cycle ${def.seats.cycle.join("/")}`,
    ],
  }),
});

export const builtinEncounters: readonly EncounterKind[] = [
  gameKind,
  seriesKind,
  matchKind,
];

/** Lineups arrive per match node side; this is the input key vocabulary the match kind reads. */
export type {
  MatchDef as MatchKindDef,
  SeriesDef as SeriesKindDef,
  GameDef as GameKindDef,
};
