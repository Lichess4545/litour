import { type ParsedEventDef, parseEventDef } from "./def";

/**
 * The acceptance table of design/tournament-model.md as executable
 * definitions. Everything here is plain data pushed through `parseEventDef`,
 * exactly the way an arbiter would author an event — if one of these stops
 * validating, the model broke. Several defs are miniaturized (fewer players
 * or boards, auto-pairable seeding) so the test suite can drive them
 * end-to-end; each notes its deltas from the published format.
 */

// --- game building blocks (plain data, validated on parse) -----------------

const classical = { kind: "game", clock: { initial: 5400, increment: 30 } };
const rapid = (initial: number, increment: number) => ({
  kind: "game",
  clock: { initial, increment },
});
const armageddon = {
  kind: "game",
  clock: { initial: 600, increment: 0, whiteInitial: 600, blackInitial: 420 },
  tie: { kind: "drawOdds", color: "black" },
};
/** Two games, colors alternating — the World Cup's basic tiebreak unit. */
const duel = (game: unknown) => ({
  kind: "series",
  legs: [game, game],
  stop: { kind: "all" },
  colors: "alternate",
});

const players = (...names: readonly string[]) =>
  names.map((name) => ({ id: name.toLowerCase(), name }));

const team = (id: string, name: string, boards: number) => ({
  id,
  name,
  roster: Array.from({ length: boards }, (_, i) => `${id}${i + 1}`),
});

const seeds = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    kind: "registration",
    seed: i + 1,
  }));

// ---------------------------------------------------------------------------

/** A whole tournament in one armageddon game: white must win, black wins a draw. */
export const armageddonShowdown: ParsedEventDef = parseEventDef({
  id: "armageddon-showdown",
  name: "Armageddon showdown",
  competitors: players("Magnus", "Hikaru"),
  stages: [
    {
      id: "main",
      groups: [{ id: "duel", entries: seeds(2), run: armageddon }],
    },
  ],
});

/**
 * World Championship match: 14 classical games, first to 7.5 — if 7–7, the
 * chain continues: two rapid games, two blitz games, then armageddon. Fresh
 * drawing of colors before each segment.
 */
export const worldChampionship: ParsedEventDef = parseEventDef({
  id: "world-championship",
  name: "World Championship match",
  competitors: players("Ding", "Gukesh"),
  stages: [
    {
      id: "match",
      groups: [
        {
          id: "title",
          entries: seeds(2),
          run: {
            kind: "series",
            legs: [
              {
                kind: "series",
                legs: Array.from({ length: 14 }, () => classical),
                stop: { kind: "firstTo", points: 7.5 },
                colors: "alternate",
              },
              duel(rapid(600, 5)),
              duel(rapid(300, 3)),
              armageddon,
            ],
            stop: { kind: "untilDecisive" },
            colors: "redraw",
          },
        },
      ],
    },
  ],
});

/**
 * FIDE World Cup: single-elimination; every bracket tie is two classical
 * games, then descending rapid/blitz duels, then armageddon — colors redrawn
 * before each segment.
 */
export const worldCup: ParsedEventDef = parseEventDef({
  id: "world-cup",
  name: "FIDE World Cup (8 players)",
  competitors: players(
    "Magnus",
    "Fabiano",
    "Hikaru",
    "Gukesh",
    "Alireza",
    "Ian",
    "Wesley",
    "Anish",
  ),
  stages: [
    {
      id: "ko",
      groups: [
        {
          id: "bracket",
          entries: seeds(8),
          run: {
            kind: "pool",
            pairing: { system: "knockout", seeding: "traditional" },
            encounter: {
              kind: "series",
              legs: [
                duel(classical),
                duel(rapid(1500, 10)),
                duel(rapid(600, 10)),
                duel(rapid(300, 3)),
                armageddon,
              ],
              stop: { kind: "untilDecisive" },
              colors: "redraw",
            },
            score: { kind: "encounterPoints" },
            tiebreaks: [],
          },
        },
      ],
    },
  ],
});

