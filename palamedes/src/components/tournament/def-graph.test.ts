// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  armageddonShowdown,
  lichess4545,
  worldCup,
  worldUniversityChampionship,
} from "@/chess/formats";
import { chessRegistry } from "@/chess/registry";
import { concretify } from "@/tournament/concrete";
import type { ParsedEventDef } from "@/tournament/registry";
import { buildGraph, type FlowGraph } from "./def-graph";

/**
 * `buildGraph` is a pure projection of the concrete structure onto React
 * Flow nodes/edges — no DOM — so it is tested here directly. These pin the
 * load-bearing layout rules (the viewer component itself is only browser-
 * verified): the force-expand of a single-drillable item, the ×N round
 * fold, container tiers with intake edges, and the knockout bracket whose
 * edges must target nodes that actually exist when pairings are folded.
 */

const graphOf = (
  def: ParsedEventDef,
  expanded: readonly string[] = [],
): FlowGraph => buildGraph(concretify(def, chessRegistry), new Set(expanded));

const ids = (g: FlowGraph): ReadonlySet<string> =>
  new Set(g.nodes.map((n) => n.id));

describe("buildGraph — the single-drillable force rule", () => {
  it("force-expands a lone encounter leaf to its run and forbids collapsing it", () => {
    const g = graphOf(armageddonShowdown);
    // The root "duel" opens to its frame + the encounter run beneath it…
    expect(ids(g).has("s:duel")).toBe(true);
    expect(ids(g).has("s:duel/run")).toBe(true);
    // …but a forced item cannot be folded back.
    expect(g.collapsibles.has("s:duel")).toBe(false);
  });
});

describe("buildGraph — the ×N round fold", () => {
  it("folds eight identical rounds into one stack, unfoldable in place", () => {
    const collapsed = graphOf(lichess4545);
    // Eight identical league rounds collapse to a single ×N step + a final.
    expect(ids(collapsed).has("s:league/rs")).toBe(true);
    expect(ids(collapsed).has("s:league/r1")).toBe(false);
    expect(collapsed.expandables.has("s:league/rs")).toBe(true);

    // Unfolding the stack exposes the individual rounds.
    const opened = graphOf(lichess4545, ["s:league/rs"]);
    expect(ids(opened).has("s:league/r1")).toBe(true);
  });
});

describe("buildGraph — containers, tiers, and intakes", () => {
  it("lays out a container's children as drillable cards fed by intake edges", () => {
    const g = graphOf(worldUniversityChampionship);
    // Every top-level child of the forced root is its own collapsible card.
    for (const child of [
      "s:qualifiers",
      "s:knockout",
      "s:otb-groups",
      "s:medals",
    ]) {
      expect(g.expandables.has(child)).toBe(true);
    }
    // The knockout draws its field from the qualifiers: intake icons exist
    // and seed-kind edges connect them.
    expect(g.nodes.some((n) => n.id.startsWith("in:"))).toBe(true);
    const seedEdges = g.edges.filter((e) => e.kind === "seed");
    expect(seedEdges.length).toBeGreaterThan(0);
    // At least one seed flow terminates at the knockout it feeds.
    expect(seedEdges.some((e) => e.target === "s:knockout")).toBe(true);
  });
});

describe("buildGraph — knockout brackets target live nodes", () => {
  it("draws winner edges between two open rounds even when pairings are folded", () => {
    // Round 1 (four identical ties) folds to its /ps stack; round 2 does
    // not. The bracket edge must anchor to the folded stack, not a /p<n>
    // node that was never laid out.
    const g = graphOf(worldCup, ["s:bracket/r1", "s:bracket/r2"]);
    const winnerEdges = g.edges.filter((e) => e.label === "winner");
    expect(winnerEdges.length).toBeGreaterThan(0);
    const laid = ids(g);
    for (const edge of winnerEdges) {
      expect(laid.has(edge.source)).toBe(true);
      expect(laid.has(edge.target)).toBe(true);
    }
  });
});

describe("buildGraph — every edge connects nodes that exist", () => {
  it("never emits a dangling endpoint across formats and expansion depths", () => {
    const cases: ReadonlyArray<readonly [ParsedEventDef, readonly string[]]> = [
      [armageddonShowdown, []],
      [lichess4545, []],
      [lichess4545, ["s:league/rs"]],
      [worldUniversityChampionship, []],
      [worldUniversityChampionship, ["s:knockout", "s:qualifiers"]],
      [worldCup, ["s:bracket/r1", "s:bracket/r2"]],
    ];
    for (const [def, expanded] of cases) {
      const g = graphOf(def, expanded);
      const laid = ids(g);
      for (const edge of g.edges) {
        expect(laid.has(edge.source)).toBe(true);
        expect(laid.has(edge.target)).toBe(true);
      }
    }
  });
});
