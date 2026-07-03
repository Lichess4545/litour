// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { CompetitionDef, CompetitorDef } from "@/tournament/core";
import { competitorId } from "@/tournament/core";
import { isContainer } from "@/tournament/registry";
import { foldDefinition } from "./fold";
import type { DefChange } from "./types";

const leaf = (id: string): CompetitionDef => ({
  id,
  entries: { open: true },
  run: {
    kind: "pool",
    pairing: { system: "swiss" },
    rounds: 3,
    encounter: { kind: "game", clock: { initial: 180, increment: 2 } },
    score: { kind: "passThrough" },
    tiebreaks: [],
  },
});

const container = (
  id: string,
  ...competitions: readonly CompetitionDef[]
): CompetitionDef => ({ id, run: { kind: "competitions", competitions } });

const alice: CompetitorDef = { id: competitorId("alice"), name: "Alice" };
const bob: CompetitorDef = { id: competitorId("bob"), name: "Bob" };

const created = (competition: CompetitionDef): DefChange => ({
  type: "definition-created",
  name: "Test event",
  competition,
});

const expectError = (
  changes: readonly DefChange[],
  kind: string,
  index: number,
): void => {
  const result = foldDefinition("stream", changes);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.kind).toBe(kind);
    expect(result.error.index).toBe(index);
  }
};

describe("foldDefinition — happy paths", () => {
  it("definition-created seeds the candidate; def id := stream id", () => {
    const result = foldDefinition("my-stream", [created(leaf("main"))]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.candidate).toEqual({
        id: "my-stream",
        name: "Test event",
        competitors: [],
        competition: leaf("main"),
      });
    }
  });

  it("definition-renamed replaces the name", () => {
    const result = foldDefinition("s", [
      created(leaf("main")),
      { type: "definition-renamed", name: "Renamed" },
    ]);
    expect(result.ok && result.candidate.name).toBe("Renamed");
  });

  it("competitor-added appends, respects index, keeps order", () => {
    const result = foldDefinition("s", [
      created(leaf("main")),
      { type: "competitor-added", competitor: alice },
      { type: "competitor-added", competitor: bob, index: 0 },
    ]);
    expect(result.ok && result.candidate.competitors).toEqual([bob, alice]);
  });

  it("competitor-added with out-of-range index appends", () => {
    const result = foldDefinition("s", [
      created(leaf("main")),
      { type: "competitor-added", competitor: alice, index: 99 },
    ]);
    expect(result.ok && result.candidate.competitors).toEqual([alice]);
  });

  it("competitor-updated replaces in place", () => {
    const richer: CompetitorDef = { ...alice, rating: 2000 };
    const result = foldDefinition("s", [
      created(leaf("main")),
      { type: "competitor-added", competitor: alice },
      { type: "competitor-added", competitor: bob },
      { type: "competitor-updated", competitorId: "alice", competitor: richer },
    ]);
    expect(result.ok && result.candidate.competitors).toEqual([richer, bob]);
  });

  it("competitor-removed removes", () => {
    const result = foldDefinition("s", [
      created(leaf("main")),
      { type: "competitor-added", competitor: alice },
      { type: "competitor-removed", competitorId: "alice" },
    ]);
    expect(result.ok && result.candidate.competitors).toEqual([]);
  });

  it("competition-added inserts into a nested container at index", () => {
    const root = container("season", container("inner", leaf("a")));
    const result = foldDefinition("s", [
      created(root),
      {
        type: "competition-added",
        parentId: "inner",
        competition: leaf("b"),
        index: 0,
      },
    ]);
    expect(result.ok && result.candidate.competition).toEqual(
      container("season", container("inner", leaf("b"), leaf("a"))),
    );
  });

  it("competition-renamed sets and clears the display name", () => {
    const result = foldDefinition("s", [
      created(container("season", leaf("a"))),
      { type: "competition-renamed", competitionId: "a", name: "Division A" },
    ]);
    expect(result.ok && result.candidate.competition).toEqual(
      container("season", { ...leaf("a"), name: "Division A" }),
    );

    const cleared = foldDefinition("s", [
      created(container("season", { ...leaf("a"), name: "Division A" })),
      { type: "competition-renamed", competitionId: "a" },
    ]);
    expect(cleared.ok && cleared.candidate.competition).toEqual(
      container("season", leaf("a")),
    );
    if (cleared.ok && isContainer(cleared.candidate.competition.run)) {
      const child = cleared.candidate.competition.run.competitions[0];
      expect(child !== undefined && "name" in child).toBe(false);
    }
  });

  it("competition-removed prunes a child", () => {
    const result = foldDefinition("s", [
      created(container("season", leaf("a"), leaf("b"))),
      { type: "competition-removed", competitionId: "a" },
    ]);
    expect(result.ok && result.candidate.competition).toEqual(
      container("season", leaf("b")),
    );
  });

  it("run-set replaces a run wholesale; entries-set null clears entries", () => {
    const result = foldDefinition("s", [
      created(leaf("main")),
      {
        type: "run-set",
        competitionId: "main",
        run: { kind: "competitions", competitions: [leaf("a")] },
      },
      { type: "entries-set", competitionId: "main", entries: null },
    ]);
    expect(result.ok && result.candidate.competition).toEqual(
      container("main", leaf("a")),
    );
    if (result.ok) {
      expect("entries" in result.candidate.competition).toBe(false);
    }
  });

  it("entries-set binds a seed list", () => {
    const result = foldDefinition("s", [
      created(leaf("main")),
      {
        type: "entries-set",
        competitionId: "main",
        entries: [{ kind: "registration", seed: 1 }],
      },
    ]);
    expect(result.ok && result.candidate.competition.entries).toEqual([
      { kind: "registration", seed: 1 },
    ]);
  });
});

