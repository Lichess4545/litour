// @vitest-environment node
import { describe, expect, it } from "vitest";
import { type CompetitorId, competitorIdSchema } from "@/tournament/core";
import type {
  SeedContext,
  SeedKind,
  SeedValidateContext,
} from "@/tournament/registry";
import { chessRegistry } from "./registry";

/**
 * The built-in seed kinds in isolation: resolve (entry → competitor) and
 * validate (the design-time rejections). The format catalog drives
 * registration/rank/placements through the engine; this pins the branches
 * it doesn't reach — `fixed` (used by no format), the self-reference and
 * out-of-range rejections, and the placements rank bound.
 */

const seed = (kind: string): SeedKind => {
  const k = chessRegistry.seeds.get(kind);
  if (k === undefined) throw new Error(`no seed kind ${kind}`);
  return k;
};

const id = (s: string): CompetitorId => competitorIdSchema.parse(s);

const issuesOf = (
  fn: (
    issue: (message: string, path?: readonly (string | number)[]) => void,
  ) => void,
): readonly string[] => {
  const out: string[] = [];
  fn((message) => out.push(message));
  return out;
};

const competitors = [
  { id: id("a"), name: "A" },
  { id: id("b"), name: "B" },
];
const ctx = (
  ranking: SeedContext["ranking"] = () => undefined,
): SeedContext => ({ competitors, ranking });
const vctx = (over: SeedValidateContext): SeedValidateContext => over;

describe("registration seed", () => {
  it("resolves the nth declared competitor", () => {
    expect(
      seed("registration").resolve({ kind: "registration", seed: 2 }, ctx()),
    ).toBe(id("b"));
  });

  it("rejects a slot past the declared field", () => {
    expect(
      issuesOf((issue) =>
        seed("registration").validate?.(
          { kind: "registration", seed: 3 },
          vctx({ competitors, sizes: new Map(), self: "g" }),
          issue,
        ),
      ),
    ).toEqual([expect.stringContaining("exceeds the 2 declared competitors")]);
  });
});

describe("fixed seed", () => {
  it("resolves to the named competitor", () => {
    expect(seed("fixed").resolve({ kind: "fixed", id: id("a") }, ctx())).toBe(
      id("a"),
    );
  });

  it("rejects an id that is no competitor", () => {
    expect(
      issuesOf((issue) =>
        seed("fixed").validate?.(
          { kind: "fixed", id: id("z") },
          vctx({ competitors, sizes: new Map(), self: "g" }),
          issue,
        ),
      ),
    ).toEqual([expect.stringContaining("unknown competitor z")]);
  });
});

describe("rank seed", () => {
  it("resolves rank N of a finished source's ranking", () => {
    const ranking = new Map([["src", [id("b"), id("a")]]]);
    expect(
      seed("rank").resolve(
        { kind: "rank", of: "src", rank: 1 },
        ctx((of) => ranking.get(of)),
      ),
    ).toBe(id("b"));
  });

  it("declares its origin for the intake graph", () => {
    expect(
      seed("rank").origins?.({ kind: "rank", of: "src", rank: 2 }),
    ).toEqual([{ of: "src", rank: 2 }]);
  });

  it("rejects self-reference, unknown source, and out-of-range rank", () => {
    const validate = (
      ref: unknown,
      sizes: ReadonlyMap<string, number | "open">,
      self: string,
    ) =>
      issuesOf((issue) =>
        seed("rank").validate?.(
          ref as { kind: string; [k: string]: unknown },
          vctx({ competitors, sizes, self }),
          issue,
        ),
      );
    expect(
      validate({ kind: "rank", of: "g", rank: 1 }, new Map(), "g"),
    ).toEqual([expect.stringContaining("cannot seed from its own ranking")]);
    expect(
      validate({ kind: "rank", of: "ghost", rank: 1 }, new Map(), "g"),
    ).toEqual([expect.stringContaining('unknown competition "ghost"')]);
    expect(
      validate(
        { kind: "rank", of: "src", rank: 9 },
        new Map([["src", 4]]),
        "g",
      ),
    ).toEqual([expect.stringContaining("rank 9 exceeds the 4 entries")]);
    // An open source waives the range check (its size is unknown).
    expect(
      validate(
        { kind: "rank", of: "src", rank: 9 },
        new Map<string, number | "open">([["src", "open"]]),
        "g",
      ),
    ).toEqual([]);
  });
});

describe("placements seed", () => {
  const validate = (
    ref: unknown,
    sizes: ReadonlyMap<string, number | "open">,
    self: string,
  ) =>
    issuesOf((issue) =>
      seed("placements").validate?.(
        ref as { kind: string; [k: string]: unknown },
        vctx({ competitors, sizes, self }),
        issue,
      ),
    );

  it("rejects a rank exceeding the summed closed field", () => {
    // Two 4-entry sources: at most 8 distinct competitors, so rank 9 is
    // unattainable — caught here, not left to hang in awaitSeeding.
    expect(
      validate(
        { kind: "placements", over: ["x", "y"], points: [3, 1], rank: 9 },
        new Map([
          ["x", 4],
          ["y", 4],
        ]),
        "finals",
      ),
    ).toEqual([expect.stringContaining("exceeds the at most 8 competitors")]);
  });

  it("waives the bound when any source is open", () => {
    expect(
      validate(
        { kind: "placements", over: ["x", "y"], points: [3, 1], rank: 99 },
        new Map<string, number | "open">([
          ["x", 4],
          ["y", "open"],
        ]),
        "finals",
      ),
    ).toEqual([]);
  });

  it("rejects self-aggregation and unknown sources", () => {
    expect(
      validate(
        { kind: "placements", over: ["finals"], points: [1], rank: 1 },
        new Map([["finals", 4]]),
        "finals",
      ),
    ).toEqual([expect.stringContaining("cannot aggregate its own ranking")]);
    expect(
      validate(
        { kind: "placements", over: ["ghost"], points: [1], rank: 1 },
        new Map(),
        "finals",
      ),
    ).toEqual([expect.stringContaining('unknown competition "ghost"')]);
  });
});
