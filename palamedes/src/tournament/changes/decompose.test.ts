// @vitest-environment node
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  candidates,
  FORMAT_EXAMPLES,
  lichess4545Season,
  wuccKnockoutUpfront,
} from "@/chess/formats";
import { parseEventDef, safeParseEventDef } from "@/chess/registry";
import type { ParsedEventDef } from "@/tournament/registry";
import { definitionToChanges } from "./decompose";
import { foldDefinition } from "./fold";

const LIBRARY: readonly {
  readonly slug: string;
  readonly def: ParsedEventDef;
}[] = [
  ...FORMAT_EXAMPLES.map(({ slug, def }) => ({ slug, def })),
  { slug: "candidates-const", def: candidates },
  { slug: "lichess4545-season-const", def: lichess4545Season },
  { slug: "wucc-knockout-upfront-const", def: wuccKnockoutUpfront },
];

describe("definitionToChanges — canonical decomposition", () => {
  it("emits definition-created first, then one competitor-added per competitor, in order", () => {
    const changes = definitionToChanges(lichess4545Season);
    expect(changes).toHaveLength(1 + lichess4545Season.competitors.length);
    const [first, ...rest] = changes;
    expect(first).toEqual({
      type: "definition-created",
      name: lichess4545Season.name,
      competition: lichess4545Season.competition,
    });
    expect(rest).toEqual(
      lichess4545Season.competitors.map((competitor) => ({
        type: "competitor-added",
        competitor,
      })),
    );
  });

  it.each(LIBRARY)(
    "round-trips $slug: fold(decompose(def)) gates back to the same def",
    ({ def }) => {
      const folded = foldDefinition(def.id, definitionToChanges(def));
      expect(folded.ok).toBe(true);
      if (!folded.ok) return;
      const gated = safeParseEventDef(folded.candidate);
      expect(gated.success).toBe(true);
      if (gated.success) expect(gated.data).toEqual(def);
    },
  );

  it("round-trips generated round robins (fast-check)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 8 }), (n) => {
        const def = parseEventDef({
          id: "rt-prop",
          name: `Round robin of ${n}`,
          competitors: Array.from({ length: n }, (_, i) => ({
            id: `p${i + 1}`,
            name: `P${i + 1}`,
          })),
          competition: {
            id: "rr",
            entries: Array.from({ length: n }, (_, i) => ({
              kind: "registration",
              seed: i + 1,
            })),
            run: {
              kind: "pool",
              pairing: { system: "roundRobin", cycles: 1 },
              encounter: {
                kind: "game",
                clock: { initial: 180, increment: 2 },
              },
              score: { kind: "passThrough" },
              bye: { kind: "points", standings: 0, encounter: 0 },
              tiebreaks: [],
            },
          },
        });
        const folded = foldDefinition(def.id, definitionToChanges(def));
        expect(folded.ok).toBe(true);
        if (!folded.ok) return;
        const gated = safeParseEventDef(folded.candidate);
        expect(gated.success).toBe(true);
        if (!gated.success) return;
        expect(gated.data).toEqual(def);
      }),
      { numRuns: 25 },
    );
  });
});
