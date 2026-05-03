import type { components } from "@litour/api-client";

import { formatTeamScore, resultBg } from "@/lib/scores";

import { BoardRow } from "./BoardRow";

type Match = components["schemas"]["MatchDTO"];
type TeamMatch = components["schemas"]["TeamMatchDTO"];
type EventSettings = components["schemas"]["EventSettingsDTO"];

interface Props {
  teamMatch: TeamMatch;
  boards: Match[];
  eventSettings: EventSettings;
}

// Single CSS grid for the whole card — header and board rows share columns
// via subgrid, so score cells line up exactly. Symmetric 4-column layout
// (no dedicated board# column); the board number is rendered as a small
// corner label inside `BoardRow`.
const GRID =
  "grid-cols-[minmax(0,1fr)_2.5rem_2.5rem_minmax(0,1fr)] sm:grid-cols-[minmax(0,1fr)_3rem_3rem_minmax(0,1fr)]";

export function TeamMatchCard({ teamMatch, boards, eventSettings }: Props) {
  if (teamMatch.is_bye) {
    return (
      <div className="border-border overflow-hidden rounded-md border">
        <div className="bg-muted/40 flex items-center justify-between gap-4 px-3 py-2.5 sm:px-4 sm:py-3">
          <span className="font-medium">{teamMatch.white_team_name}</span>
          <span className="text-muted-foreground italic">Pairing allocated bye</span>
        </div>
      </div>
    );
  }

  return (
    <div className="border-border overflow-hidden rounded-md border">
      <div className={`divide-border grid ${GRID} divide-y`}>
        <TeamMatchHeader teamMatch={teamMatch} />
        {boards.map((m) => (
          <BoardRow
            key={m.id}
            match={m}
            teamMode
            eventSettings={eventSettings}
          />
        ))}
      </div>
    </div>
  );
}

function TeamMatchHeader({ teamMatch }: { teamMatch: TeamMatch }) {
  const { white_team_name, white_score, black_team_name, black_score } = teamMatch;
  return (
    <div className="bg-muted/40 col-span-full grid grid-cols-subgrid font-semibold">
      <div className="flex items-center px-2 py-2.5 [overflow-wrap:anywhere] sm:px-3 sm:py-3">
        {white_team_name}
      </div>
      <div
        className={`flex items-center justify-center font-mono text-base tabular-nums ${resultBg(white_score, black_score)}`}
      >
        {formatTeamScore(white_score)}
      </div>
      <div
        className={`flex items-center justify-center font-mono text-base tabular-nums ${resultBg(black_score, white_score)}`}
      >
        {formatTeamScore(black_score)}
      </div>
      <div className="flex items-center justify-end px-2 py-2.5 text-right [overflow-wrap:anywhere] sm:px-3 sm:py-3">
        {black_team_name}
      </div>
    </div>
  );
}
