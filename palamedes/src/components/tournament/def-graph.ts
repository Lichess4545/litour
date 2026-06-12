import { z } from "zod";
import {
  type ConcreteCard,
  type ConcreteEvent,
  type ConcreteGroup,
  type ConcreteNode,
  type ConcreteProcess,
  type ConcreteRound,
  type ConcreteStage,
  manyList,
} from "@/tournament/concrete";

/**
 * Layout only: project the concrete structure (`@/tournament/concrete`) onto
 * React Flow nodes and edges, with in-place expansion. Every drillable card
 * can be expanded where it stands: the card is replaced by a bordered frame
 * containing the next level of resolution — siblings shift to make room and
 * every edge keeps pointing at the same id — so one canvas can span several
 * resolutions (the stage sequence with one stage opened to its rounds, a
 * round opened to its pairings, a pairing opened to its boards).
 *
 * The levels: the EVENT is its stages in sequence joined by advancement
 * flows; a STAGE is its groups as lanes of round/process steps; a ROUND is
 * its pairings feeding the scoring rule; a NODE is its immediate children;
 * a PROCESS is standings → pair-next. One generic rule needs no state: an
 * item that is the only drillable thing at its level renders pre-expanded
 * (and cannot collapse), so a single-stage event opens at its rounds
 * without any special case.
 *
 * Everything domain-shaped — sizes (known or open-with-exemplars), side
 * names, seat-derived colors, roles, seed links — arrives precomputed in
 * the concrete structure. This file iterates it and places cards.
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
  /** Clicking expands this card in place. */
  drill: z.boolean(),
  /** Edge direction at this node: timeline (right) or top-down. */
  flow: z.enum(["right", "down"]),
  /** Compact step rendering (round chips on the timeline). */
  step: z.boolean(),
  /** Faded illustration of an open size ("… pairing n") — not interactive. */
  ghost: z.boolean(),
});
export type FlowCardData = z.infer<typeof flowCardDataSchema>;

export const frameDataSchema = z.strictObject({
  title: z.string(),
  /** Clicking the frame collapses it back to its card. */
  collapsible: z.boolean(),
});
export type FrameData = z.infer<typeof frameDataSchema>;

export type FlowGraphNode =
  | {
      readonly id: string;
      readonly type: "card";
      readonly position: { readonly x: number; readonly y: number };
      readonly data: FlowCardData;
      /** Estimated footprint (layout + minimap); the DOM may differ slightly. */
      readonly width: number;
      readonly height: number;
      readonly parentId?: string | undefined;
    }
  | {
      readonly id: string;
      readonly type: "frame";
      readonly position: { readonly x: number; readonly y: number };
      readonly data: FrameData;
      readonly width: number;
      readonly height: number;
      readonly parentId?: string | undefined;
    };

export type FlowGraphEdge = {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly label?: string | undefined;
  readonly kind: "chain" | "seed";
};

export type FlowGraph = {
  readonly nodes: readonly FlowGraphNode[];
  readonly edges: readonly FlowGraphEdge[];
  /** Card ids that expand in place when clicked. */
  readonly expandables: ReadonlySet<string>;
  /** Frame ids that collapse back to their card when clicked. */
  readonly collapsibles: ReadonlySet<string>;
};

export const CARD_W = 224;
export const STEP_W = 148;
const GAP = 36;
const LANE_GAP = 44;
const FRAME_PAD = 20;
const FRAME_TITLE = 34;

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
  options?: { flow?: "right" | "down"; step?: boolean; drill?: boolean },
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
// Sized sub-graphs: every level builder returns a relatively-positioned
// fragment with its footprint, so parents can lay items out around whatever
// is currently expanded.

type Sub = {
  readonly nodes: readonly FlowGraphNode[];
  readonly edges: readonly FlowGraphEdge[];
  readonly expandables: ReadonlySet<string>;
  readonly collapsibles: ReadonlySet<string>;
  readonly w: number;
  readonly h: number;
};

/** Rendered height of a card — an estimate the gaps absorb. */
const cardH = (data: FlowCardData): number =>
  data.step
    ? 58
    : 62 +
      (data.badge === undefined ? 0 : 18) +
      (data.sides === undefined ? 0 : 22) +
      data.lines.length * 17 +
      (data.drill ? 20 : 0);

function cardSub(id: string, data: FlowCardData): Sub {
  const w = data.step ? STEP_W : CARD_W;
  const h = cardH(data);
  return {
    nodes: [
      {
        id,
        type: "card",
        position: { x: 0, y: 0 },
        data,
        width: w,
        height: h,
      },
    ],
    edges: [],
    expandables: data.drill ? new Set([id]) : new Set(),
    collapsibles: new Set(),
    w,
    h,
  };
}

/** Shift a fragment's root nodes (nested children stay parent-relative). */
const offset = (sub: Sub, dx: number, dy: number): Sub => ({
  ...sub,
  nodes: sub.nodes.map((node) =>
    node.parentId !== undefined
      ? node
      : {
          ...node,
          position: { x: node.position.x + dx, y: node.position.y + dy },
        },
  ),
});

