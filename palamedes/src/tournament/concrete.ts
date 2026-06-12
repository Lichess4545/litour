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

/** A competitor flow from an earlier group (drawn as a seed edge). */
export type ConcreteSeedLink = {
  readonly stage: string;
  readonly group: string;
  /** Edge wording ("winner", "#3"); the seed kind's origin decides it. */
  readonly label: string | undefined;
};

export type ConcreteGroup = {
  readonly id: string;
  readonly entrants: number | "open";
  /** The lane's header card (entrants, scoring, schedule badge). */
  readonly header: ConcreteCard;
  readonly seededFrom: readonly ConcreteSeedLink[];
  readonly run: ConcreteRun;
};

export type ConcreteStage = {
  readonly id: string;
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
      { role: child.role, count: child.count, sides: own, drawn },
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
  const origin = seedKind?.origin?.(entry);
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

  const pairingsOf = (round: number): Many<ConcretePairing> => {
    const node = concretifyNode(
      pool.encounter,
      { sides: EXEMPLAR_SIDES, drawn: false },
      registry,
    );
    if (entrants === "open") {
      const items = Array.from({ length: OPEN_EXAMPLES }, (_, i) => ({
        label: `pairing ${i + 1}`,
        node,
      }));
      return { open: true, items, more: { label: "… pairing n", node } };
    }
    const count =
      pairing?.pairsInRound?.(pool.pairing, entrants, round) ??
      Math.floor(entrants / 2);
    return {
      open: false,
      items: Array.from({ length: count }, (_, i) => ({
        label: `pairing ${i + 1}`,
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
    title: "Pair next round",
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
  });
  const rounds: Many<ConcreteRound> =
    roundCount === "open"
      ? {
          open: true,
          items: Array.from({ length: OPEN_EXAMPLES }, (_, i) =>
            roundOf(i + 1, `Round ${i + 1}`),
          ),
          more: roundOf(OPEN_EXAMPLES + 1, "… Round n"),
        }
      : {
          open: false,
          items: Array.from({ length: roundCount }, (_, i) =>
            roundOf(i + 1, `Round ${i + 1}`),
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
  return {
    stages: def.stages.map((stage) => ({
      id: stage.id,
      groups: stage.groups.map((group): ConcreteGroup => {
        const open = isOpenEntries(group.entries);
        const entrants = open ? ("open" as const) : group.entries.length;
        const entrantsLine = open ? "open entry" : `${entrants} entrants`;
        // One link per source group, labeled for all the seeds it sends
        // ("winner", "#3", "top 16", "4 seeds").
        const bySource = new Map<
          string,
          { stage: string; group: string; ranks: (number | undefined)[] }
        >();
        if (!open) {
          for (const entry of group.entries) {
            const origin = registry.seeds.get(entry.kind)?.origin?.(entry);
            if (origin === undefined) continue;
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
        const seededFrom = [...bySource.values()].map(
          ({ stage: s, group: g, ranks }): ConcreteSeedLink => {
            const [only] = ranks;
            const sorted = ranks.flatMap((r) => (r === undefined ? [] : [r]));
            sorted.sort((x, y) => x - y);
            const topN =
              sorted.length === ranks.length &&
              sorted.every((rank, i) => rank === i + 1);
            return {
              stage: s,
              group: g,
              label:
                ranks.length === 1
                  ? only === 1
                    ? "winner"
                    : only !== undefined
                      ? `#${only}`
                      : undefined
                  : topN
                    ? `top ${ranks.length}`
                    : `${ranks.length} seeds`,
            };
          },
        );
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
              title: group.id,
              badge: `${concrete.system} · ${roundsLabel} rounds`,
              lines: [entrantsLine, concrete.scoring.title],
            },
            seededFrom,
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
            title: group.id,
            badge: undefined,
            lines: [entrantsLine],
          },
          seededFrom,
          run: {
            kind: "encounter",
            node: concretifyNode(run, { sides, drawn: false }, registry),
          },
        };
      }),
    })),
  };
}