/** Individual swiss (LoneWolf): game points, classical tiebreaks, full-point bye. */
export const loneWolf: ParsedEventDef = parseEventDef({
  id: "lone-wolf",
  name: "LoneWolf individual swiss",
  competitors: players("Alice", "Bob", "Carol", "Dave", "Erin"),
  stages: [
    {
      id: "main",
      groups: [
        {
          id: "swiss",
          entries: seeds(5),
          run: {
            kind: "pool",
            pairing: { system: "swiss" },
            rounds: 3,
            encounter: rapid(2700, 45),
            score: { kind: "encounterPoints" },
            bye: { kind: "points", standings: 1, encounter: 1 },
            tiebreaks: [
              { metric: "sonnebornBerger" },
              { metric: "buchholz" },
              { metric: "headToHead" },
            ],
          },
        },
      ],
    },
  ],
});

/**
 * Olympiad-style team swiss: 4 boards zigzagging from the team color, match
 * points 2/1/0 from board-point comparison, FIDE extended Sonneborn-Berger.
 */
export const olympiad: ParsedEventDef = parseEventDef({
  id: "olympiad",
  name: "Olympiad team swiss",
  competitors: [
    team("ind", "India", 4),
    team("usa", "USA", 4),
    team("uzb", "Uzbekistan", 4),
    team("chn", "China", 4),
  ],
  stages: [
    {
      id: "main",
      groups: [
        {
          id: "swiss",
          entries: seeds(4),
          run: {
            kind: "pool",
            pairing: { system: "swiss" },
            rounds: 3,
            encounter: {
              kind: "match",
              boards: 4,
              board: classical,
              colors: "zigzag",
            },
            score: { kind: "perEncounter", win: 2, draw: 1, loss: 0 },
            bye: { kind: "points", standings: 1, encounter: 2 },
            tiebreaks: [
              {
                metric: "extendedSB",
                opponentTotal: "encounter",
                scored: "encounter",
              },
              { metric: "encounterPoints" },
              { metric: "gamesWon" },
            ],
          },
        },
      ],
    },
  ],
});

/** lichess4545-style team swiss: rounds won, games won, then board points (a 4-board miniature of the 8-board league). */
export const lichess4545: ParsedEventDef = parseEventDef({
  id: "lichess4545",
  name: "lichess4545 team league",
  competitors: [
    team("kni", "Knights", 4),
    team("dra", "Dragons", 4),
    team("roo", "Rooks", 4),
    team("paw", "Pawnstars", 4),
  ],
  stages: [
    {
      id: "season",
      groups: [
        {
          id: "league",
          entries: seeds(4),
          run: {
            kind: "pool",
            pairing: { system: "swiss" },
            rounds: 2,
            encounter: {
              kind: "match",
              boards: 4,
              board: rapid(2700, 45),
              colors: "zigzag",
            },
            score: { kind: "perEncounter", win: 2, draw: 1, loss: 0 },
            bye: { kind: "points", standings: 1, encounter: 2 },
            tiebreaks: [
              { metric: "matchWins" },
              { metric: "gamesWon" },
              { metric: "boardPoints", board: 1 },
              { metric: "boardPoints", board: 2 },
            ],
          },
        },
      ],
    },
  ],
});

/**
 * Norway Chess: round robin where a drawn classical game goes to armageddon.
 * Win 3 / armageddon win 1.5 / armageddon loss 1 / loss 0 — path-dependent
 * points via byLeg, while the games themselves stay normally scored.
 */
export const norwayChess: ParsedEventDef = parseEventDef({
  id: "norway-chess",
  name: "Norway Chess",
  competitors: players("Magnus", "Fabiano", "Hikaru", "Praggnanandhaa"),
  stages: [
    {
      id: "main",
      groups: [
        {
          id: "rr",
          entries: seeds(4),
          run: {
            kind: "pool",
            pairing: { system: "roundRobin", cycles: 1 },
            encounter: {
              kind: "series",
              legs: [classical, armageddon],
              stop: { kind: "untilDecisive" },
              colors: "fixed",
            },
            score: {
              kind: "byLeg",
              legs: [
                { win: 3, loss: 0 },
                { win: 1.5, loss: 1 },
              ],
            },
            tiebreaks: [{ metric: "gamesWon" }],
          },
        },
      ],
    },
  ],
});

