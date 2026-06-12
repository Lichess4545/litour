import type { ParsedEventDef } from "@/tournament/registry";
import { parseEventDef } from "./registry";

/**
 * The acceptance table of design/tournament-model.md as executable
 * definitions, authored the way an arbiter or tournament designer would:
 * plain data parsed against the chess registry — if one of these stops
 * validating, the model broke. Several defs are miniaturized (fewer players
 * or boards, auto-pairable seeding) so the test suite can drive them
 * end-to-end; each notes its deltas from the published format.
 */

// --- authoring vocabulary (plain data; the registry validates on parse) ----

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

const alternate = { source: "inherit", cycle: ["keep", "flip"] };
const sameSeats = { source: "inherit", cycle: ["keep"] };
const drawnSeats = { source: "draw" };
const zigzag = { cycle: ["keep", "flip"] };
const uniformBoards = { cycle: ["keep"] };

const untilDecided = { untilDecided: true };
const gamePoints = { kind: "passThrough" };
const matchPoints = { kind: "table", draw: 1, legs: [{ win: 2, loss: 0 }] };

/** Two games, colors alternating — the World Cup's basic tiebreak unit. */
const duel = (game: unknown) => ({
  kind: "series",
  legs: [game, game],
  seats: alternate,
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
                stop: { untilScore: 7.5 },
                seats: alternate,
              },
              duel(rapid(600, 5)),
              duel(rapid(300, 3)),
              armageddon,
            ],
            stop: untilDecided,
            seats: drawnSeats,
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
              stop: untilDecided,
              seats: drawnSeats,
            },
            score: gamePoints,
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
            score: gamePoints,
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
              seats: zigzag,
            },
            score: matchPoints,
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

/** lichess4545-style team swiss pool: rounds won, games won, then board points (4-board miniature of the 8-board league). */
const league4545 = (rounds: number) => ({
  kind: "pool",
  pairing: { system: "swiss" },
  rounds,
  encounter: {
    kind: "match",
    boards: 4,
    board: rapid(2700, 45),
    seats: zigzag,
  },
  score: matchPoints,
  bye: { kind: "points", standings: 1, encounter: 2 },
  tiebreaks: [
    { metric: "matchWins" },
    { metric: "gamesWon" },
    { metric: "boardPoints", board: 1 },
    { metric: "boardPoints", board: 2 },
  ],
});

/**
 * The league as a design: entries are open (teams register), so the view
 * shows exemplar pairings plus a faded "… pairing n" — the rounds are still
 * known because the def declares them.
 */
export const lichess4545: ParsedEventDef = parseEventDef({
  id: "lichess4545",
  name: "lichess4545 team league",
  competitors: [],
  stages: [
    {
      id: "season",
      groups: [{ id: "league", entries: { open: true }, run: league4545(8) }],
    },
  ],
});

/** The same league bound to a concrete season of four teams (the runnable fixture). */
export const lichess4545Season: ParsedEventDef = parseEventDef({
  id: "lichess4545-season",
  name: "lichess4545 team league — season",
  competitors: [
    team("kni", "Knights", 4),
    team("dra", "Dragons", 4),
    team("roo", "Rooks", 4),
    team("paw", "Pawnstars", 4),
  ],
  stages: [
    {
      id: "season",
      groups: [{ id: "league", entries: seeds(4), run: league4545(2) }],
    },
  ],
});

/** An open club round robin: even the round count depends on who signs up. */
export const clubRoundRobin: ParsedEventDef = parseEventDef({
  id: "club-rr",
  name: "Club round robin",
  competitors: [],
  stages: [
    {
      id: "night",
      groups: [
        {
          id: "rr",
          entries: { open: true },
          run: {
            kind: "pool",
            pairing: { system: "roundRobin", cycles: 1 },
            encounter: rapid(900, 10),
            score: { kind: "passThrough" },
            tiebreaks: [{ metric: "sonnebornBerger" }],
          },
        },
      ],
    },
  ],
});

