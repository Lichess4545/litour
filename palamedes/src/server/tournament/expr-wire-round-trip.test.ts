// @vitest-environment node
import { afterAll, expect, it } from "vitest";
import { event, game, play, roundRobin } from "@/chess/compose";
import { chessRegistry, parseEventDef } from "@/chess/registry";
import { db } from "@/server/db";
import { describeWithDb } from "@/test/db";
import { runEvent } from "@/tournament/builder";
import { definitionToChanges } from "@/tournament/changes/decompose";
import { concretify } from "@/tournament/concrete";
import type { MetricRef } from "@/tournament/core";
import type { Expr } from "@/tournament/expr/ast";
import type { ParsedEventDef } from "@/tournament/registry";
import { appendChanges, readDefinition } from "./change-store";

const pointsSquared: Expr = {
  op: "arith",
  f: "*",
  a: { op: "score", of: { op: "self" }, key: "standings" },
  b: { op: "score", of: { op: "self" }, key: "standings" },
};

const win3draw1: Expr = {
  op: "outcome",
  cases: [
    { when: "win", result: { op: "lit", value: 3 } },
    { when: "draw", result: { op: "lit", value: 1 } },
    { when: "loss", result: { op: "lit", value: 0 } },
    { when: "doubleLoss", result: { op: "lit", value: 0 } },
  ],
  otherwise: { op: "lit", value: 0 },
};

const buildDef = (): ParsedEventDef =>
  parseEventDef(
    event(
      "expr-wire-rr",
      "Expr wire round robin",
      [
        { id: "p1", name: "P1" },
        { id: "p2", name: "P2" },
        { id: "p3", name: "P3" },
        { id: "p4", name: "P4" },
      ],
      play(
        roundRobin(
          1,
          game({ initial: 300, increment: 2 }),
          { kind: "expr", label: "win3draw1", expr: win3draw1 },
          {
            tiebreaks: [
              { metric: "expr", label: "points squared", expr: pointsSquared },
            ],
          },
        ),
      )
        .enter(4)
        .as("rr"),
    ),
  );

const driveRoundRobin = (def: ParsedEventDef) => {
  const run = runEvent(def, chessRegistry);
  run.pairRound();
  run.game("P1", "P4", "1-0");
  run.game("P2", "P3", "1-0");
  run.pairRound();
  run.game("P4", "P3", "1-0");
  run.game("P1", "P2", "1-0");
  run.pairRound();
  run.game("P2", "P4", "1-0");
  run.game("P3", "P1", "0-1");
  return run;
};

/**
 * A round robin engineered so two competitors (Q1, Q4) finish TIED on raw
 * standings points (6 each): Q1 scores late (0, 3, 3), Q4 scores early
 * (3, 3, 0). `{op:"metric", name:"cumulative"}` — the wire door reusing a
 * builtin by name (ADR 0011) — rewards early scoring, so it ranks Q4 above
 * Q1: the OPPOSITE of the entrants-declared order a naive points-only
 * tie-break would fall back to. Q2/Q3 finish on distinct points (4 and 1)
 * so only the Q1/Q4 pair exercises the split.
 */
const buildTieDef = (tiebreaks: readonly MetricRef[]): ParsedEventDef =>
  parseEventDef(
    event(
      "expr-wire-tie",
      "Expr wire tie split",
      [
        { id: "q1", name: "Q1" },
        { id: "q2", name: "Q2" },
        { id: "q3", name: "Q3" },
        { id: "q4", name: "Q4" },
      ],
      play(
        roundRobin(
          1,
          game({ initial: 300, increment: 2 }),
          { kind: "expr", label: "win3draw1", expr: win3draw1 },
          { tiebreaks: [...tiebreaks] },
        ),
      )
        .enter(4)
        .as("rr"),
    ),
  );

