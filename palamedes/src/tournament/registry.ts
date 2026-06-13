import { z } from "zod";
import {
  type AnyEncounterDef,
  type ByeRule,
  type Color,
  type CompetitionDef,
  type CompetitionsDef,
  type CompetitorDef,
  type CompetitorId,
  competitorIdSchema,
  type Decision,
  type EventDef,
  finitePoints,
  idSchema,
  isOpenEntries,
  type MetricRef,
  type NodeView,
  type NodeWork,
  type Outcome,
  type PairingPlan,
  type PairingRef,
  type PoolDef,
  playerIdSchema,
  type RunDef,
  type ScoreRef,
  type SeedRef,
  type Side,
  type Slot,
  type TieRef,
} from "./core";

/**
 * The typeclass layer. A tournament model is `core.ts` (the laws) plus a
 * ModelRegistry of instances: encounter kinds, pairing systems, scoring
 * rules, tiebreak metrics, tie rules, and seed sources. Adding a new kind of
 * anything is one `defineX(...)` value passed to `buildRegistry` /
 * `extendRegistry` — no engine changes, no closed unions to reopen.
 *
 * Authors write instances against their own payload type `D`. The registry
 * stores an erased interface whose methods accept the raw def and decode it
 * through the instance's own zod schema, memoized per def object (defs are
 * immutable data, so this is a one-time parse — never a cast).
 *
 * Instances must be pure: the engine re-invokes nextSlot/outcome/work/
 * points/value/resolve/propose freely and memoizes decodes, so every
 * instance method must be a deterministic function of its arguments — no
 * IO, no randomness, no retained views.
 */

// ---------------------------------------------------------------------------
// Shared contract types

export type SlotOutcome = {
  readonly slot: Slot;
  readonly outcome: Outcome;
};

export type CardInfo = {
  readonly title: string;
  readonly badge?: string | undefined;
  readonly lines: readonly string[];
};

export type StructureChild = {
  readonly def: AnyEncounterDef;
  /** Display label for the relationship (e.g. "board 1", "leg 2"). */
  readonly role: string;
  /** This child stands for N identical siblings. */
  readonly count?: number | undefined;
  /** How this child derives its white-ish seat from the parent. */
  readonly seat?: "keep" | "flip" | "draw" | undefined;
  /**
   * This child plays only conditionally: `when` is the condition that
   * continues here ("still tied?"), `otherwise` the exit taken instead
   * ("winner decided"). Stop rules surface through this.
   */
  readonly gate?:
    | { readonly when: string; readonly otherwise: string }
    | undefined;
};

export type Issue = (
  message: string,
  path?: readonly (string | number)[],
) => void;

/** How a kind's children relate: in time (sequence) or side by side (parallel). */
export type Arrangement = "sequence" | "parallel";

/** One pairing of a round, fed by results of the previous round's pairings. */
export type PairFlow = {
  /** 1-based pairing number in this round. */
  readonly pair: number;
  readonly from: readonly {
    readonly pair: number;
    readonly take: "winner" | "loser";
  }[];
};

/** Registry-bound recursion over encounter children, handed to instances. */
export type EncounterOps = {
  readonly validate: (def: AnyEncounterDef, issue: Issue) => void;
  readonly structure: (def: AnyEncounterDef) => readonly StructureChild[];
  readonly nominalPoints: (def: AnyEncounterDef) => {
    win: number;
    loss: number;
  };
  readonly alwaysDecisive: (def: AnyEncounterDef) => boolean;
  readonly rosterNeed: (def: AnyEncounterDef) => number;
  readonly card: (def: AnyEncounterDef) => CardInfo;
  readonly arrangement: (def: AnyEncounterDef) => Arrangement;
};

export type TieDecision = {
  readonly decision: Decision;
  readonly work?: readonly NodeWork[] | undefined;
};

/** Tie resolution bound to a registry, with the implicit default of `draw`. */
export type BoundTies = {
  decide(
    rule: TieRef | undefined,
    q: { readonly view: NodeView; readonly points: readonly [number, number] },
  ): TieDecision;
  decisive(rule: TieRef | undefined): boolean;
};

// Standings lines are part of the scoring/metric contracts, so they live here.
export type PlayedLine = {
  readonly kind: "played";
  readonly round: number;
  readonly opponent: CompetitorId;
  readonly side: Side;
  /** My color at the encounter level (the "team color" for matches). */
  readonly color: Color;
  readonly outcome: Outcome;
  readonly standingsPoints: number;
  readonly encounterPoints: number;
  readonly opponentEncounterPoints: number;
  readonly gamesWon: number;
  readonly boardPoints: readonly number[];
  /** Decided without play (forfeits, scheduling draws) — what pairing engines mark unplayed. */
  readonly unplayed: boolean;
};

export type RoundLine =
  | PlayedLine
  | {
      readonly kind: "bye";
      readonly round: number;
      readonly standingsPoints: number;
      readonly encounterPoints: number;
    }
  | { readonly kind: "absent"; readonly round: number };

export type MetricRow = {
  readonly competitor: CompetitorId;
  readonly standingsPoints: number;
  readonly encounterPoints: number;
  readonly lines: readonly RoundLine[];
};

// The pairing contract — deliberately carries everything a JavaFo TRF encodes.
export type PairingHistoryEntry =
  | {
      readonly kind: "played";
      readonly opponent: CompetitorId;
      readonly color: Color | undefined;
      readonly points: number;
      readonly unplayed: boolean;
    }
  | { readonly kind: "bye"; readonly points: number }
  | { readonly kind: "absent" };

export type PairingCompetitor = {
  readonly id: CompetitorId;
  /** 1-based position in the group's entry order. */
  readonly seed: number;
  readonly rating: number | undefined;
};

