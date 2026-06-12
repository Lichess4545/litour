import { z } from "zod";
import type { AnyEncounterDef, PoolDef } from "@/tournament/core";
import {
  isPool,
  type ModelRegistry,
  type ParsedEventDef,
} from "@/tournament/registry";

/**
 * Pure projections of a tournament definition for React Flow, one level of
 * resolution at a time:
 *
 * - the OVERVIEW is the event's own level — a left-to-right timeline of
 *   stage frames, each holding its groups as parallel lanes, each pool lane
 *   running its rounds as a chain of steps, seed edges flowing between
 *   stages. There is no "event node": the page is the event.
 * - a LEVEL view is one encounter node's level — its immediate children
 *   only, sequenced left-to-right (series legs) or stacked as parallel
 *   lanes (match boards). Drilling into a child shows the next level down;
 *   that is the recursion, navigated instead of drawn.
 *
 * Nothing here knows a specific kind: titles, badges, child structure and
 * sequence/parallel arrangement all come from the registry.
 */

export const flowCardDataSchema = z.object({
  /** The colored chip: spine concepts or the encounter kind's name. */
  chip: z.string(),
  title: z.string(),
  badge: z.string().optional(),
  lines: z.array(z.string()).readonly(),
  /** Compression multiplier: this card stands for N identical siblings. */
  count: z.number().optional(),
  /** Clicking descends one level of resolution. */
  drill: z.boolean(),
  /** Edge direction at this node: timeline (right) or top-down. */
  flow: z.enum(["right", "down"]),
  /** Compact step rendering (round chips on the timeline). */
  step: z.boolean(),
});

export type FlowCardData = z.infer<typeof flowCardDataSchema>;

export const frameDataSchema = z.strictObject({ title: z.string() });
export type FrameData = z.infer<typeof frameDataSchema>;

export type FlowGraphNode =
  | {
      readonly id: string;
      readonly type: "card";
      readonly position: { readonly x: number; readonly y: number };
      readonly data: FlowCardData;
      readonly parentId?: string | undefined;
    }
  | {
      readonly id: string;
      readonly type: "frame";
      readonly position: { readonly x: number; readonly y: number };
      readonly data: FrameData;
      readonly width: number;
      readonly height: number;
    };

export type FlowGraphEdge = {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly label?: string | undefined;
  readonly kind: "chain" | "seed";
};

export type DrillTarget =
  | {
      /** One pool round: its pairings, each playing the encounter template. */
      readonly kind: "round";
      readonly title: string;
      readonly def: AnyEncounterDef;
      readonly pairs: number;
    }
  | {
      /** One encounter node: its immediate children. */
      readonly kind: "encounter";
      readonly title: string;
      readonly def: AnyEncounterDef;
    };

export type FlowGraph = {
  readonly nodes: readonly FlowGraphNode[];
  readonly edges: readonly FlowGraphEdge[];
  /** node id → the next level of resolution it opens. */
  readonly drills: ReadonlyMap<string, DrillTarget>;
};

export const CARD_W = 224;
export const STEP_W = 120;
const GAP_X = 36;
const ROW_H = 150;
const STACK_H = 190;
const FRAME_PAD = 20;
const FRAME_TITLE = 34;
const STAGE_GAP = 96;
const STEP_Y_NUDGE = 18;

const card = (
  chip: string,
  title: string,
  lines: readonly string[],
  options?: {
    badge?: string | undefined;
    count?: number | undefined;
    drill?: boolean;
    flow?: "right" | "down";
    step?: boolean;
  },
): FlowCardData => ({
  chip,
  title,
  lines,
  ...(options?.badge === undefined ? {} : { badge: options.badge }),
  ...(options?.count === undefined ? {} : { count: options.count }),
  drill: options?.drill ?? false,
  flow: options?.flow ?? "right",
  step: options?.step ?? false,
});

// ---------------------------------------------------------------------------
// Overview: a timeline of stage frames with group lanes and round steps

