import {
  type CompetitorDef,
  type GameResultCode,
  type Input,
  type NodePath,
  type Outcome,
  type PairingPlan,
  type ParticipantId,
  pathSegments,
} from "./core";
import {
  type Action,
  allLeaves,
  type EventState,
  materialize,
  nextActions,
  outcomeAt,
  pairingsAt,
  proposePairings,
  type ScheduledGame,
  standingsOf,
} from "./engine";
import { isPool, type ModelRegistry, type ParsedEventDef } from "./registry";
import type { StandingsRow } from "./standings";

/**
 * Fluent test driver mirroring the ergonomics of the old Python
 * TournamentBuilder: scripts inputs by competitor/player NAME, materializes
 * eagerly, and throws immediately when the engine rejects an input — a test
 * should never silently lose a move. Assertions throw with the offending
 * row spelled out.
 */

export class EventRun {
  readonly def: ParsedEventDef;
  readonly registry: ModelRegistry;
  private readonly log: Input[] = [];
  private cache:
    | { readonly length: number; readonly state: EventState }
    | undefined;

  constructor(def: ParsedEventDef, registry: ModelRegistry) {
    this.def = def;
    this.registry = registry;
  }

  state(): EventState {
    if (this.cache === undefined || this.cache.length !== this.log.length) {
      this.cache = {
        length: this.log.length,
        state: materialize(this.def, this.log, this.registry),
      };
    }
    return this.cache.state;
  }

  actions(): readonly Action[] {
    return nextActions(this.state());
  }

  scheduled(): readonly ScheduledGame[] {
    return this.actions()
      .filter(
        (a): a is Extract<Action, { kind: "createGame" }> =>
          a.kind === "createGame",
      )
      .map((a) => a.game);
  }

  submit(input: Input): this {
    // Compare error counts, not just the last index: a correction can
    // retroactively orphan an EARLIER pairing input, and a test should
    // never silently lose a move.
    const before = this.state().errors.length;
    this.log.push(input);
    const state = this.state();
    const fresh = state.errors.slice(before);
    if (fresh.length > 0) {
      throw new Error(
        fresh
          .map(
            (e) => `input ${e.index} (${e.input.kind}) rejected: ${e.reason}`,
          )
          .join("; "),
      );
    }
    return this;
  }

  // -------------------------------------------------------------------------
  // Name resolution

  private competitor(name: string): CompetitorDef {
    const found = this.def.competitors.find(
      (c) => c.name === name || c.id === name,
    );
    if (found === undefined) throw new Error(`no competitor named ${name}`);
    return found;
  }

  /** A name may be a competitor (individual events) or a roster player id. */
  private participant(name: string): ParticipantId {
    const competitor = this.def.competitors.find(
      (c) => c.name === name || c.id === name,
    );
    if (competitor !== undefined) return competitor.id;
    for (const c of this.def.competitors) {
      const player = c.roster?.find((p) => p === name);
      if (player !== undefined) return player;
    }
    throw new Error(`no competitor or roster player named ${name}`);
  }

  private solePoolPath(): NodePath {
    const pools = allLeaves(this.def)
      .filter((ref) => isPool(ref.run))
      .map((ref) => ref.path);
    const sole = pools[0];
    if (sole === undefined) throw new Error("event has no pool");
    if (pools.length > 1) {
      throw new Error(
        `event has ${pools.length} pools; pass a pool path explicitly`,
      );
    }
    return sole;
  }

  // -------------------------------------------------------------------------
  // Scripting

  /** Accept the proposer's pairings for the round the pool is waiting on. */
  pairRound(poolPath?: NodePath): this {
    const pool = poolPath ?? this.solePoolPath();
    const proposed = proposePairings(this.state(), pool);
    if (!proposed.ok)
      throw new Error(`pairing ${pool} failed: ${proposed.error}`);
    return this.submit(proposed.input);
  }

