import {
  type AnyEncounterDef,
  appendPath,
  DECIDED_BY,
  type GameResultCode,
  type NodePath,
  type NodeView,
  type NodeWork,
  type Outcome,
  orient,
  otherSide,
  type ParticipantId,
  type PathSegment,
  type PlayerId,
  type Side,
  type Slot,
} from "./core";
import type { ModelRegistry, SlotOutcome } from "./registry";

/**
 * The generic recursive evaluator. It knows no encounter kind: it asks the
 * registry instance for child slots one at a time (feeding back outcomes, so
 * lazy kinds can stop materializing), resolves each child's seat and
 * participants, recurses, and finally asks the instance for the node's
 * outcome and work. Forfeits are a law, not a kind: a forfeited node never
 * consults its instance beyond nominal points.
 */

export type EngineIndexes = {
  readonly results: ReadonlyMap<string, GameResultCode>;
  readonly lineups: ReadonlyMap<string, readonly PlayerId[]>;
  readonly decisions: ReadonlyMap<string, Side>;
  readonly colorDraws: ReadonlyMap<string, Side>;
  readonly forfeits: ReadonlyMap<string, Side>;
};

export const lineupKey = (matchPath: NodePath, side: Side): string =>
  `${matchPath}#${side}`;

export const flipMaybe = (seat: Side | undefined): Side | undefined =>
  seat === undefined ? undefined : otherSide(seat);

export type EvalChild = {
  readonly slot: Slot;
  readonly node: EvalNode;
  /** This child's seat comes from a drawing of lots that has not happened yet. */
  readonly awaitingDraw: boolean;
};

export type EvalNode = {
  readonly path: NodePath;
  readonly def: AnyEncounterDef;
  readonly whiteSeat: Side | undefined;
  readonly participants: readonly [ParticipantId, ParticipantId] | undefined;
  readonly outcome: Outcome;
  readonly forfeited: boolean;
  /** Work this node requested (createGame, awaitLineup, awaitManualDecision). */
  readonly work: readonly NodeWork[];
  readonly children: readonly EvalChild[];
};

export type EvalCtx = {
  readonly def: AnyEncounterDef;
  readonly path: NodePath;
  readonly whiteSeat: Side | undefined;
  readonly participants: readonly [ParticipantId, ParticipantId] | undefined;
};

function makeView(indexes: EngineIndexes, ctx: EvalCtx): NodeView {
  return {
    path: ctx.path,
    whiteSeat: ctx.whiteSeat,
    participants: ctx.participants,
    result: () => indexes.results.get(ctx.path),
    manualDecision: () => indexes.decisions.get(ctx.path),
    lineup: (side) => indexes.lineups.get(lineupKey(ctx.path, side)),
  };
}

const CHILD_GUARD = 10_000;
const RESERVED_LABELS = new Set(["comp", "round", "pair"]);

export function evalNode(
  registry: ModelRegistry,
  indexes: EngineIndexes,
  ctx: EvalCtx,
): EvalNode {
  const kind = registry.encounters.get(ctx.def.kind);
  if (kind === undefined) {
    throw new Error(
      `unknown encounter kind "${ctx.def.kind}" — the def was not parsed against this registry`,
    );
  }

  const forfeitWinner = indexes.forfeits.get(ctx.path);
  if (forfeitWinner !== undefined) {
    const nominal = registry.ops.nominalPoints(ctx.def);
    return {
      path: ctx.path,
      def: ctx.def,
      whiteSeat: ctx.whiteSeat,
      participants: ctx.participants,
      forfeited: true,
      work: [],
      children: [],
      outcome: {
        points: orient(forfeitWinner, nominal.win, nominal.loss),
        decision: {
          kind: "win",
          winner: forfeitWinner,
          by: DECIDED_BY.forfeit,
        },
      },
    };
  }

  const view = makeView(indexes, ctx);
  const children: EvalChild[] = [];
  const resolved: SlotOutcome[] = [];
  for (let guard = 0; ; guard += 1) {
    if (guard >= CHILD_GUARD) {
      throw new Error(
        `encounter kind "${ctx.def.kind}" materialized over ${CHILD_GUARD} children at ${ctx.path}`,
      );
    }
    const slot = kind.nextSlot(ctx.def, view, resolved);
    if (slot === undefined) break;
    if (
      !/^[a-z]+$/.test(slot.segment.label) ||
      RESERVED_LABELS.has(slot.segment.label)
    ) {
      throw new Error(
        `encounter kind "${ctx.def.kind}" minted an invalid child segment label "${slot.segment.label}"`,
      );
    }
    const childPath = appendPath(ctx.path, {
      kind: "child",
      label: slot.segment.label,
      n: slot.segment.n,
    });
    let childSeat: Side | undefined;
    let awaitingDraw = false;
    if (slot.seat === "draw") {
      childSeat = indexes.colorDraws.get(childPath);
      awaitingDraw = childSeat === undefined;
    } else {
      childSeat =
        slot.seat === "flip" ? flipMaybe(ctx.whiteSeat) : ctx.whiteSeat;
    }
    const childParticipants =
      slot.participants === "pending"
        ? undefined
        : (slot.participants ?? ctx.participants);
    const node = evalNode(registry, indexes, {
      def: slot.def,
      path: childPath,
      whiteSeat: childSeat,
      participants: childParticipants,
    });
    children.push({ slot, node, awaitingDraw });
    resolved.push({ slot, outcome: node.outcome });
  }

  const decided = kind.outcome(ctx.def, view, resolved, registry.ties);
  const scheduling = kind.work(ctx.def, view, resolved);
  return {
    path: ctx.path,
    def: ctx.def,
    whiteSeat: ctx.whiteSeat,
    participants: ctx.participants,
    forfeited: false,
    outcome: decided.outcome,
    work: [...decided.work, ...scheduling],
    children,
  };
}

/** Descend an evaluated tree by child segments; undefined when not materialized. */
export function nodeAt(
  root: EvalNode,
  segments: readonly PathSegment[],
): EvalNode | undefined {
  let node = root;
  for (const segment of segments) {
    if (segment.kind !== "child") return undefined;
    const child = node.children.find(
      (c) =>
        c.slot.segment.label === segment.label &&
        c.slot.segment.n === segment.n,
    );
    if (child === undefined) return undefined;
    node = child.node;
  }
  return node;
}
