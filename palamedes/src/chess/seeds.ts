import { z } from "zod";
import { competitorIdSchema, idSchema } from "@/tournament/core";
import { defineSeedKind, type SeedKind } from "@/tournament/registry";

/**
 * Built-in seed sources — how a group's entry list resolves to competitors.
 * Stage variety lives here: a losers-bracket or "best third place" is a new
 * seed kind, not a new stage concept.
 */

export const registrationSeed: SeedKind = defineSeedKind({
  kind: "registration",
  schema: z.object({
    kind: z.literal("registration"),
    seed: z.number().int().min(1),
  }),
  resolve: (ref, ctx) => ctx.competitors[ref.seed - 1]?.id,
  validate: (ref, ctx, issue) => {
    if (ref.seed > ctx.competitors.length) {
      issue(
        `registration seed ${ref.seed} exceeds the ${ctx.competitors.length} declared competitors`,
        ["seed"],
      );
    }
  },
});

export const fixedSeed: SeedKind = defineSeedKind({
  kind: "fixed",
  schema: z.object({ kind: z.literal("fixed"), id: competitorIdSchema }),
  resolve: (ref) => ref.id,
  validate: (ref, ctx, issue) => {
    if (!ctx.competitors.some((c) => c.id === ref.id)) {
      issue(`unknown competitor ${ref.id}`, ["id"]);
    }
  },
});

export const rankSeed: SeedKind = defineSeedKind({
  kind: "rank",
  schema: z.object({
    kind: z.literal("rank"),
    stage: idSchema,
    group: idSchema,
    rank: z.number().int().min(1),
  }),
  resolve: (ref, ctx) => ctx.ranking(ref.stage, ref.group)?.[ref.rank - 1],
  origin: (ref) => ({ stage: ref.stage, group: ref.group, rank: ref.rank }),
  validate: (ref, ctx, issue) => {
    const sourceIndex = ctx.stages.findIndex((s) => s.id === ref.stage);
    if (sourceIndex === -1 || sourceIndex >= ctx.stageIndex) {
      issue(
        `rank source must reference an earlier stage; ${ref.stage} is not one`,
        ["stage"],
      );
      return;
    }
    const size = ctx.stages[sourceIndex]?.groupSizes.get(ref.group);
    if (size === undefined) {
      issue(`unknown group ${ref.group} in stage ${ref.stage}`, ["group"]);
    } else if (size !== "open" && ref.rank > size) {
      issue(
        `rank ${ref.rank} exceeds the ${size} entries of ${ref.stage}/${ref.group}`,
        ["rank"],
      );
    }
  },
});

export const builtinSeeds: readonly SeedKind[] = [
  registrationSeed,
  fixedSeed,
  rankSeed,
];
