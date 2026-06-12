import {
  type Clock,
  type CompetitorId,
  defaultedByeRule,
  type EncounterDef,
  type EventDef,
  type GroupDef,
  groupRootPath,
  type NodePath,
  otherSide,
  type ParsedEventDef,
  type ParticipantId,
  type PathSegment,
  type PlayerId,
  type PoolDef,
  pairPath,
  pathPrefix,
  pathSegments,
  poolTotalRounds,
  type Side,
  type StageDef,
} from "./def";
import type {
  GameResultCode,
  Input,
  PairingPlan,
  PairingsSetInput,
} from "./inputs";
import {
  type EngineIndexes,
  type EvalNode,
  evalEncounter,
  lineupKey,
  type Outcome,
} from "./outcome";
import {
  type PairingContext,
  type PairingHistoryEntry,
  pairingSystems,
} from "./pairing";
import {
  evalPair,
  type PoolRoundPlans,
  poolStandings,
  type StandingsRow,
} from "./standings";

/**
 * The engine: a validated pure fold over the input log (`materialize`), plus
 * derived views — `nextActions` (what the host should do now), standings,
 * and outcomes. Nothing here performs IO or draws randomness; pairings and
 * lots arrive as recorded inputs.
 */

export type InputError = {
  readonly index: number;
  readonly input: Input;
  readonly reason: string;
};

export type EventState = EngineIndexes & {
  readonly def: ParsedEventDef;
  /** Every submitted input, in order (rejected ones included for audit). */
  readonly inputs: readonly Input[];
  readonly errors: readonly InputError[];
  /** Accepted pairings keyed by `pairingsKey` — read them via `pairingsAt`. */
  readonly pairings: ReadonlyMap<string, readonly PairingPlan[]>;
};

export const pairingsKey = (pool: NodePath, round: number): string =>
  `${pool}#${round}`;

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
  readonly results: Map<string, GameResultCode>;
  readonly lineups: Map<string, readonly PlayerId[]>;
  readonly decisions: Map<string, Side>;
  readonly colorDraws: Map<string, Side>;
  readonly forfeits: Map<string, Side>;
  readonly pairings: Map<string, readonly PairingPlan[]>;
};

/**
 * Fold the input log, in order, into an EventState. Invalid inputs are
 * recorded in `errors` with reasons and skipped — never thrown. A later input
 * overwrites an earlier one at the same node (corrections are
 * last-write-wins); every derived view recomputes from the surviving log.
 */
export function materialize(
  def: ParsedEventDef,
  inputs: readonly Input[],
): EventState {
  const state: MutableState = {
    def,
    results: new Map(),
    lineups: new Map(),
    decisions: new Map(),
    colorDraws: new Map(),
    forfeits: new Map(),
    pairings: new Map(),
  };
  const errors: InputError[] = [];
  const pairingsIndexByKey = new Map<string, number>();
  inputs.forEach((input, index) => {
    const reason = applyInput(state, input);
    if (reason !== undefined) errors.push({ index, input, reason });
    else if (input.kind === "pairingsSet") {
      pairingsIndexByKey.set(pairingsKey(input.pool, input.round), index);
    }
  });
  const finished = { ...state, inputs, errors };
  // A correction in a rank-source group can re-seed a later stage AFTER its
  // pairings were accepted; surface the orphaned pairings instead of letting
  // standings silently skip them.
  for (const [key, index] of pairingsIndexByKey) {
    const input = inputs[index];
    if (input?.kind !== "pairingsSet") continue;
    const orphan = staleEntrant(finished, input);
    if (orphan !== undefined) {
      errors.push({
        index,
        input,
        reason: `${orphan} is no longer an entrant of ${input.pool} after later corrections — re-pair round ${input.round} (key ${key})`,
      });
    }
  }
  return finished;
}