export function buildOverviewGraph(
  def: ParsedEventDef,
  registry: ModelRegistry,
): FlowGraph {
  const nodes: FlowGraphNode[] = [];
  const edges: FlowGraphEdge[] = [];
  const drills = new Map<string, DrillTarget>();
  /** First and last node of each group lane, for cross-stage seed edges. */
  const laneHead = new Map<string, string>();
  const laneTail = new Map<string, string>();

  let cursorX = 0;
  for (const stage of def.stages) {
    const frameId = `stage:${stage.id}`;
    const laneNodes: FlowGraphNode[] = [];
    let laneY = FRAME_TITLE + FRAME_PAD;
    let widest = CARD_W;

    for (const group of stage.groups) {
      const key = `${stage.id}/${group.id}`;
      const headerId = `g:${key}`;
      laneHead.set(key, headerId);

      if (isPool(group.run)) {
        const pool: PoolDef = group.run;
        const pairing = registry.pairings.get(pool.pairing.system);
        const rounds =
          pairing?.totalRounds?.(pool.pairing, group.entries.length) ??
          pool.rounds ??
          0;
        laneNodes.push({
          id: headerId,
          type: "card",
          parentId: frameId,
          position: { x: FRAME_PAD, y: laneY },
          data: card(
            "group",
            group.id,
            [`${group.entries.length} entrants`, `score: ${pool.score.kind}`],
            { badge: `${pool.pairing.system} · ${rounds} rounds` },
          ),
        });
        let previous = headerId;
        for (let r = 1; r <= rounds; r += 1) {
          const stepId = `${headerId}/round-${r}`;
          laneNodes.push({
            id: stepId,
            type: "card",
            parentId: frameId,
            position: {
              x: FRAME_PAD + CARD_W + GAP_X + (r - 1) * (STEP_W + GAP_X),
              y: laneY + STEP_Y_NUDGE,
            },
            data: card("round", `Round ${r}`, [], { drill: true, step: true }),
          });
          edges.push({
            id: `c:${previous}->${stepId}`,
            source: previous,
            target: stepId,
            kind: "chain",
          });
          drills.set(stepId, {
            kind: "round",
            title: `Round ${r}`,
            def: pool.encounter,
            pairs:
              pairing?.pairsInRound?.(pool.pairing, group.entries.length, r) ??
              Math.floor(group.entries.length / 2),
          });
          previous = stepId;
        }
        laneTail.set(key, previous);
        widest = Math.max(widest, CARD_W + (GAP_X + STEP_W) * rounds);
      } else {
        const info = registry.ops.card(group.run);
        const runId = `${headerId}/run`;
        laneNodes.push({
          id: headerId,
          type: "card",
          parentId: frameId,
          position: { x: FRAME_PAD, y: laneY },
          data: card("group", group.id, [`${group.entries.length} entrants`]),
        });
        laneNodes.push({
          id: runId,
          type: "card",
          parentId: frameId,
          position: { x: FRAME_PAD + CARD_W + GAP_X, y: laneY },
          data: card(group.run.kind, info.title, info.lines, {
            badge: info.badge,
            drill: true,
          }),
        });
        edges.push({
          id: `c:${headerId}->${runId}`,
          source: headerId,
          target: runId,
          kind: "chain",
        });
        drills.set(runId, {
          kind: "encounter",
          title: info.title,
          def: group.run,
        });
        laneTail.set(key, runId);
        widest = Math.max(widest, CARD_W + GAP_X + CARD_W);
      }
      laneY += ROW_H;
    }

    const width = FRAME_PAD * 2 + widest;
    const height = laneY - ROW_H + 130 + FRAME_PAD;
    nodes.push({
      id: frameId,
      type: "frame",
      position: { x: cursorX, y: 0 },
      data: { title: stage.id },
      width,
      height,
    });
    nodes.push(...laneNodes);
    cursorX += width + STAGE_GAP;
  }

  // Seed edges: competitors flowing from a finished group into a later one.
  for (const stage of def.stages) {
    for (const group of stage.groups) {
      const targetHead = laneHead.get(`${stage.id}/${group.id}`);
      if (targetHead === undefined) continue;
      group.entries.forEach((entry, index) => {
        const origin = registry.seeds.get(entry.kind)?.origin?.(entry);
        if (origin === undefined) return;
        const sourceTail = laneTail.get(`${origin.stage}/${origin.group}`);
        if (sourceTail === undefined) return;
        edges.push({
          id: `seed:${targetHead}:${index}`,
          source: sourceTail,
          target: targetHead,
          label:
            origin.rank === 1
              ? "winner"
              : origin.rank !== undefined
                ? `#${origin.rank}`
                : undefined,
          kind: "seed",
        });
      });
    }
  }

  return { nodes, edges, drills };
}

