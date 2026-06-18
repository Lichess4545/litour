import { z } from "zod";
import {
  defineMetricKind,
  type MetricKind,
  type MetricRow,
  type PlayedLine,
} from "@/tournament/registry";

/**
 * The differential oracle. These hand-written implementations are NO LONGER
 * registered — `./tiebreaks` provides the live, data-defined metrics. They are
 * kept as the frozen reference that `tiebreaks/definitions.test.ts` pins the
 * expression versions against, formula for formula. Change a tiebreak's
 * behavior in `tiebreaks/definitions.ts`, never here.
 */

const played = (row: MetricRow): readonly PlayedLine[] =>
  row.lines.filter((line): line is PlayedLine => line.kind === "played");

export const encounterPointsMetric: MetricKind = defineMetricKind({
  metric: "encounterPoints",
  schema: z.object({ metric: z.literal("encounterPoints") }),
  label: () => "encounterPoints",
  value: (_ref, row) => row.encounterPoints,
});

export const matchWinsMetric: MetricKind = defineMetricKind({
  metric: "matchWins",
  schema: z.object({ metric: z.literal("matchWins") }),
  label: () => "matchWins",
  value: (_ref, row) =>
    played(row).filter(
      (line) =>
        line.outcome.decision.kind === "win" &&
        line.outcome.decision.winner === line.side,
    ).length,
});

export const gamesWonMetric: MetricKind = defineMetricKind({
  metric: "gamesWon",
  schema: z.object({ metric: z.literal("gamesWon") }),
  label: () => "gamesWon",
  value: (_ref, row) =>
    played(row).reduce((sum, line) => sum + line.gamesWon, 0),
});

export const boardPointsMetric: MetricKind = defineMetricKind({
  metric: "boardPoints",
  schema: z.object({
    metric: z.literal("boardPoints"),
    board: z.number().int().min(1),
  }),
  label: (ref) => `boardPoints-${ref.board}`,
  value: (ref, row) =>
    played(row).reduce(
      (sum, line) => sum + (line.boardPoints[ref.board - 1] ?? 0),
      0,
    ),
});

export const buchholzMetric: MetricKind = defineMetricKind({
  metric: "buchholz",
  schema: z.object({
    metric: z.literal("buchholz"),
    cut: z.number().int().min(1).optional(),
  }),
  label: (ref) =>
    ref.cut === undefined ? "buchholz" : `buchholz-cut${ref.cut}`,
  value: (ref, row, all) => {
    const values: number[] = [];
    for (const line of row.lines) {
      if (line.kind === "bye") values.push(row.standingsPoints);
      if (line.kind === "played") {
        const opponent = all.get(line.opponent);
        if (opponent !== undefined) values.push(opponent.standingsPoints);
      }
    }
    values.sort((a, b) => a - b);
    return values.slice(ref.cut ?? 0).reduce((sum, v) => sum + v, 0);
  },
});

export const sonnebornBergerMetric: MetricKind = defineMetricKind({
  metric: "sonnebornBerger",
  schema: z.object({ metric: z.literal("sonnebornBerger") }),
  label: () => "sonnebornBerger",
  value: (_ref, row, all) => {
    let sum = 0;
    for (const line of played(row)) {
      const opponent = all.get(line.opponent);
      if (opponent === undefined) continue;
      const d = line.outcome.decision;
      if (d.kind === "win" && d.winner === line.side)
        sum += opponent.standingsPoints;
      else if (d.kind === "draw") sum += opponent.standingsPoints / 2;
    }
    return sum;
  },
});

export const extendedSBMetric: MetricKind = defineMetricKind({
  metric: "extendedSB",
  schema: z.object({
    metric: z.literal("extendedSB"),
    opponentTotal: z.enum(["standings", "encounter"]),
    scored: z.enum(["standings", "encounter"]),
  }),
  label: (ref) => {
    const code = (basis: "standings" | "encounter"): string =>
      basis === "standings" ? "m" : "g";
    return `extendedSB-${code(ref.opponentTotal)}${code(ref.scored)}`;
  },
  value: (ref, row, all) => {
    let sum = 0;
    for (const line of row.lines) {
      if (line.kind === "bye") {
        // FIDE Art. 16.4: the virtual opponent has the participant's own
        // total — applied to the game-points × game-points variant only.
        if (ref.opponentTotal === "encounter" && ref.scored === "encounter") {
          sum += row.encounterPoints * line.encounterPoints;
        }
        continue;
      }
      if (line.kind !== "played") continue;
      const opponent = all.get(line.opponent);
      if (opponent === undefined) continue;
      const total =
        ref.opponentTotal === "standings"
          ? opponent.standingsPoints
          : opponent.encounterPoints;
      const scored =
        ref.scored === "standings"
          ? line.standingsPoints
          : line.encounterPoints;
      sum += total * scored;
    }
    return sum;
  },
});

export const headToHeadMetric: MetricKind = defineMetricKind({
  metric: "headToHead",
  schema: z.object({ metric: z.literal("headToHead") }),
  label: () => "headToHead",
  value: (_ref, row, all) => {
    // FIDE direct encounter applies to everyone on equal SCORE.
    const tied = [...all.values()].filter(
      (other) => other.standingsPoints === row.standingsPoints,
    );
    if (tied.length < 2) return 0;
    const tiedIds = new Set(tied.map((other) => other.competitor));
    // Only meaningful when every tied pair has actually met.
    for (const other of tied) {
      const met = new Set(played(other).map((line) => line.opponent));
      for (const id of tiedIds) {
        if (id !== other.competitor && !met.has(id)) return 0;
      }
    }
    return played(row)
      .filter((line) => tiedIds.has(line.opponent))
      .reduce((sum, line) => sum + line.standingsPoints, 0);
  },
});

// gamesWon's draw-odds exclusion lives in standings.ts (gamesWonFor), where the
// per-line `gamesWon` count these formulas read is computed.