/**
 * Norway Chess: round robin where a drawn classical game goes to armageddon
 * with the same colors. Win 3 / armageddon win 1.5 / armageddon loss 1 /
 * loss 0 — the leg-keyed scoring table, while games stay normally scored.
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
              stop: untilDecided,
              seats: sameSeats,
            },
            score: {
              kind: "table",
              draw: 0,
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
            score: gamePoints,
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
                    seats: zigzag,
                  },
                  {
                    kind: "match",
                    boards: 2,
                    board: rapid(600, 5),
                    seats: zigzag,
                  },
                ],
                seats: alternate,
                tie: { kind: "manual" },
              },
              score: gamePoints,
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
            score: gamePoints,
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
            score: gamePoints,
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
            score: gamePoints,
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
              {
                kind: "match",
                boards: 2,
                board: classical,
                seats: uniformBoards,
              },
              {
                kind: "match",
                boards: 2,
                board: classical,
                seats: uniformBoards,
              },
            ],
            seats: alternate,
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
          score: gamePoints,
          tiebreaks: [{ metric: "sonnebornBerger" }],
        },
      })),
    },
  ],
});

/**
 * The cascade round: an 8-round team swiss where every round is two rapid
 * team games with swapped colors (match points only — game points never
 * matter), a tied round goes to one full-team blitz match with drawn
 * colors, and a still-tied round is decided by a single-board armageddon
 * with drawn colors. Everything below is composition: the per-leg "random
 * color" is a singleton series wrapper whose seats are drawn by lot.
 */
export const teamSwissCascade: ParsedEventDef = parseEventDef({
  id: "team-swiss-cascade",
  name: "Team swiss with blitz and armageddon cascade",
  competitors: [
    team("ank", "Anchors", 2),
    team("bol", "Bolts", 2),
    team("cog", "Cogs", 2),
    team("dyn", "Dynamos", 2),
    team("emb", "Embers", 2),
    team("fla", "Flames", 2),
    team("gri", "Griffins", 2),
    team("hus", "Huskies", 2),
  ],
  stages: [
    {
      id: "season",
      groups: [
        {
          id: "swiss",
          entries: seeds(8),
          run: {
            kind: "pool",
            pairing: { system: "swiss" },
            rounds: 8,
            encounter: {
              kind: "series",
              stop: untilDecided,
              seats: sameSeats,
              legs: [
                {
                  // Two rapid team games, colors swapped between them.
                  kind: "series",
                  legs: [
                    {
                      kind: "match",
                      boards: 2,
                      board: rapid(600, 5),
                      seats: zigzag,
                    },
                    {
                      kind: "match",
                      boards: 2,
                      board: rapid(600, 5),
                      seats: zigzag,
                    },
                  ],
                  seats: alternate,
                },
                {
                  // Tied after both games: one full-team blitz, colors drawn.
                  kind: "series",
                  legs: [
                    {
                      kind: "match",
                      boards: 2,
                      board: rapid(180, 2),
                      seats: zigzag,
                    },
                  ],
                  stop: untilDecided,
                  seats: drawnSeats,
                },
                {
                  // Still tied: a single nominated board plays armageddon,
                  // colors drawn; the match inherits the draw-odds decision.
                  kind: "series",
                  legs: [
                    {
                      kind: "match",
                      boards: 1,
                      board: armageddon,
                      seats: uniformBoards,
                      tie: { kind: "drawOdds", color: "black" },
                    },
                  ],
                  stop: untilDecided,
                  seats: drawnSeats,
                },
              ],
            },
            score: matchPoints,
            bye: { kind: "points", standings: 1, encounter: 1 },
            tiebreaks: [{ metric: "matchWins" }],
          },
        },
      ],
    },
  ],
});

// ---------------------------------------------------------------------------
// The full championship pipelines (university & corporate)

const ranks = (stage: string, group: string, ...ns: readonly number[]) =>
  ns.map((rank) => ({ kind: "rank", stage, group, rank }));

const topSeeds = (stage: string, group: string, count: number) =>
  ranks(stage, group, ...Array.from({ length: count }, (_, i) => i + 1));

const teamMatch = (boards: number, game: unknown) => ({
  kind: "match",
  boards,
  board: game,
  seats: zigzag,
});

/** Two team matches with flipped colors; the arbiter decides aggregate ties. */
const twoMatchTie = (boards: number, game: unknown) => ({
  kind: "series",
  legs: [teamMatch(boards, game), teamMatch(boards, game)],
  seats: alternate,
  tie: { kind: "manual" },
});

/** A 32-team knockout cut to two rounds: the eight survivors advance. */
const cutKnockout = (encounter: unknown) => ({
  kind: "pool",
  pairing: { system: "knockout", seeding: "traditional", rounds: 2 },
  encounter,
  score: gamePoints,
  bye: { kind: "advance" },
  legRelease: "lockstep",
  tiebreaks: [],
});