export type PairingContext = {
  readonly round: number;
  readonly totalRounds: number;
  readonly competitors: readonly PairingCompetitor[];
  readonly scores: ReadonlyMap<CompetitorId, number>;
  readonly history: ReadonlyMap<CompetitorId, readonly PairingHistoryEntry[]>;
  readonly previousRound?:
    | {
        readonly pairings: readonly PairingPlan[];
        readonly winners: readonly (CompetitorId | null)[];
      }
    | undefined;
};

export type PairingResult =
  | { readonly ok: true; readonly pairings: readonly PairingPlan[] }
  | { readonly ok: false; readonly error: string };

export type SeedContext = {
  readonly competitors: readonly CompetitorDef[];
  /** Final order of a completed source competition; undefined while unresolved. */
  readonly ranking: (of: string) => readonly CompetitorId[] | undefined;
};

export type SeedValidateContext = {
  readonly competitors: readonly CompetitorDef[];
  /** Field size per LEAF competition id; "open" = registration-bound. */
  readonly sizes: ReadonlyMap<string, number | "open">;
  /** The consuming leaf's id (self-reference and cycle messages). */
  readonly self: string;
};

export type ScoredLineInput = {
  readonly outcome: Outcome;
  readonly side: Side;
};

export type ScoredLine = ScoredLineInput & { readonly points: number };

/** Schemas an encounter kind's own schema may embed. */
export type SchemaDeps = {
  readonly encounter: z.ZodType<AnyEncounterDef>;
  readonly tie: z.ZodType<TieRef>;
};

// ---------------------------------------------------------------------------
// Erased instance interfaces (what the registry stores)

export type BoundEncounterKind = {
  readonly kind: string;
  readonly schema: z.ZodType<unknown>;
  /** Lazy child materialization: the engine asks repeatedly, feeding back resolved outcomes. */
  nextSlot(
    def: AnyEncounterDef,
    view: NodeView,
    resolved: readonly SlotOutcome[],
  ): Slot | undefined;
  /** Aggregate + decide. Returned work is decision-related (e.g. a tie awaiting the arbiter). */
  outcome(
    def: AnyEncounterDef,
    view: NodeView,
    children: readonly SlotOutcome[],
    ties: BoundTies,
  ): { readonly outcome: Outcome; readonly work: readonly NodeWork[] };
  /** Scheduling work at this node (create games, await lineups). */
  work(
    def: AnyEncounterDef,
    view: NodeView,
    children: readonly SlotOutcome[],
  ): readonly NodeWork[];
  validate(def: AnyEncounterDef, ops: EncounterOps, issue: Issue): void;
  structure(def: AnyEncounterDef, ops: EncounterOps): readonly StructureChild[];
  nominalPoints(
    def: AnyEncounterDef,
    ops: EncounterOps,
  ): { win: number; loss: number };
  alwaysDecisive(
    def: AnyEncounterDef,
    ops: EncounterOps,
    ties: BoundTies,
  ): boolean;
  rosterNeed(def: AnyEncounterDef, ops: EncounterOps): number;
  card(def: AnyEncounterDef, ops: EncounterOps): CardInfo;
  /** How this kind's children relate: in time (sequence) or side by side (parallel). */
  arrangement(def: AnyEncounterDef): Arrangement;
};

export type EncounterKind = {
  readonly kind: string;
  bind(deps: SchemaDeps): BoundEncounterKind;
};

export type PairingKind = {
  readonly system: string;
  readonly schema: z.ZodType<unknown>;
  /** Derive the schedule length; absent means defs must declare `rounds`. */
  readonly totalRounds?: (options: PairingRef, entrants: number) => number;
  /**
   * How many pairings a given round produces (eliminative systems shrink);
   * absent means every round pairs the whole field (⌊entrants/2⌋).
   */
  readonly pairsInRound?: (
    options: PairingRef,
    entrants: number,
    round: number,
  ) => number;
  /** Semantic pairing names where the system has them ("final", "bronze final"). */
  readonly pairLabels?: (
    options: PairingRef,
    entrants: number,
    round: number,
  ) => readonly string[] | undefined;
  /** Bracket advancement: how a round's pairings draw on the previous round. */
  readonly flows?: (
    options: PairingRef,
    entrants: number,
    round: number,
  ) => readonly PairFlow[] | undefined;
  /** Eliminative systems rank by survival depth instead of points. */
  readonly progression?: true;
  /** Bye rule applied when the def doesn't configure one. */
  readonly defaultBye?: ByeRule;
  propose(options: PairingRef, ctx: PairingContext): PairingResult;
  /** Design-time checks; `entrants` is undefined for open groups (count checks wait). */
  readonly validate?: (
    options: PairingRef,
    entrants: number | undefined,
    encounter: AnyEncounterDef,
    ops: EncounterOps,
    ties: BoundTies,
    issue: Issue,
  ) => void;
};

export type ScoringKind = {
  readonly kind: string;
  readonly schema: z.ZodType<unknown>;
  /** Standings points for one side of one encounter; `history` enables streak-style rules. */
  points(
    rule: ScoreRef,
    line: ScoredLineInput,
    history: readonly ScoredLine[],
  ): number;
  readonly validate?: (
    rule: ScoreRef,
    encounter: AnyEncounterDef,
    ops: EncounterOps,
    issue: Issue,
  ) => void;
  /** How this rule describes itself (outcome → points mapping, for viewers). */
  readonly card?: (rule: ScoreRef) => CardInfo;
};

export type MetricKind = {
  readonly metric: string;
  readonly schema: z.ZodType<unknown>;
  label(ref: MetricRef): string;
  value(
    ref: MetricRef,
    row: MetricRow,
    all: ReadonlyMap<CompetitorId, MetricRow>,
  ): number;
};

export type TieKind = {
  readonly kind: string;
  readonly schema: z.ZodType<unknown>;
  decide(
    rule: TieRef,
    q: { readonly view: NodeView; readonly points: readonly [number, number] },
  ): TieDecision;
  /** Can this rule always produce a winner? (knockout validation) */
  decisive(rule: TieRef): boolean;
};

