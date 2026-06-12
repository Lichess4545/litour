"use client";

import {
  Background,
  Controls,
  type Edge,
  Handle,
  MiniMap,
  type Node,
  type NodeProps,
  type NodeTypes,
  Position,
  ReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useMemo, useState } from "react";
import { chessRegistry } from "@/chess/registry";
import type { AnyEncounterDef, EventDef } from "@/tournament/core";
import {
  buildEncounterGraph,
  buildOverviewGraph,
  FLOW_NODE_WIDTH,
  type FlowCardData,
  type FlowGraph,
  flowCardDataSchema,
} from "./def-graph";

/**
 * Two-altitude view of a tournament definition. The overview shows the
 * staging spine — stages, groups, and each pool's rounds as steps. Clicking
 * a round (or a deciding match) zooms into the ENCOUNTER view: the recursive
 * definition of what that round's pairings play, where clicking any
 * composite folds/unfolds its recursion.
 */

const CHIP_STYLES: Record<string, string> = {
  event: "bg-foreground text-background",
  stage: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300",
  group: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300",
  pool: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  round: "bg-slate-500/15 text-slate-700 dark:text-slate-300",
  series: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  match: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  game: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
};
const DEFAULT_CHIP = "bg-rose-500/15 text-rose-700 dark:text-rose-300";

type CardNode = Node<FlowCardData, "card">;

function FlowCard(props: NodeProps<CardNode>) {
  // nodeTypes components receive untyped data; parse instead of casting.
  const data = flowCardDataSchema.parse(props.data);
  return (
    <div
      className={`rounded-lg border bg-card p-3 text-card-foreground shadow-sm ${
        data.drill ? "border-dashed hover:border-foreground/40" : ""
      }`}
      style={{ width: FLOW_NODE_WIDTH }}
    >
      <Handle type="target" position={Position.Top} className="!bg-border" />
      <div className="flex items-center gap-2">
        <span
          className={`rounded px-1.5 py-0.5 font-medium text-[10px] uppercase tracking-wide ${CHIP_STYLES[data.chip] ?? DEFAULT_CHIP}`}
        >
          {data.chip}
        </span>
        {data.count !== undefined && (
          <span className="rounded bg-muted px-1.5 py-0.5 font-semibold text-[10px] text-muted-foreground">
            ×{data.count}
          </span>
        )}
        {data.expandable && (
          <span className="ml-auto text-muted-foreground text-xs">
            {data.collapsed ? "▸" : "▾"}
          </span>
        )}
        {data.drill && (
          <span className="ml-auto text-muted-foreground text-xs">⤵</span>
        )}
      </div>
      <div className="mt-1.5 font-semibold text-sm leading-tight">
        {data.title}
      </div>
      {data.badge !== undefined && (
        <div className="mt-0.5 text-foreground/80 text-xs italic">
          {data.badge}
        </div>
      )}
      <div className="mt-1 space-y-0.5">
        {data.lines.map((line, i) => (
          <div
            // Static per data object — replaced wholesale, never reordered.
            // biome-ignore lint/suspicious/noArrayIndexKey: see above
            key={i}
            className="text-muted-foreground text-xs leading-snug"
          >
            {line}
          </div>
        ))}
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-border" />
    </div>
  );
}

const nodeTypes: NodeTypes = { card: FlowCard };

type View =
  | { readonly mode: "overview" }
  | {
      readonly mode: "encounter";
      readonly title: string;
      readonly def: AnyEncounterDef;
    };

export function TournamentFlow({ def }: { def: EventDef }) {
  const [view, setView] = useState<View>({ mode: "overview" });
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

  const graph: FlowGraph = useMemo(
    () =>
      view.mode === "overview"
        ? buildOverviewGraph(def, chessRegistry)
        : buildEncounterGraph(view.def, chessRegistry, collapsed),
    [def, view, collapsed],
  );

  const nodes = useMemo<CardNode[]>(
    () =>
      graph.nodes.map((node) => ({
        id: node.id,
        type: "card",
        position: node.position,
        data: node.data,
        draggable: false,
        connectable: false,
      })),
    [graph],
  );

  const edges = useMemo<Edge[]>(
    () =>
      graph.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        ...(edge.label === undefined ? {} : { label: edge.label }),
        ...(edge.kind === "seed"
          ? {
              animated: true,
              style: { strokeDasharray: "6 3" },
              labelStyle: { fontSize: 10 },
            }
          : { labelStyle: { fontSize: 10 } }),
      })),
    [graph],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-3 border-b px-4 py-2">
        {view.mode === "encounter" ? (
          <>
            <button
              type="button"
              onClick={() => setView({ mode: "overview" })}
              className="rounded border px-2 py-0.5 text-muted-foreground text-xs hover:text-foreground"
            >
              ← stages
            </button>
            <span className="text-muted-foreground text-xs">{view.title}</span>
          </>
        ) : (
          <span className="text-muted-foreground text-xs">
            Stage overview — click a round to zoom into its recursive
            definition.
          </span>
        )}
      </div>
      <div className="min-h-0 flex-1">
        <ReactFlow
          // Remount per view so fitView re-frames the new graph.
          key={view.mode === "overview" ? "overview" : `enc:${view.title}`}
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.12 }}
          minZoom={0.15}
          nodesConnectable={false}
          onNodeClick={(_, node) => {
            if (view.mode === "overview") {
              const drill = graph.drills.get(node.id);
              if (drill !== undefined) {
                setCollapsed(new Set());
                setView({
                  mode: "encounter",
                  title: drill.title,
                  def: drill.def,
                });
              }
              return;
            }
            if (!node.data.expandable) return;
            setCollapsed((current) => {
              const next = new Set(current);
              if (next.has(node.id)) next.delete(node.id);
              else next.add(node.id);
              return next;
            });
          }}
          proOptions={{ hideAttribution: false }}
        >
          <Background gap={24} />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable />
        </ReactFlow>
      </div>
    </div>
  );
}
