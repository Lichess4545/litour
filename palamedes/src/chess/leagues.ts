// NOTE: parameters follow live lichess4545.com, not the heltour fork's defaults.
// Canon and recorded deviations from live operation: design/adr/0005-lichess4545-seed-canon.md
import type { ParsedEventDef } from "@/tournament/registry";
import {
  byePoints,
  event,
  game,
  gamePoints,
  group,
  matchOf,
  matchPoints,
  play,
  swiss,
} from "./compose";
import { parseEventDef } from "./registry";

export const TEAM4545_STREAM_ID = "team4545";
export const LONEWOLF_STREAM_ID = "lonewolf";

const TEAM_BOARDS = 8;
const TEAM_ROUNDS = 8;
const LONEWOLF_ROUNDS = 11;

const classical4545 = game({ initial: 2700, increment: 45 });
const classical3030 = game({ initial: 1800, increment: 30 });

const teamSection = play(
  swiss(TEAM_ROUNDS, matchOf(TEAM_BOARDS, classical4545), matchPoints, {
    bye: byePoints(1, TEAM_BOARDS / 2),
    tiebreaks: [
      { metric: "encounterPoints" },
      { metric: "headToHead" },
      { metric: "gamesWon" },
      { metric: "sonnebornBerger" },
    ],
  }),
).open();

export const buildTeam4545League = (id: string): ParsedEventDef =>
  parseEventDef(
    event(
      id,
      "Lichess4545 Team League",
      [],
      teamSection.as("league", "Season"),
    ),
  );

const loneWolfSection = play(
  swiss(LONEWOLF_ROUNDS, classical3030, gamePoints, {
    bye: byePoints(1, 1),
    tiebreaks: [
      { metric: "modifiedMedian" },
      { metric: "buchholz" },
      { metric: "cumulative" },
      { metric: "cumulativeOpposition" },
    ],
  }),
).open();

export const buildLoneWolfLeague = (id: string): ParsedEventDef =>
  parseEventDef(
    event(
      id,
      "Lichess4545 LoneWolf",
      [],
      group(
        loneWolfSection.as("open", "Open"),
        // NOTE: U1800 eligibility is enforced at registration; the section structure is identical to Open.
        loneWolfSection.as("u1800", "U1800"),
      ).as("season", "Season"),
    ),
  );