/** Where a seed pulls its competitor from, for kinds that carry one. */
export type SeedOrigin = {
  /** The source competition's id. */
  readonly of: string;
  readonly rank?: number | undefined;
};

export type SeedKind = {
  readonly kind: string;
  readonly schema: z.ZodType<unknown>;
  resolve(ref: SeedRef, ctx: SeedContext): CompetitorId | undefined;
  readonly validate?: (
    ref: SeedRef,
    ctx: SeedValidateContext,
    issue: Issue,
  ) => void;
  /** The competitions this seed draws from (intake UI edges, the intake DAG) — possibly several (tour aggregations). */
  readonly origins?: (ref: SeedRef) => readonly SeedOrigin[];
  /** How an aggregating seed describes itself ("Tour standings", the points table). */
  readonly card?: (ref: SeedRef) => CardInfo;
};

// ---------------------------------------------------------------------------
// defineX constructors — typed authoring, erased storage, parse-not-cast

function memoDecode<D>(schema: z.ZodType<D>): (def: object) => D {
  const cache = new WeakMap<object, D>();
  return (def) => {
    const hit = cache.get(def);
    if (hit !== undefined) return hit;
    const decoded = schema.parse(def);
    cache.set(def, decoded);
    return decoded;
  };
}

export type EncounterKindSpec<D> = {
  readonly kind: string;
  readonly schema: (deps: SchemaDeps) => z.ZodType<D>;
  nextSlot(
    def: D,
    view: NodeView,
    resolved: readonly SlotOutcome[],
  ): Slot | undefined;
  outcome(
    def: D,
    view: NodeView,
    children: readonly SlotOutcome[],
    ties: BoundTies,
  ): { outcome: Outcome; work?: readonly NodeWork[] };
  work?(
    def: D,
    view: NodeView,
    children: readonly SlotOutcome[],
  ): readonly NodeWork[];
  validate?(def: D, ops: EncounterOps, issue: Issue): void;
  structure(def: D, ops: EncounterOps): readonly StructureChild[];
  nominalPoints(def: D, ops: EncounterOps): { win: number; loss: number };
  alwaysDecisive(def: D, ops: EncounterOps, ties: BoundTies): boolean;
  rosterNeed?(def: D, ops: EncounterOps): number;
  card?(def: D, ops: EncounterOps): CardInfo;
  arrangement?(def: D): Arrangement;
};

export function defineEncounterKind<D>(
  spec: EncounterKindSpec<D>,
): EncounterKind {
  return {
    kind: spec.kind,
    bind(deps) {
      const schema = spec.schema(deps);
      const decode = memoDecode(schema);
      return {
        kind: spec.kind,
        schema,
        nextSlot: (def, view, resolved) =>
          spec.nextSlot(decode(def), view, resolved),
        outcome: (def, view, children, ties) => {
          const result = spec.outcome(decode(def), view, children, ties);
          return { outcome: result.outcome, work: result.work ?? [] };
        },
        work: (def, view, children) =>
          spec.work?.(decode(def), view, children) ?? [],
        validate: (def, ops, issue) => spec.validate?.(decode(def), ops, issue),
        structure: (def, ops) => spec.structure(decode(def), ops),
        nominalPoints: (def, ops) => spec.nominalPoints(decode(def), ops),
        alwaysDecisive: (def, ops, ties) =>
          spec.alwaysDecisive(decode(def), ops, ties),
        rosterNeed: (def, ops) => spec.rosterNeed?.(decode(def), ops) ?? 0,
        card: (def, ops) =>
          spec.card?.(decode(def), ops) ?? { title: spec.kind, lines: [] },
        arrangement: (def) => spec.arrangement?.(decode(def)) ?? "sequence",
      };
    },
  };
}

export type PairingKindSpec<O> = {
  readonly system: string;
  readonly schema: z.ZodType<O>;
  readonly progression?: true;
  readonly defaultBye?: ByeRule;
  totalRounds?(options: O, entrants: number): number;
  pairsInRound?(options: O, entrants: number, round: number): number;
  pairLabels?(
    options: O,
    entrants: number,
    round: number,
  ): readonly string[] | undefined;
  flows?(
    options: O,
    entrants: number,
    round: number,
  ): readonly PairFlow[] | undefined;
  propose(options: O, ctx: PairingContext): PairingResult;
  validate?(
    options: O,
    entrants: number | undefined,
    encounter: AnyEncounterDef,
    ops: EncounterOps,
    ties: BoundTies,
    issue: Issue,
  ): void;
};

export function definePairingKind<O>(spec: PairingKindSpec<O>): PairingKind {
  const decode = memoDecode(spec.schema);
  const totalRounds = spec.totalRounds;
  const pairsInRound = spec.pairsInRound;
  const pairLabels = spec.pairLabels;
  const flows = spec.flows;
  const validate = spec.validate;
  return {
    system: spec.system,
    schema: spec.schema,
    ...(spec.progression === undefined
      ? {}
      : { progression: spec.progression }),
    ...(spec.defaultBye === undefined ? {} : { defaultBye: spec.defaultBye }),
    propose: (options, ctx) => spec.propose(decode(options), ctx),
    ...(totalRounds === undefined
      ? {}
      : {
          totalRounds: (options: PairingRef, entrants: number) =>
            totalRounds(decode(options), entrants),
        }),
    ...(pairsInRound === undefined
      ? {}
      : {
          pairsInRound: (
            options: PairingRef,
            entrants: number,
            round: number,
          ) => pairsInRound(decode(options), entrants, round),
        }),
    ...(pairLabels === undefined
      ? {}
      : {
          pairLabels: (options: PairingRef, entrants: number, round: number) =>
            pairLabels(decode(options), entrants, round),
        }),
    ...(flows === undefined
      ? {}
      : {
          flows: (options: PairingRef, entrants: number, round: number) =>
            flows(decode(options), entrants, round),
        }),
    ...(validate === undefined
      ? {}
      : {
          validate: (
            options: PairingRef,
            entrants: number | undefined,
            encounter: AnyEncounterDef,
            ops: EncounterOps,
            ties: BoundTies,
            issue: Issue,
          ) => validate(decode(options), entrants, encounter, ops, ties, issue),
        }),
  };
}

