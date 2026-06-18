"use client";

import {
  Background,
  BackgroundVariant,
  Controls,
  type Edge,
  Handle,
  MarkerType,
  MiniMap,
  type Node,
  type NodeProps,
  type NodeTypes,
  Position,
  ReactFlow,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Calculator,
  CircleDot,
  Flag,
  Grid3x3,
  Hand,
  Layers,
  ListOrdered,
  type LucideIcon,
  Network,
  Puzzle,
  RotateCcw,
  Shuffle,
  Split,
  Swords,
  UserPlus,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ConcreteEvent, ConcreteTiebreak } from "@/tournament/concrete";
import {
  buildGraph,
  buildTiebreaksGraph,
  CARD_W,
  type FlowCardData,
  type FlowGraph,
  type FrameData,
  flowCardDataSchema,
  frameDataSchema,
  STEP_W,
} from "./def-graph";

/**
 * In-place zoom: expanding a card swaps it for a bordered frame holding the
 * next level of resolution while the rest of the canvas stays put, so one
 * view can mix altitudes — a container opened beside collapsed siblings,
 * rounds beside an opened round — with every arrow still attached. Clicking
 * a frame folds it back into its card.
 *
 * The component receives the CONCRETE structure, already converted on the
 * server: the display iterates it and never touches a definition or the
 * registry.
 */

const CHIP_STYLES: Record<string, string> = {
  competitions: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300",
  competition: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300",
  round: "bg-slate-500/15 text-slate-700 dark:text-slate-300",
  series: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  match: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  game: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  standings: "bg-lime-500/15 text-lime-700 dark:text-lime-300",
  registration: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  gate: "bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300",
  end: "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300",
};
const DEFAULT_CHIP = "bg-rose-500/15 text-rose-700 dark:text-rose-300";

/** One icon per kind key — unknown kinds get the puzzle piece. */
const CHIP_ICONS: Record<string, LucideIcon> = {
  competitions: Layers,
  competition: Users,
  round: CircleDot,
  series: ListOrdered,
  match: Swords,
  game: Grid3x3,
  standings: ListOrdered,
  registration: UserPlus,
  gate: Split,
  end: Flag,
  passThrough: Calculator,
  table: Calculator,
  phased: Calculator,
  swiss: Shuffle,
  knockout: Network,
  roundRobin: RotateCcw,
  manual: Hand,
};
const chipIcon = (chip: string): LucideIcon => CHIP_ICONS[chip] ?? Puzzle;

