import {
  buildRegistry,
  type ModelRegistry,
  type ParsedEventDef,
  parseEventDef as parseWith,
  safeParseEventDef as safeParseWith,
} from "@/tournament/registry";
import { builtinEncounters } from "./encounters";
import { builtinPairings } from "./pairings";
import { builtinScorings } from "./scoring-rules";
import { builtinSeeds } from "./seeds";
import { builtinMetrics } from "./tiebreaks";
import { builtinTies } from "./ties";

/**
 * The standard chess library, assembled like any third party would: every
 * kind here goes through the public defineX/buildRegistry API — the
 * tournament system itself contains none of this vocabulary.
 */
export const chessRegistry: ModelRegistry = buildRegistry({
  encounters: builtinEncounters,
  pairings: builtinPairings,
  scorings: builtinScorings,
  metrics: builtinMetrics,
  ties: builtinTies,
  seeds: builtinSeeds,
});

/** Parse an event definition against the standard chess registry. */
export const parseEventDef = (data: unknown): ParsedEventDef =>
  parseWith(data, chessRegistry);

export const safeParseEventDef = (data: unknown) =>
  safeParseWith(data, chessRegistry);