/** Candidates: double round robin, colors reversed in the second cycle. */
export const candidates: ParsedEventDef = parseEventDef({
  id: "candidates",
  name: "Candidates (double round robin)",
  competitors: players("Ian", "Fabiano", "Gukesh", "Hikaru"),
  stages: [
    {
      id: "main",
      groups: [
        {
          id: "rr",
          entries: seeds(4),
          run: {
            kind: "pool",
            pairing: { system: "roundRobin", cycles: 2 },
            encounter: classical,
            score: { kind: "encounterPoints" },
            tiebreaks: [
              { metric: "headToHead" },
              { metric: "gamesWon" },
              { metric: "sonnebornBerger" },
            ],
          },
        },
      ],
    },
  ],
});

const wuccKnockout = (legRelease: "lockstep" | "independent", suffix: string) =>
  parseEventDef({
    id: `wucc-knockout-${suffix}`,
    name: `WUCC weekend knockout (${suffix})`,
    competitors: [
      team("yale", "Yale University", 2),
      team("pret", "University of Pretoria", 2),
      team("mona", "Monash University", 2),
      team("auck", "Auckland University", 2),
    ],
    stages: [
      {
        id: "ko",
        groups: [
          {
            id: "bracket",
            entries: seeds(4),
            run: {
              kind: "pool",
              pairing: { system: "knockout", seeding: "traditional" },
              encounter: {
                kind: "series",
                legs: [
                  {
                    kind: "match",
                    boards: 2,
                    board: rapid(600, 5),
                    colors: "zigzag",
                  },
                  {
                    kind: "match",
                    boards: 2,
                    board: rapid(600, 5),
                    colors: "zigzag",
                  },
                ],
                stop: { kind: "all" },
                colors: "alternate",
                tie: { kind: "manual" },
              },
              score: { kind: "encounterPoints" },
              legRelease,
              tiebreaks: [],
            },
          },
        ],
      },
    ],
  });

/**
 * The WUCC 2026 weekend knockout: two team matches per bracket tie, colors
 * flipped in the return match, arbiter decides aggregate ties. The live
 * event ran 4 boards with manually seeded brackets; shrunk to 2 boards with
 * `traditional` seeding here so tests can auto-pair.
 */
export const wuccKnockoutLockstep: ParsedEventDef = wuccKnockout(
  "lockstep",
  "lockstep",
);
export const wuccKnockoutUpfront: ParsedEventDef = wuccKnockout(
  "independent",
  "upfront",
);

/**
 * A miniature multi-stage championship: two round-robin groups feed a
 * knockout (A1 vs B2, B1 vs A2) with a third-place playoff — the WUCC/FIDE
 * Corporate shape.
 */
export const miniChampionship: ParsedEventDef = parseEventDef({
  id: "mini-championship",
  name: "Groups into knockout with bronze final",
  competitors: players("Anna", "Boris", "Clara", "David", "Elena", "Felix"),
  stages: [
    {
      id: "groups",
      groups: [
        {
          id: "a",
          entries: [
            { kind: "registration", seed: 1 },
            { kind: "registration", seed: 4 },
            { kind: "registration", seed: 5 },
          ],
          run: {
            kind: "pool",
            pairing: { system: "roundRobin", cycles: 1 },
            encounter: rapid(900, 10),
            score: { kind: "encounterPoints" },
            bye: { kind: "points", standings: 0, encounter: 0 },
            tiebreaks: [{ metric: "sonnebornBerger" }],
          },
        },
        {
          id: "b",
          entries: [
            { kind: "registration", seed: 2 },
            { kind: "registration", seed: 3 },
            { kind: "registration", seed: 6 },
          ],
          run: {
            kind: "pool",
            pairing: { system: "roundRobin", cycles: 1 },
            encounter: rapid(900, 10),
            score: { kind: "encounterPoints" },
            bye: { kind: "points", standings: 0, encounter: 0 },
            tiebreaks: [{ metric: "sonnebornBerger" }],
          },
        },
      ],
    },
    {
      id: "finals",
      groups: [
        {
          id: "ko",
          entries: [
            { kind: "rank", stage: "groups", group: "a", rank: 1 },
            { kind: "rank", stage: "groups", group: "b", rank: 2 },
            { kind: "rank", stage: "groups", group: "b", rank: 1 },
            { kind: "rank", stage: "groups", group: "a", rank: 2 },
          ],
          run: {
            kind: "pool",
            pairing: {
              system: "knockout",
              seeding: "adjacent",
              thirdPlace: true,
            },
            encounter: {
              kind: "game",
              clock: {
                initial: 900,
                increment: 10,
                whiteInitial: 900,
                blackInitial: 700,
              },
              tie: { kind: "drawOdds", color: "black" },
            },
            score: { kind: "encounterPoints" },
            tiebreaks: [],
          },
        },
      ],
    },
  ],
});

