import { z } from "zod";
import {
  type CompetitorId,
  competitorIdSchema,
  idSchema,
} from "@/tournament/core";
import { defineSeedKind, type SeedKind } from "@/tournament/registry";

/**
 * Built-in seed sources — how a leaf competition's entry list resolves to
 * competitors. Pipeline variety lives here: a losers-bracket or "best third
 * place" is a new seed kind, not a new spine concept.
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
    of: idSchema,
    rank: z.number().int().min(1),
  }),
  resolve: (ref, ctx) => ctx.ranking(ref.of)?.[ref.rank - 1],
  origins: (ref) => [{ of: ref.of, rank: ref.rank }],
  validate: (ref, ctx, issue) => {
    if (ref.of === ctx.self) {
      issue(`${ctx.self} cannot seed from its own ranking`, ["of"]);
      return;
    }
    const size = ctx.sizes.get(ref.of);
    if (size === undefined) {
      issue(`unknown competition "${ref.of}"`, ["of"]);
    } else if (size !== "open" && ref.rank > size) {
      issue(`rank ${ref.rank} exceeds the ${size} entries of ${ref.of}`, [
        "rank",
      ]);
    }
  },
});

/**
 * Tour aggregation: placements across several completed competitions convert
 * to points through a table (Grand Chess Tour: 13/10/8/…), and the seed
 * resolves rank N of the combined standings. Ties break by total, then by
 * best single placement, then by source order — deterministic, and an
 * arbiter can always override with fixed seeds.
 */
export const placementsSeed: SeedKind = defineSeedKind({
  kind: "placements",
  schema: z.object({
    kind: z.literal("placements"),
    over: z.array(idSchema).min(1),
    points: z.array(z.number().finite().nonnegative()).min(1),
    rank: z.number().int().min(1),
  }),
  resolve: (ref, ctx) => {
    const totals = new Map<CompetitorId, { total: number; best: number }>();
    for (const source of ref.over) {
      const ranking = ctx.ranking(source);
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
  origins: (ref) => ref.over.map((of) => ({ of })),
  card: (ref) => ({
    title: "Tour standings",
    badge: `${ref.over.length} events`,
    lines: [
      `placement points ${ref.points.slice(0, 4).join("/")}${ref.points.length > 4 ? "/…" : ""}`,
    ],
  }),
  validate: (ref, ctx, issue) => {
    // `resolve` can only say "not finished yet" (undefined), never "never":
    // an unattainable rank must die here or the event hangs in awaitSeeding
    // forever. The sum of closed source sizes bounds the combined field
    // (overlap can only shrink it); any open source waives the check.
    let bound: number | undefined = 0;
    ref.over.forEach((source, i) => {
      if (source === ctx.self) {
        issue(`${ctx.self} cannot aggregate its own ranking`, ["over", i]);
        bound = undefined;
        return;
      }
      const size = ctx.sizes.get(source);
      if (size === undefined) {
        issue(`unknown competition "${source}"`, ["over", i]);
        bound = undefined;
      } else if (size === "open") {
        bound = undefined;
      } else if (bound !== undefined) {
        bound += size;
      }
    });
    if (bound !== undefined && ref.rank > bound) {
      issue(
        `rank ${ref.rank} exceeds the at most ${bound} competitors across these sources`,
        ["rank"],
      );
    }
  },
});

export const builtinSeeds: readonly SeedKind[] = [
  registrationSeed,
  fixedSeed,
  rankSeed,
  placementsSeed,
];