const driveTieRoundRobin = (def: ParsedEventDef) => {
  const run = runEvent(def, chessRegistry);
  run.pairRound();
  run.game("Q1", "Q4", "0-1"); // Q4 wins early
  run.game("Q2", "Q3", "1/2-1/2");
  run.pairRound();
  run.game("Q4", "Q3", "1-0"); // Q4 wins again
  run.game("Q1", "Q2", "1-0"); // Q1's first win
  run.pairRound();
  run.game("Q2", "Q4", "1-0"); // Q4's late loss
  run.game("Q3", "Q1", "0-1"); // Q1's second, late win
  return run;
};

const rankOf = (
  run: ReturnType<typeof runEvent>,
  name: string,
): number | undefined => {
  const competitor = run.def.competitors.find((c) => c.name === name);
  const row = run.standings().find((r) => r.competitor === competitor?.id);
  return row?.rank;
};

const streamIds: string[] = [];

describeWithDb(
  "expr wire door — inline expr tiebreak + scoring round-trip",
  () => {
    afterAll(async () => {
      await db.definitionChange.deleteMany({
        where: { streamId: { in: streamIds } },
      });
    });

    it("round-trips through the changelog byte-identical, and the rehydrated def drives the engine to the same expr-computed standings", async () => {
      const original = buildDef();
      streamIds.push(original.id);

      const appended = await appendChanges(
        db,
        original.id,
        0,
        definitionToChanges(original),
      );
      expect(appended.ok).toBe(true);

      const rehydrated = await readDefinition(db, original.id);
      expect(rehydrated.ok).toBe(true);
      if (!rehydrated.ok) return;
      expect(rehydrated.def).toEqual(original);

      const run = driveRoundRobin(rehydrated.def);
      expect(run.unsplitCriteria()).toEqual([]);

      const rows = run.standings();
      const byName = (name: string) => {
        const competitor = run.def.competitors.find((c) => c.name === name);
        const row = rows.find((r) => r.competitor === competitor?.id);
        if (row === undefined) throw new Error(`${name} has no standings row`);
        return row;
      };

      expect(byName("P1").standingsPoints).toBe(9);
      expect(byName("P2").standingsPoints).toBe(6);
      expect(byName("P4").standingsPoints).toBe(3);
      expect(byName("P3").standingsPoints).toBe(0);

      expect(byName("P1").metrics.get("points squared")).toBe(81);
      expect(byName("P2").metrics.get("points squared")).toBe(36);
      expect(byName("P4").metrics.get("points squared")).toBe(9);
      expect(byName("P3").metrics.get("points squared")).toBe(0);

      expect(byName("P1").rank).toBe(1);
      expect(byName("P2").rank).toBe(2);
      expect(byName("P4").rank).toBe(3);
      expect(byName("P3").rank).toBe(4);

      const concrete = concretify(rehydrated.def, chessRegistry);
      const poolRun = concrete.root.run;
      if (poolRun.kind !== "rounds") {
        throw new Error(`expected a rounds run, got "${poolRun.kind}"`);
      }
      expect(poolRun.final.tiebreaks[0]?.label).toBe("points squared");
    });

    it("an inline expr tiebreak that reuses a builtin by name actually splits a genuine points tie", () => {
      const untied = driveTieRoundRobin(
        buildTieDef([
          {
            metric: "expr",
            label: "cumulative (inline)",
            expr: { op: "metric", name: "cumulative" },
          },
        ]),
      );
      expect(untied.unsplitCriteria()).toEqual([]);
      expect(rankOf(untied, "Q4")).toBe(1);
      expect(rankOf(untied, "Q1")).toBe(2);
      expect(rankOf(untied, "Q2")).toBe(3);
      expect(rankOf(untied, "Q3")).toBe(4);

      // Raw standings points alone leave Q1/Q4 an unsplit tie, sharing a rank
      // in entrants-declared order (Q1 before Q4) — the opposite of above.
      const raw = driveTieRoundRobin(buildTieDef([]));
      expect(rankOf(raw, "Q1")).toBe(rankOf(raw, "Q4"));
      expect(rankOf(raw, "Q1")).toBe(1);
    });
  },
);
