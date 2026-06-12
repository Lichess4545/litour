import { z } from "zod";
import {
  type ConcreteCard,
  type ConcreteEvent,
  type ConcreteNode,
  type ConcreteProcess,
  type ConcreteRound,
  manyList,
} from "@/tournament/concrete";

/**
 * Layout only: project the concrete structure (`@/tournament/concrete`) onto
 * React Flow nodes and edges, one level of resolution per canvas:
 *
 * - the OVERVIEW is the event's own level — a left-to-right timeline of
 *   stage frames, group lanes, round steps. There is no "event node": the
 *   page is the event.
 * - a ROUND level is that round's pairings, stacked.
 * - a NODE level is one encounter's immediate children — every board and
 *   leg its own card. Drilling descends; a breadcrumb walks back up.
 *
 * Everything domain-shaped — sizes (known or open-with-exemplars), side
 * names, seat-derived colors, roles, seed links — arrives precomputed in the
 * concrete structure. This file iterates it and places cards.
 */

export const flowCardDataSchema = z.object({
  /** The colored chip: spine concepts or the encounter kind's name. */
  chip: z.string(),
  title: z.string(),
  badge: z.string().optional(),
  lines: z.array(z.string()).readonly(),
  /** Who holds which color at this node (white square / black square chips). */
  sides: z
    .object({ white: z.string(), black: z.string() })
    .readonly()
    .optional(),
  /** This card stands for N identical siblings. */
  count: z.number().optional(),
  /** Clicking descends one level of resolution. */
  drill: z.boolean(),
  /** Edge direction at this node: timeline (right) or top-down. */
  flow: z.enum(["right", "down"]),
  /** Compact step rendering (round chips on the timeline). */
  step: z.boolean(),
  /** Faded illustration of an open size ("… pairing n") — not interactive. */
  ghost: z.boolean(),
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
      readonly kind: "round";
      readonly title: string;
      readonly round: ConcreteRound;
    }
  | {
      readonly kind: "node";
      readonly title: string;
      readonly node: ConcreteNode;
    }
  | {
      readonly kind: "process";
      readonly title: string;
      readonly process: ConcreteProcess;
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
    sides?: { white: string; black: string } | undefined;
    count?: number | undefined;
    drill?: boolean;
    flow?: "right" | "down";
    step?: boolean;
    ghost?: boolean;
  },
): FlowCardData => ({
  chip,
  title,
  lines,
  ...(options?.badge === undefined ? {} : { badge: options.badge }),
  ...(options?.sides === undefined ? {} : { sides: options.sides }),
  ...(options?.count === undefined ? {} : { count: options.count }),
  drill: options?.drill ?? false,
  flow: options?.flow ?? "right",
  step: options?.step ?? false,
  ghost: options?.ghost ?? false,
});

/** The card face of a non-encounter concrete card (scoring, standings, …). */
const plainCard = (
  concrete: ConcreteCard,
  options: { flow: "right" | "down"; step?: boolean },
): FlowCardData =>
  card(concrete.kind, concrete.title, concrete.lines, {
    badge: concrete.badge,
    ...options,
  });

/** The card face of one concrete node, with an optional leading label line. */
const nodeCard = (
  node: ConcreteNode,
  label: string | undefined,
  options: {
    drill: boolean;
    flow: "right" | "down";
    ghost?: boolean;
  },
): FlowCardData =>
  card(
    node.kind,
    node.title,
    [...(label === undefined ? [] : [label]), ...node.lines],
    {
      badge: node.badge,
      sides: node.sides,
      count: node.count,
      ...options,
    },
  );

// ---------------------------------------------------------------------------
// Overview: a timeline of stage frames with group lanes and round steps