export type ScoringKindSpec<R> = {
  readonly kind: string;
  readonly schema: z.ZodType<R>;
  points(
    rule: R,
    line: ScoredLineInput,
    history: readonly ScoredLine[],
  ): number;
  validate?(
    rule: R,
    encounter: AnyEncounterDef,
    ops: EncounterOps,
    issue: Issue,
  ): void;
  card?(rule: R): CardInfo;
};

export function defineScoringKind<R>(spec: ScoringKindSpec<R>): ScoringKind {
  const decode = memoDecode(spec.schema);
  const validate = spec.validate;
  const cardOf = spec.card;
  return {
    kind: spec.kind,
    schema: spec.schema,
    points: (rule, line, history) => spec.points(decode(rule), line, history),
    ...(validate === undefined
      ? {}
      : {
          validate: (
            rule: ScoreRef,
            encounter: AnyEncounterDef,
            ops: EncounterOps,
            issue: Issue,
          ) => validate(decode(rule), encounter, ops, issue),
        }),
    ...(cardOf === undefined
      ? {}
      : { card: (rule: ScoreRef) => cardOf(decode(rule)) }),
  };
}

export type MetricKindSpec<M> = {
  readonly metric: string;
  readonly schema: z.ZodType<M>;
  label(ref: M): string;
  value(
    ref: M,
    row: MetricRow,
    all: ReadonlyMap<CompetitorId, MetricRow>,
  ): number;
};

export function defineMetricKind<M>(spec: MetricKindSpec<M>): MetricKind {
  const decode = memoDecode(spec.schema);
  return {
    metric: spec.metric,
    schema: spec.schema,
    label: (ref) => spec.label(decode(ref)),
    value: (ref, row, all) => spec.value(decode(ref), row, all),
  };
}

export type TieKindSpec<T> = {
  readonly kind: string;
  readonly schema: z.ZodType<T>;
  decide(
    rule: T,
    q: { readonly view: NodeView; readonly points: readonly [number, number] },
  ): TieDecision;
  decisive(rule: T): boolean;
};

export function defineTieKind<T>(spec: TieKindSpec<T>): TieKind {
  const decode = memoDecode(spec.schema);
  return {
    kind: spec.kind,
    schema: spec.schema,
    decide: (rule, q) => spec.decide(decode(rule), q),
    decisive: (rule) => spec.decisive(decode(rule)),
  };
}

export type SeedKindSpec<S> = {
  readonly kind: string;
  readonly schema: z.ZodType<S>;
  resolve(ref: S, ctx: SeedContext): CompetitorId | undefined;
  validate?(ref: S, ctx: SeedValidateContext, issue: Issue): void;
  origins?(ref: S): readonly SeedOrigin[];
  card?(ref: S): CardInfo;
};

export function defineSeedKind<S>(spec: SeedKindSpec<S>): SeedKind {
  const decode = memoDecode(spec.schema);
  const validate = spec.validate;
  const origins = spec.origins;
  const cardOf = spec.card;
  return {
    kind: spec.kind,
    schema: spec.schema,
    resolve: (ref, ctx) => spec.resolve(decode(ref), ctx),
    ...(validate === undefined
      ? {}
      : {
          validate: (ref: SeedRef, ctx: SeedValidateContext, issue: Issue) =>
            validate(decode(ref), ctx, issue),
        }),
    ...(origins === undefined
      ? {}
      : { origins: (ref: SeedRef) => origins(decode(ref)) }),
    ...(cardOf === undefined
      ? {}
      : { card: (ref: SeedRef) => cardOf(decode(ref)) }),
  };
}

// ---------------------------------------------------------------------------
// The registry: instances assembled, recursive schemas built, ops bound

export type RegistrySpec = {
  readonly encounters: readonly EncounterKind[];
  readonly pairings: readonly PairingKind[];
  readonly scorings: readonly ScoringKind[];
  readonly metrics: readonly MetricKind[];
  readonly ties: readonly TieKind[];
  readonly seeds: readonly SeedKind[];
};

export type ModelRegistry = {
  readonly spec: RegistrySpec;
  readonly encounters: ReadonlyMap<string, BoundEncounterKind>;
  readonly pairings: ReadonlyMap<string, PairingKind>;
  readonly scorings: ReadonlyMap<string, ScoringKind>;
  readonly metrics: ReadonlyMap<string, MetricKind>;
  readonly ties: BoundTies;
  readonly seeds: ReadonlyMap<string, SeedKind>;
  readonly encounterSchema: z.ZodType<AnyEncounterDef>;
  readonly ops: EncounterOps;
  readonly eventSchema: z.ZodType<EventDef>;
};

function byKey<T>(
  items: readonly T[],
  key: (item: T) => string,
  what: string,
): Map<string, T> {
  const map = new Map<string, T>();
  for (const item of items) {
    if (map.has(key(item))) throw new Error(`duplicate ${what}: ${key(item)}`);
    map.set(key(item), item);
  }
  return map;
}

/** Extend a registry with additional instances. */
export function extendRegistry(
  base: ModelRegistry,
  extra: Partial<RegistrySpec>,
): ModelRegistry {
  return buildRegistry({
    encounters: [...base.spec.encounters, ...(extra.encounters ?? [])],
    pairings: [...base.spec.pairings, ...(extra.pairings ?? [])],
    scorings: [...base.spec.scorings, ...(extra.scorings ?? [])],
    metrics: [...base.spec.metrics, ...(extra.metrics ?? [])],
    ties: [...base.spec.ties, ...(extra.ties ?? [])],
    seeds: [...base.spec.seeds, ...(extra.seeds ?? [])],
  });
}