const universitySwiss = {
  kind: "pool",
  pairing: { system: "swiss" },
  rounds: 9,
  encounter: teamMatch(4, rapid(900, 10)),
  score: matchPoints,
  bye: { kind: "points", standings: 1, encounter: 2 },
  tiebreaks: [{ metric: "gamesWon" }],
};

const universityOtbGroup = {
  kind: "pool",
  pairing: { system: "roundRobin", cycles: 2 },
  encounter: teamMatch(4, classical),
  score: matchPoints,
  tiebreaks: [{ metric: "gamesWon" }],
};

/**
 * FIDE World University Team Championship — the full pipeline. Two open
 * online team-swiss qualifiers each send their top 16 into a 32-team
 * knockout that plays only two rounds (`rounds: 2` truncates the bracket);
 * the eight survivors travel to the venue: two double round robins, then
 * cross-group semifinals with a bronze final.
 */
export const worldUniversityChampionship: ParsedEventDef = parseEventDef({
  id: "world-university",
  name: "World University Team Championship",
  competitors: [],
  stages: [
    {
      id: "qualifiers",
      groups: [
        { id: "q1", entries: { open: true }, run: universitySwiss },
        { id: "q2", entries: { open: true }, run: universitySwiss },
      ],
    },
    {
      id: "knockout",
      groups: [
        {
          id: "ko",
          entries: [
            ...topSeeds("qualifiers", "q1", 16),
            ...topSeeds("qualifiers", "q2", 16),
          ],
          run: cutKnockout(twoMatchTie(4, rapid(900, 10))),
        },
      ],
    },
    {
      id: "otb-groups",
      groups: [
        {
          id: "a",
          entries: ranks("knockout", "ko", 1, 4, 5, 8),
          run: universityOtbGroup,
        },
        {
          id: "b",
          entries: ranks("knockout", "ko", 2, 3, 6, 7),
          run: universityOtbGroup,
        },
      ],
    },
    {
      id: "medals",
      groups: [
        {
          id: "title",
          entries: [
            ...ranks("otb-groups", "a", 1),
            ...ranks("otb-groups", "b", 2),
            ...ranks("otb-groups", "b", 1),
            ...ranks("otb-groups", "a", 2),
          ],
          run: {
            kind: "pool",
            pairing: {
              system: "knockout",
              seeding: "adjacent",
              thirdPlace: true,
            },
            encounter: {
              ...teamMatch(4, classical),
              tie: { kind: "manual" },
            },
            score: gamePoints,
            bye: { kind: "advance" },
            tiebreaks: [],
          },
        },
      ],
    },
  ],
});

const CORPORATE_POOLS = [
  "americas",
  "europe-africa",
  "asia-pacific",
  "oceania",
] as const;

/**
 * FIDE World Corporate Championship — four open timezone pools (team
 * swiss); each sends its top 8 into the same 32-team knockout, cut to two
 * rounds; the final eight play an over-the-board knockout with a bronze
 * final.
 */
export const worldCorporateChampionship: ParsedEventDef = parseEventDef({
  id: "world-corporate",
  name: "World Corporate Championship",
  competitors: [],
  stages: [
    {
      id: "pools",
      groups: CORPORATE_POOLS.map((id) => ({
        id,
        entries: { open: true },
        run: {
          kind: "pool",
          pairing: { system: "swiss" },
          rounds: 7,
          encounter: teamMatch(4, rapid(600, 5)),
          score: matchPoints,
          bye: { kind: "points", standings: 1, encounter: 2 },
          tiebreaks: [{ metric: "gamesWon" }],
        },
      })),
    },
    {
      id: "knockout",
      groups: [
        {
          id: "ko",
          entries: CORPORATE_POOLS.flatMap((pool) =>
            topSeeds("pools", pool, 8),
          ),
          run: cutKnockout(twoMatchTie(4, rapid(600, 5))),
        },
      ],
    },
    {
      id: "finals",
      groups: [
        {
          id: "otb",
          entries: topSeeds("knockout", "ko", 8),
          run: {
            kind: "pool",
            pairing: {
              system: "knockout",
              seeding: "traditional",
              thirdPlace: true,
            },
            encounter: {
              ...teamMatch(4, rapid(1500, 10)),
              tie: { kind: "manual" },
            },
            score: gamePoints,
            bye: { kind: "advance" },
            tiebreaks: [],
          },
        },
      ],
    },
  ],
});