/**
 * Scheveningen: two legs of uniform-color team matches; every player meets
 * every opponent via rotated lineups submitted per leg.
 */
export const scheveningen: ParsedEventDef = parseEventDef({
  id: "scheveningen",
  name: "Scheveningen team match",
  competitors: [team("ham", "Hammers", 2), team("anv", "Anvils", 2)],
  stages: [
    {
      id: "match",
      groups: [
        {
          id: "tie",
          entries: seeds(2),
          run: {
            kind: "series",
            legs: [
              { kind: "match", boards: 2, board: classical, colors: "uniform" },
              { kind: "match", boards: 2, board: classical, colors: "uniform" },
            ],
            stop: { kind: "all" },
            colors: "alternate",
          },
        },
      ],
    },
  ],
});

/** Quads: one stage, parallel round-robin groups of four. */
export const quads: ParsedEventDef = parseEventDef({
  id: "quads",
  name: "Quads",
  competitors: players("P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8"),
  stages: [
    {
      id: "main",
      groups: [1, 2].map((q) => ({
        id: `quad-${q}`,
        entries: Array.from({ length: 4 }, (_, i) => ({
          kind: "registration",
          seed: (q - 1) * 4 + i + 1,
        })),
        run: {
          kind: "pool",
          pairing: { system: "roundRobin", cycles: 1 },
          encounter: rapid(900, 5),
          score: { kind: "encounterPoints" },
          tiebreaks: [{ metric: "sonnebornBerger" }],
        },
      })),
    },
  ],
});

export type FormatExample = {
  readonly slug: string;
  readonly title: string;
  readonly blurb: string;
  readonly def: ParsedEventDef;
};

export const FORMAT_EXAMPLES: readonly FormatExample[] = [
  {
    slug: "armageddon",
    title: "Armageddon showdown",
    blurb: "The smallest possible tournament: one game, black wins a draw.",
    def: armageddonShowdown,
  },
  {
    slug: "world-championship",
    title: "World Championship match",
    blurb: "14 classical games first to 7.5, then rapid, blitz, armageddon.",
    def: worldChampionship,
  },
  {
    slug: "world-cup",
    title: "FIDE World Cup",
    blurb: "Knockout where every tie is a chain of duels ending in armageddon.",
    def: worldCup,
  },
  {
    slug: "lone-wolf",
    title: "Individual swiss",
    blurb: "Plain swiss over game points with classical tiebreaks.",
    def: loneWolf,
  },
  {
    slug: "olympiad",
    title: "Olympiad team swiss",
    blurb: "4-board matches, match points, extended Sonneborn-Berger.",
    def: olympiad,
  },
  {
    slug: "lichess4545",
    title: "lichess4545 team league",
    blurb: "Team swiss with rounds-won, games-won and board-points tiebreaks.",
    def: lichess4545,
  },
  {
    slug: "norway-chess",
    title: "Norway Chess",
    blurb: "Round robin; draws go to armageddon — 3 / 1.5 / 1 / 0 points.",
    def: norwayChess,
  },
  {
    slug: "candidates",
    title: "Candidates",
    blurb: "Double round robin with reversed colors in the second cycle.",
    def: candidates,
  },
  {
    slug: "wucc-knockout",
    title: "WUCC weekend knockout",
    blurb:
      "Team knockout: two matches per tie, flipped colors, arbiter tiebreak.",
    def: wuccKnockoutLockstep,
  },
  {
    slug: "mini-championship",
    title: "Groups → knockout",
    blurb: "Two round-robin groups seed a knockout with a bronze final.",
    def: miniChampionship,
  },
  {
    slug: "scheveningen",
    title: "Scheveningen match",
    blurb: "Two legs of uniform-color team matches with rotated lineups.",
    def: scheveningen,
  },
  {
    slug: "quads",
    title: "Quads",
    blurb: "Parallel round-robin groups of four.",
    def: quads,
  },
];
