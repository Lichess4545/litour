import { z } from "zod";
import {
  type ConcreteCard,
  type ConcreteCompetition,
  type ConcreteEvent,
  type ConcreteNode,
  type ConcretePairing,
  type ConcreteProcess,
  type ConcreteRound,
  type ConcreteRoundsRun,
  manyList,
} from "@/tournament/concrete";

/**
 * Layout only: project the concrete structure (`@/tournament/concrete`) onto
 * React Flow nodes and edges, with in-place expansion. Every drillable card
 * can be expanded where it stands: the card is replaced by a bordered frame
 * containing the next level of resolution — siblings shift to make room and
 * every edge keeps pointing at the same id — so one canvas can span several
 * resolutions (a container opened beside collapsed siblings, a round opened
 * to its pairings, a pairing opened to its boards).
 *
 * ONE recursive item draws every competition. A leaf's collapsed face is
 * its card (name, entrants, schedule, inflows — the card IS the lane
 * header); expanded, it becomes a frame holding its lane (the rounds cycle,
 * brackets, process icons) or its encounter recursion. A container's
 * collapsed face lists its children; expanded, it becomes a frame holding
 * intake icons and its children laid out by sibling tier. One generic rule
 * needs no state: an item that is the only drillable thing at its level
 * renders pre-expanded (and cannot collapse) — the root always, an only
 * child, an encounter leaf's run — so a single-competition event opens at
 * its rounds without any special case.
 *
 * Everything domain-shaped — sizes (known or open-with-exemplars), side
 * names, seat-derived colors, roles, sibling tiers, seed links — arrives
 * precomputed in the concrete structure. This file iterates it and places
 * cards; intake edges target the most specific visible node.
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
  /** Compact step rendering (round chips on the timeline). */
  step: z.boolean(),
  /** Icon-only rendering for administrative nodes (open for detail). */
  iconOnly: z.boolean(),
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
  /** Which side the edge leaves from (right, bottom, or left for cycles). */
  readonly fromHandle: "r" | "b" | "lo";
  /** Which side the edge arrives at (left, top, or right for cycles). */
  readonly toHandle: "l" | "t" | "ri";
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
    step?: boolean;
    ghost?: boolean;
    iconOnly?: boolean;
  },
): FlowCardData => ({
  chip,
  title,
  lines,
  ...(options?.badge === undefined ? {} : { badge: options.badge }),
  ...(options?.sides === undefined ? {} : { sides: options.sides }),
  ...(options?.count === undefined ? {} : { count: options.count }),
  drill: options?.drill ?? false,
  step: options?.step ?? false,
  ghost: options?.ghost ?? false,
  iconOnly: options?.iconOnly ?? false,
});

