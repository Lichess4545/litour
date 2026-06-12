import {
  type AnyEncounterDef,
  isOpenEntries,
  type PoolDef,
  type SeedRef,
} from "./core";
import {
  type Arrangement,
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
 * exist, a state-bound conversion produces the same shapes with every item
 * known and named.
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

export type ConcreteRun =
  | ConcreteRoundsRun
  | { readonly kind: "encounter"; readonly node: ConcreteNode };

/**
 * Where a group's participants come from. Every group that needs entrants
 * starts from a generator node — composability forces it: a registration
 * process, a previous group's standings output, or an aggregation across
 * several (the tour) — with optional processing on the way in ("top 8").
 */
export type ConcreteIntake = {
  readonly id: string;
  /** The participant-generating node (registration, standings, aggregation). */
  readonly card: ConcreteCard;
  /** Upstream groups feeding the generator (empty for registration). */
  readonly from: readonly {
    readonly stage: string;
    readonly group: string;
  }[];
  /** Processing on the way in ("top 8", "winner", "#2"); undefined = all. */
  readonly take: string | undefined;
};

export type ConcreteGroup = {
  readonly id: string;
  readonly entrants: number | "open";
  /** The lane's header card (entrants, scoring, schedule badge, inflows). */
  readonly header: ConcreteCard;
  /** The participant sources feeding this group. */
  readonly intakes: readonly ConcreteIntake[];
  readonly run: ConcreteRun;
};

export type ConcreteStage = {
  readonly id: string;
  /** The stage's own card at the event level. */
  readonly card: ConcreteCard;
  /** Every participant source feeding this stage's groups. */
  readonly intakes: readonly ConcreteIntake[];
  /**
   * Depth in the seed-flow graph: 0 = depends on nothing. Stages sharing a
   * tier are independent of each other — the five tour events run
   * concurrently; only what seeds from them comes later.
   */
  readonly tier: number;
  readonly groups: readonly ConcreteGroup[];
};

export type ConcreteEvent = {
  readonly stages: readonly ConcreteStage[];
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

/** A best-effort display name for one seed entry of a two-sided group. */
function entryName(
  entry: SeedRef,
  def: ParsedEventDef,
  registry: ModelRegistry,
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
      ? `from ${origin.group}`
      : `${origin.group} #${origin.rank}`;
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

/** Expand a definition into the concrete structure of how it works. */
export function concretify(
  def: ParsedEventDef,
  registry: ModelRegistry,
): ConcreteEvent {
  const built: readonly Omit<ConcreteStage, "tier">[] = def.stages.map(
    (stage): Omit<ConcreteStage, "tier"> => {
      const groups = stage.groups.map((group): ConcreteGroup => {
        const open = isOpenEntries(group.entries);
        const entrants = open ? ("open" as const) : group.entries.length;
        const entrantsLine = open ? "open entry" : `${entrants} entrants`;

        // Every group's participants come from generator nodes: open or
        // origin-less seeds are a registration process; single-origin seeds
        // are a source group's standings output (with "top N" processing);
        // multi-origin seeds aggregate several standings (the tour).
        const bySource = new Map<
          string,
          { stage: string; group: string; ranks: (number | undefined)[] }
        >();
        const aggregations = new Map<
          string,
          {
            card: ConcreteCard;
            from: readonly { stage: string; group: string }[];
            count: number;
          }
        >();
        let registered = 0;
        if (!open) {
          for (const entry of group.entries) {
            const seedKind = registry.seeds.get(entry.kind);
            const all = seedKind?.origins?.(entry) ?? [];
            if (all.length === 0) {
              registered += 1;
              continue;
            }
            if (all.length > 1) {
              const key = `${entry.kind}|${all
                .map((o) => `${o.stage}/${o.group}`)
                .join(",")}`;
              const info = seedKind?.card?.(entry);
              const acc = aggregations.get(key) ?? {
                card: {
                  kind: "standings",
                  title: info?.title ?? "Standings",
                  badge: info?.badge,
                  lines: info?.lines ?? [],
                },
                from: all.map((o) => ({ stage: o.stage, group: o.group })),
                count: 0,
              };
              acc.count += 1;
              aggregations.set(key, acc);
              continue;
            }
            for (const origin of all) {
              const sourceKey = `${origin.stage}/${origin.group}`;
              const links = bySource.get(sourceKey) ?? {
                stage: origin.stage,
                group: origin.group,
                ranks: [],
              };
              links.ranks.push(origin.rank);
              bySource.set(sourceKey, links);
            }
          }
        }

        // Name a source by its group — or by its stage when several
        // sources share a group id (the tour's five "field" groups).
        const groupUses = new Map<string, number>();
        for (const source of bySource.values()) {
          groupUses.set(source.group, (groupUses.get(source.group) ?? 0) + 1);
        }
        const sourceName = (source: {
          stage: string;
          group: string;
        }): string => {
          const sourceStage = def.stages.find((x) => x.id === source.stage);
          if ((groupUses.get(source.group) ?? 0) > 1) {
            return sourceStage?.name ?? source.stage;
          }
          const sourceGroup = sourceStage?.groups.find(
            (g) => g.id === source.group,
          );
          return sourceGroup?.name ?? source.group;
        };

        const intakes: ConcreteIntake[] = [];
        if (open || registered > 0) {
          intakes.push({
            id: `${stage.id}-${group.id}-reg`,
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
        for (const source of bySource.values()) {
          const sorted = source.ranks.flatMap((r) =>
            r === undefined ? [] : [r],
          );
          sorted.sort((x, y) => x - y);
          const [only] = source.ranks;
          const topN =
            sorted.length === source.ranks.length &&
            sorted.every((rank, i) => rank === i + 1);
          intakes.push({
            id: `${stage.id}-${group.id}-std-${source.stage}-${source.group}`,
            card: {
              kind: "standings",
              title: `${sourceName(source)} standings`,
              badge: undefined,
              lines: [],
            },
            from: [{ stage: source.stage, group: source.group }],
            take:
              source.ranks.length === 1
                ? only === 1
                  ? "winner"
                  : only !== undefined
                    ? `#${only}`
                    : undefined
                : topN
                  ? `top ${source.ranks.length}`
                  : `${source.ranks.length} seeds`,
          });
        }
        [...aggregations.values()].forEach((acc, i) => {
          intakes.push({
            id: `${stage.id}-${group.id}-agg${i + 1}`,
            card: acc.card,
            from: acc.from,
            take: `top ${acc.count}`,
          });
        });

        const inflowLines = intakes
          .filter((intake) => intake.from.length > 0)
          .map((intake) => `${intake.take ?? "all"} of ${intake.card.title}`);
        const run = group.run;
        if (isPool(run)) {
          const concrete = concretifyPool(run, entrants, registry);
          const roundsLabel = concrete.rounds.open
            ? "n"
            : String(concrete.rounds.items.length);
          return {
            id: group.id,
            entrants,
            header: {
              kind: "group",
              title: group.name ?? group.id,
              badge: `${concrete.system} · ${roundsLabel} rounds`,
              lines: [entrantsLine, concrete.scoring.title, ...inflowLines],
            },
            intakes,
            run: concrete,
          };
        }
        const [first, second] = open ? [] : group.entries;
        const sides: SideNames =
          first === undefined || second === undefined
            ? EXEMPLAR_SIDES
            : {
                a: entryName(first, def, registry),
                b: entryName(second, def, registry),
                white: 0,
              };
        return {
          id: group.id,
          entrants,
          header: {
            kind: "group",
            title: group.name ?? group.id,
            badge: undefined,
            lines: [entrantsLine, ...inflowLines],
          },
          intakes,
          run: {
            kind: "encounter",
            node: concretifyNode(run, { sides, drawn: false }, registry),
          },
        };
      });

      return {
        id: stage.id,
        intakes: groups.flatMap((group) => group.intakes),
        card: {
          kind: "stage",
          title: stage.name ?? stage.id,
          badge: groups.length > 1 ? `${groups.length} groups` : undefined,
          lines: groups.map(
            (group) =>
              `${group.id} · ${
                group.entrants === "open"
                  ? "open entry"
                  : `${group.entrants} entrants`
              }`,
          ),
        },
        groups,
      };
    },
  );

  // Dependency depth: a stage sits one tier past the deepest stage it seeds
  // from; no inflows means tier 0. Sources always precede (validated).
  const tierOf = new Map<string, number>();
  for (const stage of built) {
    const inflows = stage.intakes.flatMap((intake) =>
      intake.from.map((source) => source.stage),
    );
    const tier = inflows.reduce(
      (max, source) => Math.max(max, (tierOf.get(source) ?? 0) + 1),
      0,
    );
    tierOf.set(stage.id, tier);
  }
  return {
    stages: built.map((stage) => ({
      ...stage,
      tier: tierOf.get(stage.id) ?? 0,
    })),
  };
}