describe("foldDefinition — every FoldError", () => {
  it("streamNotCreated: first change must be definition-created", () => {
    expectError(
      [{ type: "definition-renamed", name: "X" }],
      "streamNotCreated",
      0,
    );
    expectError([], "streamNotCreated", 0);
  });

  it("alreadyCreated: a second definition-created is refused", () => {
    expectError([created(leaf("a")), created(leaf("b"))], "alreadyCreated", 1);
  });

  it("unknownCompetition: rename/remove/run-set/entries-set on a missing id", () => {
    expectError(
      [
        created(leaf("main")),
        { type: "competition-renamed", competitionId: "nope" },
      ],
      "unknownCompetition",
      1,
    );
    expectError(
      [
        created(leaf("main")),
        { type: "competition-removed", competitionId: "nope" },
      ],
      "unknownCompetition",
      1,
    );
    expectError(
      [
        created(leaf("main")),
        { type: "run-set", competitionId: "nope", run: leaf("x").run },
      ],
      "unknownCompetition",
      1,
    );
    expectError(
      [
        created(leaf("main")),
        { type: "entries-set", competitionId: "nope", entries: null },
      ],
      "unknownCompetition",
      1,
    );
    expectError(
      [
        created(leaf("main")),
        { type: "competition-added", parentId: "nope", competition: leaf("x") },
      ],
      "unknownCompetition",
      1,
    );
  });

  it("parentNotContainer: adding under a leaf", () => {
    expectError(
      [
        created(leaf("main")),
        { type: "competition-added", parentId: "main", competition: leaf("x") },
      ],
      "parentNotContainer",
      1,
    );
  });

  it("duplicateCompetitionId: an added subtree colliding anywhere in the tree", () => {
    expectError(
      [
        created(container("season", leaf("a"))),
        {
          type: "competition-added",
          parentId: "season",
          competition: leaf("a"),
        },
      ],
      "duplicateCompetitionId",
      1,
    );
    expectError(
      [
        created(container("season", leaf("a"))),
        {
          type: "competition-added",
          parentId: "season",
          competition: container("fresh", leaf("a")),
        },
      ],
      "duplicateCompetitionId",
      1,
    );
  });

  it("unknownCompetitor: update/remove on a missing competitor", () => {
    expectError(
      [
        created(leaf("main")),
        {
          type: "competitor-updated",
          competitorId: "alice",
          competitor: alice,
        },
      ],
      "unknownCompetitor",
      1,
    );
    expectError(
      [
        created(leaf("main")),
        { type: "competitor-removed", competitorId: "alice" },
      ],
      "unknownCompetitor",
      1,
    );
  });

  it("duplicateCompetitorId: adding the same id twice", () => {
    expectError(
      [
        created(leaf("main")),
        { type: "competitor-added", competitor: alice },
        {
          type: "competitor-added",
          competitor: { ...alice, name: "Alice II" },
        },
      ],
      "duplicateCompetitorId",
      2,
    );
  });

  it("competitorIdMismatch: update payload id must equal competitorId", () => {
    const result = foldDefinition("s", [
      created(leaf("main")),
      { type: "competitor-added", competitor: alice },
      { type: "competitor-updated", competitorId: "alice", competitor: bob },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({
        kind: "competitorIdMismatch",
        index: 2,
        competitorId: "alice",
        payloadId: "bob",
      });
    }
  });

  it("rootRemoval: the root competition cannot be removed", () => {
    expectError(
      [
        created(leaf("main")),
        { type: "competition-removed", competitionId: "main" },
      ],
      "rootRemoval",
      1,
    );
  });
});

describe("foldDefinition — purity", () => {
  it("does not mutate its inputs and is deterministic", () => {
    const changes: readonly DefChange[] = [
      created(container("season", leaf("a"))),
      { type: "competitor-added", competitor: alice },
      { type: "competition-added", parentId: "season", competition: leaf("b") },
      { type: "competition-renamed", competitionId: "b", name: "B" },
    ];
    const snapshot = structuredClone(changes);
    const first = foldDefinition("s", changes);
    const second = foldDefinition("s", changes);
    expect(changes).toEqual(snapshot);
    expect(second).toEqual(first);
  });
});
