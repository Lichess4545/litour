import {
  type AnyEncounterDef,
  type Clock,
  type CompetitorId,
  type EventDef,
  type GameResultCode,
  type GroupDef,
  groupRootPath,
  type Input,
  isOpenEntries,
  type NodePath,
  type PairingPlan,
  type PairingsSetInput,
  type ParticipantId,
  type PlayerId,
  type PoolDef,
  pathPrefix,
  pathSegments,
  type Side,
  type StageDef,
} from "./core";
import {
  type EngineIndexes,
  type EvalNode,
  evalNode,
  lineupKey,
  nodeAt,
} from "./evaluate";
import {
  isPool,
  type ModelRegistry,
  type PairingContext,
  type PairingHistoryEntry,
  type ParsedEventDef,
} from "./registry";
import {
  evalPair,
  type PoolRoundPlans,
  poolStandings,
  type StandingsRow,
} from "./standings";

/**
 * The engine: a validated pure fold over the input log (`materialize`), plus
 * derived views — `nextActions` (what the host should do now), standings,
 * and outcomes. It contains no tournament vocabulary: every kind-specific
 * judgment is delegated to the registry the definition was parsed against.
 */

export type InputError = {
  readonly index: number;
  readonly input: Input;
  readonly reason: string;
};

export type EventState = EngineIndexes & {
  readonly def: ParsedEventDef;
  readonly registry: ModelRegistry;
  /** Every submitted input, in order (rejected ones included for audit). */
  readonly inputs: readonly Input[];
  readonly errors: readonly InputError[];
  /** Accepted pairings keyed by `pairingsKey` — read them via `pairingsAt`. */
  readonly pairings: ReadonlyMap<string, readonly PairingPlan[]>;
};

export const pairingsKey = (pool: NodePath, round: number): string =>
  `${pool}#${round}`;

/** The slice of state the resolution helpers need (the fold uses it mid-build). */
export type StateView = EngineIndexes & {
  readonly def: ParsedEventDef;
  readonly registry: ModelRegistry;
  readonly pairings: ReadonlyMap<string, readonly PairingPlan[]>;
};

/** The accepted pairings of one pool round, if any. */
export function pairingsAt(
  state: Pick<EventState, "pairings">,
  pool: NodePath,
  round: number,
): readonly PairingPlan[] | undefined {
  return state.pairings.get(pairingsKey(pool, round));
}

type MutableState = {
  readonly def: ParsedEventDef;
  readonly registry: ModelRegistry;
  readonly results: Map<string, GameResultCode>;
  readonly lineups: Map<string, readonly PlayerId[]>;
  readonly decisions: Map<string, Side>;
  readonly colorDraws: Map<string, Side>;
  readonly forfeits: Map<string, Side>;
  readonly pairings: Map<string, readonly PairingPlan[]>;
};

/**
 * Fold the input log, in order, into an EventState. Invalid inputs are
 * recorded in `errors` with reasons and skipped — never thrown. A later
 * input overwrites an earlier one at the same node (corrections are
 * last-write-wins); every derived view recomputes from the surviving log.
 */
export function materialize(
  def: ParsedEventDef,
  inputs: readonly Input[],
  registry: ModelRegistry,
): EventState {
  const state: MutableState = {
    def,
    registry,
    results: new Map(),
    lineups: new Map(),
    decisions: new Map(),
    colorDraws: new Map(),
    forfeits: new Map(),
    pairings: new Map(),
  };
  const errors: InputError[] = [];
  const pairingInputIndexes = new Map<string, number>();
  inputs.forEach((input, index) => {
    const reason = applyInput(state, input);
    if (reason !== undefined) errors.push({ index, input, reason });
    else if (input.kind === "pairingsSet") {
      pairingInputIndexes.set(pairingsKey(input.pool, input.round), index);
    }
  });
  const finished: EventState = { ...state, inputs, errors };

  // A correction in a rank-source group can re-seed a later stage AFTER its
  // pairings were accepted; surface the orphaned pairings instead of letting
  // standings silently skip them.
  for (const index of pairingInputIndexes.values()) {
    const input = inputs[index];
    if (input?.kind !== "pairingsSet") continue;
    const orphan = staleEntrant(finished, input);
    if (orphan !== undefined) {
      errors.push({
        index,
        input,
        reason: `${orphan} is no longer an entrant of ${input.pool} after later corrections — re-pair round ${input.round}`,
      });
    }
  }
  return finished;
}

