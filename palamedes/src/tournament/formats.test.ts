// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  armageddonShowdown,
  candidates,
  lichess4545,
  loneWolf,
  miniChampionship,
  norwayChess,
  olympiad,
  quads,
  scheveningen,
  teamSwissCascade,
  worldChampionship,
  worldCup,
  wuccKnockoutLockstep,
  wuccKnockoutUpfront,
} from "@/chess/formats";
import { chessRegistry } from "@/chess/registry";
import { expectStandings, runEvent as runEventWith } from "./builder";
import { groupRootPath } from "./core";
import { pairingsAt } from "./engine";

const runEvent = (def: Parameters<typeof runEventWith>[0]) =>
  runEventWith(def, chessRegistry);

describe("armageddon showdown", () => {
  it("schedules one game with asymmetric clocks, white side first by default", () => {
    const run = runEvent(armageddonShowdown);
    const [game] = run.scheduled();
    expect(game).toMatchObject({
      white: "magnus",
      black: "hikaru",
      clock: { whiteInitial: 600, blackInitial: 420 },
    });
  });

  it("a draw is a win for black (draw odds), points stay half each", () => {
    const run = runEvent(armageddonShowdown).game(
      "Magnus",
      "Hikaru",
      "1/2-1/2",
    );
    expect(run.winnerName()).toBe("Hikaru");
    const outcome = run.outcome(groupRootPath("main", "duel"));
    expect(outcome.points).toEqual([0.5, 0.5]);
    expect(outcome.decision).toMatchObject({
      kind: "win",
      winner: 1,
      by: "drawOdds",
    });
  });

  it("white can only win by winning", () => {
    const run = runEvent(armageddonShowdown).game("Magnus", "Hikaru", "1-0");
    expect(run.winnerName()).toBe("Magnus");
  });
});

describe("world championship match", () => {
  const root = groupRootPath("match", "title");

  it("stops the classical series at 7.5 and schedules nothing further", () => {
    const run = runEvent(worldChampionship).drawColors("Ding");
    // Ding holds the white seat: odd legs Ding is white, even legs Gukesh.
    for (let leg = 1; leg <= 7; leg += 1) {
      if (leg % 2 === 1) run.game("Ding", "Gukesh", "1-0");
      else run.game("Gukesh", "Ding", "0-1");
    }
    run.game("Gukesh", "Ding", "1/2-1/2"); // 7.5 after eight games
    expect(run.winnerName()).toBe("Ding");
    expect(run.scheduled()).toHaveLength(0);
    expect(run.outcome(root)).toMatchObject({
      points: [7.5, 0.5],
      decision: { kind: "win", winner: 0, by: "points", leg: 0 },
    });
  });

  it("classical games are scheduled strictly one at a time", () => {
    const run = runEvent(worldChampionship).drawColors("Ding");
    expect(run.scheduled()).toHaveLength(1);
    run.game("Ding", "Gukesh", "1-0");
    expect(run.scheduled()).toHaveLength(1);
  });

  it("7-7 slides through rapid and blitz into armageddon, where draw odds decide a points-equal match", () => {
    const run = runEvent(worldChampionship).drawColors("Ding");
    for (let leg = 1; leg <= 14; leg += 1) {
      if (leg % 2 === 1) run.game("Ding", "Gukesh", "1/2-1/2");
      else run.game("Gukesh", "Ding", "1/2-1/2");
    }
    // Each tiebreak segment redraws colors before play.
    run.drawColors("Gukesh");
    run.game("Gukesh", "Ding", "1/2-1/2").game("Ding", "Gukesh", "1/2-1/2");
    run.drawColors("Ding");
    run.game("Ding", "Gukesh", "1/2-1/2").game("Gukesh", "Ding", "1/2-1/2");
    run.drawColors("Ding");
    run.game("Ding", "Gukesh", "1/2-1/2");

    expect(run.winnerName()).toBe("Gukesh");
    const outcome = run.outcome(root);
    // Zero points margin: only structural inheritance can decide the chain.
    expect(outcome.points[0]).toBe(outcome.points[1]);
    expect(outcome.decision).toMatchObject({
      kind: "win",
      winner: 1,
      by: "drawOdds",
      leg: 3,
    });
  });
});

