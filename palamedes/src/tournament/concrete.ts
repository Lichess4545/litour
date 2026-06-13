import {
  type AnyEncounterDef,
  type CompetitionDef,
  type EntriesDef,
  isOpenEntries,
  type PoolDef,
  type SeedRef,
} from "./core";
import {
  type Arrangement,
  isContainer,
  isPool,
  type ModelRegistry,
  type PairFlow,
  type ParsedEventDef,
} from "./registry";

/**
 * The concrete domain: a definition, expanded into the structure of "how the
 * tournament works". `concretify` is the conversion — it asks the registry
 * (structure, arrangement, cards, pair counts, seat derivations, seed
 * origins) and resolves everything into plain recursive data. A display
 * iterates this structure; it never touches a definition or the registry.
 *
 * Sizes are explicit. `Many<T>` either knows all of its items or is open —
 * registration-bound — in which case it carries example items plus one
 * faded continuation ("… pairing n"). When real registrations and pairings
 * exist, a state-bound conversion will produce the same shapes with every
 * item known and named.
 */

/** A collection whose size the definition may not know. */
export type Many<T> =
  | { readonly open: false; readonly items: readonly T[] }
  | {
      readonly open: true;
      /** Illustrative members ("pairing 1", "pairing 2"). */
      readonly items: readonly T[];
      /** The faded "… and so on" exemplar ("pairing n"). */
      readonly more: T;
    };

/** Canonical iteration: known items, then the faded continuation if open. */
export const manyList = <T>(
  many: Many<T>,
): readonly { readonly item: T; readonly ghost: boolean }[] =>
  many.open
    ? [
        ...many.items.map((item) => ({ item, ghost: false })),
        { item: many.more, ghost: true },
      ]
    : many.items.map((item) => ({ item, ghost: false }));

/** Who holds which color at a node, by name (exemplar or real). */
export type ConcreteSides = {
  readonly white: string;
  readonly black: string;
};

/** A logic gate before a conditional node: continue here, or take the exit. */
export type ConcreteGate = {
  /** The condition that continues into this node ("still tied?"). */
  readonly when: string;
  /** The exit taken otherwise ("winner decided"). */
  readonly otherwise: string;
};

/** One encounter, concretified: the recursion as explicit data. */
export type ConcreteNode = {
  /** The encounter kind key (display chip). */
  readonly kind: string;
  readonly title: string;
  readonly badge: string | undefined;
  readonly lines: readonly string[];
  /** Position among siblings ("board 2", "leg 1"); undefined at a root. */
  readonly role: string | undefined;
  /** Undefined while a drawing of lots decides who gets white (the lines say so). */
  readonly sides: ConcreteSides | undefined;
  /** This node stands for N identical siblings. */
  readonly count: number | undefined;
  /** This node plays only conditionally (its kind's stop rule). */
  readonly gate: ConcreteGate | undefined;
  readonly arrangement: Arrangement;
  readonly children: readonly ConcreteNode[];
};

export type ConcretePairing = {
  readonly label: string;
  readonly node: ConcreteNode;
};

/** A non-encounter card: a scoring rule, the standings, a pairing step. */
export type ConcreteCard = {
  /** Its kind key (display chip). */
  readonly kind: string;
  readonly title: string;
  readonly badge: string | undefined;
  readonly lines: readonly string[];
};

/**
 * What happens between rounds: standings update from the scored points and
 * (unless the schedule is over) the pairing system pairs the next round.
 * The round itself owns none of this — it outputs scored points.
 */
export type ConcreteProcess = {
  readonly standings: ConcreteCard;
  /** Undefined after the final round: nothing left to pair. */
  readonly repair: ConcreteCard | undefined;
};

export type ConcreteRound = {
  readonly label: string;
  readonly pairings: Many<ConcretePairing>;
  /** The round's output: its outcomes through the scoring rule. */
  readonly scoring: ConcreteCard;
  /**
   * Bracket advancement from the previous round (winners/losers feeding
   * each pairing); undefined where competitors come from standings instead.
   */
  readonly inflows: readonly PairFlow[] | undefined;
};