export function buildRegistry(spec: RegistrySpec): ModelRegistry {
  const tieMap = byKey(spec.ties, (t) => t.kind, "tie kind");

  const tieSchema: z.ZodType<TieRef> = z
    .looseObject({ kind: z.string() })
    .superRefine((ref, ctx) => {
      const kind = tieMap.get(ref.kind);
      if (kind === undefined) {
        ctx.addIssue({
          code: "custom",
          message: `unknown tie rule "${ref.kind}" (registered: ${[...tieMap.keys()].join(", ")})`,
        });
        return;
      }
      relayIssues(kind.schema.safeParse(ref), ctx);
    });

  // The recursive encounter schema: kind schemas may embed children, which
  // are validated by this very union — z.lazy + a mutable map break the cycle.
  const bound = new Map<string, BoundEncounterKind>();
  const encounterSchema: z.ZodType<AnyEncounterDef> = z.lazy(() =>
    z.looseObject({ kind: z.string() }).superRefine((def, ctx) => {
      const kind = bound.get(def.kind);
      if (kind === undefined) {
        ctx.addIssue({
          code: "custom",
          message: `unknown encounter kind "${def.kind}" (registered: ${[...bound.keys()].join(", ")})`,
        });
        return;
      }
      relayIssues(kind.schema.safeParse(def), ctx);
    }),
  );

  const deps: SchemaDeps = { encounter: encounterSchema, tie: tieSchema };
  for (const kind of spec.encounters) {
    if (kind.kind === "pool" || kind.kind === "competitions")
      throw new Error(`"${kind.kind}" is reserved for the spine`);
    if (bound.has(kind.kind))
      throw new Error(`duplicate encounter kind: ${kind.kind}`);
    bound.set(kind.kind, kind.bind(deps));
  }

  const ties: BoundTies = {
    decide: (rule, q) => requireTie(tieMap, rule).decideWith(q),
    decisive: (rule) => requireTie(tieMap, rule).decisiveNow(),
  };

  const opFor = (def: AnyEncounterDef): BoundEncounterKind => {
    const kind = bound.get(def.kind);
    if (kind === undefined)
      throw new Error(`unknown encounter kind "${def.kind}"`);
    return kind;
  };
  const ops: EncounterOps = {
    validate: (def, issue) => opFor(def).validate(def, ops, issue),
    structure: (def) => opFor(def).structure(def, ops),
    nominalPoints: (def) => opFor(def).nominalPoints(def, ops),
    alwaysDecisive: (def) => opFor(def).alwaysDecisive(def, ops, ties),
    rosterNeed: (def) => opFor(def).rosterNeed(def, ops),
    card: (def) => opFor(def).card(def, ops),
    arrangement: (def) => opFor(def).arrangement(def),
  };

  const core = {
    spec,
    encounters: bound,
    pairings: byKey(spec.pairings, (p) => p.system, "pairing system"),
    scorings: byKey(spec.scorings, (s) => s.kind, "scoring kind"),
    metrics: byKey(spec.metrics, (m) => m.metric, "metric"),
    ties,
    seeds: byKey(spec.seeds, (s) => s.kind, "seed kind"),
    encounterSchema,
    ops,
  };
  return { ...core, eventSchema: buildEventSchema(core) };
}

function requireTie(
  map: ReadonlyMap<string, TieKind>,
  rule: TieRef | undefined,
): {
  decideWith: (q: {
    readonly view: NodeView;
    readonly points: readonly [number, number];
  }) => TieDecision;
  decisiveNow: () => boolean;
} {
  const ref = rule ?? { kind: "draw" };
  const kind = map.get(ref.kind);
  if (kind === undefined) {
    // Unreachable for parsed defs (tieSchema rejects unknown kinds at parse).
    throw new Error(`unknown tie rule "${ref.kind}"`);
  }
  return {
    decideWith: (q) => kind.decide(ref, q),
    decisiveNow: () => kind.decisive(ref),
  };
}

type IssueSink = {
  addIssue(issue: {
    code: "custom";
    message: string;
    path?: (string | number)[];
  }): void;
};

function relayIssues(
  parsed: { success: true } | { success: false; error: z.ZodError },
  ctx: IssueSink,
): void {
  if (parsed.success) return;
  for (const issue of parsed.error.issues) {
    ctx.addIssue({
      code: "custom",
      message: issue.message,
      path: [...issue.path.map((p) => (typeof p === "symbol" ? String(p) : p))],
    });
  }
}

// ---------------------------------------------------------------------------
// Event schema + spine validation (kinds validate their own payloads)

const byeRuleSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("points"),
    standings: finitePoints,
    encounter: finitePoints,
  }),
  z.object({ kind: z.literal("advance") }),
]);

export const isPool = (run: RunDef): run is PoolDef => run.kind === "pool";

export const isContainer = (run: RunDef): run is CompetitionsDef =>
  run.kind === "competitions";

type RegistryCore = Omit<ModelRegistry, "eventSchema">;

