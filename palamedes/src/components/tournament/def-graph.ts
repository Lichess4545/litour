import { z } from "zod";
import {
  type Clock,
  type EncounterDef,
  type EventDef,
  type GameDef,
  type GroupDef,
  type PoolDef,
  poolTotalRounds,
  type SeriesDef,
} from "@/tournament/def";
import { metricLabel } from "@/tournament/standings";

/**
 * Pure projection of an EventDef into a laid-out graph for React Flow: one
 * node per definition concept, tree edges downward, dashed seed edges
 * between stages. Collapsing a node hides its subtree; consecutive
 * structurally-identical series legs (the 14 classical games of a WC match)
 * compress into one node with a ×N badge.
 */

export const flowCardDataSchema = z.object({
  kind: z.enum(["event", "stage", "group", "pool", "series", "match", "game"]),
  title: z.string(),
  badge: z.string().optional(),
  lines: z.array(z.string()),
  /** Compression multiplier: this node stands for N identical siblings/boards. */
  count: z.number().optional(),
  expandable: z.boolean(),
  collapsed: z.boolean(),
});
export type FlowCardData = z.infer<typeof flowCardDataSchema>;

export type FlowGraphNode = {
  readonly id: string;
  readonly position: { readonly x: number; readonly y: number };
  readonly data: FlowCardData;
};

export type FlowGraphEdge = {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly label?: string | undefined;
  readonly kind: "tree" | "seed";
};

export type FlowGraph = {
  readonly nodes: readonly FlowGraphNode[];
  readonly edges: readonly FlowGraphEdge[];
};

// ---------------------------------------------------------------------------
// Labels

const minutes = (seconds: number): string =>
  seconds % 60 === 0 ? `${seconds / 60}m` : `${seconds}s`;

function clockLabel(clock: Clock): string {
  if (clock.whiteInitial !== undefined && clock.blackInitial !== undefined) {
    return `${minutes(clock.whiteInitial)} vs ${minutes(clock.blackInitial)} +${clock.increment}s`;
  }
  return `${minutes(clock.initial)} +${clock.increment}s`;
}

function gameLines(def: GameDef): string[] {
  const lines = [clockLabel(def.clock)];
  if (def.points !== undefined) {
    lines.push(
      `points ${def.points.win}/${def.points.draw}/${def.points.loss}`,
    );
  }
  if (def.tie?.kind === "manual") lines.push("ties: arbiter decides");
  return lines;
}

function seriesBadge(def: SeriesDef): string {
  switch (def.stop.kind) {
    case "all":
      return `all ${def.legs.length} legs`;
    case "firstTo":
      return `first to ${def.stop.points}`;
    case "untilDecisive":
      return "until decisive";
  }
}

const SERIES_COLORS_LABEL = {
  alternate: "colors alternate per leg",
  fixed: "colors fixed",
  redraw: "colors redrawn per leg",
} as const;

const MATCH_COLORS_LABEL = {
  zigzag: "boards zigzag from the team color",
  uniform: "all boards take the team color",
} as const;

function pairingTitle(pool: PoolDef): string {
  switch (pool.pairing.system) {
    case "roundRobin":
      return pool.pairing.cycles === 2 ? "Double round robin" : "Round robin";
    case "swiss":
      return "Swiss";
    case "knockout":
      return `Knockout (${pool.pairing.seeding}${pool.pairing.thirdPlace === true ? ", bronze final" : ""})`;
    case "manual":
      return "Manual pairing";
  }
}

function scoreLine(pool: PoolDef): string {
  switch (pool.score.kind) {
    case "encounterPoints":
      return "score: game points";
    case "perEncounter":
      return `match points ${pool.score.win}/${pool.score.draw}/${pool.score.loss}`;
    case "byLeg":
      return `points by deciding leg: ${pool.score.legs.map((l) => `${l.win}/${l.loss}`).join(" then ")}`;
  }
}

