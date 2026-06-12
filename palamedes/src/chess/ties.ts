import { z } from "zod";
import { DECIDED_BY, otherSide } from "@/tournament/core";
import { defineTieKind, type TieKind } from "@/tournament/registry";

/**
 * The built-in tie rules. A tie kind answers one question: a node's children
 * are all resolved and the point sums are equal — now what?
 */

export const drawTie: TieKind = defineTieKind({
  kind: "draw",
  schema: z.object({ kind: z.literal("draw") }),
  decide: () => ({ decision: { kind: "draw" } }),
  decisive: () => false,
});

export const drawOddsTie: TieKind = defineTieKind({
  kind: "drawOdds",
  schema: z.object({
    kind: z.literal("drawOdds"),
    color: z.enum(["white", "black"]),
  }),
  decide: (rule, q) => {
    const seat = q.view.whiteSeat;
    if (seat === undefined) return { decision: { kind: "pending" } };
    const winner = rule.color === "white" ? seat : otherSide(seat);
    return {
      decision: { kind: "win", winner, by: DECIDED_BY.drawOdds },
    };
  },
  decisive: () => true,
});

export const manualTie: TieKind = defineTieKind({
  kind: "manual",
  schema: z.object({ kind: z.literal("manual") }),
  decide: (_rule, q) => {
    const winner = q.view.manualDecision();
    if (winner === undefined) {
      return {
        decision: { kind: "pending" },
        work: [{ kind: "awaitManualDecision" }],
      };
    }
    return { decision: { kind: "win", winner, by: DECIDED_BY.manual } };
  },
  decisive: () => true,
});

export const builtinTies: readonly TieKind[] = [
  drawTie,
  drawOddsTie,
  manualTie,
];