/** The card face of a non-encounter concrete card (scoring, standings, …). */
const plainCard = (
  concrete: ConcreteCard,
  options?: { step?: boolean; drill?: boolean },
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
  data.iconOnly
    ? 64
    : data.step
      ? 58
      : 62 +
        (data.badge === undefined ? 0 : 18) +
        (data.sides === undefined ? 0 : 22) +
        data.lines.length * 17 +
        (data.drill ? 20 : 0);

function cardSub(id: string, data: FlowCardData): Sub {
  const w = data.iconOnly ? 64 : data.step ? STEP_W : CARD_W;
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

/** Top-to-bottom; centered alignment keeps a straight vertical spine. */
function column(
  items: readonly Sub[],
  gap: number,
  align: "left" | "center" = "left",
): Sub {
  const w = items.reduce((max, item) => Math.max(max, item.w), 0);
  let y = 0;
  const placed = items.map((item) => {
    const sub = offset(item, align === "center" ? (w - item.w) / 2 : 0, y);
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

/** An administrative node: an icon by default, its detail when opened. */
function iconItem(
  id: string,
  concrete: ConcreteCard,
  expanded: ReadonlySet<string>,
  inner?: () => Sub,
): Sub {
  if (!expanded.has(id)) {
    return cardSub(
      id,
      card(concrete.kind, concrete.title, [], { drill: true, iconOnly: true }),
    );
  }
  return frameSub(
    id,
    concrete.title,
    inner === undefined
      ? cardSub(`${id}/detail`, plainCard(concrete))
      : inner(),
    true,
  );
}

/** A run of identical siblings: one ×N card, unfoldable to the full list. */
function foldedRun(
  id: string,
  face: FlowCardData,
  title: string,
  buildAll: () => Sub,
  expanded: ReadonlySet<string>,
): Sub {
  if (!expanded.has(id)) return cardSub(id, face);
  return frameSub(id, title, buildAll(), true);
}

/** Items fold when at least this many identical siblings repeat. */
const FOLD_AT = 4;

// ---------------------------------------------------------------------------
// The levels

export function buildGraph(
  event: ConcreteEvent,
  expanded: ReadonlySet<string>,
): FlowGraph {
  const root = event.root;
  // The root is the only item at its level: force-expanded, uncollapsible.
  const rootItem = competitionItem(root, expanded, true);
  const laid =
    root.intakes.length === 0
      ? rootItem
      : row(
          [
            column(
              root.intakes.map((intake) =>
                iconItem(`in:${intake.id}`, intake.card, expanded),
              ),
              LANE_GAP,
              "center",
            ),
            rootItem,
          ],
          GAP * 2,
        );

  const visibility = collectVisibility(root, expanded);
  // Where a flow out of a competition starts: its lane end when its own
  // frame is open, its card when collapsed, the deepest visible ancestor
  // when folded away inside one.
  const sourceAnchor = (id: string): string | undefined => {
    const spot = visibility.get(id);
    if (spot === undefined) return undefined;
    if (!spot.selfVisible) return spot.anchor;
    if (!spot.selfExpanded) return `s:${id}`;
    switch (spot.runKind) {
      case "rounds":
        return `s:${id}/out`;
      case "encounter":
        return `s:${id}/run`;
      case "competitions":
        return `s:${id}`;
    }
  };

  // Intake edges target the most specific visible node: the intake icon and
  // the leaf card/frame where rendered, else the deepest visible ancestor.
  const edges: FlowGraphEdge[] = [...laid.edges];
  const direct = new Set<string>();
  const visitComp = (comp: ConcreteCompetition): void => {
    const spot = visibility.get(comp.id);
    for (const intake of spot === undefined ? [] : comp.intakes) {
      if (spot?.selfVisible === true) {
        intake.from.forEach((source, si) => {
          const from = sourceAnchor(source);
          if (from === undefined) return;
          edges.push({
            id: `seed:in:${intake.id}:${si}`,
            source: from,
            target: `in:${intake.id}`,
            fromHandle: "r",
            toHandle: "l",
            kind: "seed",
          });
        });
        edges.push({
          id: `seed:in:${intake.id}->${comp.id}`,
          source: `in:${intake.id}`,
          target: `s:${comp.id}`,
          label: intake.take,
          fromHandle: "r",
          toHandle: "l",
          kind: "seed",
        });
        continue;
      }
      // The icon is folded away inside a collapsed ancestor: connect the
      // sources straight to that ancestor, once per (source, target, label).
      for (const source of intake.from) {
        const from = sourceAnchor(source);
        const to = spot?.anchor;
        if (from === undefined || to === undefined || from === to) continue;
        const key = `${from}|${to}|${intake.take ?? ""}`;
        if (direct.has(key)) continue;
        direct.add(key);
        edges.push({
          id: `seed:${key}`,
          source: from,
          target: to,
          label: intake.take,
          fromHandle: "r",
          toHandle: "l",
          kind: "seed",
        });
      }
    }
    if (comp.run.kind === "competitions") {
      for (const child of comp.run.competitions) visitComp(child);
    }
  };
  visitComp(root);

  return {
    nodes: laid.nodes,
    edges,
    expandables: laid.expandables,
    collapsibles: laid.collapsibles,
  };
}

type CompVisibility = {
  /** This competition's own node id, or the deepest visible ancestor's. */
  readonly anchor: string;
  readonly selfVisible: boolean;
  readonly selfExpanded: boolean;
  readonly runKind: "rounds" | "encounter" | "competitions";
};

function collectVisibility(
  root: ConcreteCompetition,
  expanded: ReadonlySet<string>,
): ReadonlyMap<string, CompVisibility> {
  const info = new Map<string, CompVisibility>();
  const walk = (
    comp: ConcreteCompetition,
    parentInteriorVisible: boolean,
    anchorAbove: string,
    forced: boolean,
  ): void => {
    const selfVisible = parentInteriorVisible;
    const anchor = selfVisible ? `s:${comp.id}` : anchorAbove;
    const selfExpanded = forced || expanded.has(`s:${comp.id}`);
    info.set(comp.id, {
      anchor,
      selfVisible,
      selfExpanded,
      runKind: comp.run.kind,
    });
    if (comp.run.kind === "competitions") {
      const interior = selfVisible && selfExpanded;
      const onlyChild = comp.run.competitions.length === 1;
      for (const child of comp.run.competitions) {
        walk(child, interior, anchor, onlyChild);
      }
    }
  };
  walk(root, true, `s:${root.id}`, true);
  return info;
}

/**
 * THE recursive item: any competition, leaf or container, collapsed to its
 * card or expanded in place to its body.
 */
function competitionItem(
  comp: ConcreteCompetition,
  expanded: ReadonlySet<string>,
  force: boolean,
): Sub {
  const id = `s:${comp.id}`;
  return item(
    id,
    comp.title,
    card(comp.card.kind, comp.card.title, comp.card.lines, {
      badge: comp.card.badge,
      drill: true,
    }),
    () => competitionBody(comp, id, expanded),
    expanded,
    force,
  );
}

/** What an expanded competition's frame contains. */
function competitionBody(
  comp: ConcreteCompetition,
  pid: string,
  expanded: ReadonlySet<string>,
): Sub {
  const run = comp.run;
  switch (run.kind) {
    case "competitions":
      return containerBody(run.competitions, expanded);
    case "rounds":
      return poolLaneSub(run, pid, expanded);
    case "encounter": {
      const runId = `${pid}/run`;
      // The run card is the only drillable thing at this level: forced.
      return run.node.children.length > 0
        ? item(
            runId,
            run.node.title,
            nodeCard(run.node, undefined, { drill: true }),
            () => childrenSub(run.node, runId, expanded),
            expanded,
            true,
          )
        : cardSub(runId, nodeCard(run.node, undefined, { drill: false }));
    }
  }
}

/**
 * A container's interior: sibling tiers flow left to right; children within
 * a tier are independent of each other (the tour's events) and stack
 * vertically, their intake icons in a column just before them. The only
 * edges are real seed flows — no implied order between independents.
 */
function containerBody(
  children: readonly ConcreteCompetition[],
  expanded: ReadonlySet<string>,
): Sub {
  const force = children.length === 1;
  const tierCount = children.reduce((max, c) => Math.max(max, c.tier), 0) + 1;
  const columns: Sub[] = [];
  for (let tier = 0; tier < tierCount; tier += 1) {
    const tierChildren = children.filter((child) => child.tier === tier);
    const intakes = tierChildren.flatMap((child) => child.intakes);
    if (intakes.length > 0) {
      columns.push(
        column(
          intakes.map((intake) =>
            iconItem(`in:${intake.id}`, intake.card, expanded),
          ),
          LANE_GAP,
          "center",
        ),
      );
    }
    columns.push(
      column(
        tierChildren.map((child) => competitionItem(child, expanded, force)),
        LANE_GAP,
        "center",
      ),
    );
  }
  return row(columns, GAP * 2);
}

/** A pool leaf's lane: its schedule left-to-right (rounds, process icons). */
function poolLaneSub(
  run: ConcreteRoundsRun,
  pid: string,
  expanded: ReadonlySet<string>,
): Sub {
  const items: Sub[] = [];
  /** Bracket, cycle, and chain edges, built as the lane assembles. */
  const loops: FlowGraphEdge[] = [];
  let prev: string | undefined;
  const connect = (to: string): void => {
    if (prev !== undefined) {
      loops.push({
        id: `c:${prev}->${to}`,
        source: prev,
        target: to,
        fromHandle: "r",
        toHandle: "l",
        kind: "chain",
      });
    }
    prev = to;
  };

  {
    const rounds = manyList(run.rounds);
    const roundItem = (
      round: ConcreteRound,
      ghost: boolean,
      i: number,
    ): Sub => {
      const roundId = `${pid}/r${i + 1}`;
      return ghost
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
          );
    };
    // Standings update and re-pairing happen between EVERY round; after the
    // last round only the standings remain. Both render as icons — the
    // between one wears the pairing system's icon.
    const processIcon = (last: boolean, processId: string): Sub =>
      iconItem(
        processId,
        last
          ? {
              kind: "standings",
              title: "Final standings",
              badge: undefined,
              lines: [],
            }
          : {
              kind: run.between.repair?.kind ?? "standings",
              title: "standings · pair next round",
              badge: undefined,
              lines: [],
            },
        expanded,
        () => processSub(last ? run.final : run.between, processId, expanded),
      );

    // Identical rounds fold into one ×N step whose repeating unit INCLUDES
    // the between-rounds process: collapsed, the process icon loops back to
    // the rounds ("next round"); unfolded, the full interleaved chain shows.
    const signature = (round: ConcreteRound): string =>
      JSON.stringify({ ...round, label: "" });
    const firstRound = rounds[0];
    const uniform =
      firstRound !== undefined &&
      rounds.length >= FOLD_AT &&
      rounds.every(
        ({ item: round, ghost }) =>
          !ghost && signature(round) === signature(firstRound.item),
      );
    if (uniform) {
      const lastRound = rounds[rounds.length - 1];
      const runId = `${pid}/rs`;
      const range = `${firstRound.item.label} … ${lastRound?.item.label ?? ""}`;
      const finalId = `${pid}/out`;
      if (!expanded.has(runId)) {
        // The cycle, drawn as one: rounds above, standings·pair below,
        // joined right and left into a circle; ×N rides the return arc.
        const betweenId = `${pid}/between`;
        const stack = column(
          [
            cardSub(
              runId,
              card("round", range, [], { drill: true, step: true }),
            ),
            processIcon(false, betweenId),
          ],
          GAP,
          "center",
        );
        items.push(stack);
        connect(runId);
        loops.push(
          {
            id: `c:${runId}->${betweenId}`,
            source: runId,
            target: betweenId,
            fromHandle: "r",
            toHandle: "ri",
            kind: "chain",
          },
          {
            id: `c:${betweenId}->${runId}`,
            source: betweenId,
            target: runId,
            label: `×${rounds.length}`,
            fromHandle: "lo",
            toHandle: "l",
            kind: "chain",
          },
          {
            id: `c:${betweenId}->${finalId}`,
            source: betweenId,
            target: finalId,
            fromHandle: "r",
            toHandle: "l",
            kind: "chain",
          },
        );
        // The final standings sit after the cycle; the exit edge above is
        // the connection.
        items.push(processIcon(true, finalId));
        prev = finalId;
      } else {
        items.push(
          frameSub(
            runId,
            `${range} ×${rounds.length}`,
            (() => {
              const chainIds: string[] = [];
              const pieces: Sub[] = [];
              rounds.forEach(({ item: round, ghost }, i) => {
                chainIds.push(`${pid}/r${i + 1}`);
                pieces.push(roundItem(round, ghost, i));
                if (i < rounds.length - 1) {
                  const betweenId = `${pid}/after${i + 1}`;
                  chainIds.push(betweenId);
                  pieces.push(processIcon(false, betweenId));
                }
              });
              const chain = row(pieces, GAP);
              const chainEdges: FlowGraphEdge[] = chainIds
                .slice(1)
                .map((target, i) => ({
                  id: `c:${chainIds[i] ?? ""}->${target}`,
                  source: chainIds[i] ?? "",
                  target,
                  fromHandle: "r" as const,
                  toHandle: "l" as const,
                  kind: "chain" as const,
                }));
              return { ...chain, edges: [...chain.edges, ...chainEdges] };
            })(),
            true,
          ),
        );
        connect(runId);
        items.push(processIcon(true, finalId));
        connect(finalId);
      }
    } else {
      rounds.forEach(({ item: round, ghost }, i) => {
        const roundId = `${pid}/r${i + 1}`;
        const prevRoundId = `${pid}/r${i}`;
        items.push(roundItem(round, ghost, i));
        const bracket = i > 0 && round.inflows !== undefined;
        if (
          bracket &&
          expanded.has(prevRoundId) &&
          expanded.has(roundId) &&
          round.inflows !== undefined
        ) {
          // Both rounds open: draw the bracket — winners (and losers, for
          // the bronze) flow pairing-to-pairing.
          for (const flow of round.inflows) {
            for (const from of flow.from) {
              loops.push({
                id: `b:${prevRoundId}/p${from.pair}->${roundId}/p${flow.pair}`,
                source: `${prevRoundId}/p${from.pair}`,
                target: `${roundId}/p${flow.pair}`,
                label: from.take,
                fromHandle: "r",
                toHandle: "l",
                kind: "chain",
              });
            }
          }
          prev = roundId;
        } else {
          connect(roundId);
        }
        const last = i === rounds.length - 1;
        const nextBracket = rounds[i + 1]?.item.inflows !== undefined;
        if (last || !nextBracket) {
          const processId = last ? `${pid}/out` : `${pid}/after${i + 1}`;
          items.push(processIcon(last, processId));
          connect(processId);
        }
      });
    }
  }

  const laid = row(items, GAP);
  return { ...laid, edges: [...laid.edges, ...loops] };
}

/** Between rounds: standings update, then pair what's next. */
function processSub(
  process: ConcreteProcess,
  pid: string,
  expanded: ReadonlySet<string>,
): Sub {
  const items: Sub[] = [
    iconItem(`${pid}/standings`, process.standings, expanded),
    ...(process.repair === undefined
      ? []
      : [iconItem(`${pid}/repair`, process.repair, expanded)]),
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
            fromHandle: "r" as const,
            toHandle: "l" as const,
            kind: "chain" as const,
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
  const pairItem = (
    pairing: (typeof pairings)[number]["item"],
    ghost: boolean,
    i: number,
  ): Sub => {
    const pairId = `${pid}/p${i + 1}`;
    const drillable = !ghost && pairing.node.children.length > 0;
    return drillable
      ? item(
          pairId,
          `${pairing.label} — ${pairing.node.title}`,
          nodeCard(pairing.node, pairing.label, { drill: true }),
          () => childrenSub(pairing.node, pairId, expanded),
          expanded,
        )
      : cardSub(
          pairId,
          nodeCard(pairing.node, pairing.label, { drill: false, ghost }),
        );
  };

  // Identical pairings fold into one ×N card, unfoldable to the full stack.
  const signature = (pairing: ConcretePairing): string =>
    JSON.stringify(pairing.node);
  const first = pairings[0];
  const uniform =
    first !== undefined &&
    pairings.length >= FOLD_AT &&
    pairings.every(
      ({ item: pairing, ghost }) =>
        !ghost && signature(pairing) === signature(first.item),
    );

  let stack: Sub;
  let feedIds: readonly string[];
  if (uniform) {
    const last = pairings[pairings.length - 1];
    const runId = `${pid}/ps`;
    const range = `${first.item.label} … ${last?.item.label ?? ""}`;
    stack = foldedRun(
      runId,
      {
        ...nodeCard(first.item.node, range, { drill: true }),
        count: pairings.length,
      },
      `${range} ×${pairings.length}`,
      () =>
        column(
          pairings.map(({ item: pairing, ghost }, i) =>
            pairItem(pairing, ghost, i),
          ),
          GAP,
        ),
      expanded,
    );
    feedIds = [runId];
  } else {
    const ids: string[] = [];
    stack = column(
      pairings.map(({ item: pairing, ghost }, i) => {
        ids.push(`${pid}/p${i + 1}`);
        return pairItem(pairing, ghost, i);
      }),
      GAP,
    );
    feedIds = ids;
  }

  const scoringId = `${pid}/scoring`;
  const scoring = iconItem(scoringId, round.scoring, expanded);
  const placedScoring = offset(
    scoring,
    stack.w + GAP * 3,
    (stack.h - scoring.h) / 2,
  );
  const edges: FlowGraphEdge[] = feedIds.map((feedId) => ({
    id: `c:${feedId}->${scoringId}`,
    source: feedId,
    target: scoringId,
    fromHandle: "r" as const,
    toHandle: "l" as const,
    kind: "chain" as const,
  }));
  const laid = merge(
    [stack, placedScoring],
    stack.w + GAP * 3 + scoring.w,
    Math.max(stack.h, scoring.h),
  );
  return { ...laid, edges: [...laid.edges, ...edges] };
}

/**
 * One node's immediate children, each its own item — no compression.
 *
 * An ungated sequence chains left-to-right with "then" edges; a parallel
 * arrangement stacks. A GATED sequence snakes down the page: each leg gets
 * its own row ending in the gate that decides what's next — the "no" exit
 * continues the row, the "yes" continuation drops to the next leg's row —
 * so a first-to-7.5 set shows that the match can end after every game.
 */
function childrenSub(
  node: ConcreteNode,
  pid: string,
  expanded: ReadonlySet<string>,
): Sub {
  const drillableCount = node.children.filter(
    (child) => child.children.length > 0,
  ).length;
  const childItem = (child: ConcreteNode, i: number): Sub => {
    const childId = `${pid}/c${i + 1}`;
    return child.children.length === 0
      ? cardSub(childId, nodeCard(child, child.role, { drill: false }))
      : item(
          childId,
          `${child.role ?? child.title} — ${child.title}`,
          nodeCard(child, child.role, { drill: true }),
          () => childrenSub(child, childId, expanded),
          expanded,
          node.children.length === 1 && drillableCount === 1,
        );
  };

  if (node.arrangement === "parallel") {
    return column(node.children.map(childItem), GAP);
  }

  const sequenceSub = (): Sub => {
    const gated = node.children.some((child) => child.gate !== undefined);
    if (!gated) {
      const laid = row(node.children.map(childItem), GAP);
      const edges: FlowGraphEdge[] = node.children.slice(1).map((_, i) => ({
        id: `c:${pid}/c${i + 1}->${pid}/c${i + 2}`,
        source: `${pid}/c${i + 1}`,
        target: `${pid}/c${i + 2}`,
        label: "then",
        fromHandle: "r" as const,
        toHandle: "l" as const,
        kind: "chain" as const,
      }));
      return { ...laid, edges: [...laid.edges, ...edges] };
    }

    // A vertical spine: each leg, then — directly below it — the gate that
    // decides whether the next leg happens. "yes" drops straight down the
    // spine; "no" hangs to the right of the gate as a labeled end. The gate
    // row is padded symmetrically so the gate itself stays on the axis.
    const items: Sub[] = [];
    const edges: FlowGraphEdge[] = [];
    node.children.forEach((child, i) => {
      const childId = `${pid}/c${i + 1}`;
      items.push(childItem(child, i));
      const next = node.children[i + 1];
      const nextId = `${pid}/c${i + 2}`;
      if (next === undefined) return;
      if (next.gate === undefined) {
        edges.push({
          id: `c:${childId}->${nextId}`,
          source: childId,
          target: nextId,
          label: "then",
          fromHandle: "b",
          toHandle: "t",
          kind: "chain",
        });
        return;
      }
      const gateId = `${nextId}/gate`;
      const exitId = `${nextId}/exit`;
      const gate = cardSub(
        gateId,
        card("gate", next.gate.when, [], { step: true }),
      );
      const exit = cardSub(
        exitId,
        card("end", next.gate.otherwise, [], { step: true }),
      );
      const pad = exit.w + GAP;
      items.push(
        merge(
          [
            offset(gate, pad, 0),
            offset(exit, pad + gate.w + GAP, (gate.h - exit.h) / 2),
          ],
          pad * 2 + gate.w,
          Math.max(gate.h, exit.h),
        ),
      );
      edges.push(
        {
          id: `c:${childId}->${gateId}`,
          source: childId,
          target: gateId,
          fromHandle: "b",
          toHandle: "t",
          kind: "chain",
        },
        {
          id: `c:${gateId}->${exitId}`,
          source: gateId,
          target: exitId,
          label: "no",
          fromHandle: "r",
          toHandle: "l",
          kind: "chain",
        },
        {
          id: `c:${gateId}->${nextId}`,
          source: gateId,
          target: nextId,
          label: "yes",
          fromHandle: "b",
          toHandle: "t",
          kind: "chain",
        },
      );
    });
    const laid = column(items, GAP, "center");
    return { ...laid, edges: [...laid.edges, ...edges] };
  };

  // Identical sequential repeats — modulo position and the seat cycle —
  // fold automatically (the 14 classical games). Parallel children never
  // fold: boards are positionally distinct and carry their own colors.
  const strip = (child: ConcreteNode): unknown => ({
    ...child,
    role: 0,
    sides: 0,
    gate: 0,
    children: child.children.map(strip),
  });
  const first = node.children[0];
  const last = node.children[node.children.length - 1];
  const uniform =
    first !== undefined &&
    last !== undefined &&
    node.children.length >= FOLD_AT &&
    node.children.every(
      (child, i) =>
        JSON.stringify(strip(child)) === JSON.stringify(strip(first)) &&
        (i === 0 ||
          JSON.stringify(child.gate) ===
            JSON.stringify(node.children[1]?.gate)),
    );
  if (!uniform) return sequenceSub();

  const runId = `${pid}/cs`;
  const range = `${first.role ?? first.title} … ${last.role ?? last.title}`;
  if (expanded.has(runId)) {
    return frameSub(
      runId,
      `${range} ×${node.children.length}`,
      sequenceSub(),
      true,
    );
  }

  const sameSides = node.children.every(
    (child) => JSON.stringify(child.sides) === JSON.stringify(first.sides),
  );
  const face = cardSub(runId, {
    ...card(first.kind, first.title, [range, ...first.lines], {
      badge: first.badge,
      ...(sameSides && first.sides !== undefined ? { sides: first.sides } : {}),
      count: node.children.length,
      drill: true,
    }),
  });
  const gate = node.children[1]?.gate;
  if (gate === undefined) return face;

  // The gated repeat draws as a cycle: play one, ask the gate, loop on
  // "yes", exit on "no".
  const gateSub = cardSub(
    `${runId}/gate`,
    card("gate", gate.when, [], { step: true }),
  );
  const exitSub = cardSub(
    `${runId}/exit`,
    card("end", gate.otherwise, [], { step: true }),
  );
  const stack = column([face, gateSub], GAP, "center");
  const placedExit = offset(
    exitSub,
    stack.w + GAP,
    face.h + GAP + (gateSub.h - exitSub.h) / 2,
  );
  const laid = merge([stack, placedExit], stack.w + GAP + exitSub.w, stack.h);
  return {
    ...laid,
    edges: [
      ...laid.edges,
      {
        id: `c:${runId}->${runId}/gate`,
        source: runId,
        target: `${runId}/gate`,
        fromHandle: "r",
        toHandle: "ri",
        kind: "chain",
      },
      {
        id: `c:${runId}/gate->${runId}`,
        source: `${runId}/gate`,
        target: runId,
        label: "yes",
        fromHandle: "lo",
        toHandle: "l",
        kind: "chain",
      },
      {
        id: `c:${runId}/gate->${runId}/exit`,
        source: `${runId}/gate`,
        target: `${runId}/exit`,
        label: "no",
        fromHandle: "r",
        toHandle: "l",
        kind: "chain",
      },
    ],
  };
}
