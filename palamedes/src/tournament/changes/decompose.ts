import type { ParsedEventDef } from "../registry";
import type { DefChange } from "./types";

/**
 * Emits the canonical seeder batch for a definition stream: `foldDefinition`
 * over this output, then `safeParseEventDef`, reconstructs the original def exactly.
 *
 * NOTE: design/adr/0005-lichess4545-seed-canon.md — seeder canon and idempotency contract.
 */
export const definitionToChanges = (
  def: ParsedEventDef,
): readonly DefChange[] => [
  {
    type: "definition-created",
    name: def.name,
    competition: def.competition,
  },
  ...def.competitors.map(
    (competitor): DefChange => ({ type: "competitor-added", competitor }),
  ),
];