describe("FIDE world cup", () => {
  const pool = groupRootPath("ko", "bracket");

  it("seeds round 1 in traditional bracket order (1v8, 4v5, 3v6, 2v7)", () => {
    const run = runEvent(worldCup).pairRound();
    const plans = pairingsAt(run.state(), pool, 1);
    expect(plans).toEqual([
      expect.objectContaining({ a: "magnus", b: "anish" }),
      expect.objectContaining({ a: "gukesh", b: "alireza" }),
      expect.objectContaining({ a: "hikaru", b: "ian" }),
      expect.objectContaining({ a: "fabiano", b: "wesley" }),
    ]);
  });

  it("runs the whole bracket, including a semifinal that goes all the way to armageddon", () => {
    const run = runEvent(worldCup).pairRound();
    // Round 1: each tie draws colors for its classical duel first.
    run
      .drawColors("Magnus")
      .game("Magnus", "Anish", "1-0")
      .game("Anish", "Magnus", "0-1");
    run
      .drawColors("Gukesh")
      .game("Gukesh", "Alireza", "1-0")
      .game("Alireza", "Gukesh", "1/2-1/2");
    run
      .drawColors("Hikaru")
      .game("Hikaru", "Ian", "1-0")
      .game("Ian", "Hikaru", "0-1");
    run
      .drawColors("Fabiano")
      .game("Fabiano", "Wesley", "1-0")
      .game("Wesley", "Fabiano", "0-1");

    run.pairRound();
    const semis = pairingsAt(run.state(), pool, 2);
    expect(semis).toEqual([
      expect.objectContaining({ a: "magnus", b: "gukesh" }),
      expect.objectContaining({ a: "hikaru", b: "fabiano" }),
    ]);

    // Magnus–Gukesh: every segment drawn until the armageddon draw.
    run.drawColors("Magnus");
    run.game("Magnus", "Gukesh", "1/2-1/2").game("Gukesh", "Magnus", "1/2-1/2");
    run.drawColors("Gukesh");
    run.game("Gukesh", "Magnus", "1/2-1/2").game("Magnus", "Gukesh", "1/2-1/2");
    run.drawColors("Magnus");
    run.game("Magnus", "Gukesh", "1/2-1/2").game("Gukesh", "Magnus", "1/2-1/2");
    run.drawColors("Gukesh");
    run.game("Gukesh", "Magnus", "1/2-1/2").game("Magnus", "Gukesh", "1/2-1/2");
    run.drawColors("Magnus");
    run.game("Magnus", "Gukesh", "1/2-1/2"); // armageddon: Gukesh advances on draw odds

    run
      .drawColors("Hikaru")
      .game("Hikaru", "Fabiano", "1-0")
      .game("Fabiano", "Hikaru", "0-1");

    run.pairRound();
    run
      .drawColors("Hikaru")
      .game("Hikaru", "Gukesh", "1-0")
      .game("Gukesh", "Hikaru", "1/2-1/2");

    expect(run.winnerName()).toBe("Hikaru");
    expectStandings(run).competitor("Hikaru").rank(1);
    expectStandings(run).competitor("Gukesh").rank(2);
    expectStandings(run).competitor("Magnus").rank(3);
    expectStandings(run).competitor("Fabiano").rank(3);
    expectStandings(run).competitor("Anish").rank(5);
  });
});