  /** Record arbiter-authored pairings (first unpaired round). Pairs are [white-seat name, other name]. */
  pairManual(
    pairs: readonly (readonly [string, string])[],
    options?: { readonly byes?: readonly string[]; readonly pool?: NodePath },
  ): this {
    const pool = options?.pool ?? this.solePoolPath();
    let round = 1;
    while (pairingsAt(this.state(), pool, round) !== undefined) round += 1;
    return this.submit({
      kind: "pairingsSet",
      pool,
      round,
      pairings: [
        ...pairs.map(
          ([white, other]): PairingPlan => ({
            kind: "pair",
            a: this.competitor(white).id,
            b: this.competitor(other).id,
            whiteSeat: 0,
          }),
        ),
        ...(options?.byes ?? []).map(
          (name): PairingPlan => ({
            kind: "bye",
            competitor: this.competitor(name).id,
          }),
        ),
      ],
    });
  }

  /** Submit a lineup for the team's first (path-ordered) match awaiting one. */
  lineup(teamName: string, players: readonly string[]): this {
    const team = this.competitor(teamName);
    const awaiting = this.actions()
      .filter(
        (a): a is Extract<Action, { kind: "awaitLineup" }> =>
          a.kind === "awaitLineup" && a.competitor === team.id,
      )
      .sort((x, y) => x.match.localeCompare(y.match, "en", { numeric: true }));
    const first = awaiting[0];
    if (first === undefined) {
      throw new Error(`${teamName} is not awaiting a lineup`);
    }
    return this.submit({
      kind: "lineupSet",
      match: first.match,
      side: first.side,
      players: players.map((p) => {
        const id = team.roster?.find((r) => r === p);
        if (id === undefined)
          throw new Error(`${p} is not on ${teamName}'s roster`);
        return id;
      }),
    });
  }

  /** Record a result by the two participants' names (white first). */
  game(white: string, black: string, result: GameResultCode): this {
    const whiteId = this.participant(white);
    const blackId = this.participant(black);
    const game = this.scheduled().find(
      (g) => g.white === whiteId && g.black === blackId,
    );
    if (game === undefined) {
      const open = this.scheduled()
        .map((g) => `${g.white} vs ${g.black}`)
        .join(", ");
      throw new Error(
        `no scheduled game ${white} (white) vs ${black}; open: [${open}]`,
      );
    }
    return this.submit({ kind: "gameResult", game: game.path, result });
  }

  /**
   * Record a team match by board order. Results are white-relative codes for
   * each board's game — remember board colors zigzag.
   */
  match(
    teamA: string,
    teamB: string,
    ...results: readonly GameResultCode[]
  ): this {
    const a = this.competitor(teamA);
    const b = this.competitor(teamB);
    const rosterA = new Set<string>(a.roster ?? []);
    const rosterB = new Set<string>(b.roster ?? []);

    const byMatch = new Map<string, ScheduledGame[]>();
    for (const g of this.scheduled()) {
      const players = [g.white, g.black];
      const isOurs =
        players.some((p) => rosterA.has(p)) &&
        players.some((p) => rosterB.has(p));
      if (!isOurs) continue;
      const segments = pathSegments(g.path);
      const last = segments[segments.length - 1];
      if (last?.kind !== "child" || last.label !== "board") continue;
      const matchPath = g.path.split("/").slice(0, -1).join("/");
      const list = byMatch.get(matchPath) ?? [];
      list.push(g);
      byMatch.set(matchPath, list);
    }
    const matchPath = [...byMatch.keys()].sort((x, y) =>
      x.localeCompare(y, "en", { numeric: true }),
    )[0];
    if (matchPath === undefined) {
      throw new Error(`no scheduled match between ${teamA} and ${teamB}`);
    }
    const games = byMatch.get(matchPath) ?? [];
    if (games.length !== results.length) {
      throw new Error(
        `${teamA} vs ${teamB} has ${games.length} open boards, got ${results.length} results`,
      );
    }
    const sorted = [...games].sort((x, y) =>
      x.path.localeCompare(y.path, "en", { numeric: true }),
    );
    sorted.forEach((g, i) => {
      const result = results[i];
      if (result !== undefined)
        this.submit({ kind: "gameResult", game: g.path, result });
    });
    return this;
  }

