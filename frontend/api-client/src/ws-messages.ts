import { z } from "zod";

const pairingBase = {
  pairing_id: z.number().int(),
  round_id: z.number().int(),
  result: z.string(),
  game_link: z.string(),
  white_username: z.string().nullable(),
  black_username: z.string().nullable(),
};

export const wsPairingResultUpdate = z.object({
  type: z.literal("pairing.result"),
  ...pairingBase,
});

export const wsPairingGameLinkUpdate = z.object({
  type: z.literal("pairing.game_link"),
  ...pairingBase,
});

export const wsPing = z.object({ type: z.literal("ping") });

export const wsMessage = z.discriminatedUnion("type", [
  wsPairingResultUpdate,
  wsPairingGameLinkUpdate,
  wsPing,
]);

export type WSPairingResultUpdate = z.infer<typeof wsPairingResultUpdate>;
export type WSPairingGameLinkUpdate = z.infer<typeof wsPairingGameLinkUpdate>;
export type WSPing = z.infer<typeof wsPing>;
export type WSMessage = z.infer<typeof wsMessage>;