function buildEventSchema(registry: RegistryCore): z.ZodType<EventDef> {
  const poolSchema = z.object({
    kind: z.literal("pool"),
    pairing: z.looseObject({ system: z.string() }),
    rounds: z.number().int().min(1).optional(),
    encounter: registry.encounterSchema,
    score: z.looseObject({ kind: z.string() }),
    bye: byeRuleSchema.optional(),
    legRelease: z.enum(["independent", "lockstep"]).optional(),
    tiebreaks: z.array(z.looseObject({ metric: z.string() })),
    terms: z
      .object({
        round: z.string().min(1).optional(),
        pairing: z.string().min(1).optional(),
      })
      .optional(),
  });

  // Dispatch `run` on its discriminant so a malformed pool reports POOL
  // issues at pool paths — an undiscriminated union would surface whichever
  // branch failed last ("unknown encounter kind pool" for a pool typo).
  const runSchema: z.ZodType<RunDef> = z
    .looseObject({ kind: z.string() })
    .superRefine((run, ctx) => {
      if (run.kind === "pool") {
        relayIssues(poolSchema.safeParse(run), ctx);
      } else if (run.kind === "competitions") {
        relayIssues(competitionsSchema.safeParse(run), ctx);
      } else {
        relayIssues(registry.encounterSchema.safeParse(run), ctx);
      }
    });

  // The recursive spine schema: a competition's run may hold competitions,
  // which hold runs — z.lazy breaks the cycle.
  const competitionSchema: z.ZodType<CompetitionDef> = z.lazy(() =>
    z.object({
      id: idSchema,
      name: z.string().min(1).optional(),
      entries: z
        .union([
          z.array(z.looseObject({ kind: z.string() })).min(1),
          z.object({ open: z.literal(true) }),
        ])
        .optional(),
      run: runSchema,
    }),
  );

  const competitionsSchema = z.object({
    kind: z.literal("competitions"),
    competitions: z.array(competitionSchema).min(1),
  });

  const schema: z.ZodType<EventDef> = z
    .object({
      id: idSchema,
      name: z.string().min(1),
      // May be empty: open events declare no competitors until registration.
      competitors: z.array(
        z.object({
          id: competitorIdSchema,
          name: z.string().min(1),
          rating: z.number().int().positive().optional(),
          roster: z.array(playerIdSchema).min(1).optional(),
        }),
      ),
      competition: competitionSchema,
    })
    .superRefine((event, ctx) => {
      for (const f of validateEvent(event, registry)) {
        ctx.addIssue({ code: "custom", message: f.message, path: [...f.path] });
      }
    });
  return schema;
}

type Found = {
  readonly message: string;
  readonly path: readonly (string | number)[];
};

type CompetitionAt = {
  readonly comp: CompetitionDef;
  /** The zod issue path of this node within the event. */
  readonly path: readonly (string | number)[];
};

/** A leaf during validation: run narrowed, entries still possibly absent. */
type LeafAt = CompetitionAt & {
  readonly run: PoolDef | AnyEncounterDef;
};

/** Relay a failed kind-schema parse into the event's issue list. */
function relayParseIssues(
  issue: Issue,
  error: z.ZodError,
  base: readonly (string | number)[] = [],
): void {
  for (const zi of error.issues) {
    issue(zi.message, [...base, ...zi.path.map(String)]);
  }
}

function* walkCompetitions(
  comp: CompetitionDef,
  base: readonly (string | number)[],
): Generator<CompetitionAt> {
  yield { comp, path: base };
  if (isContainer(comp.run)) {
    let i = 0;
    for (const child of comp.run.competitions) {
      yield* walkCompetitions(child, [...base, "run", "competitions", i]);
      i += 1;
    }
  }
}

function validateEvent(
  event: EventDef,
  registry: RegistryCore,
): readonly Found[] {
  // Runs inside the event schema's superRefine: zod reaches it only after
  // the structural parse succeeded, so the spine's required fields exist.
  const found: Found[] = [];
  const issueAt =
    (base: readonly (string | number)[]): Issue =>
    (message, path = []) =>
      found.push({ message, path: [...base, ...path] });

  const ids = new Set<string>();
  const names = new Set<string>();
  const players = new Set<string>();
  event.competitors.forEach((competitor, i) => {
    if (ids.has(competitor.id))
      found.push({
        message: `duplicate competitor id ${competitor.id}`,
        path: ["competitors", i, "id"],
      });
    ids.add(competitor.id);
    if (names.has(competitor.name))
      found.push({
        message: `duplicate competitor name ${competitor.name}`,
        path: ["competitors", i, "name"],
      });
    names.add(competitor.name);
    competitor.roster?.forEach((player, j) => {
      if (players.has(player))
        found.push({
          message: `player ${player} appears in more than one roster`,
          path: ["competitors", i, "roster", j],
        });
      players.add(player);
    });
  });

  const all = [...walkCompetitions(event.competition, ["competition"])];

  // Containers and leaves share one namespace (seeds reference by bare id)
  // — see "Node paths" in core.ts.
  const compIds = new Set<string>();
  for (const { comp, path } of all) {
    if (compIds.has(comp.id))
      found.push({
        message: `duplicate competition id ${comp.id}`,
        path: [...path, "id"],
      });
    compIds.add(comp.id);
  }

  // Leaves intake; containers don't. The sizes table seeds validate against
  // covers every leaf.
  const sizes = new Map<string, number | "open">();
  const leaves: LeafAt[] = [];
  for (const at of all) {
    if (isContainer(at.comp.run)) {
      if (at.comp.entries !== undefined) {
        found.push({
          message: `container ${at.comp.id} cannot have entries; its competitions intake their own`,
          path: [...at.path, "entries"],
        });
      }
      continue;
    }
    leaves.push({ comp: at.comp, run: at.comp.run, path: at.path });
    const entries = at.comp.entries;
    if (entries === undefined) {
      found.push({
        message: `competition ${at.comp.id} needs entries: a seed list or { open: true }`,
        path: [...at.path, "entries"],
      });
      continue;
    }
    sizes.set(at.comp.id, isOpenEntries(entries) ? "open" : entries.length);
  }

  for (const { comp, run, path } of leaves) {
    const entries = comp.entries;

    if (entries !== undefined && !isOpenEntries(entries)) {
      // One seed cannot fill two slots: structurally identical refs always
      // resolve to the same competitor, so the field would repeat them.
      const seenRefs = new Map<string, number>();
      entries.forEach((entry, ei) => {
        const key = JSON.stringify(entry);
        const firstIndex = seenRefs.get(key);
        if (firstIndex !== undefined) {
          found.push({
            message: `entry ${ei} repeats entry ${firstIndex}; one seed cannot fill two slots`,
            path: [...path, "entries", ei],
          });
        } else {
          seenRefs.set(key, ei);
        }
      });

      entries.forEach((entry, ei) => {
        const seedKind = registry.seeds.get(entry.kind);
        if (seedKind === undefined) {
          found.push({
            message: `unknown seed kind "${entry.kind}" (registered: ${[...registry.seeds.keys()].join(", ")})`,
            path: [...path, "entries", ei],
          });
          return;
        }
        const parsed = seedKind.schema.safeParse(entry);
        if (!parsed.success) {
          relayParseIssues(issueAt([...path, "entries", ei]), parsed.error);
          return;
        }
        seedKind.validate?.(
          entry,
          { competitors: event.competitors, sizes, self: comp.id },
          issueAt([...path, "entries", ei]),
        );
      });
    }

    const encounter = isPool(run) ? run.encounter : run;
    if (
      !isPool(run) &&
      (entries === undefined || isOpenEntries(entries) || entries.length !== 2)
    ) {
      found.push({
        message: `a root encounter needs exactly 2 entries; ${comp.id} ${entries === undefined || isOpenEntries(entries) ? "is open" : `has ${entries.length}`}`,
        path: [...path, "entries"],
      });
    }
    // Recursing into ops decodes payloads through THROWING parses, so gate
    // on the payload actually validating — kind registration alone is not
    // enough (the schema layer reported the issues; we must not re-trip them).
    const known =
      registry.encounters.has(encounter.kind) &&
      registry.encounterSchema.safeParse(encounter).success;
    if (known) {
      registry.ops.validate(encounter, issueAt([...path, "run"]));
    }
    if (isPool(run)) {
      validatePoolDef(
        run,
        entries === undefined || isOpenEntries(entries)
          ? undefined
          : entries.length,
        registry,
        issueAt([...path, "run"]),
      );
    }

    const need = known ? registry.ops.rosterNeed(encounter) : 0;
    if (need > 0 && entries !== undefined && !isOpenEntries(entries)) {
      entries.forEach((entry, ei) => {
        const seedKind = registry.seeds.get(entry.kind);
        // resolve() also decodes through a throwing parse: only feed it
        // entries the seed pass above proved valid.
        if (
          seedKind === undefined ||
          !seedKind.schema.safeParse(entry).success
        ) {
          return;
        }
        const id = seedKind.resolve(entry, {
          competitors: event.competitors,
          ranking: () => undefined, // runtime-resolved seeds are checked at lineup time
        });
        if (id === undefined) return;
        const competitor = event.competitors.find((c) => c.id === id);
        if (
          competitor !== undefined &&
          (competitor.roster?.length ?? 0) < need
        ) {
          found.push({
            message: `${competitor.name} needs a roster of at least ${need} players for this competition`,
            path: [...path, "entries", ei],
          });
        }
      });
    }
  }

  found.push(...intakeCycleIssues(leaves, registry));
  return found;
}