export type ConcreteRoundsRun = {
  readonly kind: "rounds";
  /** The pairing system key (display chip / badge). */
  readonly system: string;
  /** The scoring rule's self-description (each round references it too). */
  readonly scoring: ConcreteCard;
  readonly rounds: Many<ConcreteRound>;
  /** Between two rounds: standings update, then pair the next round. */
  readonly between: ConcreteProcess;
  /** After the last round: the final standings — the group's output. */
  readonly final: ConcreteProcess;
};

/**
 * Where a leaf's participants come from. Every leaf that needs entrants
 * starts from a generator node — composability forces it: a registration
 * process, a source competition's standings output, or an aggregation
 * across several (the tour) — with optional processing on the way in
 * ("top 8").
 */
export type ConcreteIntake = {
  readonly id: string;
  /** The participant-generating node (registration, standings, aggregation). */
  readonly card: ConcreteCard;
  /** Upstream competition ids feeding the generator (empty for registration). */
  readonly from: readonly string[];
  /** Processing on the way in ("top 8", "winner", "#2"); undefined = all. */
  readonly take: string | undefined;
};

export type ConcreteRun =
  | ConcreteRoundsRun
  | { readonly kind: "encounter"; readonly node: ConcreteNode }
  | {
      readonly kind: "competitions";
      readonly competitions: readonly ConcreteCompetition[];
    };

/**
 * One competition, concretified — the recursion as explicit data. A leaf
 * carries its field and its schedule; a container carries its children,
 * each tiered among its SIBLINGS by intake dependency (a child whose
 * subtree draws on a sibling's subtree sits one tier past it; sources
 * outside the container tier the container itself at the parent's level,
 * recursively).
 */
export type ConcreteCompetition = {
  readonly id: string;
  readonly title: string;
  /** Field size; undefined for containers (their children intake their own). */
  readonly entrants: number | "open" | undefined;
  /** Its face at the parent's level. */
  readonly card: ConcreteCard;
  /** The participant sources feeding this leaf (empty for containers). */
  readonly intakes: readonly ConcreteIntake[];
  /** Dependency depth among siblings; 0 = depends on no sibling. */
  readonly tier: number;
  readonly run: ConcreteRun;
};

export type ConcreteEvent = {
  readonly root: ConcreteCompetition;
};

/** Illustrative members shown before the faded "… n" when a size is open. */
const OPEN_EXAMPLES = 2;

/**
 * Side names with the white seat's current holder. At design time the
 * exemplars name whoever holds the white seat "A"; a drawing of lots resets
 * to fresh exemplars (the holder is unknown until it happens).
 */
type SideNames = {
  readonly a: string;
  readonly b: string;
  readonly white: 0 | 1;
};

const EXEMPLAR_SIDES: SideNames = { a: "A", b: "B", white: 0 };

const chips = (sides: SideNames): ConcreteSides =>
  sides.white === 0
    ? { white: sides.a, black: sides.b }
    : { white: sides.b, black: sides.a };

function concretifyNode(
  def: AnyEncounterDef,
  opts: {
    readonly role?: string | undefined;
    readonly count?: number | undefined;
    readonly sides: SideNames;
    /** This node's own colors come from a drawing of lots. */
    readonly drawn: boolean;
    readonly gate?: ConcreteGate | undefined;
  },
  registry: ModelRegistry,
): ConcreteNode {
  const info = registry.ops.card(def);
  const children = registry.ops.structure(def).map((child) => {
    const drawn = child.seat === "draw";
    const own: SideNames =
      child.seat === "flip"
        ? {
            a: opts.sides.a,
            b: opts.sides.b,
            white: opts.sides.white === 0 ? 1 : 0,
          }
        : drawn
          ? EXEMPLAR_SIDES
          : opts.sides;
    return concretifyNode(
      child.def,
      {
        role: child.role,
        count: child.count,
        sides: own,
        drawn,
        gate: child.gate,
      },
      registry,
    );
  });
  return {
    kind: def.kind,
    title: info.title,
    badge: info.badge,
    lines: opts.drawn ? ["colors drawn by lot", ...info.lines] : info.lines,
    role: opts.role,
    sides: opts.drawn ? undefined : chips(opts.sides),
    count: opts.count,
    gate: opts.gate,
    arrangement: registry.ops.arrangement(def),
    children,
  };
}

