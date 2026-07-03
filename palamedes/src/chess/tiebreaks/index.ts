import { z } from "zod";
import type { MetricKind } from "@/tournament/registry";
import {
  boardPoints,
  buchholz,
  CUMULATIVE,
  CUMULATIVE_OPPOSITION,
  ENCOUNTER_POINTS,
  extendedSB,
  GAMES_WITH_BLACK,
  GAMES_WON,
  HEAD_TO_HEAD,
  MATCH_WINS,
  MODIFIED_MEDIAN,
  medianBuchholz,
  SONNEBORN_BERGER,
} from "./definitions";
import { exprMetric } from "./expr-metric";

/**
 * The live tiebreak registry — every chess tiebreak as a data-defined metric
 * the engine evaluates. This is what `chessRegistry` registers; the labels and
 * ref shapes match the legacy `metrics.ts` (now the differential oracle) so the
 * format catalogue is unaffected.
 */

const code = (channel: "standings" | "encounter"): string =>
  channel === "standings" ? "m" : "g";

export const builtinMetrics: readonly MetricKind[] = [
  exprMetric({
    metric: "encounterPoints",
    schema: z.object({ metric: z.literal("encounterPoints") }),
    label: () => "encounterPoints",
    expr: () => ENCOUNTER_POINTS,
  }),
  exprMetric({
    metric: "matchWins",
    schema: z.object({ metric: z.literal("matchWins") }),
    label: () => "matchWins",
    expr: () => MATCH_WINS,
  }),
  exprMetric({
    metric: "gamesWon",
    schema: z.object({ metric: z.literal("gamesWon") }),
    label: () => "gamesWon",
    expr: () => GAMES_WON,
  }),
  exprMetric({
    metric: "boardPoints",
    schema: z.object({
      metric: z.literal("boardPoints"),
      board: z.number().int().min(1),
    }),
    label: (ref) => `boardPoints-${ref.board}`,
    expr: (ref) => boardPoints(ref.board),
  }),
  exprMetric({
    metric: "buchholz",
    schema: z.object({
      metric: z.literal("buchholz"),
      cut: z.number().int().min(1).optional(),
    }),
    label: (ref) =>
      ref.cut === undefined ? "buchholz" : `buchholz-cut${ref.cut}`,
    expr: (ref) => buchholz(ref.cut ?? 0),
  }),
  exprMetric({
    metric: "sonnebornBerger",
    schema: z.object({ metric: z.literal("sonnebornBerger") }),
    label: () => "sonnebornBerger",
    expr: () => SONNEBORN_BERGER,
  }),
  exprMetric({
    metric: "extendedSB",
    schema: z.object({
      metric: z.literal("extendedSB"),
      opponentTotal: z.enum(["standings", "encounter"]),
      scored: z.enum(["standings", "encounter"]),
    }),
    label: (ref) => `extendedSB-${code(ref.opponentTotal)}${code(ref.scored)}`,
    expr: (ref) => extendedSB(ref.opponentTotal, ref.scored),
  }),
  exprMetric({
    metric: "headToHead",
    schema: z.object({ metric: z.literal("headToHead") }),
    label: () => "headToHead",
    expr: () => HEAD_TO_HEAD,
  }),
  exprMetric({
    metric: "medianBuchholz",
    schema: z.object({
      metric: z.literal("medianBuchholz"),
      cut: z.number().int().min(1).optional(),
    }),
    label: (ref) =>
      ref.cut === undefined ? "medianBuchholz" : `medianBuchholz-cut${ref.cut}`,
    expr: (ref) => medianBuchholz(ref.cut ?? 1),
  }),
  exprMetric({
    metric: "cumulative",
    schema: z.object({ metric: z.literal("cumulative") }),
    label: () => "cumulative",
    expr: () => CUMULATIVE,
  }),
  exprMetric({
    metric: "cumulativeOpposition",
    schema: z.object({ metric: z.literal("cumulativeOpposition") }),
    label: () => "cumulativeOpposition",
    expr: () => CUMULATIVE_OPPOSITION,
  }),
  exprMetric({
    metric: "modifiedMedian",
    schema: z.object({ metric: z.literal("modifiedMedian") }),
    label: () => "modifiedMedian",
    expr: () => MODIFIED_MEDIAN,
  }),
  exprMetric({
    metric: "gamesWithBlack",
    schema: z.object({ metric: z.literal("gamesWithBlack") }),
    label: () => "gamesWithBlack",
    expr: () => GAMES_WITH_BLACK,
  }),
];