describe("individual swiss (LoneWolf)", () => {
  it("pairs, byes, forfeits, and the classical tiebreak chain all land", () => {
    // Pairings pinned (not proposer-driven) so the hand-computed tiebreak
    // numbers can't be invalidated by demo-swiss tweaks.
    const run = runEvent(loneWolf)
      .pairManual(
        [
          ["Alice", "Bob"],
          ["Dave", "Carol"],
        ],
        { byes: ["Erin"] },
      )
      .game("Alice", "Bob", "1-0")
      .game("Dave", "Carol", "0-1")
      .pairManual(
        [
          ["Carol", "Alice"],
          ["Bob", "Erin"],
        ],
        { byes: ["Dave"] },
      )
      .game("Carol", "Alice", "1-0")
      .game("Bob", "Erin", "1X-0F")
      .pairManual(
        [
          ["Carol", "Erin"],
          ["Alice", "Dave"],
        ],
        { byes: ["Bob"] },
      )
      .game("Carol", "Erin", "1/2-1/2")
      .game("Alice", "Dave", "1-0");

    expectStandings(run).competitor("Carol").points(2.5).rank(1);
    // Alice and Bob both finish on 2 with equal buchholz 5.5 —
    // Sonneborn-Berger separates them (3 vs 1.5).
    expectStandings(run)
      .competitor("Alice")
      .points(2)
      .metric("sonnebornBerger", 3)
      .metric("buchholz", 5.5)
      .rank(2);
    expectStandings(run)
      .competitor("Bob")
      .points(2)
      .metric("sonnebornBerger", 1.5)
      .metric("buchholz", 5.5)
      .rank(3);
    expectStandings(run).competitor("Erin").points(1.5).rank(4);
    expectStandings(run).competitor("Dave").points(1).rank(5);
  });
});

describe("olympiad team swiss", () => {
  it("zigzags board colors from the team seat", () => {
    const run = runEvent(olympiad)
      .pairManual([
        ["India", "USA"],
        ["China", "Uzbekistan"],
      ])
      .lineup("India", ["ind1", "ind2", "ind3", "ind4"])
      .lineup("USA", ["usa1", "usa2", "usa3", "usa4"]);
    const games = run.scheduled();
    expect(games).toContainEqual(
      expect.objectContaining({ white: "ind1", black: "usa1" }),
    );
    expect(games).toContainEqual(
      expect.objectContaining({ white: "usa2", black: "ind2" }),
    );
    expect(games).toContainEqual(
      expect.objectContaining({ white: "ind3", black: "usa3" }),
    );
    expect(games).toContainEqual(
      expect.objectContaining({ white: "usa4", black: "ind4" }),
    );
  });

  it("computes match points and the FIDE extended Sonneborn-Berger (GPxGP)", () => {
    const run = runEvent(olympiad);
    const fullRosters = (team: string, prefix: string) =>
      run.lineup(
        team,
        [1, 2, 3, 4].map((i) => `${prefix}${i}`),
      );

    run.pairManual([
      ["India", "USA"],
      ["China", "Uzbekistan"],
    ]);
    fullRosters("India", "ind");
    fullRosters("USA", "usa");
    fullRosters("China", "chn");
    fullRosters("Uzbekistan", "uzb");
    run.match("India", "USA", "1-0", "0-1", "1-0", "1-0"); // 3-1
    run.match(
      "China",
      "Uzbekistan",
      "1/2-1/2",
      "1/2-1/2",
      "1/2-1/2",
      "1/2-1/2",
    ); // 2-2

    run.pairManual([
      ["Uzbekistan", "India"],
      ["USA", "China"],
    ]);
    fullRosters("India", "ind");
    fullRosters("USA", "usa");
    fullRosters("China", "chn");
    fullRosters("Uzbekistan", "uzb");
    run.match("Uzbekistan", "India", "0-1", "1-0", "1/2-1/2", "1/2-1/2"); // India 3-1
    run.match("USA", "China", "1-0", "1-0", "0-1", "0-1"); // 2-2

    run.pairManual([
      ["India", "China"],
      ["Uzbekistan", "USA"],
    ]);
    fullRosters("India", "ind");
    fullRosters("USA", "usa");
    fullRosters("China", "chn");
    fullRosters("Uzbekistan", "uzb");
    run.match("India", "China", "1/2-1/2", "1/2-1/2", "1/2-1/2", "1/2-1/2"); // 2-2
    run.match("Uzbekistan", "USA", "0-1", "1-0", "1/2-1/2", "1/2-1/2"); // USA 3-1

    expectStandings(run)
      .competitor("India")
      .points(5)
      .encounterPoints(8)
      .rank(1);
    // China and USA tie on 3 match points; EGGSB (36 vs 32) splits them.
    expectStandings(run)
      .competitor("China")
      .points(3)
      .encounterPoints(6)
      .metric("extendedSB-gg", 36)
      .rank(2);
    expectStandings(run)
      .competitor("USA")
      .points(3)
      .encounterPoints(6)
      .metric("extendedSB-gg", 32)
      .rank(3);
    expectStandings(run).competitor("Uzbekistan").points(1).rank(4);
  });
});