/** A best-effort display name for one seed entry of a two-sided leaf. */
function entryName(
  entry: SeedRef,
  def: ParsedEventDef,
  registry: ModelRegistry,
  nameOf: (id: string) => string,
): string {
  const seedKind = registry.seeds.get(entry.kind);
  const id = seedKind?.resolve(entry, {
    competitors: def.competitors,
    ranking: () => undefined,
  });
  if (id !== undefined) {
    return def.competitors.find((c) => c.id === id)?.name ?? id;
  }
  const [origin] = seedKind?.origins?.(entry) ?? [];
  if (origin !== undefined) {
    return origin.rank === undefined
      ? `from ${nameOf(origin.of)}`
      : `${nameOf(origin.of)} #${origin.rank}`;
  }
  return "TBD";
}

function concretifyPool(
  pool: PoolDef,
  entrants: number | "open",
  registry: ModelRegistry,
): ConcreteRoundsRun {
  const pairing = registry.pairings.get(pool.pairing.system);
  const roundWord = pool.terms?.round ?? "Round";
  const pairWord = pool.terms?.pairing ?? "pairing";

  const pairingsOf = (round: number): Many<ConcretePairing> => {
    const node = concretifyNode(
      pool.encounter,
      { sides: EXEMPLAR_SIDES, drawn: false },
      registry,
    );
    if (entrants === "open") {
      const items = Array.from({ length: OPEN_EXAMPLES }, (_, i) => ({
        label: `${pairWord} ${i + 1}`,
        node,
      }));
      return { open: true, items, more: { label: `… ${pairWord} n`, node } };
    }
    const count =
      pairing?.pairsInRound?.(pool.pairing, entrants, round) ??
      Math.floor(entrants / 2);
    // The system's own names ("final", "bronze final") beat the generic word.
    const labels = pairing?.pairLabels?.(pool.pairing, entrants, round);
    return {
      open: false,
      items: Array.from({ length: count }, (_, i) => ({
        label: labels?.[i] ?? `${pairWord} ${i + 1}`,
        node,
      })),
    };
  };

  const scoringKind = registry.scorings.get(pool.score.kind);
  const scoringInfo = scoringKind?.card?.(pool.score);
  const scoring: ConcreteCard = {
    kind: pool.score.kind,
    title: scoringInfo?.title ?? pool.score.kind,
    badge: scoringInfo?.badge,
    lines: scoringInfo?.lines ?? [],
  };
  const standings: ConcreteCard = {
    kind: "standings",
    title: "Standings",
    badge: undefined,
    lines: pool.tiebreaks.map((ref) => {
      const metric = registry.metrics.get(ref.metric);
      return `tie: ${metric?.label(ref) ?? ref.metric}`;
    }),
  };
  const repair: ConcreteCard = {
    kind: pool.pairing.system,
    title: `Pair next ${roundWord.toLowerCase()}`,
    badge: undefined,
    lines: ["from these standings"],
  };

  const roundCount =
    pool.rounds ??
    (entrants !== "open" && pairing?.totalRounds !== undefined
      ? pairing.totalRounds(pool.pairing, entrants)
      : "open");
  const roundOf = (round: number, label: string): ConcreteRound => ({
    label,
    pairings: pairingsOf(round),
    scoring,
    inflows:
      entrants === "open"
        ? undefined
        : pairing?.flows?.(pool.pairing, entrants, round),
  });
  const rounds: Many<ConcreteRound> =
    roundCount === "open"
      ? {
          open: true,
          items: Array.from({ length: OPEN_EXAMPLES }, (_, i) =>
            roundOf(i + 1, `${roundWord} ${i + 1}`),
          ),
          more: roundOf(OPEN_EXAMPLES + 1, `… ${roundWord} n`),
        }
      : {
          open: false,
          items: Array.from({ length: roundCount }, (_, i) =>
            roundOf(i + 1, `${roundWord} ${i + 1}`),
          ),
        };

  return {
    kind: "rounds",
    system: pool.pairing.system,
    scoring,
    rounds,
    between: { standings, repair },
    final: { standings, repair: undefined },
  };
}

