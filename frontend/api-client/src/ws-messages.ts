import { z } from "zod";

const matchBase = {
  match_id: z.number().int(),
  round_id: z.number().int(),
  result: z.string(),
  game_link: z.string(),
  white_username: z.string().nullable(),
  black_username: z.string().nullable(),
};

export const wsMatchResultUpdate = z.object({
  type: z.literal("match.result"),
  ...matchBase,
});

export const wsMatchGameLinkUpdate = z.object({
  type: z.literal("match.game_link"),
  ...matchBase,
});

export const wsPing = z.object({ type: z.literal("ping") });

export const wsMessage = z.discriminatedUnion("type", [
  wsMatchResultUpdate,
  wsMatchGameLinkUpdate,
  wsPing,
]);

export type WSMatchResultUpdate = z.infer<typeof wsMatchResultUpdate>;
export type WSMatchGameLinkUpdate = z.infer<typeof wsMatchGameLinkUpdate>;
export type WSPing = z.infer<typeof wsPing>;
export type WSMessage = z.infer<typeof wsMessage>;
