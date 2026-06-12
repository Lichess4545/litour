import { z } from "zod";
import { finitePoints } from "@/tournament/core";
import { defineScoringKind, type ScoringKind } from "@/tournament/registry";

/**
 * Built-in scoring kinds — how a pool turns one encounter outcome into
 * standings points. `passThrough` keeps the encounter's own sums (game
 * points); `table` maps the decision through a win/draw/loss table,
 * optionally keyed by the deciding leg (match points, Norway's 3/1.5/1/0).
 */

export const passThroughScoring: ScoringKind = defineScoringKind({
  kind: "passThrough",
  schema: z.object({ kind: z.literal("passThrough") }),
  points: (_rule, line) => line.outcome.points[line.side],
  card: () => ({
    title: "Game points",
    lines: ["each side keeps its points"],
  }),
});

type TableRule = {
  kind: "table";
  draw: number;
  /** Row i applies when leg i decided; wins without a leg use row 0; one row = plain match points. */
  legs: { win: number; loss: number }[];
};

export const tableScoring: ScoringKind = defineScoringKind<TableRule>({
  kind: "table",
  schema: z.object({
    kind: z.literal("table"),
    draw: finitePoints,
    legs: z.array(z.object({ win: finitePoints, loss: finitePoints })).min(1),
  }),
  points: (rule, line) => {
    const d = line.outcome.decision;
    switch (d.kind) {
      case "pending":
        return 0;
      case "draw":
        return rule.draw;
      case "doubleLoss":
        return rule.legs[0]?.loss ?? 0;
      case "win": {
        const row =
          rule.legs[Math.min(d.leg ?? 0, rule.legs.length - 1)] ?? rule.legs[0];
        if (row === undefined) return 0;
        return d.winner === line.side ? row.win : row.loss;
      }
    }
  },
  validate: (rule, encounter, ops, issue) => {
    if (rule.legs.length > 1) {
      const children = ops.structure(encounter).length;
      if (children !== rule.legs.length) {
        issue(
          `leg-keyed table declares ${rule.legs.length} rows but the encounter has ${children} legs`,
          ["legs"],
        );
      }
    }
  },
  card: (rule) => ({
    title: "Points table",
    lines: [
      ...(rule.legs.length === 1
        ? [
            `win → ${rule.legs[0]?.win ?? 0} · loss → ${rule.legs[0]?.loss ?? 0}`,
          ]
        : rule.legs.map(
            (row, i) => `won by leg ${i + 1} → ${row.win} · loss → ${row.loss}`,
          )),
      `draw → ${rule.draw}`,
    ],
  }),
});

type PhasedRule = {
  kind: "phased";
  /** Consecutive round blocks, each with its own win/draw/loss values. */
  phases: { rounds: number; win: number; draw: number; loss: number }[];
};

/**
 * Round-dependent scoring: consecutive blocks of rounds score differently
 * (Grand Chess Tour Rapid & Blitz: 9 rapid rounds at 2/1/0, then 18 blitz
 * rounds at 1/½/0). The competitor's chronological history says which round
 * this line is.
 */
export const phasedScoring: ScoringKind = defineScoringKind<PhasedRule>({
  kind: "phased",
  schema: z.object({
    kind: z.literal("phased"),
    phases: z
      .array(
        z.object({
          rounds: z.number().int().min(1),
          win: finitePoints,
          draw: finitePoints,
          loss: finitePoints,
        }),
      )
      .min(1),
  }),
  points: (rule, line, history) => {
    let round = history.length + 1;
    let phase = rule.phases[rule.phases.length - 1];
    for (const candidate of rule.phases) {
      if (round <= candidate.rounds) {
        phase = candidate;
        break;
      }
      round -= candidate.rounds;
    }
    if (phase === undefined) return 0;
    const d = line.outcome.decision;
    switch (d.kind) {
      case "pending":
        return 0;
      case "draw":
        return phase.draw;
      case "doubleLoss":
        return phase.loss;
      case "win":
        return d.winner === line.side ? phase.win : phase.loss;
    }
  },
  card: (rule) => ({
    title: "Phased points",
    lines: rule.phases.map(
      (phase, i) =>
        `phase ${i + 1} (${phase.rounds} rounds): ${phase.win}/${phase.draw}/${phase.loss}`,
    ),
  }),
});

export const builtinScorings: readonly ScoringKind[] = [
  passThroughScoring,
  tableScoring,
  phasedScoring,
];