function staleEntrant(
  state: EventState,
  input: PairingsSetInput,
): CompetitorId | undefined {
  const segments = pathSegments(input.pool);
  const [stageSeg, groupSeg] = segments;
  if (stageSeg?.kind !== "stage" || groupSeg?.kind !== "group")
    return undefined;
  const ref = findGroup(state.def, stageSeg.id, groupSeg.id);
  if (ref === undefined) return undefined;
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

/** Append one input and re-derive (the fold is cheap at chess scale). */
export function withInput(state: EventState, input: Input): EventState {
  return materialize(state.def, [...state.inputs, input]);
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

type StateView = EngineIndexes & {
  readonly def: EventDef;
  readonly pairings: ReadonlyMap<string, readonly PairingPlan[]>;
};

/**
 * Resolve a group's entrants. Rank sources resolve only once their source
 * group has completed; until then the whole group is unresolved (undefined).
 */
export function resolveEntrants(
  view: StateView,
  ref: GroupRef,
): readonly CompetitorId[] | undefined {
  const entrants: CompetitorId[] = [];
  for (const entry of ref.group.entries) {
    switch (entry.kind) {
      case "registration": {
        const competitor = view.def.competitors[entry.seed - 1];
        if (competitor === undefined) return undefined;
        entrants.push(competitor.id);
        break;
      }
      case "fixed":
        entrants.push(entry.id);
        break;
      case "rank": {
        const source = findGroup(view.def, entry.stage, entry.group);
        if (source === undefined) return undefined;
        const ranking = groupRanking(view, source);
        const competitor = ranking?.[entry.rank - 1];
        if (competitor === undefined) return undefined;
        entrants.push(competitor);
        break;
      }
    }
  }
  return entrants;
}

/** Final order of a group once complete: standings order for pools, [winner, loser] for encounters. */
export function groupRanking(
  view: StateView,
  ref: GroupRef,
): readonly CompetitorId[] | undefined {
  const entrants = resolveEntrants(view, ref);
  if (entrants === undefined) return undefined;

  if (ref.group.run.kind === "pool") {
    const pool = ref.group.run;
    const total = poolTotalRounds(pool, entrants.length);
    const rounds = poolRounds(view, ref.path, total);
    if (rounds.size < total) return undefined;
    for (const [round, plans] of rounds) {
      if (!roundComplete(view, pool, ref.path, round, plans)) return undefined;
    }
    return poolStandings(view, pool, ref.path, entrants, rounds, total).map(
      (row) => row.competitor,
    );
  }

  const sides = rootSides(entrants);
  if (sides === undefined) return undefined;
  const node = evalRoot(view, ref.group.run, ref.path);
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
  view: StateView,
  poolPath: NodePath,
  total: number,
): PoolRoundPlans {
  const rounds = new Map<number, readonly PairingPlan[]>();
  for (let r = 1; r <= total; r += 1) {
    const plans = view.pairings.get(pairingsKey(poolPath, r));
    if (plans === undefined) break;
    rounds.set(r, plans);
  }
  return rounds;
}

function roundComplete(
  view: StateView,
  pool: PoolDef,
  poolPath: NodePath,
  round: number,
  plans: readonly PairingPlan[],
): boolean {
  return plans.every((plan, index) => {
    if (plan.kind === "bye") return true;
    const node = evalPair(view, pool, poolPath, round, index, plan);
    return node.outcome.decision.kind !== "pending";
  });
}

function evalRoot(
  view: StateView,
  def: EncounterDef,
  path: NodePath,
): EvalNode {
  return evalEncounter(view, {
    def,
    path,
    whiteSeat: view.colorDraws.get(path) ?? 0,
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

function resolveEncounterNode(view: StateView, path: NodePath): Resolved {
  const segments = pathSegments(path);
  const [stageSeg, groupSeg, ...rest] = segments;
  if (stageSeg?.kind !== "stage" || groupSeg?.kind !== "group") {
    return {
      ok: false,
      reason: `path must start with stage-<id>/group-<id>: ${path}`,
    };
  }
  const ref = findGroup(view.def, stageSeg.id, groupSeg.id);
  if (ref === undefined) {
    return { ok: false, reason: `unknown group ${stageSeg.id}/${groupSeg.id}` };
  }
  const entrants = resolveEntrants(view, ref);
  if (entrants === undefined) {
    return {
      ok: false,
      reason: `${stageSeg.id}/${groupSeg.id} is waiting on an earlier stage`,
    };
  }

  let root: EvalNode;
  let sides: readonly [CompetitorId, CompetitorId];
  let descend: readonly PathSegment[];

  if (ref.group.run.kind === "pool") {
    const [roundSeg, pairSeg, ...encounterSegs] = rest;
    if (roundSeg?.kind !== "round" || pairSeg?.kind !== "pair") {
      return {
        ok: false,
        reason: `pool paths need round-<n>/pair-<n>: ${path}`,
      };
    }
    const plans = view.pairings.get(pairingsKey(ref.path, roundSeg.n));
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
    root = evalEncounter(view, {
      def: ref.group.run.encounter,
      path: pairPath(ref.path, roundSeg.n, pairSeg.n),
      whiteSeat: plan.whiteSeat,
    });
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
    root = evalRoot(view, ref.group.run, ref.path);
    sides = rs;
    descend = rest;
  }

  let node = root;
  for (const segment of descend) {
    if (segment.kind === "leg") {
      if (node.ctx.def.kind !== "series") {
        return { ok: false, reason: `${node.ctx.path} is not a series` };
      }
      const child = node.children[segment.n - 1];
      if (child === undefined) {
        return {
          ok: false,
          reason: `leg ${segment.n} of ${node.ctx.path} is not materialized yet`,
        };
      }
      node = child;
    } else if (segment.kind === "board") {
      if (node.ctx.def.kind !== "match") {
        return { ok: false, reason: `${node.ctx.path} is not a match` };
      }
      const child = node.children[segment.n - 1];
      if (child === undefined) {
        return {
          ok: false,
          reason: `board ${segment.n} is out of range at ${node.ctx.path}`,
        };
      }
      node = child;
    } else {
      return {
        ok: false,
        reason: `unexpected segment ${segment.kind} inside an encounter`,
      };
    }
  }
  return { ok: true, node, sides };
}

/** Both lineups of every match ancestor of (and including) `path` must be submitted. */
function missingLineups(view: StateView, path: NodePath): string | undefined {
  const segments = pathSegments(path);
  for (let i = 0; i < segments.length; i += 1) {
    if (segments[i]?.kind !== "board") continue;
    const matchPath = pathPrefix(path, i);
    for (const side of [0, 1] as const) {
      if (!view.lineups.has(lineupKey(matchPath, side))) {
        return `lineup for side ${side} of ${matchPath} is not submitted`;
      }
    }
  }
  return undefined;
}

/** True when any game at or under `path` already has a recorded result. */
function resultsUnder(view: StateView, path: NodePath): boolean {
  for (const key of view.results.keys()) {
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
      const resolved = resolveEncounterNode(state, input.match);
      if (!resolved.ok) return resolved.reason;
      const def = resolved.node.ctx.def;
      if (def.kind !== "match") return `${input.match} is not a match`;
      if (input.players.length !== def.boards) {
        return `lineup needs exactly ${def.boards} players`;
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
      const resolved = resolveEncounterNode(state, input.game);
      if (!resolved.ok) return resolved.reason;
      if (resolved.node.ctx.def.kind !== "game")
        return `${input.game} is not a game`;
      if (resolved.node.ctx.whiteSeat === undefined) {
        return `colors at ${input.game} have not been drawn yet`;
      }
      const lineupGap = missingLineups(state, input.game);
      if (lineupGap !== undefined) return lineupGap;
      state.results.set(input.game, input.result);
      return undefined;
    }
    case "manualDecision": {
      const resolved = resolveEncounterNode(state, input.node);
      if (!resolved.ok) return resolved.reason;
      if (!resolved.node.needsManual && !state.decisions.has(input.node)) {
        return `${input.node} is not awaiting a manual decision`;
      }
      state.decisions.set(input.node, input.winner);
      return undefined;
    }
    case "colorDraw":
      return applyColorDraw(state, input.node, input.whiteSeat);
    case "encounterForfeit": {
      const resolved = resolveEncounterNode(state, input.node);
      if (!resolved.ok) return resolved.reason;
      state.forfeits.set(input.node, input.winner);
      return undefined;
    }
  }
}

function applyColorDraw(
  state: MutableState,
  path: NodePath,
  whiteSeat: Side,
): string | undefined {
  // Results are recorded white-relative; redrawing the seat under them would
  // silently flip who won. The fold rejects that instead.
  if (resultsUnder(state, path)) {
    return `colors at ${path} are fixed: results are already recorded under it`;
  }
  const segments = pathSegments(path);
  const last = segments[segments.length - 1];
  if (last?.kind === "leg") {
    const parentPath = pathPrefix(path, segments.length - 1);
    const resolved = resolveEncounterNode(state, parentPath);
    if (!resolved.ok) return resolved.reason;
    const def = resolved.node.ctx.def;
    if (def.kind !== "series" || def.colors !== "redraw") {
      return `${parentPath} does not draw colors per leg`;
    }
    if (last.n > resolved.node.children.length) {
      return `leg ${last.n} of ${parentPath} is not materialized yet`;
    }
    state.colorDraws.set(path, whiteSeat);
    return undefined;
  }
  if (segments.length === 2) {
    const [stageSeg, groupSeg] = segments;
    if (stageSeg?.kind === "stage" && groupSeg?.kind === "group") {
      const ref = findGroup(state.def, stageSeg.id, groupSeg.id);
      if (ref === undefined)
        return `unknown group ${stageSeg.id}/${groupSeg.id}`;
      if (ref.group.run.kind === "pool") {
        return "pool pairings assign colors; colorDraw applies to root encounters and redraw legs";
      }
      state.colorDraws.set(path, whiteSeat);
      return undefined;
    }
  }
  return `colorDraw applies to root encounters and redraw legs, not ${path}`;
}

function applyPairingsSet(
  state: MutableState,
  input: PairingsSetInput,
): string | undefined {
  const segments = pathSegments(input.pool);
  const [stageSeg, groupSeg] = segments;
  if (
    segments.length !== 2 ||
    stageSeg?.kind !== "stage" ||
    groupSeg?.kind !== "group"
  ) {
    return `pairings address a pool group, not ${input.pool}`;
  }
  const ref = findGroup(state.def, stageSeg.id, groupSeg.id);
  if (ref === undefined) return `unknown group ${stageSeg.id}/${groupSeg.id}`;
  if (ref.group.run.kind !== "pool") return `${input.pool} is not a pool`;
  const pool = ref.group.run;

  const entrants = resolveEntrants(state, ref);
  if (entrants === undefined) {
    return `${input.pool} is waiting on an earlier stage`;
  }
  const total = poolTotalRounds(pool, entrants.length);
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
  for (const plan of input.pairings) {
    const ids = plan.kind === "pair" ? [plan.a, plan.b] : [plan.competitor];
    for (const id of ids) {
      if (!entrantSet.has(id))
        return `${id} is not an entrant of ${input.pool}`;
      if (seen.has(id)) return `${id} appears twice in round ${input.round}`;
      seen.add(id);
    }
    if (plan.kind === "bye" && defaultedByeRule(pool) === undefined) {
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
 * created game. Gating and ordering: design/tournament-model.md § "The engine".
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

    if (ref.group.run.kind === "pool") {
      collectPoolActions(state, ref, ref.group.run, entrants, actions);
    } else {
      const sides = rootSides(entrants);
      if (sides === undefined) continue;
      const node = evalRoot(state, ref.group.run, ref.path);
      collectEncounterActions(
        state,
        node,
        sides,
        [sides[0], sides[1]],
        undefined,
        actions,
      );
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
  if (ref.group.run.kind !== "pool") {
    // A drawn deciding match has no champion even though the event is over.
    const d = evalRoot(state, ref.group.run, ref.path).outcome.decision;
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
  const total = poolTotalRounds(pool, entrants.length);
  for (let round = 1; round <= total; round += 1) {
    const plans = state.pairings.get(pairingsKey(ref.path, round));
    if (plans === undefined) {
      const previousDone =
        round === 1 ||
        roundComplete(
          state,
          pool,
          ref.path,
          round - 1,
          state.pairings.get(pairingsKey(ref.path, round - 1)) ?? [],
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

    const legLimit = lockstepLegLimit(state, pool, ref.path, round, plans);
    plans.forEach((plan, index) => {
      if (plan.kind === "bye") return;
      const node = evalPair(state, pool, ref.path, round, index, plan);
      collectEncounterActions(
        state,
        node,
        [plan.a, plan.b],
        [plan.a, plan.b],
        legLimit,
        actions,
      );
    });
  }
}

/** Exclusive leg-index limit for the round's series encounters. See PoolDef.legRelease. */
function lockstepLegLimit(
  state: EventState,
  pool: PoolDef,
  poolPath: NodePath,
  round: number,
  plans: readonly PairingPlan[],
): number | undefined {
  if (pool.legRelease !== "lockstep" || pool.encounter.kind !== "series")
    return undefined;
  let minResolved = Number.POSITIVE_INFINITY;
  plans.forEach((plan, index) => {
    if (plan.kind === "bye") return;
    const node = evalPair(state, pool, poolPath, round, index, plan);
    const resolved = node.children.filter(
      (leg) => leg.outcome.decision.kind !== "pending",
    ).length;
    minResolved = Math.min(minResolved, resolved);
  });
  return Number.isFinite(minResolved) ? minResolved + 1 : undefined;
}

function collectEncounterActions(
  state: EventState,
  node: EvalNode,
  competitors: readonly [CompetitorId, CompetitorId],
  participants: readonly [ParticipantId, ParticipantId] | undefined,
  legLimit: number | undefined,
  actions: Action[],
): void {
  if (state.forfeits.has(node.ctx.path)) return;
  if (node.needsManual) {
    actions.push({
      kind: "awaitManualDecision",
      node: node.ctx.path,
      between: competitors,
    });
    return;
  }
  if (node.outcome.decision.kind !== "pending") return;

  const def = node.ctx.def;
  switch (def.kind) {
    case "game": {
      if (state.results.has(node.ctx.path)) return;
      const seat = node.ctx.whiteSeat;
      if (seat === undefined || participants === undefined) return;
      actions.push({
        kind: "createGame",
        game: {
          path: node.ctx.path,
          white: participants[seat],
          black: participants[otherSide(seat)],
          clock: def.clock,
        },
      });
      return;
    }
    case "series": {
      node.children.forEach((child, index) => {
        if (legLimit !== undefined && index >= legLimit) return;
        if (def.colors === "redraw" && child.ctx.whiteSeat === undefined) {
          actions.push({
            kind: "awaitColorDraw",
            node: child.ctx.path,
            between: competitors,
          });
          return;
        }
        collectEncounterActions(
          state,
          child,
          competitors,
          participants,
          undefined,
          actions,
        );
      });
      return;
    }
    case "match": {
      const lineups: (readonly PlayerId[] | undefined)[] = (
        [0, 1] as const
      ).map((side) => state.lineups.get(lineupKey(node.ctx.path, side)));
      ([0, 1] as const).forEach((side) => {
        if (lineups[side] === undefined) {
          actions.push({
            kind: "awaitLineup",
            match: node.ctx.path,
            side,
            competitor: competitors[side],
            boards: def.boards,
          });
        }
      });
      const [lineup0, lineup1] = lineups;
      if (lineup0 === undefined || lineup1 === undefined) return;
      node.children.forEach((board, index) => {
        const p0 = lineup0[index];
        const p1 = lineup1[index];
        if (p0 === undefined || p1 === undefined) return;
        collectEncounterActions(
          state,
          board,
          competitors,
          [p0, p1],
          undefined,
          actions,
        );
      });
      return;
    }
  }
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
    const plans = state.pairings.get(pairingsKey(ref.path, r));
    if (plans !== undefined) playedRounds.set(r, plans);
  }
  const rows = poolStandings(
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
    options: pool.pairing,
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

/** Run the pool's pairing system against the currently awaited round. */
export function proposePairings(
  state: EventState,
  poolPath: NodePath,
  systems = pairingSystems,
): ProposeResult {
  const awaiting = nextActions(state).find(
    (action): action is Extract<Action, { kind: "awaitPairings" }> =>
      action.kind === "awaitPairings" && action.pool === poolPath,
  );
  if (awaiting === undefined) {
    return { ok: false, error: `${poolPath} is not awaiting pairings` };
  }
  const system = systems[awaiting.context.options.system];
  const result = system(awaiting.context);
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

/** Outcome at a materialized node. Throws when the path doesn't resolve (reads are strict; the input fold is not). */
export function outcomeAt(state: EventState, path: NodePath): Outcome {
  const resolved = resolveEncounterNode(state, path);
  if (!resolved.ok) throw new Error(resolved.reason);
  return resolved.node.outcome;
}

/** Live standings of a pool group. Throws when the path is not a ready pool (reads are strict; the input fold is not). */
export function standingsOf(
  state: EventState,
  poolPath: NodePath,
): readonly StandingsRow[] {
  const segments = pathSegments(poolPath);
  const [stageSeg, groupSeg] = segments;
  if (
    segments.length !== 2 ||
    stageSeg?.kind !== "stage" ||
    groupSeg?.kind !== "group"
  ) {
    throw new Error(`standings address a pool group, not ${poolPath}`);
  }
  const ref = findGroup(state.def, stageSeg.id, groupSeg.id);
  if (ref === undefined)
    throw new Error(`unknown group ${stageSeg.id}/${groupSeg.id}`);
  if (ref.group.run.kind !== "pool")
    throw new Error(`${poolPath} is not a pool`);
  const entrants = resolveEntrants(state, ref);
  if (entrants === undefined)
    throw new Error(`${poolPath} is waiting on an earlier stage`);
  const total = poolTotalRounds(ref.group.run, entrants.length);
  return poolStandings(
    state,
    ref.group.run,
    ref.path,
    entrants,
    poolRounds(state, ref.path, total),
    total,
  );
}
