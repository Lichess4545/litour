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
import type { EventDef } from "@/tournament/def";
import {
  buildFlowGraph,
  FLOW_NODE_WIDTH,
  type FlowCardData,
  flowCardDataSchema,
} from "./def-graph";

/**
 * Interactive view of a tournament definition. Every node is one concept of
 * the meta-model; click a composite node to fold/unfold its recursion (a
 * knockout's encounter chain, a series' legs, a match's boards).
 */

const KIND_STYLES: Record<FlowCardData["kind"], string> = {
  event: "bg-foreground text-background",
  stage: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300",
  group: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300",
  pool: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  series: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  match: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  game: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
};

export function KindChip({ kind }: { kind: FlowCardData["kind"] }) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 font-medium text-[10px] uppercase tracking-wide ${KIND_STYLES[kind]}`}
    >
      {kind}
    </span>
  );
}

function FlowCard(props: NodeProps) {
  // nodeTypes components receive untyped data; parse instead of casting.
  const data = flowCardDataSchema.parse(props.data);
  return (
    <div
      className="rounded-lg border bg-card p-3 text-card-foreground shadow-sm"
      style={{ width: FLOW_NODE_WIDTH }}
    >
      <Handle type="target" position={Position.Top} className="!bg-border" />
      <div className="flex items-center gap-2">
        <KindChip kind={data.kind} />
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
        {data.lines.map((line) => (
          <div
            key={line}
            className="text-muted-foreground text-xs leading-snug"
          >
            {line}
          </div>
        ))}
      </div>
      {data.collapsed && (
        <div className="mt-1 text-muted-foreground text-xs">
          click to expand
        </div>
      )}
      <Handle type="source" position={Position.Bottom} className="!bg-border" />
    </div>
  );
}

const nodeTypes: NodeTypes = { card: FlowCard };

export function TournamentFlow({ def }: { def: EventDef }) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

  const graph = useMemo(() => buildFlowGraph(def, collapsed), [def, collapsed]);

  const nodes = useMemo<Node[]>(
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
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      fitView
      fitViewOptions={{ padding: 0.12 }}
      minZoom={0.15}
      nodesConnectable={false}
      onNodeClick={(_, node) => {
        const target = graph.nodes.find((n) => n.id === node.id);
        if (target === undefined || !target.data.expandable) return;
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
  );
}