/** Every leaf in a concrete competition's subtree (the ids seeds reference). */
const leavesOf = (comp: ConcreteCompetition): readonly ConcreteCompetition[] =>
  comp.run.kind === "competitions"
    ? comp.run.competitions.flatMap(leavesOf)
    : [comp];

/**
 * Tier a container's children among themselves: a child whose subtree draws
 * on a sibling's subtree sits one tier past that sibling; sources outside
 * the container don't tier here — they bubble up and tier the container at
 * its own parent's level. Bounded relaxation, so a sibling-level cycle
 * (legal when the leaf-level intake graph is still acyclic) terminates.
 */
function withSiblingTiers(
  children: readonly ConcreteCompetition[],
): readonly ConcreteCompetition[] {
  const leafSets = children.map(
    (child) => new Set(leavesOf(child).map((leaf) => leaf.id)),
  );
  const externalSources = children.map((child, i) =>
    leavesOf(child)
      .flatMap((leaf) => leaf.intakes.flatMap((intake) => intake.from))
      .filter((source) => !(leafSets[i]?.has(source) ?? false)),
  );
  const tiers = children.map(() => 0);
  for (let pass = 0; pass < children.length; pass += 1) {
    let changed = false;
    children.forEach((_, i) => {
      for (const source of externalSources[i] ?? []) {
        const j = leafSets.findIndex((set) => set.has(source));
        if (j < 0 || j === i) continue;
        const lifted = (tiers[j] ?? 0) + 1;
        if (lifted > (tiers[i] ?? 0)) {
          tiers[i] = lifted;
          changed = true;
        }
      }
    });
    if (!changed) break;
  }
  return children.map((child, i) => ({ ...child, tier: tiers[i] ?? 0 }));
}

/** The intake's processing label: "winner", "#3", "top 8", "4 seeds". */
function takeLabel(
  ranks: readonly (number | undefined)[],
  topN: boolean,
): string | undefined {
  if (ranks.length !== 1) {
    return topN ? `top ${ranks.length}` : `${ranks.length} seeds`;
  }
  const [only] = ranks;
  if (only === undefined) return undefined;
  return only === 1 ? "winner" : `#${only}`;
}

