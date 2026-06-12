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
  /** Undefined while a drawing of lots decides who gets white. */
  readonly sides: ConcreteSides | undefined;
  /** This node's colors come from a drawing of lots. */
  readonly drawnColors: boolean;
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
 * What happens after a round's encounters resolve: outcomes go through the
 * scoring rule, standings update, and (unless this was the last round) the
 * pairing system pairs the next round from them.
 */
export type ConcreteProcess = {
  readonly scoring: ConcreteCard;
  readonly standings: ConcreteCard;
  /** Undefined after the final round: nothing left to pair. */
  readonly repair: ConcreteCard | undefined;
};

export type ConcreteRound = {
  readonly label: string;
  readonly pairings: Many<ConcretePairing>;
  readonly process: ConcreteProcess;
};

export type ConcreteRun =
  | {
      readonly kind: "rounds";
      /** The pairing system key (display chip / badge). */
      readonly system: string;
      readonly score: string;
      readonly rounds: Many<ConcreteRound>;
    }
  | { readonly kind: "encounter"; readonly node: ConcreteNode };

/** A competitor flow from an earlier group (drawn as a seed edge). */
export type ConcreteSeedLink = {
  readonly stage: string;
  readonly group: string;
  readonly rank: number | undefined;
};

export type ConcreteGroup = {
  readonly id: string;
  readonly entrants: number | "open";
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
  role: string | undefined,
  sides: SideNames,
  drawnColors: boolean,
  count: number | undefined,
  registry: ModelRegistry,
): ConcreteNode {
  const info = registry.ops.card(def);
  const children = registry.ops.structure(def).map((child) => {
    const drawn = child.seat === "draw";
    const own: SideNames =
      child.seat === "flip"
        ? { a: sides.a, b: sides.b, white: sides.white === 0 ? 1 : 0 }
        : drawn
          ? EXEMPLAR_SIDES
          : sides;
    return concretifyNode(
      child.def,
      child.role,
      own,
      drawn,
      child.count,
      registry,
    );
  });
  return {
    kind: def.kind,
    title: info.title,
    badge: info.badge,
    lines: info.lines,
    role,
    sides: drawnColors ? undefined : chips(sides),
    drawnColors,
    count,
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
): ConcreteRun {
  const pairing = registry.pairings.get(pool.pairing.system);

  const pairingsOf = (round: number): Many<ConcretePairing> => {
    const node = concretifyNode(
      pool.encounter,
      undefined,
      EXEMPLAR_SIDES,
      false,
      undefined,
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
  const processOf = (last: boolean): ConcreteProcess => ({
    scoring,
    standings,
    repair: last ? undefined : repair,
  });

  const roundCount =
    pool.rounds ??
    (entrants !== "open" && pairing?.totalRounds !== undefined
      ? pairing.totalRounds(pool.pairing, entrants)
      : "open");
  const rounds: Many<ConcreteRound> =
    roundCount === "open"
      ? {
          open: true,
          items: Array.from({ length: OPEN_EXAMPLES }, (_, i) => ({
            label: `Round ${i + 1}`,
            pairings: pairingsOf(i + 1),
            process: processOf(false),
          })),
          more: {
            label: "… Round n",
            pairings: pairingsOf(OPEN_EXAMPLES + 1),
            process: processOf(true),
          },
        }
      : {
          open: false,
          items: Array.from({ length: roundCount }, (_, i) => ({
            label: `Round ${i + 1}`,
            pairings: pairingsOf(i + 1),
            process: processOf(i === roundCount - 1),
          })),
        };

  return {
    kind: "rounds",
    system: pool.pairing.system,
    score: pool.score.kind,
    rounds,
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
        const seededFrom = open
          ? []
          : group.entries.flatMap((entry): ConcreteSeedLink[] => {
              const origin = registry.seeds.get(entry.kind)?.origin?.(entry);
              return origin === undefined
                ? []
                : [
                    {
                      stage: origin.stage,
                      group: origin.group,
                      rank: origin.rank,
                    },
                  ];
            });
        const run = group.run;
        if (isPool(run)) {
          return {
            id: group.id,
            entrants,
            seededFrom,
            run: concretifyPool(run, entrants, registry),
          };
        }
        const sides: SideNames = open
          ? EXEMPLAR_SIDES
          : {
              a: entryName(group.entries[0] ?? { kind: "?" }, def, registry),
              b: entryName(group.entries[1] ?? { kind: "?" }, def, registry),
              white: 0,
            };
        return {
          id: group.id,
          entrants,
          seededFrom,
          run: {
            kind: "encounter",
            node: concretifyNode(
              run,
              undefined,
              sides,
              false,
              undefined,
              registry,
            ),
          },
        };
      }),
    })),
  };
}