describe("lichess4545 team league", () => {
  it("ranks by match points, then rounds won, games won, and board points", () => {
    const run = runEvent(lichess4545);
    const fullRosters = () => {
      for (const [team, prefix] of [
        ["Knights", "kni"],
        ["Dragons", "dra"],
        ["Rooks", "roo"],
        ["Pawnstars", "paw"],
      ] as const) {
        run.lineup(
          team,
          [1, 2, 3, 4].map((i) => `${prefix}${i}`),
        );
      }
    };

    run.pairManual([
      ["Knights", "Dragons"],
      ["Pawnstars", "Rooks"],
    ]);
    fullRosters();
    // Knights 3-1 (boards 1-3; Dragons' d4 wins board 4 as white).
    run.match("Knights", "Dragons", "1-0", "0-1", "1-0", "1-0");
    // Pawnstars 2.5-1.5 (wins on 1 and 2; Rooks' r4 wins board 4 as white).
    run.match("Pawnstars", "Rooks", "1-0", "0-1", "1/2-1/2", "1-0");

    run.pairManual([
      ["Knights", "Pawnstars"],
      ["Rooks", "Dragons"],
    ]);
    fullRosters();
    run.match(
      "Knights",
      "Pawnstars",
      "1/2-1/2",
      "1/2-1/2",
      "1/2-1/2",
      "1/2-1/2",
    );
    // 2-2, but Rooks take board 1 while Dragons win the middle boards.
    run.match("Rooks", "Dragons", "1-0", "1-0", "0-1", "0-1");

    // Knights and Pawnstars: 3 MP and one match win each; games won 3 vs 2.
    expectStandings(run)
      .competitor("Knights")
      .points(3)
      .metric("gamesWon", 3)
      .rank(1);
    expectStandings(run)
      .competitor("Pawnstars")
      .points(3)
      .metric("gamesWon", 2)
      .rank(2);
    expectStandings(run).competitor("Knights").metric("boardPoints-1", 1.5);
    // Dragons and Rooks tie on points, match wins, AND games won —
    // board-1 points (1 vs 0) finally split them.
    expectStandings(run)
      .competitor("Rooks")
      .points(1)
      .metric("gamesWon", 3)
      .metric("boardPoints-1", 1)
      .rank(3);
    expectStandings(run)
      .competitor("Dragons")
      .points(1)
      .metric("gamesWon", 3)
      .metric("boardPoints-1", 0)
      .rank(4);
  });
});

describe("Norway Chess", () => {
  it("decisive classical games score 3-0 and skip the armageddon entirely", () => {
    const run = runEvent(norwayChess)
      .pairRound()
      .game("Magnus", "Praggnanandhaa", "1-0");
    expectStandings(run).competitor("Magnus").points(3);
    expectStandings(run).competitor("Praggnanandhaa").points(0);
    // No armageddon for that pairing: the only remaining round-1 game is Fabiano-Hikaru classical.
    expect(run.scheduled()).toHaveLength(1);
    expect(run.scheduled()[0]).toMatchObject({
      white: "fabiano",
      black: "hikaru",
    });
  });

  it("draws go to a fixed-color armageddon and score 1.5/1 by deciding leg", () => {
    const run = runEvent(norwayChess)
      .pairRound() // R1: Magnus-Pragg, Fabiano-Hikaru
      .game("Magnus", "Praggnanandhaa", "1-0")
      .game("Fabiano", "Hikaru", "1/2-1/2")
      // classical white keeps armageddon white (fixed colors)
      .game("Fabiano", "Hikaru", "1-0")
      .pairRound() // R2: Pragg-Hikaru, Magnus-Fabiano
      .game("Praggnanandhaa", "Hikaru", "1/2-1/2")
      .game("Praggnanandhaa", "Hikaru", "1/2-1/2") // armageddon draw: black wins
      .game("Magnus", "Fabiano", "1-0")
      .pairRound() // R3: Fabiano-Pragg, Hikaru-Magnus
      .game("Fabiano", "Praggnanandhaa", "1/2-1/2")
      .game("Fabiano", "Praggnanandhaa", "1/2-1/2")
      .game("Hikaru", "Magnus", "0-1");

    expectStandings(run).competitor("Magnus").points(9).rank(1);
    expectStandings(run)
      .competitor("Fabiano")
      .points(2.5)
      .metric("gamesWon", 1)
      .rank(2);
    // Hikaru's and Pragg's armageddon wins came via draw odds — not games won.
    expectStandings(run)
      .competitor("Hikaru")
      .points(2.5)
      .metric("gamesWon", 0)
      .rank(3);
    expectStandings(run)
      .competitor("Praggnanandhaa")
      .points(2.5)
      .metric("gamesWon", 0)
      .rank(3);
  });
});