// ---------------------------------------------------------------------------
// Level views: ONE level of resolution per canvas — drill to descend

const seatLine = (seat: "keep" | "flip" | "draw" | undefined): string[] =>
  seat === "keep"
    ? ["white side stays white"]
    : seat === "flip"
      ? ["white side takes black"]
      : seat === "draw"
        ? ["colors drawn by lot"]
        : [];

export function buildLevelGraph(
  target: DrillTarget,
  registry: ModelRegistry,
): FlowGraph {
  return target.kind === "round"
    ? buildRoundLevel(target, registry)
    : buildEncounterLevel(target.def, registry);
}

/**
 * A round is its pairings: one card per pairing, all playing the pool's
 * encounter template side by side.
 */
function buildRoundLevel(
  target: { readonly def: AnyEncounterDef; readonly pairs: number },
  registry: ModelRegistry,
): FlowGraph {
  const nodes: FlowGraphNode[] = [];
  const drills = new Map<string, DrillTarget>();

  const info = registry.ops.card(target.def);
  const deeper = registry.ops.structure(target.def).length > 0;
  for (let i = 1; i <= target.pairs; i += 1) {
    const id = `lvl:${i}`;
    nodes.push({
      id,
      type: "card",
      position: { x: 0, y: (i - 1) * STACK_H },
      data: card(target.def.kind, info.title, [`pairing ${i}`, ...info.lines], {
        badge: info.badge,
        drill: deeper,
        flow: "down",
      }),
    });
    if (deeper) {
      drills.set(id, {
        kind: "encounter",
        title: `Pairing ${i} — ${info.title}`,
        def: target.def,
      });
    }
  }
  return { nodes, edges: [], drills };
}

/** One encounter's immediate children, each its own card — no compression. */
function buildEncounterLevel(
  target: AnyEncounterDef,
  registry: ModelRegistry,
): FlowGraph {
  const nodes: FlowGraphNode[] = [];
  const edges: FlowGraphEdge[] = [];
  const drills = new Map<string, DrillTarget>();

  const structure = registry.ops.structure(target);
  const arrangement = registry.ops.arrangement(target);

  // A leaf (single game) has nothing inside: show the thing itself up close.
  if (structure.length === 0) {
    const info = registry.ops.card(target);
    nodes.push({
      id: "lvl:1",
      type: "card",
      position: { x: 0, y: 0 },
      data: card(target.kind, info.title, info.lines, { badge: info.badge }),
    });
    return { nodes, edges, drills };
  }

  structure.forEach((child, index) => {
    const id = `lvl:${index + 1}`;
    const info = registry.ops.card(child.def);
    const deeper = registry.ops.structure(child.def).length > 0;
    nodes.push({
      id,
      type: "card",
      position:
        arrangement === "sequence"
          ? { x: index * (CARD_W + GAP_X), y: 0 }
          : { x: 0, y: index * STACK_H },
      data: card(
        child.def.kind,
        info.title,
        [child.role, ...seatLine(child.seat), ...info.lines],
        {
          badge: info.badge,
          count: child.count,
          drill: deeper,
          flow: arrangement === "sequence" ? "right" : "down",
        },
      ),
    });
    if (deeper) {
      drills.set(id, {
        kind: "encounter",
        title: `${child.role} — ${info.title}`,
        def: child.def,
      });
    }
    if (arrangement === "sequence" && index > 0) {
      edges.push({
        id: `c:lvl:${index}->lvl:${index + 1}`,
        source: `lvl:${index}`,
        target: id,
        label: "then",
        kind: "chain",
      });
    }
  });

  return { nodes, edges, drills };
}