/** Append one input and re-derive (the fold is cheap at chess scale). */
export function withInput(state: EventState, input: Input): EventState {
  return materialize(state.def, [...state.inputs, input], state.registry);
}

function staleEntrant(
  state: StateView,
  input: PairingsSetInput,
): CompetitorId | undefined {
  const ref = groupAt(state, input.pool);
  if (typeof ref === "string") return undefined;
  const entrants = resolveEntrants(state, ref);
  if (entrants === undefined) return undefined;
  const entrantSet = new Set<string>(entrants);
  for (const plan of input.pairings) {
    const ids = plan.kind === "pair" ? [plan.a, plan.b] : [plan.competitor];
    const orphan = ids.find((id) => !entrantSet.has(id));
    if (orphan !== undefined) return orphan;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Definition lookups and entrant resolution

type GroupRef = {
  readonly stage: StageDef;
  readonly stageIndex: number;
  readonly group: GroupDef;
  readonly path: NodePath;
};

function findGroup(
  def: EventDef,
  stageId: string,
  groupId: string,
): GroupRef | undefined {
  const stageIndex = def.stages.findIndex((s) => s.id === stageId);
  const stage = def.stages[stageIndex];
  if (stage === undefined) return undefined;
  const group = stage.groups.find((g) => g.id === groupId);
  if (group === undefined) return undefined;
  return { stage, stageIndex, group, path: groupRootPath(stageId, groupId) };
}

function* allGroups(def: EventDef): Generator<GroupRef> {
  for (let stageIndex = 0; stageIndex < def.stages.length; stageIndex += 1) {
    const stage = def.stages[stageIndex];
    if (stage === undefined) continue;
    for (const group of stage.groups) {
      yield {
        stage,
        stageIndex,
        group,
        path: groupRootPath(stage.id, group.id),
      };
    }
  }
}

function groupAt(state: StateView, path: NodePath): GroupRef | string {
  const [stageSeg, groupSeg, ...rest] = pathSegments(path);
  if (
    rest.length > 0 ||
    stageSeg?.kind !== "stage" ||
    groupSeg?.kind !== "group"
  ) {
    return `expected a stage-<id>/group-<id> path, got ${path}`;
  }
  const ref = findGroup(state.def, stageSeg.id, groupSeg.id);
  return ref ?? `unknown group ${stageSeg.id}/${groupSeg.id}`;
}

/**
 * Resolve a group's entrants. Rank-style seeds resolve only once their
 * source group has completed; until then the whole group is unresolved.
 */
export function resolveEntrants(
  state: StateView,
  ref: GroupRef,
): readonly CompetitorId[] | undefined {
  // Open groups have no field until registration binds one.
  if (isOpenEntries(ref.group.entries)) return undefined;
  const entrants: CompetitorId[] = [];
  for (const entry of ref.group.entries) {
    const kind = state.registry.seeds.get(entry.kind);
    if (kind === undefined) return undefined;
    const id = kind.resolve(entry, {
      competitors: state.def.competitors,
      ranking: (stage, group) => {
        const source = findGroup(state.def, stage, group);
        if (source === undefined) return undefined;
        return groupRanking(state, source);
      },
    });
    if (id === undefined) return undefined;
    entrants.push(id);
  }
  return entrants;
}

/** Total rounds a pool plays: derived by its pairing kind or declared. */
export function totalRoundsOf(
  state: StateView,
  pool: PoolDef,
  entrants: number,
): number {
  const kind = state.registry.pairings.get(pool.pairing.system);
  return kind?.totalRounds?.(pool.pairing, entrants) ?? pool.rounds ?? 0;
}

/** Final order of a completed group: standings for pools, [winner, loser] for encounters (entry order on a draw). */
export function groupRanking(
  state: StateView,
  ref: GroupRef,
): readonly CompetitorId[] | undefined {
  const entrants = resolveEntrants(state, ref);
  if (entrants === undefined) return undefined;

  if (isPool(ref.group.run)) {
    const pool = ref.group.run;
    const total = totalRoundsOf(state, pool, entrants.length);
    const rounds = poolRounds(state, ref.path, total);
    if (rounds.size < total) return undefined;
    for (const [round, plans] of rounds) {
      if (!roundComplete(state, pool, ref.path, round, plans)) return undefined;
    }
    return poolStandings(
      state.registry,
      state,
      pool,
      ref.path,
      entrants,
      rounds,
      total,
    ).map((row) => row.competitor);
  }

  const sides = rootSides(entrants);
  if (sides === undefined) return undefined;
  const node = evalRoot(state, ref.group.run, ref.path, sides);
  const d = node.outcome.decision;
  if (d.kind === "pending") return undefined;
  if (d.kind === "win") {
    return d.winner === 0 ? [sides[0], sides[1]] : [sides[1], sides[0]];
  }
  // A drawn root encounter is finished, just shared: entry order, so the
  // event can complete (eventWinner reports no champion for it).
  return sides;
}

const rootSides = (
  entrants: readonly CompetitorId[],
): readonly [CompetitorId, CompetitorId] | undefined => {
  const [a, b] = entrants;
  return a !== undefined && b !== undefined ? [a, b] : undefined;
};

function poolRounds(
  state: StateView,
  poolPath: NodePath,
  total: number,
): PoolRoundPlans {
  const rounds = new Map<number, readonly PairingPlan[]>();
  for (let r = 1; r <= total; r += 1) {
    const plans = pairingsAt(state, poolPath, r);
    if (plans === undefined) break;
    rounds.set(r, plans);
  }
  return rounds;
}

function roundComplete(
  state: StateView,
  pool: PoolDef,
  poolPath: NodePath,
  round: number,
  plans: readonly PairingPlan[],
): boolean {
  return plans.every((plan, index) => {
    if (plan.kind === "bye") return true;
    const node = evalPair(
      state.registry,
      state,
      pool,
      poolPath,
      round,
      index,
      plan,
    );
    return node.outcome.decision.kind !== "pending";
  });
}

function evalRoot(
  state: StateView,
  def: AnyEncounterDef,
  path: NodePath,
  sides: readonly [CompetitorId, CompetitorId],
): EvalNode {
  return evalNode(state.registry, state, {
    def,
    path,
    whiteSeat: state.colorDraws.get(path) ?? 0,
    participants: sides,
  });
}

// ---------------------------------------------------------------------------
// Path resolution (shared by input validation and public reads)

type Resolved =
  | {
      readonly ok: true;
      readonly node: EvalNode;
      readonly sides: readonly [CompetitorId, CompetitorId];
    }
  | { readonly ok: false; readonly reason: string };

function resolveNode(state: StateView, path: NodePath): Resolved {
  const segments = pathSegments(path);
  const [stageSeg, groupSeg, ...rest] = segments;
  if (stageSeg?.kind !== "stage" || groupSeg?.kind !== "group") {
    return {
      ok: false,
      reason: `path must start with stage-<id>/group-<id>: ${path}`,
    };
  }
  const ref = findGroup(state.def, stageSeg.id, groupSeg.id);
  if (ref === undefined) {
    return { ok: false, reason: `unknown group ${stageSeg.id}/${groupSeg.id}` };
  }
  const entrants = resolveEntrants(state, ref);
  if (entrants === undefined) {
    return {
      ok: false,
      reason: `${stageSeg.id}/${groupSeg.id} is waiting on an earlier stage`,
    };
  }

  let root: EvalNode;
  let sides: readonly [CompetitorId, CompetitorId];
  let descend: readonly (typeof segments)[number][];

  if (isPool(ref.group.run)) {
    const [roundSeg, pairSeg, ...encounterSegs] = rest;
    if (roundSeg?.kind !== "round" || pairSeg?.kind !== "pair") {
      return {
        ok: false,
        reason: `pool paths need round-<n>/pair-<n>: ${path}`,
      };
    }
    const plans = pairingsAt(state, ref.path, roundSeg.n);
    const plan = plans?.[pairSeg.n - 1];
    if (plan === undefined) {
      return {
        ok: false,
        reason: `round ${roundSeg.n} pair ${pairSeg.n} is not paired yet`,
      };
    }
    if (plan.kind === "bye") {
      return {
        ok: false,
        reason: `pair ${pairSeg.n} of round ${roundSeg.n} is a bye`,
      };
    }
    root = evalPair(
      state.registry,
      state,
      ref.group.run,
      ref.path,
      roundSeg.n,
      pairSeg.n - 1,
      plan,
    );
    sides = [plan.a, plan.b];
    descend = encounterSegs;
  } else {
    const rs = rootSides(entrants);
    if (rs === undefined) {
      return {
        ok: false,
        reason: `group ${ref.group.id} needs exactly two entrants`,
      };
    }
    root = evalRoot(state, ref.group.run, ref.path, rs);
    sides = rs;
    descend = rest;
  }

  const node = nodeAt(root, descend);
  if (node === undefined) {
    return {
      ok: false,
      reason: `${path} is not materialized (yet): the addressed child does not exist`,
    };
  }
  return { ok: true, node, sides };
}

/** True when any game at or under `path` already has a recorded result. */
function resultsUnder(state: EngineIndexes, path: NodePath): boolean {
  for (const key of state.results.keys()) {
    if (key === path || key.startsWith(`${path}/`)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Input application (validation lives here)

function applyInput(state: MutableState, input: Input): string | undefined {
  switch (input.kind) {
    case "pairingsSet":
      return applyPairingsSet(state, input);

    case "lineupSet": {
      const resolved = resolveNode(state, input.match);
      if (!resolved.ok) return resolved.reason;
      const wanted = resolved.node.work.find(
        (w) => w.kind === "awaitLineup" && w.side === input.side,
      );
      const already = state.lineups.has(lineupKey(input.match, input.side));
      if (wanted === undefined && !already) {
        return `${input.match} is not awaiting a lineup for side ${input.side}`;
      }
      const boards =
        wanted?.kind === "awaitLineup"
          ? wanted.boards
          : state.lineups.get(lineupKey(input.match, input.side))?.length;
      if (boards !== undefined && input.players.length !== boards) {
        return `lineup needs exactly ${boards} players`;
      }
      if (new Set(input.players).size !== input.players.length) {
        return "lineup repeats a player";
      }
      const competitorId = resolved.sides[input.side];
      const competitor = state.def.competitors.find(
        (c) => c.id === competitorId,
      );
      if (competitor?.roster === undefined) {
        return `${competitorId} has no roster to draw a lineup from`;
      }
      const roster = new Set<string>(competitor.roster);
      const outsider = input.players.find((p) => !roster.has(p));
      if (outsider !== undefined) {
        return `${outsider} is not on the roster of ${competitor.name}`;
      }
      if (resultsUnder(state, input.match)) {
        return `${input.match} already has results; lineups are locked`;
      }
      state.lineups.set(lineupKey(input.match, input.side), input.players);
      return undefined;
    }

    case "gameResult": {
      const resolved = resolveNode(state, input.game);
      if (!resolved.ok) return resolved.reason;
      const node = resolved.node;
      if (state.registry.ops.structure(node.def).length > 0) {
        return `${input.game} is not a playable leaf`;
      }
      if (node.whiteSeat === undefined) {
        return `colors at ${input.game} have not been drawn yet`;
      }
      if (node.participants === undefined) {
        return `participants at ${input.game} are not known yet (lineups outstanding)`;
      }
      state.results.set(input.game, input.result);
      return undefined;
    }

    case "manualDecision": {
      const resolved = resolveNode(state, input.node);
      if (!resolved.ok) return resolved.reason;
      const awaiting = resolved.node.work.some(
        (w) => w.kind === "awaitManualDecision",
      );
      if (!awaiting && !state.decisions.has(input.node)) {
        return `${input.node} is not awaiting a manual decision`;
      }
      state.decisions.set(input.node, input.winner);
      return undefined;
    }

    case "colorDraw": {
      // Results are recorded white-relative; redrawing the seat under them
      // would silently flip who won. The fold rejects that instead.
      if (resultsUnder(state, input.node)) {
        return `colors at ${input.node} are fixed: results are already recorded under it`;
      }
      const segments = pathSegments(input.node);
      if (segments.length === 2) {
        const ref = groupAt(state, input.node);
        if (typeof ref === "string") return ref;
        if (isPool(ref.group.run)) {
          return "pool pairings assign colors; colorDraw applies to root encounters and drawn child seats";
        }
        state.colorDraws.set(input.node, input.whiteSeat);
        return undefined;
      }
      const last = segments[segments.length - 1];
      if (last?.kind !== "child") {
        return `colorDraw applies to root encounters and drawn child seats, not ${input.node}`;
      }
      const parent = resolveNode(
        state,
        pathPrefix(input.node, segments.length - 1),
      );
      if (!parent.ok) return parent.reason;
      const child = parent.node.children.find(
        (c) =>
          c.slot.segment.label === last.label && c.slot.segment.n === last.n,
      );
      if (child === undefined) {
        return `${input.node} is not materialized yet`;
      }
      if (child.slot.seat !== "draw") {
        return `the seat at ${input.node} is not drawn by lot`;
      }
      state.colorDraws.set(input.node, input.whiteSeat);
      return undefined;
    }

    case "encounterForfeit": {
      const resolved = resolveNode(state, input.node);
      if (!resolved.ok) return resolved.reason;
      state.forfeits.set(input.node, input.winner);
      return undefined;
    }
  }
}

function applyPairingsSet(
  state: MutableState,
  input: PairingsSetInput,
): string | undefined {
  const ref = groupAt(state, input.pool);
  if (typeof ref === "string") return ref;
  if (!isPool(ref.group.run)) return `${input.pool} is not a pool`;
  const pool = ref.group.run;

  const entrants = resolveEntrants(state, ref);
  if (entrants === undefined) {
    return `${input.pool} is waiting on an earlier stage`;
  }
  const total = totalRoundsOf(state, pool, entrants.length);
  if (input.round < 1 || input.round > total) {
    return `round ${input.round} is outside this pool's ${total} rounds`;
  }
  const key = pairingsKey(ref.path, input.round);
  if (state.pairings.has(key)) {
    return `round ${input.round} is already paired`;
  }
  if (
    input.round > 1 &&
    !state.pairings.has(pairingsKey(ref.path, input.round - 1))
  ) {
    return `round ${input.round - 1} must be paired first`;
  }

  const entrantSet = new Set<string>(entrants);
  const seen = new Set<string>();
  const byeRule =
    pool.bye ?? state.registry.pairings.get(pool.pairing.system)?.defaultBye;
  for (const plan of input.pairings) {
    const ids = plan.kind === "pair" ? [plan.a, plan.b] : [plan.competitor];
    for (const id of ids) {
      if (!entrantSet.has(id))
        return `${id} is not an entrant of ${input.pool}`;
      if (seen.has(id)) return `${id} appears twice in round ${input.round}`;
      seen.add(id);
    }
    if (plan.kind === "bye" && byeRule === undefined) {
      return "this pool has no bye rule configured";
    }
  }

  state.pairings.set(key, input.pairings);
  return undefined;
}

// ---------------------------------------------------------------------------
// Actions: what the host should do right now

export type ScheduledGame = {
  readonly path: NodePath;
  readonly white: ParticipantId;
  readonly black: ParticipantId;
  readonly clock: Clock;
};

export type Action =
  | { readonly kind: "createGame"; readonly game: ScheduledGame }
  | {
      readonly kind: "awaitPairings";
      readonly pool: NodePath;
      readonly round: number;
      readonly context: PairingContext;
    }
  | {
      readonly kind: "awaitLineup";
      readonly match: NodePath;
      readonly side: Side;
      readonly competitor: CompetitorId;
      readonly boards: number;
    }
  | {
      readonly kind: "awaitManualDecision";
      readonly node: NodePath;
      readonly between: readonly [CompetitorId, CompetitorId];
    }
  | {
      readonly kind: "awaitColorDraw";
      readonly node: NodePath;
      readonly between: readonly [CompetitorId, CompetitorId];
    }
  | {
      readonly kind: "awaitSeeding";
      readonly stage: string;
      readonly group: string;
    }
  | {
      readonly kind: "eventComplete";
      readonly winner: CompetitorId | undefined;
    };

/**
 * Idempotent snapshot of everything the host should do right now. The host
 * diffs it against work it has already started; the engine never retracts a
 * created game.
 */
export function nextActions(state: EventState): readonly Action[] {
  const actions: Action[] = [];
  let allComplete = true;

  for (const ref of allGroups(state.def)) {
    const entrants = resolveEntrants(state, ref);
    if (entrants === undefined) {
      actions.push({
        kind: "awaitSeeding",
        stage: ref.stage.id,
        group: ref.group.id,
      });
      allComplete = false;
      continue;
    }
    if (groupRanking(state, ref) !== undefined) continue;
    allComplete = false;

    if (isPool(ref.group.run)) {
      collectPoolActions(state, ref, ref.group.run, entrants, actions);
    } else {
      const sides = rootSides(entrants);
      if (sides === undefined) continue;
      const node = evalRoot(state, ref.group.run, ref.path, sides);
      collectNodeActions(node, sides, undefined, actions);
    }
  }

  if (allComplete) {
    actions.push({ kind: "eventComplete", winner: eventWinner(state) });
  }
  return actions;
}

function eventWinner(state: EventState): CompetitorId | undefined {
  const lastStage = state.def.stages[state.def.stages.length - 1];
  const onlyGroup =
    lastStage?.groups.length === 1 ? lastStage.groups[0] : undefined;
  if (lastStage === undefined || onlyGroup === undefined) return undefined;
  const ref = findGroup(state.def, lastStage.id, onlyGroup.id);
  if (ref === undefined) return undefined;
  if (!isPool(ref.group.run)) {
    // A drawn deciding match has no champion even though the event is over.
    const entrants = resolveEntrants(state, ref);
    const sides = entrants === undefined ? undefined : rootSides(entrants);
    if (sides === undefined) return undefined;
    const d = evalRoot(state, ref.group.run, ref.path, sides).outcome.decision;
    if (d.kind !== "win") return undefined;
  }
  return groupRanking(state, ref)?.[0];
}

function collectPoolActions(
  state: EventState,
  ref: GroupRef,
  pool: PoolDef,
  entrants: readonly CompetitorId[],
  actions: Action[],
): void {
  const total = totalRoundsOf(state, pool, entrants.length);
  for (let round = 1; round <= total; round += 1) {
    const plans = pairingsAt(state, ref.path, round);
    if (plans === undefined) {
      const previousDone =
        round === 1 ||
        roundComplete(
          state,
          pool,
          ref.path,
          round - 1,
          pairingsAt(state, ref.path, round - 1) ?? [],
        );
      if (previousDone) {
        actions.push({
          kind: "awaitPairings",
          pool: ref.path,
          round,
          context: buildPairingContext(
            state,
            ref,
            pool,
            entrants,
            round,
            total,
          ),
        });
      }
      return;
    }

    const childLimit = lockstepChildLimit(state, pool, ref.path, round, plans);
    plans.forEach((plan, index) => {
      if (plan.kind === "bye") return;
      const node = evalPair(
        state.registry,
        state,
        pool,
        ref.path,
        round,
        index,
        plan,
      );
      collectNodeActions(node, [plan.a, plan.b], childLimit, actions);
    });
  }
}

/**
 * With `legRelease: "lockstep"`, child N+1 of a round's encounters is
 * schedulable only once every pair has resolved child N. Returns the
 * exclusive child-index limit, or undefined when not in lockstep.
 */
function lockstepChildLimit(
  state: EventState,
  pool: PoolDef,
  poolPath: NodePath,
  round: number,
  plans: readonly PairingPlan[],
): number | undefined {
  if (pool.legRelease !== "lockstep") return undefined;
  let minResolved = Number.POSITIVE_INFINITY;
  plans.forEach((plan, index) => {
    if (plan.kind === "bye") return;
    const node = evalPair(
      state.registry,
      state,
      pool,
      poolPath,
      round,
      index,
      plan,
    );
    const resolved = node.children.filter(
      (child) => child.node.outcome.decision.kind !== "pending",
    ).length;
    minResolved = Math.min(minResolved, resolved);
  });
  return Number.isFinite(minResolved) ? minResolved + 1 : undefined;
}

function collectNodeActions(
  node: EvalNode,
  competitors: readonly [CompetitorId, CompetitorId],
  childLimit: number | undefined,
  actions: Action[],
): void {
  if (node.forfeited) return;
  for (const work of node.work) {
    switch (work.kind) {
      case "createGame":
        actions.push({
          kind: "createGame",
          game: {
            path: node.path,
            white: work.white,
            black: work.black,
            clock: work.clock,
          },
        });
        break;
      case "awaitLineup":
        actions.push({
          kind: "awaitLineup",
          match: node.path,
          side: work.side,
          competitor: competitors[work.side],
          boards: work.boards,
        });
        break;
      case "awaitManualDecision":
        actions.push({
          kind: "awaitManualDecision",
          node: node.path,
          between: competitors,
        });
        break;
    }
  }
  node.children.forEach((child, index) => {
    if (childLimit !== undefined && index >= childLimit) return;
    if (child.awaitingDraw) {
      actions.push({
        kind: "awaitColorDraw",
        node: child.node.path,
        between: competitors,
      });
      return;
    }
    collectNodeActions(child.node, competitors, undefined, actions);
  });
}

// ---------------------------------------------------------------------------
// Pairing context + proposals

function buildPairingContext(
  state: EventState,
  ref: GroupRef,
  pool: PoolDef,
  entrants: readonly CompetitorId[],
  round: number,
  total: number,
): PairingContext {
  const playedRounds = new Map<number, readonly PairingPlan[]>();
  for (let r = 1; r < round; r += 1) {
    const plans = pairingsAt(state, ref.path, r);
    if (plans !== undefined) playedRounds.set(r, plans);
  }
  const rows = poolStandings(
    state.registry,
    state,
    pool,
    ref.path,
    entrants,
    playedRounds,
    total,
  );

  const scores = new Map<CompetitorId, number>();
  const history = new Map<CompetitorId, readonly PairingHistoryEntry[]>();
  for (const row of rows) {
    scores.set(row.competitor, row.standingsPoints);
    history.set(
      row.competitor,
      row.lines.map((line): PairingHistoryEntry => {
        if (line.kind === "bye") {
          return { kind: "bye", points: line.standingsPoints };
        }
        if (line.kind === "absent") {
          return { kind: "absent" };
        }
        return {
          kind: "played",
          opponent: line.opponent,
          color: line.color,
          points: line.standingsPoints,
          unplayed: line.unplayed,
        };
      }),
    );
  }

  const previousPlans = playedRounds.get(round - 1);
  const previousRound =
    previousPlans === undefined
      ? undefined
      : {
          pairings: previousPlans,
          winners: previousPlans.map((plan, index): CompetitorId | null => {
            if (plan.kind === "bye") return plan.competitor;
            const node = evalPair(
              state.registry,
              state,
              pool,
              ref.path,
              round - 1,
              index,
              plan,
            );
            const d = node.outcome.decision;
            if (d.kind !== "win") return null;
            return d.winner === 0 ? plan.a : plan.b;
          }),
        };

  return {
    round,
    totalRounds: total,
    competitors: entrants.map((id, index) => ({
      id,
      seed: index + 1,
      rating: state.def.competitors.find((c) => c.id === id)?.rating,
    })),
    scores,
    history,
    previousRound,
  };
}

export type ProposeResult =
  | { readonly ok: true; readonly input: PairingsSetInput }
  | { readonly ok: false; readonly error: string };

/** Run the pool's pairing kind against the currently awaited round. */
export function proposePairings(
  state: EventState,
  poolPath: NodePath,
): ProposeResult {
  const awaiting = nextActions(state).find(
    (action): action is Extract<Action, { kind: "awaitPairings" }> =>
      action.kind === "awaitPairings" && action.pool === poolPath,
  );
  if (awaiting === undefined) {
    return { ok: false, error: `${poolPath} is not awaiting pairings` };
  }
  const ref = groupAt(state, poolPath);
  if (typeof ref === "string") return { ok: false, error: ref };
  if (!isPool(ref.group.run))
    return { ok: false, error: `${poolPath} is not a pool` };
  const system = ref.group.run.pairing.system;
  const kind = state.registry.pairings.get(system);
  if (kind === undefined) {
    return {
      ok: false,
      error: `pairing system "${system}" has no registered proposer: record a pairingsSet input directly`,
    };
  }
  const result = kind.propose(ref.group.run.pairing, awaiting.context);
  if (!result.ok) return result;
  return {
    ok: true,
    input: {
      kind: "pairingsSet",
      pool: poolPath,
      round: awaiting.round,
      pairings: [...result.pairings],
    },
  };
}

// ---------------------------------------------------------------------------
// Public reads

/** Outcome at a materialized node. Throws when the path does not resolve (reads are strict; the input fold is not). */
export function outcomeAt(state: EventState, path: NodePath) {
  const resolved = resolveNode(state, path);
  if (!resolved.ok) throw new Error(resolved.reason);
  return resolved.node.outcome;
}

/** The full evaluated tree at a pairing or root encounter (for UIs). Throws on unresolvable paths. */
export function evaluatedNodeAt(state: EventState, path: NodePath): EvalNode {
  const resolved = resolveNode(state, path);
  if (!resolved.ok) throw new Error(resolved.reason);
  return resolved.node;
}

/** Live standings of a pool group. Throws when the path is not a ready pool (reads are strict; the input fold is not). */
export function standingsOf(
  state: EventState,
  poolPath: NodePath,
): readonly StandingsRow[] {
  const ref = groupAt(state, poolPath);
  if (typeof ref === "string") throw new Error(ref);
  if (!isPool(ref.group.run)) throw new Error(`${poolPath} is not a pool`);
  const entrants = resolveEntrants(state, ref);
  if (entrants === undefined) {
    throw new Error(`${poolPath} is waiting on an earlier stage`);
  }
  const total = totalRoundsOf(state, ref.group.run, entrants.length);
  return poolStandings(
    state.registry,
    state,
    ref.group.run,
    ref.path,
    entrants,
    poolRounds(state, ref.path, total),
    total,
  );
}