// ---------------------------------------------------------------------------
// The Grand Chess Tour: five whole tournaments rolled up into tour standings

/** Tour points by event placement (1st → 13, 2nd → 10, …). */
const GCT_POINTS = [13, 10, 8, 7, 6, 5, 4, 3, 2, 1];

const GCT_EVENTS = [
  { id: "superbet-classic", name: "Superbet Chess Classic", kind: "classical" },
  { id: "zagreb", name: "SuperUnited Zagreb Rapid & Blitz", kind: "rb" },
  { id: "warsaw", name: "SuperUnited Warsaw Rapid & Blitz", kind: "rb" },
  { id: "saint-louis", name: "Saint Louis Rapid & Blitz", kind: "rb" },
  { id: "sinquefield", name: "Sinquefield Cup", kind: "classical" },
] as const;

/** A classical tour stop: 10-player single round robin. */
const gctClassical = {
  kind: "pool",
  pairing: { system: "roundRobin", cycles: 1 },
  encounter: {
    kind: "game",
    name: "Classical",
    clock: { initial: 7200, increment: 30 },
  },
  score: gamePoints,
  tiebreaks: [{ metric: "sonnebornBerger" }, { metric: "headToHead" }],
};

/**
 * A Rapid & Blitz stop: one rapid round robin (rounds 1–9, scored 2/1/0)
 * straight into a double blitz round robin (rounds 10–27, scored 1/½/0) —
 * one combined standings via phased scoring. (The per-phase clock change is
 * host scheduling; the model varies the points.)
 */
const gctRapidBlitz = {
  kind: "pool",
  pairing: { system: "roundRobin", cycles: 3 },
  encounter: {
    kind: "game",
    name: "Rapid / Blitz",
    clock: { initial: 1500, increment: 10 },
  },
  score: {
    kind: "phased",
    phases: [
      { rounds: 9, win: 2, draw: 1, loss: 0 },
      { rounds: 18, win: 1, draw: 0.5, loss: 0 },
    ],
  },
  tiebreaks: [{ metric: "sonnebornBerger" }],
};

/**
 * A finals match: two classical games worth 6/3, two rapid worth 4/2, two
 * blitz worth 2/1, and armageddon if the weighted points are still level —
 * the weighting is just per-game point schedules summing up the series.
 */
const gctFinalsMatch = {
  kind: "series",
  name: "Finals match",
  legName: "game",
  legs: [
    ...Array.from({ length: 2 }, () => ({
      kind: "game",
      name: "Classical",
      clock: { initial: 5400, increment: 30 },
      points: { win: 6, draw: 3, loss: 0 },
    })),
    ...Array.from({ length: 2 }, () => ({
      kind: "game",
      name: "Rapid",
      clock: { initial: 1500, increment: 10 },
      points: { win: 4, draw: 2, loss: 0 },
    })),
    ...Array.from({ length: 2 }, () => ({
      kind: "game",
      name: "Blitz",
      clock: { initial: 300, increment: 3 },
      points: { win: 2, draw: 1, loss: 0 },
    })),
    armageddon,
  ],
  stop: untilDecided,
  seats: alternate,
};

/**
 * The Grand Chess Tour: five complete tournaments — two classical round
 * robins and three Rapid & Blitz events — whose placements convert to tour
 * points (13/10/8/…); the top four on tour points meet in the São Paulo
 * finals over weighted classical/rapid/blitz matches with a bronze final.
 * Every word on the cards comes from the definition: stage names, "match"
 * for the finals pairings, "game" for the legs.
 */
export const grandChessTour: ParsedEventDef = parseEventDef({
  id: "grand-chess-tour",
  name: "Grand Chess Tour",
  competitors: players(
    "Caruana",
    "Praggnanandhaa",
    "Gukesh",
    "Abdusattorov",
    "Firouzja",
    "So",
    "Vachier-Lagrave",
    "Aronian",
    "Giri",
    "Duda",
  ),
  stages: [
    ...GCT_EVENTS.map((event) => ({
      id: event.id,
      name: event.name,
      groups: [
        {
          id: "field",
          name: event.name,
          entries: seeds(10),
          run: event.kind === "classical" ? gctClassical : gctRapidBlitz,
        },
      ],
    })),
    {
      id: "finals",
      name: "GCT Finals São Paulo",
      groups: [
        {
          id: "playoff",
          name: "Finals — top 4 on tour points",
          entries: Array.from({ length: 4 }, (_, i) => ({
            kind: "placements",
            sources: GCT_EVENTS.map((event) => ({
              stage: event.id,
              group: "field",
            })),
            points: GCT_POINTS,
            rank: i + 1,
          })),
          run: {
            kind: "pool",
            pairing: {
              system: "knockout",
              seeding: "traditional",
              thirdPlace: true,
            },
            terms: { pairing: "match" },
            encounter: gctFinalsMatch,
            score: gamePoints,
            bye: { kind: "advance" },
            tiebreaks: [],
          },
        },
      ],
    },
  ],
});