/**
 * The intake graph (consumer → the sources its seeds draw from) must be a
 * DAG: definition order never constrains references, only actual cycles do.
 */
function intakeCycleIssues(
  leaves: readonly LeafAt[],
  registry: RegistryCore,
): readonly Found[] {
  const sourcesOf = new Map<string, readonly string[]>();
  const entriesPath = new Map<string, readonly (string | number)[]>();
  for (const { comp, path } of leaves) {
    const entries = comp.entries;
    if (entries === undefined || isOpenEntries(entries)) continue;
    const sources = new Set<string>();
    for (const entry of entries) {
      const seedKind = registry.seeds.get(entry.kind);
      if (
        seedKind?.origins === undefined ||
        !seedKind.schema.safeParse(entry).success
      )
        continue;
      for (const origin of seedKind.origins(entry)) sources.add(origin.of);
    }
    sourcesOf.set(comp.id, [...sources]);
    entriesPath.set(comp.id, [...path, "entries"]);
  }

  const found: Found[] = [];
  const reported = new Set<string>();
  const state = new Map<string, "visiting" | "done">();
  // Iterative DFS: an intake chain can be arbitrarily long, and recursing
  // here would risk the very overflow the parse bound exists to prevent.
  const visit = (start: string): void => {
    if (state.has(start)) return;
    type Frame = {
      readonly id: string;
      readonly sources: readonly string[];
      next: number;
    };
    const stack: Frame[] = [
      { id: start, sources: sourcesOf.get(start) ?? [], next: 0 },
    ];
    const onPath: string[] = [start];
    state.set(start, "visiting");
    for (
      let frame = stack[stack.length - 1];
      frame !== undefined;
      frame = stack[stack.length - 1]
    ) {
      if (frame.next >= frame.sources.length) {
        stack.pop();
        onPath.pop();
        state.set(frame.id, "done");
        continue;
      }
      const source = frame.sources[frame.next];
      frame.next += 1;
      if (source === undefined) continue;
      const mark = state.get(source);
      if (mark === "done") continue;
      if (mark === "visiting") {
        const cycle = [...onPath.slice(onPath.indexOf(source)), source];
        const canonical = [...cycle.slice(0, -1)].sort().join("|");
        if (!reported.has(canonical)) {
          reported.add(canonical);
          found.push({
            message: `intake cycle: ${cycle.join(" → ")}`,
            path: entriesPath.get(source) ?? [],
          });
        }
        continue;
      }
      // Sources without entries of their own (open or registration leaves)
      // terminate chains; unknown ids were reported by the seed's validate.
      if (sourcesOf.has(source)) {
        state.set(source, "visiting");
        stack.push({
          id: source,
          sources: sourcesOf.get(source) ?? [],
          next: 0,
        });
        onPath.push(source);
      }
    }
  };
  for (const id of sourcesOf.keys()) visit(id);
  return found;
}

