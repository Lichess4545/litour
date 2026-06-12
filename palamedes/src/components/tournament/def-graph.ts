import { z } from "zod";
import type { AnyEncounterDef, EventDef, PoolDef } from "@/tournament/core";
import { isPool, type ModelRegistry } from "@/tournament/registry";

/**
 * Pure projections of an EventDef into laid-out graphs for React Flow, in
 * two altitudes: the OVERVIEW (event → stages → groups → round steps, with
 * dashed seed edges between stages) and the ENCOUNTER view you drill into
 * from any round — the recursive definition of what one pairing plays,
 * rendered through each kind's registry card. Nothing here knows a specific
 * kind: titles, badges and child structure all come from the registry.
 */

export const flowCardDataSchema = z.object({
  /** The colored chip: spine concepts or the encounter kind's name. */
  chip: z.string(),
  title: z.string(),
  badge: z.string().optional(),
  lines: z.array(z.string()),
  /** Compression multiplier: this node stands for N identical siblings. */
  count: z.number().optional(),
  expandable: z.boolean(),
  collapsed: z.boolean(),
  /** Overview nodes that open the encounter view when clicked. */
  drill: z.boolean(),
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

export type DrillTarget = {
  readonly title: string;
  readonly def: AnyEncounterDef;
};

export type FlowGraph = {
  readonly nodes: readonly FlowGraphNode[];
  readonly edges: readonly FlowGraphEdge[];
  /** node id → the encounter definition that node opens. */
  readonly drills: ReadonlyMap<string, DrillTarget>;
};

// ---------------------------------------------------------------------------
// Layout (tidy tree, fixed node width)

export const FLOW_NODE_WIDTH = 244;
const GAP_X = 28;
const LEVEL_HEIGHT = 168;

type TreeNode = {
  readonly id: string;
  readonly data: FlowCardData;
  readonly children: readonly TreeNode[];
  readonly edgeLabel?: string | undefined;
};

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

function finishGraph(
  root: TreeNode,
  seeds: readonly FlowGraphEdge[],
  drills: ReadonlyMap<string, DrillTarget>,
): FlowGraph {
  const nodes: FlowGraphNode[] = [];
  const edges: FlowGraphEdge[] = [];
  place(measure(root), 0, 0, undefined, nodes, edges);
  const visible = new Set(nodes.map((n) => n.id));
  const visibleSeeds = seeds.filter(
    (s) => visible.has(s.source) && visible.has(s.target),
  );
  return { nodes, edges: [...edges, ...visibleSeeds], drills };
}

const card = (
  chip: string,
  title: string,
  lines: readonly string[],
  options?: {
    badge?: string | undefined;
    count?: number | undefined;
    expandable?: boolean;
    collapsed?: boolean;
    drill?: boolean;
  },
): FlowCardData => ({
  chip,
  title,
  lines: [...lines],
  ...(options?.badge === undefined ? {} : { badge: options.badge }),
  ...(options?.count === undefined ? {} : { count: options.count }),
  expandable: options?.expandable ?? false,
  collapsed: options?.collapsed ?? false,
  drill: options?.drill ?? false,
});

// ---------------------------------------------------------------------------
// Overview: stages → groups → rounds, with drill targets

function poolLines(
  pool: PoolDef,
  entrants: number,
  registry: ModelRegistry,
): string[] {
  const lines = [`${entrants} entrants`, `score: ${pool.score.kind}`];
  if (pool.tiebreaks.length > 0) {
    const labels = pool.tiebreaks.map((ref) => {
      const metric = registry.metrics.get(ref.metric);
      return metric === undefined ? ref.metric : metric.label(ref);
    });
    lines.push(`tiebreaks: ${labels.join(" · ")}`);
  }
  if (pool.legRelease === "lockstep") lines.push("legs released in lockstep");
  return lines;
}

export function buildOverviewGraph(
  def: EventDef,
  registry: ModelRegistry,
): FlowGraph {
  const seeds: FlowGraphEdge[] = [];
  const drills = new Map<string, DrillTarget>();

  const stageTrees = def.stages.map((stage): TreeNode => {
    const groups = stage.groups.map((group): TreeNode => {
      const groupId = `g:${stage.id}/${group.id}`;

      group.entries.forEach((entry, index) => {
        const sourceStage = entry["stage"];
        const sourceGroup = entry["group"];
        const rank = entry["rank"];
        if (typeof sourceStage !== "string" || typeof sourceGroup !== "string")
          return;
        seeds.push({
          id: `seed:${groupId}:${index}`,
          source: `g:${sourceStage}/${sourceGroup}`,
          target: groupId,
          label:
            rank === 1
              ? "winner"
              : typeof rank === "number"
                ? `#${rank}`
                : undefined,
          kind: "seed",
        });
      });

      let runChild: TreeNode;
      if (isPool(group.run)) {
        const pool = group.run;
        const pairing = registry.pairings.get(pool.pairing.system);
        const rounds =
          pairing?.totalRounds?.(pool.pairing, group.entries.length) ??
          pool.rounds ??
          0;
        // Rounds render as a chain of steps; each drills into the encounter
        // definition that every pairing of that round plays.
        let next: TreeNode | undefined;
        for (let r = rounds; r >= 1; r -= 1) {
          const id = `${groupId}/round-${r}`;
          drills.set(id, {
            title: `Round ${r} — what each pairing plays`,
            def: pool.encounter,
          });
          next = {
            id,
            data: card("round", `Round ${r}`, [], { drill: true }),
            children: next === undefined ? [] : [next],
          };
        }
        runChild = {
          id: `${groupId}/pool`,
          data: card(
            "pool",
            pool.pairing.system,
            poolLines(pool, group.entries.length, registry),
            { badge: `${rounds} rounds` },
          ),
          children: next === undefined ? [] : [next],
        };
      } else {
        const id = `${groupId}/run`;
        const info = registry.ops.card(group.run);
        drills.set(id, { title: "The deciding encounter", def: group.run });
        runChild = {
          id,
          data: card(
            "encounter",
            info.title,
            ["click to open the definition"],
            {
              badge: info.badge,
              drill: true,
            },
          ),
          children: [],
        };
      }

      return {
        id: groupId,
        data: card("group", group.id, [`${group.entries.length} entrants`]),
        children: [runChild],
      };
    });

    return {
      id: `s:${stage.id}`,
      data: card("stage", stage.id, [
        `${stage.groups.length} group${stage.groups.length === 1 ? "" : "s"}`,
      ]),
      children: groups,
    };
  });

  const root: TreeNode = {
    id: "event",
    data: card("event", def.name, [`${def.competitors.length} competitors`]),
    children: stageTrees,
  };
  return finishGraph(root, seeds, drills);
}

// ---------------------------------------------------------------------------
// Encounter view: the recursive definition, one card per node

export function buildEncounterGraph(
  def: AnyEncounterDef,
  registry: ModelRegistry,
  collapsed: ReadonlySet<string>,
): FlowGraph {
  const build = (
    node: AnyEncounterDef,
    id: string,
    role: string | undefined,
    count: number | undefined,
  ): TreeNode => {
    const info = registry.ops.card(node);
    const structure = registry.ops.structure(node);

    // Consecutive structurally-identical children compress into one card
    // with a ×N badge (the 14 classical games of a WC match).
    const groups: {
      child: (typeof structure)[number];
      count: number;
      from: number;
      to: number;
    }[] = [];
    structure.forEach((child, index) => {
      const previous = groups[groups.length - 1];
      if (
        previous !== undefined &&
        JSON.stringify(previous.child.def) === JSON.stringify(child.def) &&
        previous.child.count === child.count
      ) {
        previous.count += 1;
        previous.to = index + 1;
        return;
      }
      groups.push({ child, count: 1, from: index + 1, to: index + 1 });
    });

    const isCollapsed = collapsed.has(id);
    const children = isCollapsed
      ? []
      : groups.map((group, index) =>
          build(
            group.child.def,
            `${id}/${index + 1}`,
            group.count > 1
              ? `${group.child.role} ${group.from}–${group.to}`
              : group.child.role,
            group.count > 1 ? group.count : group.child.count,
          ),
        );

    return {
      id,
      data: card(node.kind, info.title, info.lines, {
        badge: info.badge,
        count,
        expandable: structure.length > 0,
        collapsed: isCollapsed,
      }),
      children,
      edgeLabel: role,
    };
  };

  return finishGraph(build(def, "e", undefined, undefined), [], new Map());
}
