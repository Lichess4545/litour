import { z } from "zod";
import { finitePoints } from "@/tournament/core";
import type { ScoringKind } from "@/tournament/registry";
import {
  PASS_THROUGH,
  type PhasedRule,
  phased,
  type TableRule,
  table,
} from "./definitions";
import { exprScoring } from "./expr-scoring";

/**
 * The live scoring registry — every scoring rule as a data-defined expression.
 * This is what `chessRegistry` registers; the kinds, schemas, and cards match
 * the legacy `scorings.ts` (now the differential oracle).
 */
export const builtinScorings: readonly ScoringKind[] = [
  exprScoring({
    kind: "passThrough",
    schema: z.object({ kind: z.literal("passThrough") }),
    expr: () => PASS_THROUGH,
    card: () => ({
      title: "Game points",
      lines: ["each side keeps its points"],
    }),
  }),
  exprScoring<TableRule>({
    kind: "table",
    schema: z.object({
      kind: z.literal("table"),
      draw: finitePoints,
      legs: z.array(z.object({ win: finitePoints, loss: finitePoints })).min(1),
    }),
    expr: (rule) => table(rule),
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
              (row, i) =>
                `won by leg ${i + 1} → ${row.win} · loss → ${row.loss}`,
            )),
        `draw → ${rule.draw}`,
      ],
    }),
  }),
  exprScoring<PhasedRule>({
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
    expr: (rule) => phased(rule),
    card: (rule) => ({
      title: "Phased points",
      lines: rule.phases.map(
        (p, i) =>
          `phase ${i + 1} (${p.rounds} rounds): ${p.win}/${p.draw}/${p.loss}`,
      ),
    }),
  }),
];
