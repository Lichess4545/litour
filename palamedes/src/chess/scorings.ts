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
});

export const builtinScorings: readonly ScoringKind[] = [
  passThroughScoring,
  tableScoring,
];
