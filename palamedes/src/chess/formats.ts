import type { ParsedEventDef } from "@/tournament/registry";
import {
  bestOf,
  byeAdvance,
  byePoints,
  type CompetitionData,
  competition,
  container,
  drawOdds,
  duel,
  type EncounterData,
  event,
  game,
  gamePoints,
  knockout,
  manualTie,
  matchOf,
  matchPoints,
  open,
  phased,
  pointsTable,
  ranks,
  roundRobin,
  type SeedData,
  sameSeats,
  seeds,
  seedsFrom,
  seriesOf,
  swiss,
  top,
  tourTop,
  uniformBoards,
  untilDecided,
} from "./compose";
import { parseEventDef } from "./registry";

/**
 * The acceptance table of design/tournament-model.md as executable
 * definitions, authored on the compose combinators the way an arbiter or
 * tournament designer would: named patterns composing into plain data,
 * parsed against the chess registry — if one of these stops validating, the
 * model broke. Several defs are miniaturized (fewer players or boards,
 * auto-pairable seeding) so the test suite can drive them end-to-end; each
 * notes its deltas from the published format.
 */

// --- format-local vocabulary -----------------------------------------------

const classical = game({ initial: 5400, increment: 30 });
const rapid = (initial: number, increment: number) =>
  game({ initial, increment });
const armageddon = game(
  { initial: 600, increment: 0, whiteInitial: 600, blackInitial: 420 },
  { tie: drawOdds("black") },
);

const players = (...names: readonly string[]) =>
  names.map((name) => ({ id: name.toLowerCase(), name }));

const team = (id: string, name: string, boards: number) => ({
  id,
  name,
  roster: Array.from({ length: boards }, (_, i) => `${id}${i + 1}`),
});

const seedNos = (...ns: readonly number[]): readonly SeedData[] =>
  ns.map((seed) => ({ kind: "registration", seed }));

// ---------------------------------------------------------------------------

/** A whole tournament in one armageddon game: white must win, black wins a draw. */
export const armageddonShowdown: ParsedEventDef = parseEventDef(
  event(
    "armageddon-showdown",
    "Armageddon showdown",
    players("Magnus", "Hikaru"),
    competition("duel", undefined, seeds(2), armageddon),
  ),
);

/**
 * World Championship match: 14 classical games, first to 7.5 — if 7–7, the
 * chain continues: two rapid games, two blitz games, then armageddon. Fresh
 * drawing of colors before each segment.
 */
export const worldChampionship: ParsedEventDef = parseEventDef(
  event(
    "world-championship",
    "World Championship match",
    players("Ding", "Gukesh"),
    competition(
      "title",
      undefined,
      seeds(2),
      untilDecided(
        bestOf(14, classical),
        duel(rapid(600, 5)),
        duel(rapid(300, 3)),
        armageddon,
      ),
    ),
  ),
);

/**
 * FIDE World Cup: single-elimination; every bracket tie is two classical
 * games, then descending rapid/blitz duels, then armageddon — colors redrawn
 * before each segment.
 */
export const worldCup: ParsedEventDef = parseEventDef(
  event(
    "world-cup",
    "FIDE World Cup (8 players)",
    players(
      "Magnus",
      "Fabiano",
      "Hikaru",
      "Gukesh",
      "Alireza",
      "Ian",
      "Wesley",
      "Anish",
    ),
    competition(
      "bracket",
      undefined,
      seeds(8),
      knockout(
        untilDecided(
          duel(classical),
          duel(rapid(1500, 10)),
          duel(rapid(600, 10)),
          duel(rapid(300, 3)),
          armageddon,
        ),
      ),
    ),
  ),
);

/** Individual swiss (LoneWolf): game points, classical tiebreaks, full-point bye. */
export const loneWolf: ParsedEventDef = parseEventDef(
  event(
    "lone-wolf",
    "LoneWolf individual swiss",
    players("Alice", "Bob", "Carol", "Dave", "Erin"),
    competition(
      "swiss",
      undefined,
      seeds(5),
      swiss(3, rapid(2700, 45), gamePoints, {
        bye: byePoints(1, 1),
        tiebreaks: [
          { metric: "sonnebornBerger" },
          { metric: "buchholz" },
          { metric: "headToHead" },
        ],
      }),
    ),
  ),
);