  /** Resolve the pending arbiter tiebreak in favor of the named competitor. */
  decide(winnerName: string): this {
    const winner = this.competitor(winnerName).id;
    const awaiting = this.actions().find(
      (a): a is Extract<Action, { kind: "awaitManualDecision" }> =>
        a.kind === "awaitManualDecision" && a.between.includes(winner),
    );
    if (awaiting === undefined) {
      throw new Error(`no manual decision awaiting ${winnerName}`);
    }
    return this.submit({
      kind: "manualDecision",
      node: awaiting.node,
      winner: awaiting.between[0] === winner ? 0 : 1,
    });
  }

  /** Resolve the pending color draw, giving the named side the white seat. */
  drawColors(whiteName: string): this {
    const white = this.competitor(whiteName).id;
    const awaiting = this.actions().find(
      (a): a is Extract<Action, { kind: "awaitColorDraw" }> =>
        a.kind === "awaitColorDraw" && a.between.includes(white),
    );
    if (awaiting === undefined) {
      throw new Error(`no color draw awaiting ${whiteName}`);
    }
    return this.submit({
      kind: "colorDraw",
      node: awaiting.node,
      whiteSeat: awaiting.between[0] === white ? 0 : 1,
    });
  }

  // -------------------------------------------------------------------------
  // Reads

  standings(poolPath?: NodePath): readonly StandingsRow[] {
    return standingsOf(this.state(), poolPath ?? this.solePoolPath());
  }

  outcome(path: NodePath): Outcome {
    return outcomeAt(this.state(), path);
  }

  winnerName(): string | undefined {
    const done = this.actions().find(
      (a): a is Extract<Action, { kind: "eventComplete" }> =>
        a.kind === "eventComplete",
    );
    if (done?.winner === undefined) return undefined;
    return this.def.competitors.find((c) => c.id === done.winner)?.name;
  }
}

export const runEvent = (
  def: ParsedEventDef,
  registry: ModelRegistry,
): EventRun => new EventRun(def, registry);

// ---------------------------------------------------------------------------
// Assertions

export function expectStandings(
  run: EventRun,
  poolPath?: NodePath,
): StandingsExpect {
  return new StandingsExpect(run, run.standings(poolPath));
}

class StandingsExpect {
  constructor(
    private readonly run: EventRun,
    private readonly rows: readonly StandingsRow[],
  ) {}

  competitor(name: string): RowExpect {
    const competitor = this.run.def.competitors.find(
      (c) => c.name === name || c.id === name,
    );
    if (competitor === undefined)
      throw new Error(`no competitor named ${name}`);
    const row = this.rows.find((r) => r.competitor === competitor.id);
    if (row === undefined) throw new Error(`${name} has no standings row`);
    return new RowExpect(name, row);
  }
}

class RowExpect {
  constructor(
    private readonly name: string,
    private readonly row: StandingsRow,
  ) {}

  private check(field: string, actual: number, expected: number): this {
    if (actual !== expected) {
      throw new Error(
        `${this.name}: expected ${field} ${expected}, got ${actual} ` +
          `(row: points=${this.row.standingsPoints} encounter=${this.row.encounterPoints} ` +
          `rank=${this.row.rank} metrics=${JSON.stringify([...this.row.metrics])})`,
      );
    }
    return this;
  }

  points(expected: number): this {
    return this.check("standings points", this.row.standingsPoints, expected);
  }

  encounterPoints(expected: number): this {
    return this.check("encounter points", this.row.encounterPoints, expected);
  }

  rank(expected: number): this {
    return this.check("rank", this.row.rank, expected);
  }

  metric(label: string, expected: number): this {
    const actual = this.row.metrics.get(label);
    if (actual === undefined) {
      throw new Error(
        `${this.name}: no metric ${label}; have [${[...this.row.metrics.keys()].join(", ")}]`,
      );
    }
    return this.check(label, actual, expected);
  }
}
