// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildRegistry } from "@/tournament/registry";

describe("buildRegistry", () => {
  it("threads the registry id through to the built ModelRegistry", () => {
    const registry = buildRegistry({
      id: "x/1",
      encounters: [],
      pairings: [],
      scorings: [],
      metrics: [],
      ties: [],
      seeds: [],
    });
    expect(registry.id).toBe("x/1");
  });
});
