// @vitest-environment node
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { norwayChess } from "@/chess/formats";
import { chessRegistry, parseEventDef } from "@/chess/registry";
import type { ParsedEventDef } from "@/tournament/registry";
import { type EventRun, runEvent as runEventWith } from "./builder";
import type { GameResultCode } from "./core";
import { groupRootPath } from "./core";
import { pairingsAt, proposePairings } from "./engine";

const runEvent = (def: Parameters<typeof runEventWith>[0]) =>
  runEventWith(def, chessRegistry);

const rrEvent = (n: number, cycles: 1 | 2): ParsedEventDef =>
  parseEventDef({
    id: "rr-prop",
    name: `Round robin of ${n}`,
    competitors: Array.from({ length: n }, (_, i) => ({
      id: `p${i + 1}`,
      name: `P${i + 1}`,
    })),
    stages: [
      {
        id: "main",
        groups: [
          {
            id: "rr",
            entries: Array.from({ length: n }, (_, i) => ({
              kind: "registration",
              seed: i + 1,
            })),
            run: {
              kind: "pool",
              pairing: { system: "roundRobin", cycles },
              encounter: {
                kind: "game",
                clock: { initial: 180, increment: 2 },
              },
              score: { kind: "passThrough" },
              bye: { kind: "points", standings: 0, encounter: 0 },
              tiebreaks: [],
            },
          },
        ],
      },
    ],
  });

const playAllScheduled = (run: EventRun, result: GameResultCode): void => {
  for (const game of run.scheduled()) {
    run.submit({ kind: "gameResult", game: game.path, result });
  }
};

describe("berger round robin", () => {
  it("meets everyone exactly once per cycle with balanced colors (n = 3..9)", () => {
    for (let n = 3; n <= 9; n += 1) {
      for (const cycles of [1, 2] as const) {
        const run = runEvent(rrEvent(n, cycles));
        const pool = groupRootPath("main", "rr");
        const perCycle = n % 2 === 0 ? n - 1 : n;
        const meetings = new Map<string, number>();
        const whites = new Map<string, number>();
        const byes = new Map<string, number>();

        for (let round = 1; round <= perCycle * cycles; round += 1) {
          run.pairRound();
          const plans = pairingsAt(run.state(), pool, round) ?? [];
          const seenThisRound = new Set<string>();
          for (const plan of plans) {
            if (plan.kind === "bye") {
              byes.set(plan.competitor, (byes.get(plan.competitor) ?? 0) + 1);
              seenThisRound.add(plan.competitor);
              continue;
            }
            const key = [plan.a, plan.b].sort().join("|");
            meetings.set(key, (meetings.get(key) ?? 0) + 1);
            const white = plan.whiteSeat === 0 ? plan.a : plan.b;
            whites.set(white, (whites.get(white) ?? 0) + 1);
            seenThisRound.add(plan.a);
            seenThisRound.add(plan.b);
          }
          expect(seenThisRound.size).toBe(n); // everyone paired or bye'd, once
          playAllScheduled(run, "1-0");
        }

        const pairCount = (n * (n - 1)) / 2;
        expect(meetings.size).toBe(pairCount);
        for (const count of meetings.values()) expect(count).toBe(cycles);

        const games = (n - 1) * cycles; // everyone plays n-1 games per cycle
        for (let i = 1; i <= n; i += 1) {
          const w = whites.get(`p${i}`) ?? 0;
          const imbalance = Math.abs(2 * w - games);
          expect(imbalance).toBeLessThanOrEqual(cycles === 2 ? 0 : 1);
        }
        if (n % 2 === 1) {
          for (let i = 1; i <= n; i += 1)
            expect(byes.get(`p${i}`) ?? 0).toBe(cycles);
        } else {
          expect(byes.size).toBe(0);
        }
      }
    }
  });
});

const classicalResult = fc.constantFrom<GameResultCode>(
  "1-0",
  "0-1",
  "1/2-1/2",
);

