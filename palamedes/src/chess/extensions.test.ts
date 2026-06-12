// @vitest-environment node
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { runEvent } from "@/tournament/builder";
import {
  type AnyEncounterDef,
  DECIDED_BY,
  PENDING,
  type Side,
  sideSchema,
} from "@/tournament/core";
import {
  defineEncounterKind,
  defineScoringKind,
  extendRegistry,
  parseEventDef,
} from "@/tournament/registry";
import { chessRegistry } from "./registry";

/**
 * The extensibility proof: a brand-new encounter kind (handicap/odds play)
 * and a brand-new scoring kind (arena streak scoring) defined HERE — outside
 * the system AND outside the chess library — registered alongside the
 * built-ins, parsed, and run end-to-end. No core file knows they exist.
 */

type HandicapDef = {
  kind: "handicap";
  ahead: Side;
  head: number;
  of: AnyEncounterDef;
};

/** Odds play: one side starts the encounter with a points head start. */
const handicapKind = defineEncounterKind<HandicapDef>({
  kind: "handicap",
  schema: (deps) =>
    z.object({
      kind: z.literal("handicap"),
      ahead: sideSchema,
      head: z.number().positive().multipleOf(0.25),
      of: deps.encounter,
    }),
  nextSlot: (def, _view, resolved) =>
    resolved.length === 0
      ? { segment: { label: "inner", n: 1 }, def: def.of, seat: "keep" }
      : undefined,
  outcome: (def, _view, children) => {
    const inner = children[0]?.outcome ?? PENDING;
    const points: readonly [number, number] =
      def.ahead === 0
        ? [inner.points[0] + def.head, inner.points[1]]
        : [inner.points[0], inner.points[1] + def.head];
    if (inner.decision.kind === "pending") {
      return { outcome: { points, decision: { kind: "pending" } } };
    }
    if (points[0] === points[1]) {
      return { outcome: { points, decision: { kind: "draw" } } };
    }
    return {
      outcome: {
        points,
        decision: {
          kind: "win",
          winner: points[0] > points[1] ? 0 : 1,
          by: DECIDED_BY.points,
        },
      },
    };
  },
  structure: (def) => [{ def: def.of, role: "with a head start" }],
  nominalPoints: (def, ops) => {
    const inner = ops.nominalPoints(def.of);
    return def.ahead === 0
      ? { win: inner.win + def.head, loss: inner.loss }
      : { win: inner.win, loss: inner.loss };
  },
  alwaysDecisive: () => false,
  card: (def) => ({
    title: "Handicap",
    badge: `side ${def.ahead} starts +${def.head}`,
    lines: [],
  }),
});

type ArenaRule = {
  kind: "arena";
  win: number;
  draw: number;
  streak: number;
};

/** Lichess-style streak scoring: after `streak` consecutive wins, points double. */
const arenaScoring = defineScoringKind<ArenaRule>({
  kind: "arena",
  schema: z.object({
    kind: z.literal("arena"),
    win: z.number().positive(),
    draw: z.number().nonnegative(),
    streak: z.number().int().positive(),
  }),
  points: (rule, line, history) => {
    const d = line.outcome.decision;
    const base =
      d.kind === "win" && d.winner === line.side
        ? rule.win
        : d.kind === "draw"
          ? rule.draw
          : 0;
    const tail = history.slice(-rule.streak);
    const onStreak =
      tail.length === rule.streak &&
      tail.every((scored) => {
        const sd = scored.outcome.decision;
        return sd.kind === "win" && sd.winner === scored.side;
      });
    return onStreak ? base * 2 : base;
  },
});

const registry = extendRegistry(chessRegistry, {
  encounters: [handicapKind],
  scorings: [arenaScoring],
});

const game = { kind: "game", clock: { initial: 180, increment: 2 } };

describe("third-party kinds run end-to-end without touching the core", () => {
  it("handicap: a drawn game loses for the side giving odds", () => {
    const def = parseEventDef(
      {
        id: "odds-match",
        name: "Odds match",
        competitors: [
          { id: "master", name: "Master" },
          { id: "club", name: "Club player" },
        ],
        competition: {
          id: "duel",
          entries: [
            { kind: "registration", seed: 1 },
            { kind: "registration", seed: 2 },
          ],
          // The club player starts half a point ahead: master must win.
          run: { kind: "handicap", ahead: 1, head: 0.5, of: game },
        },
      },
      registry,
    );

    const drawn = runEvent(def, registry).game(
      "Master",
      "Club player",
      "1/2-1/2",
    );
    expect(drawn.winnerName()).toBe("Club player");

    const won = runEvent(def, registry).game("Master", "Club player", "1-0");
    expect(won.winnerName()).toBe("Master");
  });

  it("arena scoring: points double after a win streak", () => {
    const def = parseEventDef(
      {
        id: "mini-arena",
        name: "Mini arena",
        competitors: [
          { id: "a", name: "Ann" },
          { id: "b", name: "Ben" },
        ],
        competition: {
          id: "arena",
          entries: [
            { kind: "registration", seed: 1 },
            { kind: "registration", seed: 2 },
          ],
          run: {
            kind: "pool",
            pairing: { system: "manual" },
            rounds: 3,
            encounter: game,
            score: { kind: "arena", win: 2, draw: 1, streak: 2 },
            tiebreaks: [],
          },
        },
      },
      registry,
    );

    const run = runEvent(def, registry)
      .pairManual([["Ann", "Ben"]])
      .game("Ann", "Ben", "1-0")
      .pairManual([["Ann", "Ben"]])
      .game("Ann", "Ben", "1-0")
      .pairManual([["Ann", "Ben"]])
      .game("Ann", "Ben", "1/2-1/2");

    // 2, 2, then a doubled draw after two straight wins.
    const rows = run.standings();
    expect(rows.find((r) => r.competitor === "a")?.standingsPoints).toBe(6);
    expect(rows.find((r) => r.competitor === "b")?.standingsPoints).toBe(1);
  });

  it("an unknown kind is an arbiter-grade parse error against the base registry", () => {
    const result = chessRegistry.eventSchema.safeParse({
      id: "odds-match",
      name: "Odds match",
      competitors: [
        { id: "m", name: "M" },
        { id: "c", name: "C" },
      ],
      competition: {
        id: "duel",
        entries: [
          { kind: "registration", seed: 1 },
          { kind: "registration", seed: 2 },
        ],
        run: { kind: "handicap", ahead: 1, head: 0.5, of: game },
      },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.message).join("\n")).toContain(
        'unknown encounter kind "handicap"',
      );
    }
  });
});