/**
 * Olympiad-style team swiss: 4 boards zigzagging from the team color, match
 * points 2/1/0 from board-point comparison, FIDE extended Sonneborn-Berger.
 */
export const olympiad: ParsedEventDef = parseEventDef(
  event(
    "olympiad",
    "Olympiad team swiss",
    [
      team("ind", "India", 4),
      team("usa", "USA", 4),
      team("uzb", "Uzbekistan", 4),
      team("chn", "China", 4),
    ],
    competition(
      "swiss",
      undefined,
      seeds(4),
      swiss(3, matchOf(4, classical), matchPoints, {
        bye: byePoints(1, 2),
        tiebreaks: [
          {
            metric: "extendedSB",
            opponentTotal: "encounter",
            scored: "encounter",
          },
          { metric: "encounterPoints" },
          { metric: "gamesWon" },
        ],
      }),
    ),
  ),
);

/** lichess4545-style team swiss pool: rounds won, games won, then board points (4-board miniature of the 8-board league). */
const league4545 = (rounds: number) =>
  swiss(rounds, matchOf(4, rapid(2700, 45)), matchPoints, {
    bye: byePoints(1, 2),
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
export const lichess4545: ParsedEventDef = parseEventDef(
  event(
    "lichess4545",
    "lichess4545 team league",
    [],
    competition("league", undefined, open, league4545(8)),
  ),
);

/** The same league bound to a concrete season of four teams (the runnable fixture). */
export const lichess4545Season: ParsedEventDef = parseEventDef(
  event(
    "lichess4545-season",
    "lichess4545 team league — season",
    [
      team("kni", "Knights", 4),
      team("dra", "Dragons", 4),
      team("roo", "Rooks", 4),
      team("paw", "Pawnstars", 4),
    ],
    competition("league", undefined, seeds(4), league4545(2)),
  ),
);

/** An open club round robin: even the round count depends on who signs up. */
export const clubRoundRobin: ParsedEventDef = parseEventDef(
  event(
    "club-rr",
    "Club round robin",
    [],
    competition(
      "rr",
      undefined,
      open,
      roundRobin(1, rapid(900, 10), gamePoints, {
        tiebreaks: [{ metric: "sonnebornBerger" }],
      }),
    ),
  ),
);

/**
 * Norway Chess: round robin where a drawn classical game goes to armageddon
 * with the same colors. Win 3 / armageddon win 1.5 / armageddon loss 1 /
 * loss 0 — the leg-keyed scoring table, while games stay normally scored.
 */
export const norwayChess: ParsedEventDef = parseEventDef(
  event(
    "norway-chess",
    "Norway Chess",
    players("Magnus", "Fabiano", "Hikaru", "Praggnanandhaa"),
    competition(
      "rr",
      undefined,
      seeds(4),
      roundRobin(
        1,
        seriesOf([classical, armageddon], {
          stop: { untilDecided: true },
          seats: sameSeats,
        }),
        pointsTable(0, { win: 3, loss: 0 }, { win: 1.5, loss: 1 }),
        { tiebreaks: [{ metric: "gamesWon" }] },
      ),
    ),
  ),
);

/** Candidates: double round robin, colors reversed in the second cycle. */
export const candidates: ParsedEventDef = parseEventDef(
  event(
    "candidates",
    "Candidates (double round robin)",
    players("Ian", "Fabiano", "Gukesh", "Hikaru"),
    competition(
      "rr",
      undefined,
      seeds(4),
      roundRobin(2, classical, gamePoints, {
        tiebreaks: [
          { metric: "headToHead" },
          { metric: "gamesWon" },
          { metric: "sonnebornBerger" },
        ],
      }),
    ),
  ),
);

const wuccKnockout = (legRelease: "lockstep" | "independent", suffix: string) =>
  parseEventDef(
    event(
      `wucc-knockout-${suffix}`,
      `WUCC weekend knockout (${suffix})`,
      [
        team("yale", "Yale University", 2),
        team("pret", "University of Pretoria", 2),
        team("mona", "Monash University", 2),
        team("auck", "Auckland University", 2),
      ],
      competition(
        "bracket",
        undefined,
        seeds(4),
        knockout(
          seriesOf([matchOf(2, rapid(600, 5)), matchOf(2, rapid(600, 5))], {
            tie: manualTie,
          }),
          { legRelease },
        ),
      ),
    ),
  );

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
export const miniChampionship: ParsedEventDef = parseEventDef(
  event(
    "mini-championship",
    "Groups into knockout with bronze final",
    players("Anna", "Boris", "Clara", "David", "Elena", "Felix"),
    container(
      "mini-championship",
      "Groups into knockout with bronze final",
      container(
        "groups",
        undefined,
        competition(
          "a",
          undefined,
          seedNos(1, 4, 5),
          roundRobin(1, rapid(900, 10), gamePoints, {
            bye: byePoints(0, 0),
            tiebreaks: [{ metric: "sonnebornBerger" }],
          }),
        ),
        competition(
          "b",
          undefined,
          seedNos(2, 3, 6),
          roundRobin(1, rapid(900, 10), gamePoints, {
            bye: byePoints(0, 0),
            tiebreaks: [{ metric: "sonnebornBerger" }],
          }),
        ),
      ),
      competition(
        "ko",
        undefined,
        [
          ...ranks("a", 1),
          ...ranks("b", 2),
          ...ranks("b", 1),
          ...ranks("a", 2),
        ],
        knockout(
          game(
            {
              initial: 900,
              increment: 10,
              whiteInitial: 900,
              blackInitial: 700,
            },
            { tie: drawOdds("black") },
          ),
          { seeding: "adjacent", thirdPlace: true },
        ),
      ),
    ),
  ),
);

/**
 * Scheveningen: two legs of uniform-color team matches; every player meets
 * every opponent via rotated lineups submitted per leg.
 */
export const scheveningen: ParsedEventDef = parseEventDef(
  event(
    "scheveningen",
    "Scheveningen team match",
    [team("ham", "Hammers", 2), team("anv", "Anvils", 2)],
    competition(
      "tie",
      undefined,
      seeds(2),
      seriesOf([
        matchOf(2, classical, { seats: uniformBoards }),
        matchOf(2, classical, { seats: uniformBoards }),
      ]),
    ),
  ),
);

/** Quads: parallel round-robin groups of four under one roof. */
export const quads: ParsedEventDef = parseEventDef(
  event(
    "quads",
    "Quads",
    players("P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8"),
    container(
      "main",
      undefined,
      ...[1, 2].map((q) =>
        competition(
          `quad-${q}`,
          undefined,
          seedsFrom((q - 1) * 4 + 1, 4),
          roundRobin(1, rapid(900, 5), gamePoints, {
            tiebreaks: [{ metric: "sonnebornBerger" }],
          }),
        ),
      ),
    ),
  ),
);

/**
 * The cascade round: an 8-round team swiss where every round is two rapid
 * team games with swapped colors (match points only — game points never
 * matter), a tied round goes to one full-team blitz match with drawn
 * colors, and a still-tied round is decided by a single-board armageddon
 * with drawn colors. Everything below is composition: the per-leg "random
 * color" is a singleton untilDecided wrapper whose seats are drawn by lot.
 */
export const teamSwissCascade: ParsedEventDef = parseEventDef(
  event(
    "team-swiss-cascade",
    "Team swiss with blitz and armageddon cascade",
    [
      team("ank", "Anchors", 2),
      team("bol", "Bolts", 2),
      team("cog", "Cogs", 2),
      team("dyn", "Dynamos", 2),
      team("emb", "Embers", 2),
      team("fla", "Flames", 2),
      team("gri", "Griffins", 2),
      team("hus", "Huskies", 2),
    ],
    competition(
      "swiss",
      undefined,
      seeds(8),
      swiss(
        8,
        seriesOf(
          [
            // Two rapid team games, colors swapped between them.
            seriesOf([matchOf(2, rapid(600, 5)), matchOf(2, rapid(600, 5))]),
            // Tied after both games: one full-team blitz, colors drawn.
            untilDecided(matchOf(2, rapid(180, 2))),
            // Still tied: a single nominated board plays armageddon,
            // colors drawn; the match inherits the draw-odds decision.
            untilDecided(
              matchOf(1, armageddon, {
                seats: uniformBoards,
                tie: drawOdds("black"),
              }),
            ),
          ],
          { stop: { untilDecided: true }, seats: sameSeats },
        ),
        matchPoints,
        { bye: byePoints(1, 1), tiebreaks: [{ metric: "matchWins" }] },
      ),
    ),
  ),
);

// ---------------------------------------------------------------------------
// The full championship pipelines (university & corporate)

/** Two team matches with flipped colors; the arbiter decides aggregate ties. */
const twoMatchTie = (boards: number, g: EncounterData) =>
  seriesOf([matchOf(boards, g), matchOf(boards, g)], { tie: manualTie });

/** A 32-team knockout cut to two rounds: the eight survivors advance. */
const cutKnockout = (encounter: EncounterData) =>
  knockout(encounter, { rounds: 2, bye: byeAdvance, legRelease: "lockstep" });

const universitySwiss = swiss(9, matchOf(4, rapid(900, 10)), matchPoints, {
  bye: byePoints(1, 2),
  tiebreaks: [{ metric: "gamesWon" }],
});

const universityOtbGroup = roundRobin(2, matchOf(4, classical), matchPoints, {
  tiebreaks: [{ metric: "gamesWon" }],
});

/**
 * FIDE World University Team Championship — the full pipeline. Two open
 * online team-swiss qualifiers each send their top 16 into a 32-team
 * knockout that plays only two rounds (`rounds: 2` truncates the bracket);
 * the eight survivors travel to the venue: two double round robins, then
 * cross-group semifinals with a bronze final.
 */
export const worldUniversityChampionship: ParsedEventDef = parseEventDef(
  event(
    "world-university",
    "World University Team Championship",
    [],
    container(
      "world-university",
      "World University Team Championship",
      container(
        "qualifiers",
        undefined,
        competition("q1", undefined, open, universitySwiss),
        competition("q2", undefined, open, universitySwiss),
      ),
      competition(
        "knockout",
        undefined,
        [...top("q1", 16), ...top("q2", 16)],
        cutKnockout(twoMatchTie(4, rapid(900, 10))),
      ),
      container(
        "otb-groups",
        undefined,
        competition(
          "a",
          undefined,
          ranks("knockout", 1, 4, 5, 8),
          universityOtbGroup,
        ),
        competition(
          "b",
          undefined,
          ranks("knockout", 2, 3, 6, 7),
          universityOtbGroup,
        ),
      ),
      competition(
        "medals",
        undefined,
        [
          ...ranks("a", 1),
          ...ranks("b", 2),
          ...ranks("b", 1),
          ...ranks("a", 2),
        ],
        knockout(matchOf(4, classical, { tie: manualTie }), {
          seeding: "adjacent",
          thirdPlace: true,
          bye: byeAdvance,
        }),
      ),
    ),
  ),
);

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
export const worldCorporateChampionship: ParsedEventDef = parseEventDef(
  event(
    "world-corporate",
    "World Corporate Championship",
    [],
    container(
      "world-corporate",
      "World Corporate Championship",
      container(
        "pools",
        undefined,
        ...CORPORATE_POOLS.map((id) =>
          competition(
            id,
            undefined,
            open,
            swiss(7, matchOf(4, rapid(600, 5)), matchPoints, {
              bye: byePoints(1, 2),
              tiebreaks: [{ metric: "gamesWon" }],
            }),
          ),
        ),
      ),
      competition(
        "knockout",
        undefined,
        CORPORATE_POOLS.flatMap((pool) => top(pool, 8)),
        cutKnockout(twoMatchTie(4, rapid(600, 5))),
      ),
      competition(
        "finals",
        undefined,
        top("knockout", 8),
        knockout(matchOf(4, rapid(1500, 10), { tie: manualTie }), {
          thirdPlace: true,
          bye: byeAdvance,
        }),
      ),
    ),
  ),
);

// ---------------------------------------------------------------------------
// Sectioned events: parallel divisions, contemporaneous, separately scored

/**
 * GRENKE: an elite double round robin and a huge open swiss — completely
 * different formats — under one roof, at the same time. Exported as a
 * COMPETITION too: the whole thing drops into the Grand Chess Tour below as
 * a tour stop, by reference.
 */
export const grenkeCompetition: CompetitionData = container(
  "grenke",
  "GRENKE Karlsruhe",
  competition(
    "classic",
    "GRENKE Classic",
    seeds(6),
    roundRobin(2, classical, gamePoints, {
      tiebreaks: [{ metric: "sonnebornBerger" }],
    }),
  ),
  competition(
    "open",
    "GRENKE Open",
    open,
    swiss(9, classical, gamePoints, {
      bye: byePoints(0.5, 0.5),
      tiebreaks: [{ metric: "buchholz" }, { metric: "sonnebornBerger" }],
    }),
  ),
);

export const grenke: ParsedEventDef = parseEventDef(
  event(
    "grenke",
    "GRENKE Chess Classic & Open",
    players(
      "Carlsen",
      "Caruana",
      "Vachier-Lagrave",
      "Keymer",
      "Ding",
      "Rapport",
    ),
    grenkeCompetition,
  ),
);

/** A LoneWolf-style swiss section (registration decides who enters which). */
const loneWolfSection = swiss(11, rapid(2700, 45), gamePoints, {
  bye: byePoints(1, 1),
  tiebreaks: [
    { metric: "sonnebornBerger" },
    { metric: "buchholz" },
    { metric: "headToHead" },
  ],
});

/**
 * Sections: one event, two divisions running contemporaneously — separate
 * registration, separate standings. The rating cap is registration policy
 * (host-side), not structure.
 */
export const loneWolfSections: ParsedEventDef = parseEventDef(
  event(
    "lonewolf-sections",
    "LoneWolf — Open & U1800",
    [],
    container(
      "season",
      "Season",
      competition("open", "Open", open, loneWolfSection),
      competition("u1800", "U1800", open, loneWolfSection),
    ),
  ),
);

const candidatesPool = roundRobin(2, classical, gamePoints, {
  tiebreaks: [
    { metric: "headToHead" },
    { metric: "gamesWon" },
    { metric: "sonnebornBerger" },
  ],
});

/** Both Candidates tournaments share the venue and the schedule. */
export const candidatesBoth: ParsedEventDef = parseEventDef(
  event(
    "candidates-both",
    "FIDE Candidates — open & women",
    players(
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
    container(
      "candidates",
      "Candidates Toronto",
      competition("open", "Candidates", seeds(8), candidatesPool),
      competition(
        "women",
        "Women's Candidates",
        seedsFrom(9, 8),
        candidatesPool,
      ),
    ),
  ),
);

/**
 * Tata Steel Wijk aan Zee: Masters and Challengers round robins beside an
 * open amateur swiss, all contemporaneous. (Each field miniaturized to 6;
 * the Challengers→Masters promotion crosses editions, outside one event.)
 */
export const tataSteel: ParsedEventDef = parseEventDef(
  event(
    "tata-steel",
    "Tata Steel Wijk aan Zee",
    players(
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
    container(
      "wijk",
      "Wijk aan Zee",
      competition(
        "masters",
        "Masters",
        seeds(6),
        roundRobin(1, classical, gamePoints, {
          tiebreaks: [{ metric: "sonnebornBerger" }],
        }),
      ),
      competition(
        "challengers",
        "Challengers",
        seedsFrom(7, 6),
        roundRobin(1, classical, gamePoints, {
          tiebreaks: [{ metric: "sonnebornBerger" }],
        }),
      ),
      competition(
        "amateurs",
        "Amateurs",
        open,
        swiss(9, rapid(2700, 30), gamePoints, {
          bye: byePoints(0.5, 0.5),
          tiebreaks: [{ metric: "buchholz" }],
        }),
      ),
    ),
  ),
);

// ---------------------------------------------------------------------------
// The Grand Chess Tour: whole tournaments rolled up into tour standings

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
const gctClassical = roundRobin(
  1,
  game({ initial: 7200, increment: 30 }, { name: "Classical" }),
  gamePoints,
  { tiebreaks: [{ metric: "sonnebornBerger" }, { metric: "headToHead" }] },
);

/**
 * A Rapid & Blitz stop: one rapid round robin (rounds 1–9, scored 2/1/0)
 * straight into a double blitz round robin (rounds 10–27, scored 1/½/0) —
 * one combined standings via phased scoring. (The per-phase clock change is
 * host scheduling; the model varies the points.)
 */
const gctRapidBlitz = roundRobin(
  3,
  game({ initial: 1500, increment: 10 }, { name: "Rapid / Blitz" }),
  phased(
    { rounds: 9, win: 2, draw: 1, loss: 0 },
    { rounds: 18, win: 1, draw: 0.5, loss: 0 },
  ),
  { tiebreaks: [{ metric: "sonnebornBerger" }] },
);

/**
 * A finals match: two classical games worth 6/3, two rapid worth 4/2, two
 * blitz worth 2/1, and armageddon if the weighted points are still level —
 * the weighting is just per-game point schedules summing up the series.
 */
const gctFinalsMatch = seriesOf(
  [
    ...Array.from({ length: 2 }, () =>
      game(
        { initial: 5400, increment: 30 },
        { name: "Classical", points: { win: 6, draw: 3, loss: 0 } },
      ),
    ),
    ...Array.from({ length: 2 }, () =>
      game(
        { initial: 1500, increment: 10 },
        { name: "Rapid", points: { win: 4, draw: 2, loss: 0 } },
      ),
    ),
    ...Array.from({ length: 2 }, () =>
      game(
        { initial: 300, increment: 3 },
        { name: "Blitz", points: { win: 2, draw: 1, loss: 0 } },
      ),
    ),
    armageddon,
  ],
  { stop: { untilDecided: true }, name: "Finals match", legName: "game" },
);

/** The competitions whose placements pay tour points — GRENKE's elite RR included. */
const GCT_SOURCES = [...GCT_EVENTS.map((e) => e.id), "classic"];

/**
 * The Grand Chess Tour: whole tournaments — two classical round robins,
 * three Rapid & Blitz events, and the entire GRENKE event dropped in BY
 * REFERENCE as a sixth stop — whose placements convert to tour points
 * (13/10/8/…); the top four on tour points meet in the São Paulo finals
 * over weighted classical/rapid/blitz matches with a bronze final. Every
 * word on the cards comes from the definition: competition names, "match"
 * for the finals pairings, "game" for the legs.
 */
export const grandChessTour: ParsedEventDef = parseEventDef(
  event(
    "grand-chess-tour",
    "Grand Chess Tour",
    players(
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
    container(
      "tour",
      "Grand Chess Tour",
      ...GCT_EVENTS.map((e) =>
        competition(
          e.id,
          e.name,
          seeds(10),
          e.kind === "classical" ? gctClassical : gctRapidBlitz,
        ),
      ),
      grenkeCompetition,
      competition(
        "finals",
        "GCT Finals São Paulo",
        tourTop(GCT_SOURCES, GCT_POINTS, 4),
        knockout(gctFinalsMatch, {
          thirdPlace: true,
          bye: byeAdvance,
          terms: { pairing: "match" },
        }),
      ),
    ),
  ),
);

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
      "Whole tournaments — GRENKE dropped in unchanged — feed tour points; the top four meet in weighted-match finals.",
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