describe("norway chess properties", () => {
  const pairNumber = (game: { readonly path: string }): number => {
    const match = /pair-(\d+)/.exec(game.path);
    return match === null ? 1 : Number.parseInt(match[1] ?? "1", 10);
  };

  /**
   * Plays all three rounds. The result of each game is fixed by its (round,
   * pair) address — not by submission order — so two runs over the same
   * arrays receive identical game→result mappings even when the submission
   * order is reversed.
   */
  const driveNorway = (
    classicals: readonly GameResultCode[],
    armageddons: readonly GameResultCode[],
    reverseWithinRound: boolean,
  ): EventRun => {
    const run = runEvent(norwayChess);
    for (let round = 1; round <= 3; round += 1) {
      run.pairRound();
      for (const source of [classicals, armageddons]) {
        const games = [...run.scheduled()].sort((a, b) =>
          a.path.localeCompare(b.path),
        );
        const ordered = reverseWithinRound ? [...games].reverse() : games;
        for (const game of ordered) {
          const index = (round - 1) * 2 + (pairNumber(game) - 1);
          run.submit({
            kind: "gameResult",
            game: game.path,
            result: source[index] ?? "1/2-1/2",
          });
        }
      }
      expect(run.scheduled()).toHaveLength(0);
    }
    return run;
  };

  const resultArrays = fc.tuple(
    fc.array(classicalResult, { minLength: 6, maxLength: 6 }),
    fc.array(classicalResult, { minLength: 6, maxLength: 6 }),
  );

  it("pays out exactly 3 per decisive classical and 2.5 per armageddon tie", () => {
    fc.assert(
      fc.property(resultArrays, ([classicals, armageddons]) => {
        const run = driveNorway(classicals, armageddons, false);
        const rows = run.standings();
        const total = rows.reduce((sum, row) => sum + row.standingsPoints, 0);
        // Norway's quirk: a decisive classical is worth 3 (3+0), but a draw
        // settled in armageddon is worth only 2.5 (1.5+1).
        const expected = classicals.reduce(
          (sum, result) => sum + (result === "1/2-1/2" ? 2.5 : 3),
          0,
        );
        expect(total).toBe(expected);
        expect(rows).toHaveLength(4);
      }),
      { numRuns: 25 },
    );
  });

  it("standings are independent of result order within a round", () => {
    fc.assert(
      fc.property(resultArrays, ([classicals, armageddons]) => {
        const forward = driveNorway(classicals, armageddons, false).standings();
        const backward = driveNorway(classicals, armageddons, true).standings();
        expect(backward).toEqual(forward);
      }),
      { numRuns: 15 },
    );
  });
});

const swissEvent = (): ParsedEventDef =>
  parseEventDef({
    id: "swiss-prop",
    name: "Swiss of five",
    competitors: ["A", "B", "C", "D", "E"].map((name) => ({
      id: name.toLowerCase(),
      name,
    })),
    stages: [
      {
        id: "main",
        groups: [
          {
            id: "swiss",
            entries: Array.from({ length: 5 }, (_, i) => ({
              kind: "registration",
              seed: i + 1,
            })),
            run: {
              kind: "pool",
              pairing: { system: "swiss" },
              rounds: 3,
              encounter: {
                kind: "game",
                clock: { initial: 180, increment: 2 },
              },
              score: { kind: "passThrough" },
              bye: { kind: "points", standings: 1, encounter: 1 },
              tiebreaks: [],
            },
          },
        ],
      },
    ],
  });