function concretifyLeaf(
  comp: CompetitionDef,
  run: PoolDef | AnyEncounterDef,
  entries: EntriesDef,
  def: ParsedEventDef,
  registry: ModelRegistry,
  nameOf: (id: string) => string,
): ConcreteCompetition {
  const open = isOpenEntries(entries);
  const entrants = open ? ("open" as const) : entries.length;
  const entrantsLine = open ? "open entry" : `${entrants} entrants`;

  // Classify each seed by origin count: none → registration; one → that
  // source's standings (with "top N" processing); several → an aggregation
  // (the tour).
  const bySource = new Map<string, { ranks: (number | undefined)[] }>();
  const aggregations = new Map<
    string,
    { card: ConcreteCard; from: readonly string[]; count: number }
  >();
  let registered = 0;
  if (!open) {
    for (const entry of entries) {
      const seedKind = registry.seeds.get(entry.kind);
      const all = seedKind?.origins?.(entry) ?? [];
      if (all.length === 0) {
        registered += 1;
        continue;
      }
      if (all.length > 1) {
        const key = `${entry.kind}|${all.map((o) => o.of).join(",")}`;
        const info = seedKind?.card?.(entry);
        const acc = aggregations.get(key) ?? {
          card: {
            kind: "standings",
            title: info?.title ?? "Standings",
            badge: info?.badge,
            lines: info?.lines ?? [],
          },
          from: all.map((o) => o.of),
          count: 0,
        };
        acc.count += 1;
        aggregations.set(key, acc);
        continue;
      }
      for (const origin of all) {
        const links = bySource.get(origin.of) ?? { ranks: [] };
        links.ranks.push(origin.rank);
        bySource.set(origin.of, links);
      }
    }
  }

  const intakes: ConcreteIntake[] = [];
  if (open || registered > 0) {
    intakes.push({
      id: `${comp.id}-reg`,
      card: {
        kind: "registration",
        title: "Registration",
        badge: undefined,
        lines: [entrantsLine],
      },
      from: [],
      take: undefined,
    });
  }
  for (const [sourceId, source] of bySource) {
    const sorted = source.ranks.flatMap((r) => (r === undefined ? [] : [r]));
    sorted.sort((x, y) => x - y);
    const topN =
      sorted.length === source.ranks.length &&
      sorted.every((rank, i) => rank === i + 1);
    intakes.push({
      id: `${comp.id}-std-${sourceId}`,
      card: {
        kind: "standings",
        title: `${nameOf(sourceId)} standings`,
        badge: undefined,
        lines: [],
      },
      from: [sourceId],
      take: takeLabel(source.ranks, topN),
    });
  }
  [...aggregations.values()].forEach((acc, i) => {
    intakes.push({
      id: `${comp.id}-agg${i + 1}`,
      card: acc.card,
      from: acc.from,
      take: `top ${acc.count}`,
    });
  });

  const inflowLines = intakes
    .filter((intake) => intake.from.length > 0)
    .map((intake) => `${intake.take ?? "all"} of ${intake.card.title}`);
  const title = comp.name ?? comp.id;

  if (isPool(run)) {
    const concrete = concretifyPool(run, entrants, registry);
    const roundsLabel = concrete.rounds.open
      ? "n"
      : String(concrete.rounds.items.length);
    return {
      id: comp.id,
      title,
      entrants,
      card: {
        kind: "competition",
        title,
        badge: `${concrete.system} · ${roundsLabel} rounds`,
        lines: [entrantsLine, concrete.scoring.title, ...inflowLines],
      },
      intakes,
      tier: 0,
      run: concrete,
    };
  }

  const [first, second] = open ? [] : entries;
  const sides: SideNames =
    first === undefined || second === undefined
      ? EXEMPLAR_SIDES
      : {
          a: entryName(first, def, registry, nameOf),
          b: entryName(second, def, registry, nameOf),
          white: 0,
        };
  return {
    id: comp.id,
    title,
    entrants,
    card: {
      kind: "competition",
      title,
      badge: undefined,
      lines: [entrantsLine, ...inflowLines],
    },
    intakes,
    tier: 0,
    run: {
      kind: "encounter",
      node: concretifyNode(run, { sides, drawn: false }, registry),
    },
  };
}

/** One line of a container card: a child and its field size. */
function sizeLine(child: ConcreteCompetition): string {
  if (child.entrants === "open") return `${child.id} · open entry`;
  if (child.entrants !== undefined) {
    return `${child.id} · ${child.entrants} entrants`;
  }
  const count =
    child.run.kind === "competitions" ? child.run.competitions.length : 0;
  return `${child.id} · ${count} competitions`;
}

function concretifyCompetition(
  comp: CompetitionDef,
  def: ParsedEventDef,
  registry: ModelRegistry,
  nameOf: (id: string) => string,
): ConcreteCompetition {
  const run = comp.run;
  if (!isContainer(run)) {
    const entries = comp.entries;
    if (entries === undefined) {
      // Parsed defs guarantee entries on every leaf.
      throw new Error(
        `competition ${comp.id} has no entries — the def was not parsed`,
      );
    }
    return concretifyLeaf(comp, run, entries, def, registry, nameOf);
  }
  const children = withSiblingTiers(
    run.competitions.map((child) =>
      concretifyCompetition(child, def, registry, nameOf),
    ),
  );
  const title = comp.name ?? comp.id;
  return {
    id: comp.id,
    title,
    entrants: undefined,
    card: {
      kind: "competitions",
      title,
      badge: `${children.length} competitions`,
      lines: children.map(sizeLine),
    },
    intakes: [],
    tier: 0,
    run: { kind: "competitions", competitions: children },
  };
}

/** Expand a definition into the concrete structure of how it works. */
export function concretify(
  def: ParsedEventDef,
  registry: ModelRegistry,
): ConcreteEvent {
  const names = new Map<string, string>();
  const collect = (comp: CompetitionDef): void => {
    names.set(comp.id, comp.name ?? comp.id);
    if (isContainer(comp.run)) {
      for (const child of comp.run.competitions) collect(child);
    }
  };
  collect(def.competition);
  const nameOf = (id: string): string => names.get(id) ?? id;
  return {
    root: concretifyCompetition(def.competition, def, registry, nameOf),
  };
}
