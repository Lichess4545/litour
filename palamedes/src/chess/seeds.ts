import { z } from "zod";
import {
  type CompetitorId,
  competitorIdSchema,
  idSchema,
} from "@/tournament/core";
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
  origins: (ref) => [{ stage: ref.stage, group: ref.group, rank: ref.rank }],
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

/**
 * Tour aggregation: placements across several completed groups convert to
 * points through a table (Grand Chess Tour: 13/10/8/…), and the seed
 * resolves rank N of the combined standings. Ties break by total, then by
 * best single placement, then by source order — deterministic, and an
 * arbiter can always override with fixed seeds.
 */
export const placementsSeed: SeedKind = defineSeedKind({
  kind: "placements",
  schema: z.object({
    kind: z.literal("placements"),
    sources: z.array(z.object({ stage: idSchema, group: idSchema })).min(1),
    points: z.array(z.number().finite().nonnegative()).min(1),
    rank: z.number().int().min(1),
  }),
  resolve: (ref, ctx) => {
    const totals = new Map<CompetitorId, { total: number; best: number }>();
    for (const source of ref.sources) {
      const ranking = ctx.ranking(source.stage, source.group);
      if (ranking === undefined) return undefined; // every source must finish
      ranking.forEach((competitor, index) => {
        const award = ref.points[index] ?? 0;
        const entry = totals.get(competitor) ?? {
          total: 0,
          best: Number.POSITIVE_INFINITY,
        };
        totals.set(competitor, {
          total: entry.total + award,
          best: Math.min(entry.best, index),
        });
      });
    }
    const order = [...totals.entries()].sort(
      ([, a], [, b]) => b.total - a.total || a.best - b.best,
    );
    return order[ref.rank - 1]?.[0];
  },
  origins: (ref) =>
    ref.sources.map((source) => ({ stage: source.stage, group: source.group })),
  card: (ref) => ({
    title: "Tour standings",
    badge: `${ref.sources.length} events`,
    lines: [
      `placement points ${ref.points.slice(0, 4).join("/")}${ref.points.length > 4 ? "/…" : ""}`,
    ],
  }),
  validate: (ref, ctx, issue) => {
    ref.sources.forEach((source, i) => {
      const sourceIndex = ctx.stages.findIndex((s) => s.id === source.stage);
      if (sourceIndex === -1 || sourceIndex >= ctx.stageIndex) {
        issue(
          `placements source must reference an earlier stage; ${source.stage} is not one`,
          ["sources", i, "stage"],
        );
        return;
      }
      if (ctx.stages[sourceIndex]?.groupSizes.get(source.group) === undefined) {
        issue(`unknown group ${source.group} in stage ${source.stage}`, [
          "sources",
          i,
          "group",
        ]);
      }
    });
  },
});

export const builtinSeeds: readonly SeedKind[] = [
  registrationSeed,
  fixedSeed,
  rankSeed,
  placementsSeed,
];