describe("candidates double round robin", () => {
  it("plays the canonical Berger tables and reverses colors in cycle two", () => {
    const run = runEvent(candidates);
    const pool = groupRootPath("main", "rr");
    const expectRound = (
      round: number,
      pairs: readonly (readonly [string, string])[],
    ) => {
      run.pairRound();
      const plans = pairingsAt(run.state(), pool, round);
      expect(plans).toEqual(
        pairs.map(([a, b]) => expect.objectContaining({ a, b, whiteSeat: 0 })),
      );
      for (const [a] of pairs) {
        const game = run.scheduled().find((g) => g.white === a);
        expect(game).toBeDefined();
        if (game !== undefined)
          run.submit({ kind: "gameResult", game: game.path, result: "1-0" });
      }
    };

    // Seeds: ian(1) fabiano(2) gukesh(3) hikaru(4).
    expectRound(1, [
      ["ian", "hikaru"],
      ["fabiano", "gukesh"],
    ]);
    expectRound(2, [
      ["hikaru", "gukesh"],
      ["ian", "fabiano"],
    ]);
    expectRound(3, [
      ["fabiano", "hikaru"],
      ["gukesh", "ian"],
    ]);
    // Second cycle: same tables, colors flipped.
    expectRound(4, [
      ["hikaru", "ian"],
      ["gukesh", "fabiano"],
    ]);
    expectRound(5, [
      ["gukesh", "hikaru"],
      ["fabiano", "ian"],
    ]);
    expectRound(6, [
      ["hikaru", "fabiano"],
      ["ian", "gukesh"],
    ]);
  });
});

