import { z } from "zod";
import type { ModelRegistry } from "../registry";
import type { DefChange, DefChangeType } from "./types";

const id = z.string().min(1);
const insertIndex = z.number().int().min(0).optional();

/**
 * Payload subtrees (competition, run, entries, competitor) are validated against
 * registry-registered kinds — an unknown kind is rejected here, before the DAL
 * batch gate. Depth and node-count caps are NOT enforced here; they belong to
 * the batch gate's safeParseEventDef call.
 */
export function buildDefChangeSchema(
  registry: ModelRegistry,
): z.ZodType<DefChange> {
  const { competition, run, entries, competitor } = registry.defSchemas;
  const arms = {
    "definition-created": z.object({
      type: z.literal("definition-created"),
      name: z.string().min(1),
      competition,
    }),
    "definition-renamed": z.object({
      type: z.literal("definition-renamed"),
      name: z.string().min(1),
    }),
    "competitor-added": z.object({
      type: z.literal("competitor-added"),
      competitor,
      index: insertIndex,
    }),
    "competitor-updated": z.object({
      type: z.literal("competitor-updated"),
      competitorId: id,
      competitor,
    }),
    "competitor-removed": z.object({
      type: z.literal("competitor-removed"),
      competitorId: id,
    }),
    "competition-added": z.object({
      type: z.literal("competition-added"),
      parentId: id,
      competition,
      index: insertIndex,
    }),
    "competition-renamed": z.object({
      type: z.literal("competition-renamed"),
      competitionId: id,
      name: z.string().min(1).optional(),
    }),
    "competition-removed": z.object({
      type: z.literal("competition-removed"),
      competitionId: id,
    }),
    "run-set": z.object({
      type: z.literal("run-set"),
      competitionId: id,
      run,
    }),
    "entries-set": z.object({
      type: z.literal("entries-set"),
      competitionId: id,
      entries: entries.nullable(),
    }),
  } satisfies {
    [K in DefChangeType]: z.ZodType<Extract<DefChange, { type: K }>>;
  };
  return z.discriminatedUnion("type", [
    arms["definition-created"],
    arms["definition-renamed"],
    arms["competitor-added"],
    arms["competitor-updated"],
    arms["competitor-removed"],
    arms["competition-added"],
    arms["competition-renamed"],
    arms["competition-removed"],
    arms["run-set"],
    arms["entries-set"],
  ]);
}