function poolLines(pool: PoolDef, entrants: number): string[] {
  const lines = [
    `${entrants} entrants · ${poolTotalRounds(pool, entrants)} rounds`,
    scoreLine(pool),
  ];
  if (pool.tiebreaks.length > 0) {
    lines.push(`tiebreaks: ${pool.tiebreaks.map(metricLabel).join(" · ")}`);
  }
  if (pool.legRelease === "lockstep") {
    lines.push("legs released in lockstep across pairs");
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Tree construction

type TreeNode = {
  readonly id: string;
  readonly data: FlowCardData;
  readonly children: readonly TreeNode[];
  readonly edgeLabel?: string | undefined;
};

const card = (
  kind: FlowCardData["kind"],
  title: string,
  lines: string[],
  options?: { badge?: string | undefined; count?: number | undefined },
): Omit<FlowCardData, "expandable" | "collapsed"> => ({
  kind,
  title,
  lines,
  ...(options?.badge === undefined ? {} : { badge: options.badge }),
  ...(options?.count === undefined ? {} : { count: options.count }),
});

function withState(
  id: string,
  data: Omit<FlowCardData, "expandable" | "collapsed">,
  children: readonly TreeNode[],
  collapsed: ReadonlySet<string>,
  edgeLabel?: string,
): TreeNode {
  const isCollapsed = collapsed.has(id);
  return {
    id,
    data: { ...data, expandable: children.length > 0, collapsed: isCollapsed },
    children: isCollapsed ? [] : children,
    edgeLabel,
  };
}

/** Consecutive structurally identical legs become one entry with a count. */
function compressLegs(
  legs: readonly EncounterDef[],
): readonly { def: EncounterDef; count: number; from: number; to: number }[] {
  const groups: {
    def: EncounterDef;
    count: number;
    from: number;
    to: number;
  }[] = [];
  legs.forEach((leg, index) => {
    const previous = groups[groups.length - 1];
    if (
      previous !== undefined &&
      JSON.stringify(previous.def) === JSON.stringify(leg)
    ) {
      previous.count += 1;
      previous.to = index + 1;
      return;
    }
    groups.push({ def: leg, count: 1, from: index + 1, to: index + 1 });
  });
  return groups;
}

function encounterTree(
  id: string,
  def: EncounterDef,
  collapsed: ReadonlySet<string>,
  edgeLabel?: string,
  count?: number,
): TreeNode {
  switch (def.kind) {
    case "game": {
      const drawOdds = def.tie?.kind === "drawOdds" ? def.tie : undefined;
      return withState(
        id,
        card(
          "game",
          drawOdds === undefined ? "Game" : "Armageddon",
          gameLines(def),
          {
            badge:
              drawOdds === undefined
                ? undefined
                : `${drawOdds.color} wins draws`,
            count,
          },
        ),
        [],
        collapsed,
        edgeLabel,
      );
    }
    case "series": {
      const children = compressLegs(def.legs).map((group, index) =>
        encounterTree(
          `${id}/l${index + 1}`,
          group.def,
          collapsed,
          group.count > 1
            ? `legs ${group.from}–${group.to}`
            : `leg ${group.from}`,
          group.count > 1 ? group.count : undefined,
        ),
      );
      return withState(
        id,
        card("series", "Series", [SERIES_COLORS_LABEL[def.colors]], {
          badge: seriesBadge(def),
          count,
        }),
        children,
        collapsed,
        edgeLabel,
      );
    }
    case "match": {
      const board = encounterTree(
        `${id}/b`,
        def.board,
        collapsed,
        "per board",
        def.boards,
      );
      return withState(
        id,
        card("match", "Team match", [MATCH_COLORS_LABEL[def.colors]], {
          badge: `${def.boards} boards`,
          count,
        }),
        [board],
        collapsed,
        edgeLabel,
      );
    }
  }
}

function groupTree(
  stageId: string,
  group: GroupDef,
  collapsed: ReadonlySet<string>,
): { tree: TreeNode; seeds: readonly FlowGraphEdge[] } {
  const id = `g:${stageId}/${group.id}`;
  const run = group.run;
  const runChild =
    run.kind === "pool"
      ? withState(
          `${id}/run`,
          card("pool", pairingTitle(run), poolLines(run, group.entries.length)),
          [
            encounterTree(
              `${id}/run/enc`,
              run.encounter,
              collapsed,
              "each pairing",
            ),
          ],
          collapsed,
        )
      : encounterTree(`${id}/run`, run, collapsed);

  const seeds: FlowGraphEdge[] = [];
  group.entries.forEach((entry, index) => {
    if (entry.kind !== "rank") return;
    seeds.push({
      id: `seed:${id}:${index}`,
      source: `g:${entry.stage}/${entry.group}`,
      target: id,
      label: entry.rank === 1 ? "winner" : `#${entry.rank}`,
      kind: "seed",
    });
  });

  const tree = withState(
    id,
    card("group", group.id, [`${group.entries.length} entrants`]),
    [runChild],
    collapsed,
  );
  return { tree, seeds };
}

// ---------------------------------------------------------------------------
// Layout (tidy tree, fixed node width)

export const FLOW_NODE_WIDTH = 244;
const GAP_X = 28;
const LEVEL_HEIGHT = 188;

type Placed = {
  readonly tree: TreeNode;
  readonly width: number;
  readonly children: readonly Placed[];
};

function measure(tree: TreeNode): Placed {
  const children = tree.children.map(measure);
  const childrenWidth =
    children.reduce((sum, child) => sum + child.width, 0) +
    GAP_X * Math.max(0, children.length - 1);
  return { tree, children, width: Math.max(FLOW_NODE_WIDTH, childrenWidth) };
}

function place(
  placed: Placed,
  centerX: number,
  depth: number,
  parentId: string | undefined,
  nodes: FlowGraphNode[],
  edges: FlowGraphEdge[],
): void {
  nodes.push({
    id: placed.tree.id,
    position: { x: centerX - FLOW_NODE_WIDTH / 2, y: depth * LEVEL_HEIGHT },
    data: placed.tree.data,
  });
  if (parentId !== undefined) {
    edges.push({
      id: `t:${parentId}->${placed.tree.id}`,
      source: parentId,
      target: placed.tree.id,
      label: placed.tree.edgeLabel,
      kind: "tree",
    });
  }
  const total =
    placed.children.reduce((sum, child) => sum + child.width, 0) +
    GAP_X * Math.max(0, placed.children.length - 1);
  let cursor = centerX - total / 2;
  for (const child of placed.children) {
    place(
      child,
      cursor + child.width / 2,
      depth + 1,
      placed.tree.id,
      nodes,
      edges,
    );
    cursor += child.width + GAP_X;
  }
}

export function buildFlowGraph(
  def: EventDef,
  collapsed: ReadonlySet<string>,
): FlowGraph {
  const seeds: FlowGraphEdge[] = [];
  const stageTrees = def.stages.map((stage) => {
    const groups = stage.groups.map((group) => {
      const built = groupTree(stage.id, group, collapsed);
      seeds.push(...built.seeds);
      return built.tree;
    });
    return withState(
      `s:${stage.id}`,
      card("stage", stage.id, [
        `${stage.groups.length} group${stage.groups.length === 1 ? "" : "s"}`,
      ]),
      groups,
      collapsed,
    );
  });
  const root = withState(
    "event",
    card("event", def.name, [`${def.competitors.length} competitors`]),
    stageTrees,
    collapsed,
  );

  const nodes: FlowGraphNode[] = [];
  const edges: FlowGraphEdge[] = [];
  place(measure(root), 0, 0, undefined, nodes, edges);

  const visible = new Set(nodes.map((n) => n.id));
  const visibleSeeds = seeds.filter(
    (s) => visible.has(s.source) && visible.has(s.target),
  );
  return { nodes, edges: [...edges, ...visibleSeeds] };
}
