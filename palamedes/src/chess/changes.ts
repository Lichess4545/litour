import { buildDefChangeSchema } from "@/tournament/changes/schema";
import type { DefChange } from "@/tournament/changes/types";
import { chessRegistry } from "./registry";

export const defChangeSchema = buildDefChangeSchema(chessRegistry);

export const parseDefChange = (data: unknown): DefChange =>
  defChangeSchema.parse(data);

export const safeParseDefChange = (data: unknown) =>
  defChangeSchema.safeParse(data);
