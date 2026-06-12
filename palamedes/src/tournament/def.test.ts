// @vitest-environment node
import { describe, expect, it } from "vitest";
import { FORMAT_EXAMPLES } from "@/chess/formats";
import { safeParseEventDef } from "@/chess/registry";
import {
  appendPath,
  groupRootPath,
  nodePath,
  nodePathSchema,
  pathSegments,
} from "./core";

// A minimal valid event the rejection cases below mutate.
const baseEvent = (overrides: Record<string, unknown>) => ({
  id: "test",
  name: "Test",
  competitors: [
    { id: "a", name: "A" },
    { id: "b", name: "B" },
    { id: "c", name: "C" },
  ],
  stages: [
    {
      id: "main",
      groups: [
        {
          id: "g",
          entries: [
            { kind: "registration", seed: 1 },
            { kind: "registration", seed: 2 },
          ],
          run: { kind: "game", clock: { initial: 300, increment: 2 } },
        },
      ],
    },
  ],
  ...overrides,
});

const failureMessages = (data: unknown): string => {
  const parsed = safeParseEventDef(data);
  expect(parsed.success).toBe(false);
  return parsed.success
    ? ""
    : parsed.error.issues.map((i) => i.message).join("\n");
};

describe("parseEventDef", () => {
  it("format examples have unique slugs (parsing happened at import)", () => {
    expect(new Set(FORMAT_EXAMPLES.map((f) => f.slug)).size).toBe(
      FORMAT_EXAMPLES.length,
    );
  });

  it("rejects knockout pools whose field is not a power of two", () => {
    const messages = failureMessages(
      baseEvent({
        stages: [
          {
            id: "main",
            groups: [
              {
                id: "ko",
                entries: [1, 2, 3].map((seed) => ({
                  kind: "registration",
                  seed,
                })),
                run: {
                  kind: "pool",
                  pairing: { system: "knockout", seeding: "adjacent" },
                  encounter: {
                    kind: "game",
                    clock: { initial: 300, increment: 2 },
                  },
                  score: { kind: "passThrough" },
                  tiebreaks: [],
                },
              },
            ],
          },
        ],
      }),
    );
    expect(messages).toContain("power-of-two");
  });

  it("requires rounds on swiss pools and forbids them on round robins", () => {
    const pool = (pairing: object, rounds?: number) => ({
      kind: "pool",
      pairing,
      ...(rounds === undefined ? {} : { rounds }),
      encounter: { kind: "game", clock: { initial: 300, increment: 2 } },
      score: { kind: "passThrough" },
      tiebreaks: [],
    });
    const group = (run: object) =>
      baseEvent({
        stages: [
          {
            id: "main",
            groups: [
              {
                id: "g",
                entries: [1, 2].map((seed) => ({ kind: "registration", seed })),
                run,
              },
            ],
          },
        ],
      });
    expect(failureMessages(group(pool({ system: "swiss" })))).toContain(
      "must declare rounds",
    );
    expect(
      failureMessages(group(pool({ system: "roundRobin", cycles: 1 }, 3))),
    ).toContain("derive their round count");
  });

  it("rejects byLeg scoring that does not match the series", () => {
    const messages = failureMessages(
      baseEvent({
        stages: [
          {
            id: "main",
            groups: [
              {
                id: "g",
                entries: [1, 2].map((seed) => ({ kind: "registration", seed })),
                run: {
                  kind: "pool",
                  pairing: { system: "roundRobin", cycles: 1 },
                  encounter: {
                    kind: "series",
                    legs: [
                      { kind: "game", clock: { initial: 300, increment: 2 } },
                    ],
                    stop: { untilDecided: true },
                    seats: { source: "inherit", cycle: ["keep"] },
                  },
                  score: {
                    kind: "table",
                    draw: 0,
                    legs: [
                      { win: 3, loss: 0 },
                      { win: 1.5, loss: 1 },
                    ],
                  },
                  tiebreaks: [],
                },
              },
            ],
          },
        ],
      }),
    );
    expect(messages).toContain(
      "leg-keyed table declares 2 rows but the encounter has 1 legs",
    );
  });

  it("rejects rank seeds that reference the same or a later stage", () => {
    const messages = failureMessages(
      baseEvent({
        stages: [
          {
            id: "main",
            groups: [
              {
                id: "g",
                entries: [
                  { kind: "registration", seed: 1 },
                  { kind: "rank", stage: "main", group: "g", rank: 1 },
                ],
                run: { kind: "game", clock: { initial: 300, increment: 2 } },
              },
            ],
          },
        ],
      }),
    );
    expect(messages).toContain("must reference an earlier stage");
  });

  it("rejects duplicate competitor ids and unreachable firstTo targets", () => {
    expect(
      failureMessages(
        baseEvent({
          competitors: [
            { id: "a", name: "A" },
            { id: "a", name: "A2" },
          ],
        }),
      ),
    ).toContain("duplicate competitor id");

    expect(
      failureMessages(
        baseEvent({
          stages: [
            {
              id: "main",
              groups: [
                {
                  id: "g",
                  entries: [1, 2].map((seed) => ({
                    kind: "registration",
                    seed,
                  })),
                  run: {
                    kind: "series",
                    legs: [
                      { kind: "game", clock: { initial: 300, increment: 2 } },
                      { kind: "game", clock: { initial: 300, increment: 2 } },
                    ],
                    stop: { untilScore: 7.5 },
                    seats: { source: "inherit", cycle: ["keep", "flip"] },
                  },
                },
              ],
            },
          ],
        }),
      ),
    ).toContain("exceeds the 2 points reachable");
  });

  it("rejects rosters smaller than the deepest match", () => {
    const messages = failureMessages(
      baseEvent({
        competitors: [
          { id: "a", name: "A", roster: ["a1"] },
          { id: "b", name: "B", roster: ["b1", "b2"] },
        ],
        stages: [
          {
            id: "main",
            groups: [
              {
                id: "g",
                entries: [1, 2].map((seed) => ({ kind: "registration", seed })),
                run: {
                  kind: "match",
                  boards: 2,
                  board: {
                    kind: "game",
                    clock: { initial: 300, increment: 2 },
                  },
                  seats: { cycle: ["keep", "flip"] },
                },
              },
            ],
          },
        ],
      }),
    );
    expect(messages).toContain("needs a roster of at least 2 players");
  });

  it("rejects root encounters without exactly two entries", () => {
    const messages = failureMessages(
      baseEvent({
        stages: [
          {
            id: "main",
            groups: [
              {
                id: "g",
                entries: [1, 2, 3].map((seed) => ({
                  kind: "registration",
                  seed,
                })),
                run: { kind: "game", clock: { initial: 300, increment: 2 } },
              },
            ],
          },
        ],
      }),
    );
    expect(messages).toContain("exactly 2 entries");
  });
});

describe("node paths", () => {
  it("round-trips through segments", () => {
    const path = appendPath(
      appendPath(groupRootPath("otb", "ko"), { kind: "round", n: 2 }),
      { kind: "pair", n: 3 },
    );
    expect(path).toBe("stage-otb/group-ko/round-2/pair-3");
    expect(pathSegments(path)).toEqual([
      { kind: "stage", id: "otb" },
      { kind: "group", id: "ko" },
      { kind: "round", n: 2 },
      { kind: "pair", n: 3 },
    ]);
  });

  it("rejects malformed paths", () => {
    for (const bad of [
      "round-0",
      "Stage-a/group-b",
      "stage-a//group-b",
      "stage-a/board-x",
      "leg-1", // grammar requires a stage/group root
      "stage-a/group-b/pair-1", // a pair only exists inside a round
    ]) {
      expect(nodePathSchema.safeParse(bad).success).toBe(false);
    }
    expect(() => nodePath([{ kind: "stage", id: "UPPER" }])).toThrow();
  });
});