// ---------------------------------------------------------------------------
// Sectioned events: parallel divisions, contemporaneous, separately scored

/** A LoneWolf-style swiss section (registration decides who enters which). */
const loneWolfSection = {
  kind: "pool",
  pairing: { system: "swiss" },
  rounds: 11,
  encounter: rapid(2700, 45),
  score: gamePoints,
  bye: { kind: "points", standings: 1, encounter: 1 },
  tiebreaks: [
    { metric: "sonnebornBerger" },
    { metric: "buchholz" },
    { metric: "headToHead" },
  ],
};

/**
 * Sections: one event, two divisions running contemporaneously — separate
 * registration, separate standings. The rating cap is registration policy
 * (host-side), not structure.
 */
export const loneWolfSections: ParsedEventDef = parseEventDef({
  id: "lonewolf-sections",
  name: "LoneWolf — Open & U1800",
  competitors: [],
  stages: [
    {
      id: "season",
      name: "Season",
      groups: [
        {
          id: "open",
          name: "Open",
          entries: { open: true },
          run: loneWolfSection,
        },
        {
          id: "u1800",
          name: "U1800",
          entries: { open: true },
          run: loneWolfSection,
        },
      ],
    },
  ],
});

const candidatesPool = {
  kind: "pool",
  pairing: { system: "roundRobin", cycles: 2 },
  encounter: classical,
  score: gamePoints,
  tiebreaks: [
    { metric: "headToHead" },
    { metric: "gamesWon" },
    { metric: "sonnebornBerger" },
  ],
};

/** Both Candidates tournaments share the venue and the schedule. */
export const candidatesBoth: ParsedEventDef = parseEventDef({
  id: "candidates-both",
  name: "FIDE Candidates — open & women",
  competitors: players(
    "Nepomniachtchi",
    "Caruana",
    "Gukesh",
    "Praggnanandhaa",
    "Vidit",
    "Firouzja",
    "Nakamura",
    "Abasov",
    "Tan Zhongyi",
    "Goryachkina",
    "Lei Tingjie",
    "Vaishali",
    "Humpy",
    "Salimova",
    "Lagno",
    "Muzychuk",
  ),
  stages: [
    {
      id: "candidates",
      name: "Candidates Toronto",
      groups: [
        {
          id: "open",
          name: "Candidates",
          entries: seeds(8),
          run: candidatesPool,
        },
        {
          id: "women",
          name: "Women's Candidates",
          entries: Array.from({ length: 8 }, (_, i) => ({
            kind: "registration",
            seed: 9 + i,
          })),
          run: candidatesPool,
        },
      ],
    },
  ],
});

/**
 * GRENKE: an elite double round robin and a huge open swiss — completely
 * different formats — under one roof, at the same time.
 */
export const grenke: ParsedEventDef = parseEventDef({
  id: "grenke",
  name: "GRENKE Chess Classic & Open",
  competitors: players(
    "Carlsen",
    "Caruana",
    "Vachier-Lagrave",
    "Keymer",
    "Ding",
    "Rapport",
  ),
  stages: [
    {
      id: "grenke",
      name: "GRENKE Karlsruhe",
      groups: [
        {
          id: "classic",
          name: "GRENKE Classic",
          entries: seeds(6),
          run: {
            kind: "pool",
            pairing: { system: "roundRobin", cycles: 2 },
            encounter: classical,
            score: gamePoints,
            tiebreaks: [{ metric: "sonnebornBerger" }],
          },
        },
        {
          id: "open",
          name: "GRENKE Open",
          entries: { open: true },
          run: {
            kind: "pool",
            pairing: { system: "swiss" },
            rounds: 9,
            encounter: classical,
            score: gamePoints,
            bye: { kind: "points", standings: 0.5, encounter: 0.5 },
            tiebreaks: [{ metric: "buchholz" }, { metric: "sonnebornBerger" }],
          },
        },
      ],
    },
  ],
});