function validatePoolDef(
  pool: PoolDef,
  /** Undefined when the leaf is open: entrant-count checks wait for binding. */
  entrants: number | undefined,
  registry: RegistryCore,
  issue: Issue,
): void {
  // Kind validators recurse into the encounter through throwing decodes:
  // only hand them a payload that actually validates.
  const encounterValid =
    registry.encounters.has(pool.encounter.kind) &&
    registry.encounterSchema.safeParse(pool.encounter).success;

  // Scoring and tiebreaks are checked regardless of the pairing system: an
  // unregistered system is legal (pairings arrive as inputs) and must not
  // waive the rest of the pool's validation.
  const scoring = registry.scorings.get(pool.score.kind);
  if (scoring === undefined) {
    issue(
      `unknown scoring kind "${pool.score.kind}" (registered: ${[...registry.scorings.keys()].join(", ")})`,
      ["score"],
    );
  } else {
    const parsedScore = scoring.schema.safeParse(pool.score);
    if (!parsedScore.success) {
      relayParseIssues(issue, parsedScore.error, ["score"]);
    } else if (encounterValid) {
      scoring.validate?.(
        pool.score,
        pool.encounter,
        registry.ops,
        (m, p = []) => issue(m, ["score", ...p]),
      );
    }
  }

  pool.tiebreaks.forEach((ref, i) => {
    const metric = registry.metrics.get(ref.metric);
    if (metric === undefined) {
      issue(
        `unknown tiebreak metric "${ref.metric}" (registered: ${[...registry.metrics.keys()].join(", ")})`,
        ["tiebreaks", i],
      );
      return;
    }
    const parsedRef = metric.schema.safeParse(ref);
    if (!parsedRef.success) {
      relayParseIssues(issue, parsedRef.error, ["tiebreaks", i]);
    }
  });

  const pairing = registry.pairings.get(pool.pairing.system);
  if (pairing === undefined) {
    // Open world: unknown systems are fine (pairings arrive as inputs), but
    // then the schedule length cannot be derived.
    if (pool.rounds === undefined) {
      issue(
        `unregistered pairing system "${pool.pairing.system}" requires explicit rounds`,
        ["pairing"],
      );
    }
    return;
  }
  const parsed = pairing.schema.safeParse(pool.pairing);
  if (!parsed.success) {
    relayParseIssues(issue, parsed.error, ["pairing"]);
  } else {
    if (pairing.totalRounds === undefined && pool.rounds === undefined) {
      issue(`${pool.pairing.system} pools must declare rounds`, ["rounds"]);
    }
    if (pairing.totalRounds !== undefined && pool.rounds !== undefined) {
      issue(
        `${pool.pairing.system} pools derive their round count; omit rounds`,
        ["rounds"],
      );
    }
    if (encounterValid) {
      pairing.validate?.(
        pool.pairing,
        entrants,
        pool.encounter,
        registry.ops,
        registry.ties,
        (m, p = []) => issue(m, ["pairing", ...p]),
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Parsing

const brandSchema = (registry: ModelRegistry) =>
  registry.eventSchema.brand<"ParsedEventDef">();

/** An EventDef that passed every registry refinement; the engine only accepts this. */
export type ParsedEventDef = z.infer<ReturnType<typeof brandSchema>>;

// The recursive schemas (and the walks behind them) descend the def with
// native recursion, so the structure must be bounded BEFORE zod runs — a
// stack overflow would escape even safeParse as a RangeError. The node cap
// also bounds the intake DFS and rejects cyclic objects. These are DoS
// ceilings for untrusted input, not format limits: the largest real def
// (the Grand Chess Tour) is dozens of nodes and ~6 levels deep, so the
// headroom is three-plus orders of magnitude.
const MAX_DEF_DEPTH = 200;
const MAX_DEF_NODES = 50_000;

type Admitted =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly reason: string };

/**
 * Iterative structural admission for untrusted definition data: bound depth
 * and node count, then sever aliasing with the caller's object so the
 * parsed def — and the decode memos keyed on its identity — cannot change
 * underneath the engine.
 */
function admitDefData(data: unknown): Admitted {
  const stack: { readonly value: unknown; readonly depth: number }[] = [
    { value: data, depth: 0 },
  ];
  let nodes = 0;
  for (let frame = stack.pop(); frame !== undefined; frame = stack.pop()) {
    if (frame.depth > MAX_DEF_DEPTH) {
      return {
        ok: false,
        reason: `definition nests deeper than ${MAX_DEF_DEPTH} levels`,
      };
    }
    nodes += 1;
    if (nodes > MAX_DEF_NODES) {
      return {
        ok: false,
        reason: `definition exceeds ${MAX_DEF_NODES} nodes`,
      };
    }
    const value = frame.value;
    if (Array.isArray(value)) {
      for (const item of value) {
        stack.push({ value: item, depth: frame.depth + 1 });
      }
    } else if (value !== null && typeof value === "object") {
      for (const item of Object.values(value)) {
        stack.push({ value: item, depth: frame.depth + 1 });
      }
    }
  }
  try {
    return { ok: true, value: structuredClone(data) };
  } catch {
    // Functions, symbols, and other non-data refuse to clone: definitions
    // are PLAIN DATA by contract, so refuse them as data, with a reason.
    return { ok: false, reason: "definition contains non-data values" };
  }
}

/** A schema that fails with the admission reason — typed issues, no throw. */
const refuseSchema = (reason: string): z.ZodType<ParsedEventDef> =>
  z.custom<ParsedEventDef>(() => false, { message: reason });

/** Parse and fully validate an event definition against a registry; throws listing every issue. */
export function parseEventDef(
  data: unknown,
  registry: ModelRegistry,
): ParsedEventDef {
  const admitted = admitDefData(data);
  if (!admitted.ok) return refuseSchema(admitted.reason).parse(data);
  return brandSchema(registry).parse(admitted.value);
}

/** Like `parseEventDef` but returns the issues instead of throwing. */
export function safeParseEventDef(data: unknown, registry: ModelRegistry) {
  const admitted = admitDefData(data);
  if (!admitted.ok) return refuseSchema(admitted.reason).safeParse(data);
  return brandSchema(registry).safeParse(admitted.value);
}