const merge = (subs: readonly Sub[], w: number, h: number): Sub => ({
  nodes: subs.flatMap((sub) => sub.nodes),
  edges: subs.flatMap((sub) => sub.edges),
  expandables: new Set(subs.flatMap((sub) => [...sub.expandables])),
  collapsibles: new Set(subs.flatMap((sub) => [...sub.collapsibles])),
  w,
  h,
});

/** Left-to-right, vertically centered. */
function row(items: readonly Sub[], gap: number): Sub {
  const h = items.reduce((max, item) => Math.max(max, item.h), 0);
  let x = 0;
  const placed = items.map((item) => {
    const sub = offset(item, x, (h - item.h) / 2);
    x += item.w + gap;
    return sub;
  });
  return merge(placed, Math.max(0, x - gap), h);
}

/** Top-to-bottom, left aligned. */
function column(items: readonly Sub[], gap: number): Sub {
  const w = items.reduce((max, item) => Math.max(max, item.w), 0);
  let y = 0;
  const placed = items.map((item) => {
    const sub = offset(item, 0, y);
    y += item.h + gap;
    return sub;
  });
  return merge(placed, w, Math.max(0, y - gap));
}

/** Wrap a fragment in a bordered frame that owns its children. */
function frameSub(
  id: string,
  title: string,
  inner: Sub,
  collapsible: boolean,
): Sub {
  const w = inner.w + FRAME_PAD * 2;
  const h = inner.h + FRAME_TITLE + FRAME_PAD;
  const frame: FlowGraphNode = {
    id,
    type: "frame",
    position: { x: 0, y: 0 },
    data: { title, collapsible },
    width: w,
    height: h,
  };
  const children = inner.nodes.map(
    (node): FlowGraphNode =>
      node.parentId !== undefined
        ? node
        : {
            ...node,
            parentId: id,
            position: {
              x: node.position.x + FRAME_PAD,
              y: node.position.y + FRAME_TITLE,
            },
          },
  );
  return {
    nodes: [frame, ...children],
    edges: inner.edges,
    expandables: inner.expandables,
    collapsibles: collapsible
      ? new Set([id, ...inner.collapsibles])
      : inner.collapsibles,
    w,
    h,
  };
}

/**
 * A drillable item: its card, or — when expanded (or forced, for the only
 * drillable thing at its level) — a frame holding the next level down.
 */
function item(
  id: string,
  title: string,
  data: FlowCardData,
  inner: () => Sub,
  expanded: ReadonlySet<string>,
  force = false,
): Sub {
  if (!force && !expanded.has(id)) return cardSub(id, data);
  return frameSub(id, title, inner(), !force);
}

// ---------------------------------------------------------------------------
// The levels

export function buildGraph(
  event: ConcreteEvent,
  expanded: ReadonlySet<string>,
): FlowGraph {
  const force = event.stages.length === 1;
  const items = event.stages.map((stage) =>
    item(
      `s:${stage.id}`,
      stage.id,
      card(stage.card.kind, stage.card.title, stage.card.lines, {
        badge: stage.card.badge,
        drill: true,
      }),
      () => stageSub(stage, `s:${stage.id}`, expanded),
      expanded,
      force,
    ),
  );
  const laid = row(items, GAP * 2);

  const edges: FlowGraphEdge[] = [...laid.edges];
  event.stages.forEach((stage, index) => {
    const id = `s:${stage.id}`;
    if (stage.seededFrom.length > 0) {
      stage.seededFrom.forEach((link, li) => {
        edges.push({
          id: `seed:${id}:${li}`,
          source: `s:${link.stage}`,
          target: id,
          label: link.label,
          kind: "seed",
        });
      });
    } else if (index > 0) {
      const previous = event.stages[index - 1];
      if (previous !== undefined) {
        edges.push({
          id: `c:s:${previous.id}->${id}`,
          source: `s:${previous.id}`,
          target: id,
          kind: "chain",
        });
      }
    }
  });

  return {
    nodes: laid.nodes,
    edges,
    expandables: laid.expandables,
    collapsibles: laid.collapsibles,
  };
}

/** One stage: its groups as parallel lanes of round and process steps. */
function stageSub(
  stage: ConcreteStage,
  pid: string,
  expanded: ReadonlySet<string>,
): Sub {
  return column(
    stage.groups.map((group) => laneSub(group, `${pid}/${group.id}`, expanded)),
    LANE_GAP,
  );
}

