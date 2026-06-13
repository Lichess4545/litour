// @vitest-environment node
import { describe, expect, it } from "vitest";
import { game, group, play, ranks, top } from "./compose";

/**
 * The combinators' one contract: a terminal emits EXACTLY the literal an
 * arbiter would write by hand. Pinned with toStrictEqual because the
 * registry's looseObject schemas would let a drifted or extra key pass
 * unnoticed; three representative literals cover the wire grammar without
 * restating every constructor.
 */

const g = game({ initial: 300, increment: 2 });

describe("the fluent layer emits the bare wire shapes", () => {
  it("a seeded leaf: registration slots, no name key when unnamed", () => {
    expect(play(g).enter(2).as("a")).toStrictEqual({
      id: "a",
      entries: [
        { kind: "registration", seed: 1 },
        { kind: "registration", seed: 2 },
      ],
      run: g,
    });
  });

  it("flows concatenate variadically and compile to bare source ids", () => {
    const a = play(g).enter(2).as("a");
    expect(play(g).from(top(a, 1), ranks(a, 2)).as("b", "B")).toStrictEqual({
      id: "b",
      name: "B",
      entries: [
        { kind: "rank", of: "a", rank: 1 },
        { kind: "rank", of: "a", rank: 2 },
      ],
      run: g,
    });
  });

  it("a container: children in order, never an entries key", () => {
    const a = play(g).enter(2).as("a");
    expect(group(a).as("c")).toStrictEqual({
      id: "c",
      run: { kind: "competitions", competitions: [a] },
    });
  });
});
