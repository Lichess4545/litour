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
import { concretify } from "@/tournament/concrete";
import type { ParsedEventDef } from "@/tournament/registry";
import {
  buildLevelGraph,
  buildOverviewGraph,
  CARD_W,
  type DrillTarget,
  type FlowCardData,
  type FlowGraph,
  type FrameData,
  flowCardDataSchema,
  frameDataSchema,
  STEP_W,
} from "./def-graph";

/**
 * One level of resolution per view — that is the recursion, navigated.
 * The first level is the event itself: a timeline of stage frames, group
 * lanes, round steps. Drilling into a round (or any composite) replaces the
 * canvas with that node's immediate children; the breadcrumb walks back up.
 */

const CHIP_STYLES: Record<string, string> = {
  stage: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300",
  group: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300",
  round: "bg-slate-500/15 text-slate-700 dark:text-slate-300",
  series: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  match: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  game: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
};
const DEFAULT_CHIP = "bg-rose-500/15 text-rose-700 dark:text-rose-300";

type CardNode = Node<FlowCardData, "card">;
type FrameNode = Node<FrameData, "frame">;
type AppNode = CardNode | FrameNode;

function SideChips({ white, black }: { white: string; black: string }) {
  return (
    <div className="mt-1 flex items-center gap-2 text-xs">
      <span className="flex items-center gap-1">
        <span className="inline-block h-2.5 w-2.5 rounded-[3px] border border-zinc-500 bg-white" />
        {white}
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-block h-2.5 w-2.5 rounded-[3px] border border-zinc-500 bg-zinc-950" />
        {black}
      </span>
    </div>
  );
}

function FlowCard(props: NodeProps<CardNode>) {
  // nodeTypes components receive untyped data; parse instead of casting.
  const data = flowCardDataSchema.parse(props.data);
  const horizontal = data.flow === "right";
  return (
    <div
      className={`rounded-lg border bg-card text-card-foreground shadow-sm ${
        data.step ? "px-3 py-2" : "p-3"
      } ${data.drill ? "border-dashed hover:border-foreground/40" : ""} ${
        data.ghost ? "border-dotted opacity-40" : ""
      }`}
      style={{ width: data.step ? STEP_W : CARD_W }}
    >
      <Handle
        type="target"
        position={horizontal ? Position.Left : Position.Top}
        className="!bg-border"
      />
      {data.step ? (
        <div className="flex items-center gap-1.5">
          <span
            className={`rounded px-1 py-0.5 font-medium text-[9px] uppercase tracking-wide ${CHIP_STYLES[data.chip] ?? DEFAULT_CHIP}`}
          >
            {data.chip}
          </span>
          <span className="font-semibold text-xs">{data.title}</span>
          {data.drill && (
            <button
              type="button"
              aria-label={`Zoom into ${data.title}`}
              className="ml-auto text-muted-foreground text-xs"
            >
              ⤵
            </button>
          )}
        </div>
      ) : (
        <>
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
          {data.sides !== undefined && <SideChips {...data.sides} />}
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
          {data.drill && (
            <button
              type="button"
              aria-label={`Zoom into ${data.title}`}
              className="mt-1 text-muted-foreground text-xs"
            >
              click to zoom in
            </button>
          )}
        </>
      )}
      <Handle
        type="source"
        position={horizontal ? Position.Right : Position.Bottom}
        className="!bg-border"
      />
    </div>
  );
}

function StageFrame(props: NodeProps<FrameNode>) {
  const data = frameDataSchema.parse(props.data);
  return (
    <div className="h-full w-full rounded-xl border border-dashed bg-muted/20">
      <div className="px-4 py-2 font-medium text-muted-foreground text-xs uppercase tracking-wide">
        stage · {data.title}
      </div>
    </div>
  );
}

const nodeTypes: NodeTypes = { card: FlowCard, frame: StageFrame };

export function TournamentFlow({ def }: { def: ParsedEventDef }) {
  // The definition → concrete conversion happens once; everything below
  // (including every drill level) iterates the resulting structure.
  const concrete = useMemo(() => concretify(def, chessRegistry), [def]);

  // The drill stack: empty = the event's own level (the stage timeline).
  const [stack, setStack] = useState<readonly DrillTarget[]>([]);
  const top = stack[stack.length - 1];

  const graph: FlowGraph = useMemo(
    () =>
      top === undefined ? buildOverviewGraph(concrete) : buildLevelGraph(top),
    [concrete, top],
  );

  const nodes = useMemo<AppNode[]>(
    () =>
      graph.nodes.map((node): AppNode => {
        if (node.type === "frame") {
          return {
            id: node.id,
            type: "frame",
            position: node.position,
            data: node.data,
            style: { width: node.width, height: node.height },
            draggable: false,
            selectable: false,
            connectable: false,
            zIndex: -1,
          };
        }
        return {
          id: node.id,
          type: "card",
          position: node.position,
          data: node.data,
          ...(node.parentId === undefined ? {} : { parentId: node.parentId }),
          draggable: false,
          connectable: false,
        };
      }),
    [graph],
  );

  const edges = useMemo<Edge[]>(
    () =>
      graph.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        ...(edge.label === undefined ? {} : { label: edge.label }),
        labelStyle: { fontSize: 10 },
        ...(edge.kind === "seed"
          ? { animated: true, style: { strokeDasharray: "6 3" } }
          : {}),
      })),
    [graph],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 overflow-x-auto border-b px-4 py-2">
        <button
          type="button"
          onClick={() => setStack([])}
          className={`rounded border px-2 py-0.5 text-xs ${
            stack.length === 0
              ? "text-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          stages
        </button>
        {stack.map((frame, depth) => (
          <button
            key={`${depth}:${frame.title}`}
            type="button"
            onClick={() => setStack(stack.slice(0, depth + 1))}
            className={`whitespace-nowrap rounded border px-2 py-0.5 text-xs ${
              depth === stack.length - 1
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {frame.title}
          </button>
        ))}
        {top === undefined && (
          <span className="ml-auto whitespace-nowrap text-muted-foreground text-xs">
            click a dashed card to zoom in
          </span>
        )}
      </div>
      <div className="min-h-0 flex-1">
        <ReactFlow
          // Remount per level so fitView re-frames the new graph. Distinct
          // because every navigation op changes the stack depth — if a
          // replace-top op is ever added, key on a real path identity.
          key={`${stack.length}:${top?.title ?? "overview"}`}
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          minZoom={0.15}
          nodesConnectable={false}
          onNodeClick={(_, node) => {
            const drill = graph.drills.get(node.id);
            if (drill !== undefined) setStack([...stack, drill]);
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