/** One group's lane: header, then its schedule left-to-right. */
function laneSub(
  group: ConcreteGroup,
  pid: string,
  expanded: ReadonlySet<string>,
): Sub {
  const ids: string[] = [`${pid}/hdr`];
  const items: Sub[] = [cardSub(`${pid}/hdr`, plainCard(group.header))];

  if (group.run.kind === "rounds") {
    const run = group.run;
    const rounds = manyList(run.rounds);
    rounds.forEach(({ item: round, ghost }, i) => {
      const roundId = `${pid}/r${i + 1}`;
      ids.push(roundId);
      items.push(
        ghost
          ? cardSub(
              roundId,
              card("round", round.label, [], { step: true, ghost: true }),
            )
          : item(
              roundId,
              round.label,
              card("round", round.label, [], { drill: true, step: true }),
              () => roundSub(round, roundId, expanded),
              expanded,
            ),
      );
      const last = i === rounds.length - 1;
      const processId = `${pid}/after${i + 1}`;
      ids.push(processId);
      items.push(
        item(
          processId,
          last ? "Final standings" : `After ${round.label}`,
          card("standings", last ? "standings" : "standings · pair", [], {
            drill: true,
            step: true,
          }),
          () => processSub(last ? run.final : run.between, processId),
          expanded,
        ),
      );
    });
  } else {
    const node = group.run.node;
    const runId = `${pid}/run`;
    ids.push(runId);
    items.push(
      node.children.length > 0
        ? item(
            runId,
            node.title,
            nodeCard(node, undefined, { drill: true, flow: "right" }),
            () => childrenSub(node, runId, expanded),
            expanded,
          )
        : cardSub(
            runId,
            nodeCard(node, undefined, { drill: false, flow: "right" }),
          ),
    );
  }

  const laid = row(items, GAP);
  const edges: FlowGraphEdge[] = ids.slice(1).map((target, i) => ({
    id: `c:${ids[i] ?? ""}->${target}`,
    source: ids[i] ?? "",
    target,
    kind: "chain",
  }));
  return { ...laid, edges: [...laid.edges, ...edges] };
}

/** Between rounds: standings update, then pair what's next. */
function processSub(process: ConcreteProcess, pid: string): Sub {
  const items: Sub[] = [
    cardSub(`${pid}/standings`, plainCard(process.standings)),
    ...(process.repair === undefined
      ? []
      : [cardSub(`${pid}/repair`, plainCard(process.repair))]),
  ];
  const laid = row(items, GAP);
  const edges: FlowGraphEdge[] =
    process.repair === undefined
      ? []
      : [
          {
            id: `c:${pid}/standings->${pid}/repair`,
            source: `${pid}/standings`,
            target: `${pid}/repair`,
            kind: "chain",
          },
        ];
  return { ...laid, edges: [...laid.edges, ...edges] };
}

/** A round: its pairings stacked, feeding the scoring rule. */
function roundSub(
  round: ConcreteRound,
  pid: string,
  expanded: ReadonlySet<string>,
): Sub {
  const pairings = manyList(round.pairings);
  const pairIds: string[] = [];
  const stack = column(
    pairings.map(({ item: pairing, ghost }, i) => {
      const pairId = `${pid}/p${i + 1}`;
      pairIds.push(pairId);
      const drillable = !ghost && pairing.node.children.length > 0;
      return drillable
        ? item(
            pairId,
            `${pairing.label} — ${pairing.node.title}`,
            nodeCard(pairing.node, pairing.label, {
              drill: true,
              flow: "down",
            }),
            () => childrenSub(pairing.node, pairId, expanded),
            expanded,
          )
        : cardSub(
            pairId,
            nodeCard(pairing.node, pairing.label, {
              drill: false,
              flow: "down",
              ghost,
            }),
          );
    }),
    GAP,
  );

  const scoringId = `${pid}/scoring`;
  const scoring = cardSub(scoringId, plainCard(round.scoring));
  const placedScoring = offset(
    scoring,
    stack.w + GAP * 3,
    (stack.h - scoring.h) / 2,
  );
  const edges: FlowGraphEdge[] = pairIds.map((pairId) => ({
    id: `c:${pairId}->${scoringId}`,
    source: pairId,
    target: scoringId,
    kind: "chain",
  }));
  const laid = merge(
    [stack, placedScoring],
    stack.w + GAP * 3 + scoring.w,
    Math.max(stack.h, scoring.h),
  );
  return { ...laid, edges: [...laid.edges, ...edges] };
}

/** One node's immediate children, each its own item — no compression. */
function childrenSub(
  node: ConcreteNode,
  pid: string,
  expanded: ReadonlySet<string>,
): Sub {
  const sequence = node.arrangement === "sequence";
  const flow = sequence ? ("right" as const) : ("down" as const);
  const drillableCount = node.children.filter(
    (child) => child.children.length > 0,
  ).length;
  const ids: string[] = [];
  const items = node.children.map((child, i) => {
    const childId = `${pid}/c${i + 1}`;
    ids.push(childId);
    if (child.children.length === 0) {
      return cardSub(
        childId,
        nodeCard(child, child.role, { drill: false, flow }),
      );
    }
    return item(
      childId,
      `${child.role ?? child.title} — ${child.title}`,
      nodeCard(child, child.role, { drill: true, flow }),
      () => childrenSub(child, childId, expanded),
      expanded,
      node.children.length === 1 && drillableCount === 1,
    );
  });
  const laid = sequence ? row(items, GAP) : column(items, GAP);
  const edges: FlowGraphEdge[] = sequence
    ? ids.slice(1).map((target, i) => ({
        id: `c:${ids[i] ?? ""}->${target}`,
        source: ids[i] ?? "",
        target,
        label: "then",
        kind: "chain",
      }))
    : [];
  return { ...laid, edges: [...laid.edges, ...edges] };
}