export function buildOverviewGraph(event: ConcreteEvent): FlowGraph {
  const nodes: FlowGraphNode[] = [];
  const edges: FlowGraphEdge[] = [];
  const drills = new Map<string, DrillTarget>();
  /** First and last node of each group lane, for cross-stage seed edges. */
  const laneHead = new Map<string, string>();
  const laneTail = new Map<string, string>();

  let cursorX = 0;
  for (const stage of event.stages) {
    const frameId = `stage:${stage.id}`;
    const laneNodes: FlowGraphNode[] = [];
    let laneY = FRAME_TITLE + FRAME_PAD;
    let widest = CARD_W;

    for (const group of stage.groups) {
      const key = `${stage.id}/${group.id}`;
      const headerId = `g:${key}`;
      laneHead.set(key, headerId);

      if (group.run.kind === "rounds") {
        const run = group.run;
        laneNodes.push({
          id: headerId,
          type: "card",
          parentId: frameId,
          position: { x: FRAME_PAD, y: laneY },
          data: plainCard(group.header, { flow: "right" }),
        });

        const rounds = manyList(run.rounds);
        // Every round is followed by its process step: standings update and
        // re-pair between rounds, the final standings after the last.
        const steps: readonly (
          | { kind: "round"; round: ConcreteRound; ghost: boolean }
          | {
              kind: "process";
              process: ConcreteProcess;
              title: string;
              label: string;
            }
        )[] = rounds.flatMap(({ item: round, ghost }, i) => [
          { kind: "round" as const, round, ghost },
          i < rounds.length - 1
            ? {
                kind: "process" as const,
                process: run.between,
                title: `After ${round.label}`,
                label: "standings · pair",
              }
            : {
                kind: "process" as const,
                process: run.final,
                title: "Final standings",
                label: "standings",
              },
        ]);
        let previous = headerId;
        steps.forEach((step, slot) => {
          const stepId = `${headerId}/step-${slot + 1}`;
          const ghost = step.kind === "round" && step.ghost;
          laneNodes.push({
            id: stepId,
            type: "card",
            parentId: frameId,
            position: {
              x: FRAME_PAD + CARD_W + GAP_X + slot * (STEP_W + GAP_X),
              y: laneY + STEP_Y_NUDGE,
            },
            data:
              step.kind === "round"
                ? card("round", step.round.label, [], {
                    drill: !ghost,
                    step: true,
                    ghost,
                  })
                : card("standings", step.label, [], {
                    drill: true,
                    step: true,
                  }),
          });
          edges.push({
            id: `c:${previous}->${stepId}`,
            source: previous,
            target: stepId,
            kind: "chain",
          });
          if (step.kind === "round" && !ghost) {
            drills.set(stepId, {
              kind: "round",
              title: step.round.label,
              round: step.round,
            });
          }
          if (step.kind === "process") {
            drills.set(stepId, {
              kind: "process",
              title: step.title,
              process: step.process,
            });
          }
          previous = stepId;
        });
        laneTail.set(key, previous);
        widest = Math.max(widest, CARD_W + (GAP_X + STEP_W) * steps.length);
      } else {
        const node = group.run.node;
        const runId = `${headerId}/run`;
        laneNodes.push({
          id: headerId,
          type: "card",
          parentId: frameId,
          position: { x: FRAME_PAD, y: laneY },
          data: plainCard(group.header, { flow: "right" }),
        });
        laneNodes.push({
          id: runId,
          type: "card",
          parentId: frameId,
          position: { x: FRAME_PAD + CARD_W + GAP_X, y: laneY },
          data: nodeCard(node, undefined, {
            drill: node.children.length > 0,
            flow: "right",
          }),
        });
        edges.push({
          id: `c:${headerId}->${runId}`,
          source: headerId,
          target: runId,
          kind: "chain",
        });
        if (node.children.length > 0) {
          drills.set(runId, { kind: "node", title: node.title, node });
        }
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
  for (const stage of event.stages) {
    for (const group of stage.groups) {
      const targetHead = laneHead.get(`${stage.id}/${group.id}`);
      if (targetHead === undefined) continue;
      group.seededFrom.forEach((link, index) => {
        const sourceTail = laneTail.get(`${link.stage}/${link.group}`);
        if (sourceTail === undefined) return;
        edges.push({
          id: `seed:${targetHead}:${index}`,
          source: sourceTail,
          target: targetHead,
          label: link.label,
          kind: "seed",
        });
      });
    }
  }

  return { nodes, edges, drills };
}

// ---------------------------------------------------------------------------
// Level views: ONE level of resolution per canvas — drill to descend

export function buildLevelGraph(target: DrillTarget): FlowGraph {
  switch (target.kind) {
    case "round":
      return buildRoundLevel(target.round);
    case "node":
      return buildNodeLevel(target.node);
    case "process":
      return buildProcessLevel(target.process);
  }
}

/**
 * A round is its pairings, stacked — open sizes end in a faded exemplar —
 * and its output: every outcome through the scoring rule. Standings and
 * re-pairing belong to the process step between rounds, not here.
 */
function buildRoundLevel(round: ConcreteRound): FlowGraph {
  const nodes: FlowGraphNode[] = [];
  const edges: FlowGraphEdge[] = [];
  const drills = new Map<string, DrillTarget>();

  const pairings = manyList(round.pairings);

  pairings.forEach(({ item: pairing, ghost }, slot) => {
    const id = `lvl:${slot + 1}`;
    const drill = !ghost && pairing.node.children.length > 0;
    nodes.push({
      id,
      type: "card",
      position: { x: 0, y: slot * STACK_H },
      data: nodeCard(pairing.node, pairing.label, {
        drill,
        flow: "down",
        ghost,
      }),
    });
    if (drill) {
      drills.set(id, {
        kind: "node",
        title: `${pairing.label} — ${pairing.node.title}`,
        node: pairing.node,
      });
    }
  });

  // The round's output, to the right: every outcome through the scoring rule.
  const scoringId = "scoring";
  nodes.push({
    id: scoringId,
    type: "card",
    position: {
      x: CARD_W + 3 * GAP_X,
      y: ((pairings.length - 1) * STACK_H) / 2,
    },
    data: plainCard(round.scoring, { flow: "right" }),
  });
  pairings.forEach((_, slot) => {
    edges.push({
      id: `c:lvl:${slot + 1}->${scoringId}`,
      source: `lvl:${slot + 1}`,
      target: scoringId,
      kind: "chain",
    });
  });

  return { nodes, edges, drills };
}

/** Between rounds: standings update from the points, then pair what's next. */
function buildProcessLevel(process: ConcreteProcess): FlowGraph {
  const nodes: FlowGraphNode[] = [];
  const edges: FlowGraphEdge[] = [];
  const chain: readonly ConcreteCard[] = [
    process.standings,
    ...(process.repair === undefined ? [] : [process.repair]),
  ];
  chain.forEach((concrete, i) => {
    nodes.push({
      id: `proc:${i + 1}`,
      type: "card",
      position: { x: i * (CARD_W + GAP_X), y: 0 },
      data: plainCard(concrete, { flow: "right" }),
    });
    if (i > 0) {
      edges.push({
        id: `c:proc:${i}->proc:${i + 1}`,
        source: `proc:${i}`,
        target: `proc:${i + 1}`,
        kind: "chain",
      });
    }
  });
  return { nodes, edges, drills: new Map() };
}

/** One node's immediate children, each its own card — no compression. */
function buildNodeLevel(node: ConcreteNode): FlowGraph {
  const nodes: FlowGraphNode[] = [];
  const edges: FlowGraphEdge[] = [];
  const drills = new Map<string, DrillTarget>();

  // A leaf (single game) has nothing inside: show the thing itself up close.
  if (node.children.length === 0) {
    nodes.push({
      id: "lvl:1",
      type: "card",
      position: { x: 0, y: 0 },
      data: nodeCard(node, undefined, { drill: false, flow: "right" }),
    });
    return { nodes, edges, drills };
  }

  const sequence = node.arrangement === "sequence";
  node.children.forEach((child, index) => {
    const id = `lvl:${index + 1}`;
    const drill = child.children.length > 0;
    nodes.push({
      id,
      type: "card",
      position: sequence
        ? { x: index * (CARD_W + GAP_X), y: 0 }
        : { x: 0, y: index * STACK_H },
      data: nodeCard(child, child.role, {
        drill,
        flow: sequence ? "right" : "down",
      }),
    });
    if (drill) {
      drills.set(id, {
        kind: "node",
        title: `${child.role ?? child.title} — ${child.title}`,
        node: child,
      });
    }
    if (sequence && index > 0) {
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