describe("WUCC weekend knockout (two team matches per tie)", () => {
  const teams = {
    yale: ["yale1", "yale2"],
    pret: ["pret1", "pret2"],
    mona: ["mona1", "mona2"],
    auck: ["auck1", "auck2"],
  } as const;

  it("lockstep holds the return match until every tie finished match one", () => {
    const run = runEvent(wuccKnockoutLockstep).pairRound();
    // Only leg-1 lineups are awaited under lockstep.
    expect(run.actions().filter((a) => a.kind === "awaitLineup")).toHaveLength(
      4,
    );

    run.lineup("Yale University", teams.yale);
    run.lineup("Auckland University", teams.auck);
    // Yale (white seat): board 1 yale1 white, board 2 auck2 white.
    expect(run.scheduled()).toContainEqual(
      expect.objectContaining({ white: "yale1", black: "auck1" }),
    );
    expect(run.scheduled()).toContainEqual(
      expect.objectContaining({ white: "auck2", black: "yale2" }),
    );
    run.match("Yale University", "Auckland University", "1-0", "0-1"); // Yale 2-0

    // Pretoria-Monash have not finished match one: no return-match work yet.
    expect(run.actions().filter((a) => a.kind === "awaitLineup")).toHaveLength(
      2,
    );

    run.lineup("University of Pretoria", teams.pret);
    run.lineup("Monash University", teams.mona);
    run.match("University of Pretoria", "Monash University", "1-0", "1/2-1/2"); // 1.5-0.5

    // Now the return matches open, colors flipped.
    run.lineup("Yale University", teams.yale);
    run.lineup("Auckland University", teams.auck);
    expect(run.scheduled()).toContainEqual(
      expect.objectContaining({ white: "auck1", black: "yale1" }),
    );
    run.match("Auckland University", "Yale University", "1-0", "0-1"); // Auckland 2-0: 2-2 aggregate

    run.lineup("University of Pretoria", teams.pret);
    run.lineup("Monash University", teams.mona);
    run.match("Monash University", "University of Pretoria", "0-1", "1-0"); // Pretoria 2-0

    // Tied aggregate goes to the arbiter.
    expect(run.actions()).toContainEqual(
      expect.objectContaining({ kind: "awaitManualDecision" }),
    );
    run.decide("Yale University");

    run.pairRound(); // final: Yale-Pretoria
    run.lineup("Yale University", teams.yale);
    run.lineup("University of Pretoria", teams.pret);
    run.match("Yale University", "University of Pretoria", "1-0", "1/2-1/2"); // 1.5-0.5
    run.lineup("Yale University", teams.yale);
    run.lineup("University of Pretoria", teams.pret);
    run.match(
      "University of Pretoria",
      "Yale University",
      "1/2-1/2",
      "1/2-1/2",
    ); // 1-1

    expect(run.winnerName()).toBe("Yale University");
    expectStandings(run).competitor("Yale University").rank(1);
    expectStandings(run).competitor("University of Pretoria").rank(2);
    expectStandings(run).competitor("Auckland University").rank(3);
    expectStandings(run).competitor("Monash University").rank(3);
  });

  it("upfront releases both matches' lineups immediately", () => {
    const run = runEvent(wuccKnockoutUpfront).pairRound();
    expect(run.actions().filter((a) => a.kind === "awaitLineup")).toHaveLength(
      8,
    );
  });
});

describe("multi-stage: groups into knockout with a bronze final", () => {
  it("waits on seeding, then runs semis, final, and third-place playoff", () => {
    const run = runEvent(miniChampionship);
    const a = groupRootPath("groups", "a");
    const b = groupRootPath("groups", "b");
    const ko = groupRootPath("finals", "ko");

    expect(run.actions()).toContainEqual(
      expect.objectContaining({ kind: "awaitSeeding", stage: "finals" }),
    );

    // Group A: Anna, David, Elena (round-robin of three, rotating byes).
    run.pairRound(a).game("David", "Elena", "1-0");
    run.pairRound(a).game("Anna", "David", "1-0");
    run.pairRound(a).game("Elena", "Anna", "0-1");
    // Group B: Boris, Clara, Felix.
    run.pairRound(b).game("Clara", "Felix", "1-0");
    run.pairRound(b).game("Boris", "Clara", "0-1");
    run.pairRound(b).game("Felix", "Boris", "1-0");

    expectStandings(run, a).competitor("Anna").points(2).rank(1);
    expectStandings(run, b).competitor("Clara").points(2).rank(1);

    run.pairRound(ko); // semis: A1-B2 (Anna-Felix), B1-A2 (Clara-David)
    const semis = pairingsAt(run.state(), ko, 1);
    expect(semis).toEqual([
      expect.objectContaining({ a: "anna", b: "felix" }),
      expect.objectContaining({ a: "clara", b: "david" }),
    ]);
    run.game("Anna", "Felix", "1-0");
    run.game("Clara", "David", "0-1");

    run.pairRound(ko); // final Anna-David, bronze Felix-Clara
    run.game("Anna", "David", "1-0");
    run.game("Felix", "Clara", "1/2-1/2"); // draw odds: Clara takes bronze

    expect(run.winnerName()).toBe("Anna");
    expectStandings(run, ko).competitor("Anna").rank(1);
    expectStandings(run, ko).competitor("David").rank(2);
    expectStandings(run, ko).competitor("Clara").rank(3);
    expectStandings(run, ko).competitor("Felix").rank(4);
  });
});

