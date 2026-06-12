import { z } from "zod";
import {
  type Color,
  competitorIdSchema,
  nodePathSchema,
  playerIdSchema,
  sideSchema,
} from "./def";

/**
 * The engine is a pure fold over an ordered log of these inputs. Pairings are
 * proposed by pairing systems but only take effect once recorded as a
 * `pairingsSet` input, so the fold is total and replayable. Randomness
 * (drawing of lots) enters as recorded `colorDraw` inputs, never ambiently.
 */

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
export type LineupSetInput = Extract<Input, { kind: "lineupSet" }>;
export type GameResultInput = Extract<Input, { kind: "gameResult" }>;

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

/** True when no game was actually played (forfeits and scheduling draws) — what TRF marks unplayed. */
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
