// @vitest-environment node
import { describe, expect, it } from "vitest";
import { runEvent } from "./builder";
import {
  competitorId,
  type EventDef,
  groupRootPath,
  nodePathSchema,
  playerId,
} from "./def";
import { materialize, withInput } from "./engine";
import {
  armageddonShowdown,
  lichess4545,
  loneWolf,
  norwayChess,
  worldChampionship,
} from "./formats";
import type { Input } from "./inputs";

const path = (raw: string) => nodePathSchema.parse(raw);

const errorsOf = (def: EventDef, inputs: Input[]) =>
  materialize(def, inputs).errors.map((e) => e.reason);

describe("input validation", () => {
  it("rejects a result for a game whose colors are not drawn yet", () => {
    const reasons = errorsOf(worldChampionship, [
      {
        kind: "gameResult",
        game: path("stage-match/group-title/leg-1/leg-1"),
        result: "1-0",
      },
    ]);
    expect(reasons).toEqual([expect.stringContaining("colors")]);
  });

  it("rejects a result for a series leg that is not materialized yet", () => {
    const reasons = errorsOf(worldChampionship, [
      {
        kind: "colorDraw",
        node: path("stage-match/group-title/leg-1"),
        whiteSeat: 0,
      },
      {
        kind: "gameResult",
        game: path("stage-match/group-title/leg-1/leg-2"),
        result: "1-0",
      },
    ]);
    expect(reasons).toEqual([expect.stringContaining("not materialized")]);
  });

  it("rejects pairing round 2 before round 1, and re-pairing a paired round", () => {
    const pool = groupRootPath("main", "swiss");
    const pairings: Extract<Input, { kind: "pairingsSet" }>["pairings"] = [
      {
        kind: "pair",
        a: competitorId("alice"),
        b: competitorId("bob"),
        whiteSeat: 0,
      },
    ];
    const round2First = errorsOf(loneWolf, [
      { kind: "pairingsSet", pool, round: 2, pairings },
    ]);
    expect(round2First).toEqual([
      expect.stringContaining("round 1 must be paired first"),
    ]);

    const repaired = errorsOf(loneWolf, [
      { kind: "pairingsSet", pool, round: 1, pairings },
      { kind: "pairingsSet", pool, round: 1, pairings },
    ]);
    expect(repaired).toEqual([expect.stringContaining("already paired")]);
  });

  it("rejects a bye when the pool has no bye rule", () => {
    const pool = groupRootPath("main", "rr");
    const reasons = errorsOf(norwayChess, [
      {
        kind: "pairingsSet",
        pool,
        round: 1,
        pairings: [
          {
            kind: "pair",
            a: competitorId("magnus"),
            b: competitorId("fabiano"),
            whiteSeat: 0,
          },
          { kind: "bye", competitor: competitorId("hikaru") },
        ],
      },
    ]);
    expect(reasons).toEqual([expect.stringContaining("no bye rule")]);
  });

  it("rejects a color draw where colors are not drawn (fixed-color series leg)", () => {
    const run = runEvent(norwayChess).pairRound();
    const state = withInput(run.state(), {
      kind: "colorDraw",
      node: path("stage-main/group-rr/round-1/pair-1/leg-2"),
      whiteSeat: 1,
    });
    expect(state.errors.map((e) => e.reason)).toEqual([
      expect.stringContaining("does not draw colors per leg"),
    ]);
  });

  it("rejects a manual decision on a node that is not awaiting one", () => {
    const reasons = errorsOf(armageddonShowdown, [
      {
        kind: "manualDecision",
        node: groupRootPath("main", "duel"),
        winner: 0,
      },
    ]);
    expect(reasons).toEqual([
      expect.stringContaining("not awaiting a manual decision"),
    ]);
  });

  it("rejects a lineup containing a player from outside the roster", () => {
    const run = runEvent(lichess4545).pairRound();
    const awaitLineup = run
      .actions()
      .find((a) => a.kind === "awaitLineup" && a.competitor === "kni");
    expect(awaitLineup?.kind).toBe("awaitLineup");
    if (awaitLineup?.kind !== "awaitLineup") return;
    const state = withInput(run.state(), {
      kind: "lineupSet",
      match: awaitLineup.match,
      side: awaitLineup.side,
      players: ["dra1", "kni2", "kni3", "kni4"].map(playerId),
    });
    expect(state.errors.map((e) => e.reason)).toEqual([
      expect.stringContaining("not on the roster"),
    ]);
  });

  it("rejects board results until both lineups are submitted", () => {
    const run = runEvent(lichess4545).pairRound();
    const state = withInput(run.state(), {
      kind: "gameResult",
      game: path("stage-season/group-league/round-1/pair-1/board-1"),
      result: "1-0",
    });
    expect(state.errors.map((e) => e.reason)).toEqual([
      expect.stringContaining("lineup"),
    ]);
  });
});

describe("corrections (last write wins, everything re-derives)", () => {
  it("flips the armageddon winner when the result is corrected", () => {
    const node = groupRootPath("main", "duel");
    const first = runEvent(armageddonShowdown).game("Magnus", "Hikaru", "1-0");
    expect(first.winnerName()).toBe("Magnus");

    const corrected = withInput(first.state(), {
      kind: "gameResult",
      game: node,
      result: "1/2-1/2",
    });
    expect(corrected.errors).toHaveLength(0);
    const run = runEvent(armageddonShowdown)
      .game("Magnus", "Hikaru", "1-0")
      .submit({ kind: "gameResult", game: node, result: "1/2-1/2" });
    expect(run.winnerName()).toBe("Hikaru");
  });

  it("resurrects a skipped armageddon when a decisive classical is corrected to a draw", () => {
    const run = runEvent(norwayChess)
      .pairRound()
      .game("Magnus", "Praggnanandhaa", "1-0");
    const classicalPath = path("stage-main/group-rr/round-1/pair-1/leg-1");
    const armageddonPath = path("stage-main/group-rr/round-1/pair-1/leg-2");
    expect(run.scheduled().map((g) => g.path)).not.toContain(armageddonPath);

    run.submit({ kind: "gameResult", game: classicalPath, result: "1/2-1/2" }); // correction
    expect(run.scheduled().map((g) => g.path)).toContain(armageddonPath);
  });
});

describe("audit trail", () => {
  it("keeps rejected inputs in the log with their reasons", () => {
    const state = materialize(armageddonShowdown, [
      {
        kind: "manualDecision",
        node: groupRootPath("main", "duel"),
        winner: 0,
      },
      {
        kind: "gameResult",
        game: groupRootPath("main", "duel"),
        result: "1-0",
      },
    ]);
    expect(state.inputs).toHaveLength(2);
    expect(state.errors).toHaveLength(1);
    expect(state.errors[0]?.index).toBe(0);
  });
});