describe("naive swiss legality", () => {
  it("never repeats a pairing and gives at most one bye per player", () => {
    fc.assert(
      fc.property(
        fc.array(classicalResult, { minLength: 6, maxLength: 6 }),
        (results) => {
          const run = runEvent(swissEvent());
          const pool = groupRootPath("main", "swiss");
          let cursor = 0;
          const met = new Set<string>();
          const byes = new Map<string, number>();

          for (let round = 1; round <= 3; round += 1) {
            run.pairRound();
            const plans = pairingsAt(run.state(), pool, round) ?? [];
            const covered = new Set<string>();
            for (const plan of plans) {
              if (plan.kind === "bye") {
                byes.set(plan.competitor, (byes.get(plan.competitor) ?? 0) + 1);
                covered.add(plan.competitor);
                continue;
              }
              const key = [plan.a, plan.b].sort().join("|");
              expect(met.has(key)).toBe(false);
              met.add(key);
              covered.add(plan.a);
              covered.add(plan.b);
            }
            expect(covered.size).toBe(5);
            for (const game of run.scheduled()) {
              run.submit({
                kind: "gameResult",
                game: game.path,
                result: results[cursor % results.length] ?? "1/2-1/2",
              });
              cursor += 1;
            }
          }
          for (const count of byes.values())
            expect(count).toBeLessThanOrEqual(1);
        },
      ),
      { numRuns: 20 },
    );
  });
});

const knockout16 = (): ParsedEventDef =>
  parseEventDef({
    id: "ko-sixteen",
    name: "Sixteen-player knockout",
    competitors: Array.from({ length: 16 }, (_, i) => ({
      id: `s${i + 1}`,
      name: `Seed ${i + 1}`,
    })),
    stages: [
      {
        id: "main",
        groups: [
          {
            id: "ko",
            entries: Array.from({ length: 16 }, (_, i) => ({
              kind: "registration",
              seed: i + 1,
            })),
            run: {
              kind: "pool",
              pairing: { system: "knockout", seeding: "traditional" },
              encounter: {
                kind: "game",
                clock: { initial: 180, increment: 2 },
                tie: { kind: "drawOdds", color: "black" },
              },
              score: { kind: "passThrough" },
              tiebreaks: [],
            },
          },
        ],
      },
    ],
  });

describe("traditional knockout bracket", () => {
  it("pairs seeds summing to n+1 with seeds 1 and 2 in opposite halves (16 players)", () => {
    const run = runEvent(knockout16()).pairRound();
    const plans = pairingsAt(run.state(), groupRootPath("main", "ko"), 1) ?? [];
    expect(plans).toHaveLength(8);
    const seedOf = (id: string): number => Number.parseInt(id.slice(1), 10);
    const halves: number[][] = [[], []];
    plans.forEach((plan, slot) => {
      if (plan.kind !== "pair") throw new Error("knockout emitted a bye");
      expect(seedOf(plan.a) + seedOf(plan.b)).toBe(17);
      halves[slot < 4 ? 0 : 1]?.push(seedOf(plan.a), seedOf(plan.b));
    });
    expect(halves[0]).toContain(1);
    expect(halves[1]).toContain(2);
  });

  it("refuses fields beyond the verified bracket tables", () => {
    const big = parseEventDef({
      id: "ko-big",
      name: "Sixty-four players",
      competitors: Array.from({ length: 64 }, (_, i) => ({
        id: `p${i + 1}`,
        name: `P${i + 1}`,
      })),
      stages: [
        {
          id: "main",
          groups: [
            {
              id: "ko",
              entries: Array.from({ length: 64 }, (_, i) => ({
                kind: "registration",
                seed: i + 1,
              })),
              run: {
                kind: "pool",
                pairing: { system: "knockout", seeding: "traditional" },
                encounter: {
                  kind: "game",
                  clock: { initial: 180, increment: 2 },
                  tie: { kind: "drawOdds", color: "black" },
                },
                score: { kind: "passThrough" },
                tiebreaks: [],
              },
            },
          ],
        },
      ],
    });
    const proposed = proposePairings(
      runEvent(big).state(),
      groupRootPath("main", "ko"),
    );
    expect(proposed).toMatchObject({
      ok: false,
      error: expect.stringContaining("no verified bracket table"),
    });
  });
});