/** The colored kind pill: icon plus key. */
function Chip({ chip, small }: { chip: string; small?: boolean }) {
  const Icon = chipIcon(chip);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded font-medium uppercase tracking-wide ${
        small ? "px-1 py-0.5 text-[9px]" : "px-1.5 py-0.5 text-[10px]"
      } ${CHIP_STYLES[chip] ?? DEFAULT_CHIP}`}
    >
      <Icon className={small ? "h-2.5 w-2.5" : "h-3 w-3"} />
      {chip}
    </span>
  );
}

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

/** All four hookups, addressable per edge: in from left/top, out right/bottom. */
function CardHandles() {
  return (
    <>
      <Handle
        type="target"
        id="l"
        position={Position.Left}
        className="!bg-border"
      />
      <Handle
        type="target"
        id="t"
        position={Position.Top}
        className="!bg-border"
      />
      <Handle
        type="source"
        id="r"
        position={Position.Right}
        className="!bg-border"
      />
      <Handle
        type="source"
        id="b"
        position={Position.Bottom}
        className="!bg-border"
      />
      {/* Cycle hookups: into the right side, out of the left side. */}
      <Handle
        type="target"
        id="ri"
        position={Position.Right}
        className="!bg-border"
      />
      <Handle
        type="source"
        id="lo"
        position={Position.Left}
        className="!bg-border"
      />
    </>
  );
}

/**
 * The "this opens up" marker, on every expandable card. Shape-first (a dashed
 * ⊕ pill) so it reads without relying on color; the matching dashed card
 * border is the same signal at the card scale.
 */
function ExpandBadge({ small }: { small?: boolean }) {
  return (
    <span
      role="img"
      aria-label="expandable — click to zoom in"
      title="click to zoom in"
      className={`flex shrink-0 items-center justify-center rounded-full border border-primary/60 border-dashed bg-primary/10 font-bold text-primary leading-none ${
        small ? "h-4 w-4 text-[11px]" : "h-5 w-5 text-sm"
      }`}
    >
      +
    </span>
  );
}

function FlowCard(props: NodeProps<CardNode>) {
  // nodeTypes components receive untyped data; parse instead of casting.
  const data = flowCardDataSchema.parse(props.data);
  if (data.iconOnly) {
    const Icon = chipIcon(data.chip);
    return (
      <div
        title={data.title}
        className={`flex h-16 w-16 items-center justify-center rounded-xl border bg-card shadow-sm ${
          data.drill
            ? "border-primary/50 border-dashed hover:border-primary"
            : ""
        }`}
      >
        <CardHandles />
        <span
          role="img"
          aria-label={data.title}
          className={`rounded-lg p-2 ${CHIP_STYLES[data.chip] ?? DEFAULT_CHIP}`}
        >
          <Icon className="h-5 w-5" />
        </span>
      </div>
    );
  }
  return (
    <div
      className={`rounded-lg border bg-card text-card-foreground shadow-sm ${
        data.step ? "px-3 py-2" : "p-3"
      } ${data.drill ? "border-primary/50 border-dashed hover:border-primary" : ""} ${
        data.ghost ? "border-dotted opacity-40" : ""
      }`}
      style={{ width: data.step ? STEP_W : CARD_W }}
    >
      <CardHandles />
      {data.step ? (
        <>
          <div className="flex items-center justify-between gap-1.5">
            <span className="flex items-center gap-1">
              <Chip chip={data.chip} small />
              {data.count !== undefined && (
                <span className="rounded bg-muted px-1 py-0.5 font-semibold text-[9px] text-muted-foreground">
                  ×{data.count}
                </span>
              )}
            </span>
            {data.drill && <ExpandBadge small />}
          </div>
          <div className="mt-0.5 truncate whitespace-nowrap font-semibold text-xs">
            {data.title}
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <Chip chip={data.chip} />
            {data.count !== undefined && (
              <span className="rounded bg-muted px-1.5 py-0.5 font-semibold text-[10px] text-muted-foreground">
                ×{data.count}
              </span>
            )}
            {data.drill && (
              <span className="ml-auto">
                <ExpandBadge />
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
              aria-label={`Expand ${data.title}`}
              className="mt-1 text-muted-foreground text-xs"
            >
              click to zoom in
            </button>
          )}
        </>
      )}
    </div>
  );
}

function Frame(props: NodeProps<FrameNode>) {
  const data = frameDataSchema.parse(props.data);
  return (
    <div className="h-full w-full rounded-xl border border-blue-400/50 border-dashed bg-white/90">
      <CardHandles />
      <div className="flex items-center gap-2 px-4 py-2 font-medium text-muted-foreground text-xs uppercase tracking-wide">
        {data.title}
        {data.collapsible && (
          <button
            type="button"
            aria-label={`Collapse ${data.title}`}
            className="normal-case"
          >
            ⤴ collapse
          </button>
        )}
      </div>
    </div>
  );
}

const nodeTypes: NodeTypes = { card: FlowCard, frame: Frame };

/**
 * The shared zoomable canvas: it owns the expand/collapse state and rebuilds
 * the layout from `build` on every change, recentering the camera on whatever
 * moved. Both the whole-tournament view and the standalone tiebreak gallery
 * are just different `build` functions over the same machinery, so the
 * fan-out/fan-in formulas zoom identically wherever they are reached.
 */
function FlowCanvas({
  build,
}: {
  build: (expanded: ReadonlySet<string>) => FlowGraph;
}) {
  // The canvas depends on measured container size; rendering it on the
  // server only produces hydration mismatches. Mount-gate the canvas alone —
  // the toolbar shell renders identically on server and client.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  /** Ids currently expanded in place (collapsed descendants are remembered). */
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  const graph: FlowGraph = useMemo(() => build(expanded), [build, expanded]);

  // After an expand/collapse the layout reflows; bring the camera to the
  // node that changed (or refit everything after "collapse all") so the
  // content never vanishes off-viewport.
  const [flow, setFlow] = useState<ReactFlowInstance<AppNode, Edge> | null>(
    null,
  );
  const focusRef = useRef<string | null>(null);
  useEffect(() => {
    if (flow === null) return;
    const focus = focusRef.current;
    if (focus === null) return;
    // Only fit to a target the committed layout actually contains — reading
    // the graph is what makes it an honest dependency (the effect exists to
    // re-run after every layout reflow).
    if (focus !== "*" && !graph.nodes.some((node) => node.id === focus)) {
      // Target left the layout: abandon the intent rather than ambush the
      // camera on some unrelated later reflow.
      focusRef.current = null;
      return;
    }
    focusRef.current = null;
    // Frame the whole revealed subtree, not just the clicked node: expanding a
    // computation node fans its inputs out to the LEFT, and in a narrow
    // viewport that reveal is wider than the node itself — fitting to the node
    // alone leaves the new content off-screen and the expand feels like a no-op.
    // A node's descendants are exactly the ids prefixed by `${focus}/`.
    const subtree = graph.nodes
      .filter((node) => node.id === focus || node.id.startsWith(`${focus}/`))
      .map((node) => ({ id: node.id }));
    const frame = requestAnimationFrame(() => {
      void (focus === "*"
        ? flow.fitView({ padding: 0.15, duration: 400 })
        : flow.fitView({
            nodes: subtree,
            padding: 0.2,
            duration: 400,
            maxZoom: 1,
          }));
    });
    return () => cancelAnimationFrame(frame);
  }, [flow, graph]);

  const nodes = useMemo<AppNode[]>(
    () =>
      graph.nodes.map((node): AppNode => {
        if (node.type === "frame") {
          return {
            id: node.id,
            type: "frame",
            position: node.position,
            data: node.data,
            ...(node.parentId === undefined ? {} : { parentId: node.parentId }),
            width: node.width,
            height: node.height,
            draggable: false,
            connectable: false,
          };
        }
        return {
          id: node.id,
          type: "card",
          position: node.position,
          data: node.data,
          ...(node.parentId === undefined ? {} : { parentId: node.parentId }),
          // Estimates feed the minimap; the DOM measurement refines them.
          initialWidth: node.width,
          initialHeight: node.height,
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
        sourceHandle: edge.fromHandle,
        targetHandle: edge.toHandle,
        ...(edge.label === undefined ? {} : { label: edge.label }),
        labelStyle: { fontSize: 10 },
        // Arrowheads make the flow direction explicit at every edge.
        markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
        ...(edge.kind === "seed"
          ? { animated: true, style: { strokeDasharray: "6 3" } }
          : {}),
      })),
    [graph],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-2">
        {expanded.size > 0 && (
          <button
            type="button"
            onClick={() => {
              focusRef.current = "*";
              setExpanded(new Set());
            }}
            className="rounded border px-2 py-0.5 text-muted-foreground text-xs hover:text-foreground"
          >
            collapse all
          </button>
        )}
        <span className="ml-auto whitespace-nowrap text-muted-foreground text-xs">
          click a dashed card to zoom in · click a frame to fold it back
        </span>
      </div>
      <div className="min-h-0 flex-1">
        {mounted ? (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onInit={setFlow}
            fitView
            fitViewOptions={{ padding: 0.15 }}
            minZoom={0.05}
            nodesConnectable={false}
            onNodeClick={(_, node) => {
              if (graph.collapsibles.has(node.id)) {
                focusRef.current = node.id;
                setExpanded((prev) => {
                  const next = new Set(prev);
                  next.delete(node.id);
                  return next;
                });
              } else if (graph.expandables.has(node.id)) {
                focusRef.current = node.id;
                setExpanded((prev) => new Set(prev).add(node.id));
              }
            }}
          >
            {/* Blueprint paper: fine grid plus stronger major lines. */}
            <Background
              id="grid-minor"
              variant={BackgroundVariant.Lines}
              gap={24}
              color="#dbeafe"
              bgColor="#eff6ff"
            />
            <Background
              id="grid-major"
              variant={BackgroundVariant.Lines}
              gap={120}
              color="#bfdbfe"
            />
            <Controls showInteractive={false} />
            <MiniMap
              pannable
              zoomable
              className="!h-44 !w-64 rounded-lg border"
              nodeStrokeWidth={4}
              nodeColor={(node) =>
                node.type === "frame" ? "rgba(99, 102, 241, 0.10)" : "#94a3b8"
              }
              nodeStrokeColor={(node) =>
                node.type === "frame" ? "#818cf8" : "#64748b"
              }
              maskColor="rgba(148, 163, 184, 0.25)"
            />
          </ReactFlow>
        ) : (
          // Pre-hydration placeholder: echo the blueprint paper so the
          // static shell looks intentional instead of blank.
          <div aria-hidden className="h-full w-full bg-[#eff6ff]" />
        )}
      </div>
    </div>
  );
}

/** The whole tournament, zoomable from the event down into each tiebreak. */
export function TournamentFlow({ concrete }: { concrete: ConcreteEvent }) {
  const build = useCallback(
    (expanded: ReadonlySet<string>) => buildGraph(concrete, expanded),
    [concrete],
  );
  return <FlowCanvas build={build} />;
}

/** Just the tiebreaks, each its own zoomable fan-out/fan-in formula. */
export function TiebreaksFlow({
  tiebreaks,
}: {
  tiebreaks: readonly ConcreteTiebreak[];
}) {
  const build = useCallback(
    (expanded: ReadonlySet<string>) => buildTiebreaksGraph(tiebreaks, expanded),
    [tiebreaks],
  );
  return <FlowCanvas build={build} />;
}