/**
 * Tata Steel Wijk aan Zee: Masters and Challengers round robins beside an
 * open amateur swiss, all contemporaneous. (Each field miniaturized to 6;
 * the Challengers→Masters promotion crosses editions, outside one event.)
 */
export const tataSteel: ParsedEventDef = parseEventDef({
  id: "tata-steel",
  name: "Tata Steel Wijk aan Zee",
  competitors: players(
    "Gukesh",
    "Abdusattorov",
    "Giri",
    "Wei Yi",
    "Fedoseev",
    "Warmerdam",
    "Erdogmus",
    "Divya",
    "Sindarov",
    "Suleymanli",
    "Beerdsen",
    "Maurizzi",
  ),
  stages: [
    {
      id: "wijk",
      name: "Wijk aan Zee",
      groups: [
        {
          id: "masters",
          name: "Masters",
          entries: seeds(6),
          run: {
            kind: "pool",
            pairing: { system: "roundRobin", cycles: 1 },
            encounter: classical,
            score: gamePoints,
            tiebreaks: [{ metric: "sonnebornBerger" }],
          },
        },
        {
          id: "challengers",
          name: "Challengers",
          entries: Array.from({ length: 6 }, (_, i) => ({
            kind: "registration",
            seed: 7 + i,
          })),
          run: {
            kind: "pool",
            pairing: { system: "roundRobin", cycles: 1 },
            encounter: classical,
            score: gamePoints,
            tiebreaks: [{ metric: "sonnebornBerger" }],
          },
        },
        {
          id: "amateurs",
          name: "Amateurs",
          entries: { open: true },
          run: {
            kind: "pool",
            pairing: { system: "swiss" },
            rounds: 9,
            encounter: rapid(2700, 30),
            score: gamePoints,
            bye: { kind: "points", standings: 0.5, encounter: 0.5 },
            tiebreaks: [{ metric: "buchholz" }],
          },
        },
      ],
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
    blurb:
      "Open team signup: 8 known rounds, an unknown number of pairings each.",
    def: lichess4545,
  },
  {
    slug: "club-round-robin",
    title: "Open round robin",
    blurb: "Entries open — even the round count depends on who signs up.",
    def: clubRoundRobin,
  },
  {
    slug: "norway-chess",
    title: "Norway Chess",
    blurb: "Round robin; draws go to armageddon — 3 / 1.5 / 1 / 0 points.",
    def: norwayChess,
  },
  {
    slug: "candidates",
    title: "FIDE Candidates — open & women",
    blurb:
      "Two double round robins sharing the venue: separate fields, separate standings.",
    def: candidatesBoth,
  },
  {
    slug: "lonewolf-sections",
    title: "LoneWolf — Open & U1800",
    blurb:
      "Two swiss sections, contemporaneous: registration and standings per section.",
    def: loneWolfSections,
  },
  {
    slug: "grenke",
    title: "GRENKE Classic & Open",
    blurb:
      "An elite double round robin beside a huge open swiss — different formats, one event.",
    def: grenke,
  },
  {
    slug: "tata-steel",
    title: "Tata Steel Wijk aan Zee",
    blurb: "Masters and Challengers round robins beside an open amateur swiss.",
    def: tataSteel,
  },
  {
    slug: "grand-chess-tour",
    title: "Grand Chess Tour",
    blurb:
      "Five whole tournaments; placements become tour points; the top four meet in weighted-match finals.",
    def: grandChessTour,
  },
  {
    slug: "world-university",
    title: "World University Team Championship",
    blurb:
      "Two open qualifiers → 32-team knockout cut to two rounds → eight teams over the board.",
    def: worldUniversityChampionship,
  },
  {
    slug: "world-corporate",
    title: "World Corporate Championship",
    blurb:
      "Four open timezone pools → 32-team knockout, two rounds → an over-the-board final eight.",
    def: worldCorporateChampionship,
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
  {
    slug: "team-swiss-cascade",
    title: "Team swiss with cascading tiebreaks",
    blurb:
      "Eight rounds; each round: two color-swapped rapid games, then full-team blitz with drawn colors, then a one-board armageddon.",
    def: teamSwissCascade,
  },
];