describe("scheveningen", () => {
  it("plays uniform-color legs with rotated lineups", () => {
    const run = runEvent(scheveningen);
    const root = groupRootPath("match", "tie");

    run.lineup("Hammers", ["ham1", "ham2"]);
    run.lineup("Anvils", ["anv1", "anv2"]);
    // Leg 1: Hammers hold the seat — both boards white.
    expect(run.scheduled()).toContainEqual(
      expect.objectContaining({ white: "ham1", black: "anv1" }),
    );
    expect(run.scheduled()).toContainEqual(
      expect.objectContaining({ white: "ham2", black: "anv2" }),
    );
    run.game("ham1", "anv1", "1-0").game("ham2", "anv2", "1-0");

    // Leg 2: Anvils hold the seat and rotate their order.
    run.lineup("Hammers", ["ham1", "ham2"]);
    run.lineup("Anvils", ["anv2", "anv1"]);
    expect(run.scheduled()).toContainEqual(
      expect.objectContaining({ white: "anv2", black: "ham1" }),
    );
    expect(run.scheduled()).toContainEqual(
      expect.objectContaining({ white: "anv1", black: "ham2" }),
    );
    run.game("anv2", "ham1", "0-1").game("anv1", "ham2", "0-1");

    expect(run.outcome(root)).toMatchObject({
      points: [4, 0],
      decision: { kind: "win", winner: 0 },
    });
    expect(run.winnerName()).toBe("Hammers");
  });
});

describe("quads", () => {
  it("runs parallel round-robin groups independently", () => {
    const run = runEvent(quads);
    const q1 = groupRootPath("main", "quad-1");
    const q2 = groupRootPath("main", "quad-2");
    const awaiting = run
      .actions()
      .filter((a) => a.kind === "awaitPairings")
      .map((a) => (a.kind === "awaitPairings" ? a.pool : ""));
    expect([...awaiting].sort()).toEqual([q1, q2].sort());

    run.pairRound(q1).game("P1", "P4", "1-0").game("P2", "P3", "1-0");
    // Quad 2 untouched and still pairable.
    expect(run.actions()).toContainEqual(
      expect.objectContaining({ kind: "awaitPairings", pool: q2 }),
    );
  });
});

describe("the cascade round (two rapid games, blitz tiebreak, board armageddon)", () => {
  it("plays one full cascade: tied games, drawn-color blitz tie, armageddon decides", () => {
    const run = runEvent(teamSwissCascade).pairManual([
      ["Anchors", "Bolts"],
      ["Cogs", "Dynamos"],
      ["Embers", "Flames"],
      ["Griffins", "Huskies"],
    ]);

    // Both rapid games exist up front; the blitz and armageddon legs do not.
    run.lineup("Anchors", ["ank1", "ank2"]);
    run.lineup("Anchors", ["ank1", "ank2"]);
    run.lineup("Bolts", ["bol1", "bol2"]);
    run.lineup("Bolts", ["bol1", "bol2"]);

    // Game one (Anchors hold the seat): each team wins on one board — 1-1.
    run.match("Anchors", "Bolts", "1-0", "1-0");
    // Game two, colors swapped: 1-1 again. Aggregate 2-2.
    run.match("Anchors", "Bolts", "1-0", "1-0");

    // Tied: the blitz leg appears, colors drawn by lot.
    run.drawColors("Bolts");
    run.lineup("Anchors", ["ank1", "ank2"]);
    run.lineup("Bolts", ["bol1", "bol2"]);
    run.match("Anchors", "Bolts", "1-0", "1-0"); // blitz also 1-1

    // Still tied: the single-board armageddon, colors drawn again.
    run.drawColors("Anchors");
    run.lineup("Anchors", ["ank1"]);
    run.lineup("Bolts", ["bol1"]);
    run.match("Anchors", "Bolts", "1/2-1/2"); // black holds the draw

    const pair = run.standings().find((row) => row.competitor === "bol");
    // Anchors drew the armageddon as white: Bolts take the round.
    expect(pair?.standingsPoints).toBe(2);
    expectStandings(run).competitor("Anchors").points(0);
    expectStandings(run).competitor("Bolts").metric("matchWins", 1);
  });
});
