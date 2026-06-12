import { z } from "zod";
import {
  type AnyEncounterDef,
  type ByeRule,
  type Color,
  type CompetitorDef,
  type CompetitorId,
  competitorIdSchema,
  type Decision,
  type EventDef,
  finitePoints,
  idSchema,
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
};

export type Issue = (
  message: string,
  path?: readonly (string | number)[],
) => void;

/** How a kind's children relate: in time (sequence) or side by side (parallel). */
export type Arrangement = "sequence" | "parallel";

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
  /** Final order of a completed earlier group; undefined while unresolved. */
  readonly ranking: (
    stage: string,
    group: string,
  ) => readonly CompetitorId[] | undefined;
};

export type SeedValidateContext = {
  readonly competitors: readonly CompetitorDef[];
  readonly stageIndex: number;
  readonly stages: readonly {
    readonly id: string;
    readonly groupSizes: ReadonlyMap<string, number>;
  }[];
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
  /** Eliminative systems rank by survival depth instead of points. */
  readonly progression?: true;
  /** Bye rule applied when the def doesn't configure one. */
  readonly defaultBye?: ByeRule;
  propose(options: PairingRef, ctx: PairingContext): PairingResult;
  readonly validate?: (
    options: PairingRef,
    entrants: number,
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
  readonly stage: string;
  readonly group: string;
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
  /** Declares the earlier stage/group this seed draws from (cross-stage UI edges). */
  readonly origin?: (ref: SeedRef) => SeedOrigin | undefined;
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
  propose(options: O, ctx: PairingContext): PairingResult;
  validate?(
    options: O,
    entrants: number,
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
    ...(validate === undefined
      ? {}
      : {
          validate: (
            options: PairingRef,
            entrants: number,
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
};

export function defineScoringKind<R>(spec: ScoringKindSpec<R>): ScoringKind {
  const decode = memoDecode(spec.schema);
  const validate = spec.validate;
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
  origin?(ref: S): SeedOrigin | undefined;
};

export function defineSeedKind<S>(spec: SeedKindSpec<S>): SeedKind {
  const decode = memoDecode(spec.schema);
  const validate = spec.validate;
  const origin = spec.origin;
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
    ...(origin === undefined
      ? {}
      : { origin: (ref: SeedRef) => origin(decode(ref)) }),
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
    if (kind.kind === "pool")
      throw new Error('"pool" is reserved for the pool spine');
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
  });

  const groupSchema = z.object({
    id: idSchema,
    entries: z.array(z.looseObject({ kind: z.string() })).min(1),
    run: z.union([poolSchema, registry.encounterSchema]),
  });

  const schema: z.ZodType<EventDef> = z
    .object({
      id: idSchema,
      name: z.string().min(1),
      competitors: z
        .array(
          z.object({
            id: competitorIdSchema,
            name: z.string().min(1),
            rating: z.number().int().positive().optional(),
            roster: z.array(playerIdSchema).min(1).optional(),
          }),
        )
        .min(1),
      stages: z
        .array(z.object({ id: idSchema, groups: z.array(groupSchema).min(1) }))
        .min(1),
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

function validateEvent(
  event: EventDef,
  registry: RegistryCore,
): readonly Found[] {
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

  const stageMeta = event.stages.map((stage) => ({
    id: stage.id,
    groupSizes: new Map(stage.groups.map((g) => [g.id, g.entries.length])),
  }));

  const stageIds = new Set<string>();
  event.stages.forEach((stage, si) => {
    if (stageIds.has(stage.id))
      found.push({
        message: `duplicate stage id ${stage.id}`,
        path: ["stages", si, "id"],
      });
    stageIds.add(stage.id);

    const groupIds = new Set<string>();
    stage.groups.forEach((group, gi) => {
      const base = ["stages", si, "groups", gi] as const;
      if (groupIds.has(group.id))
        found.push({
          message: `duplicate group id ${group.id} in stage ${stage.id}`,
          path: [...base, "id"],
        });
      groupIds.add(group.id);

      group.entries.forEach((entry, ei) => {
        const seedKind = registry.seeds.get(entry.kind);
        if (seedKind === undefined) {
          found.push({
            message: `unknown seed kind "${entry.kind}" (registered: ${[...registry.seeds.keys()].join(", ")})`,
            path: [...base, "entries", ei],
          });
          return;
        }
        const parsed = seedKind.schema.safeParse(entry);
        if (!parsed.success) {
          for (const zi of parsed.error.issues)
            found.push({
              message: zi.message,
              path: [...base, "entries", ei, ...zi.path.map(String)],
            });
          return;
        }
        seedKind.validate?.(
          entry,
          { competitors: event.competitors, stageIndex: si, stages: stageMeta },
          issueAt([...base, "entries", ei]),
        );
      });

      const run = group.run;
      const encounter = isPool(run) ? run.encounter : run;
      if (!isPool(run) && group.entries.length !== 2) {
        found.push({
          message: `a root encounter needs exactly 2 entries; group ${group.id} has ${group.entries.length}`,
          path: [...base, "entries"],
        });
      }
      // Unknown kinds were already reported by the schema layer; recursing
      // into them through ops would throw.
      const known = registry.encounters.has(encounter.kind);
      if (known) {
        registry.ops.validate(encounter, issueAt([...base, "run"]));
      }
      if (isPool(run)) {
        validatePoolDef(
          run,
          group.entries.length,
          registry,
          issueAt([...base, "run"]),
        );
      }

      const need = known ? registry.ops.rosterNeed(encounter) : 0;
      if (need > 0) {
        group.entries.forEach((entry, ei) => {
          const seedKind = registry.seeds.get(entry.kind);
          const id = seedKind?.resolve(entry, {
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
              message: `${competitor.name} needs a roster of at least ${need} players for this group`,
              path: [...base, "entries", ei],
            });
          }
        });
      }
    });
  });

  return found;
}

function validatePoolDef(
  pool: PoolDef,
  entrants: number,
  registry: RegistryCore,
  issue: Issue,
): void {
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
    for (const zi of parsed.error.issues)
      issue(zi.message, ["pairing", ...zi.path.map(String)]);
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
    if (registry.encounters.has(pool.encounter.kind)) {
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

  const scoring = registry.scorings.get(pool.score.kind);
  if (scoring === undefined) {
    issue(
      `unknown scoring kind "${pool.score.kind}" (registered: ${[...registry.scorings.keys()].join(", ")})`,
      ["score"],
    );
  } else {
    const parsedScore = scoring.schema.safeParse(pool.score);
    if (!parsedScore.success) {
      for (const zi of parsedScore.error.issues)
        issue(zi.message, ["score", ...zi.path.map(String)]);
    } else if (registry.encounters.has(pool.encounter.kind)) {
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
      for (const zi of parsedRef.error.issues)
        issue(zi.message, ["tiebreaks", i, ...zi.path.map(String)]);
    }
  });
}

// ---------------------------------------------------------------------------
// Parsing

const brandSchema = (registry: ModelRegistry) =>
  registry.eventSchema.brand<"ParsedEventDef">();

/** An EventDef that passed every registry refinement; the engine only accepts this. */
export type ParsedEventDef = z.infer<ReturnType<typeof brandSchema>>;

/** Parse and fully validate an event definition against a registry; throws listing every issue. */
export function parseEventDef(
  data: unknown,
  registry: ModelRegistry,
): ParsedEventDef {
  return brandSchema(registry).parse(data);
}

/** Like `parseEventDef` but returns the issues instead of throwing. */
export function safeParseEventDef(data: unknown, registry: ModelRegistry) {
  return brandSchema(registry).safeParse(data);
}
