import type { components } from "@litour/api-client";
import { useMemo } from "react";

import { TeamMatchCard } from "./TeamMatchCard";

type Match = components["schemas"]["MatchDTO"];
type TeamMatch = components["schemas"]["TeamMatchDTO"];
type EventSettings = components["schemas"]["EventSettingsDTO"];

interface Props {
  teamMatches: TeamMatch[];
  matches: Match[];
  eventSettings: EventSettings;
}

export function TeamMatchesView({ teamMatches, matches, eventSettings }: Props) {
  const matchesByTeam = useMemo(() => groupByTeamMatch(matches), [matches]);
  const sorted = useMemo(
    () => [...teamMatches].sort((a, b) => a.pairing_order - b.pairing_order),
    [teamMatches],
  );

  return (
    <div className="space-y-6">
      {sorted.map((tm) => (
        <TeamMatchCard
          key={tm.id}
          teamMatch={tm}
          boards={matchesByTeam.get(tm.id) ?? []}
          eventSettings={eventSettings}
        />
      ))}
    </div>
  );
}

function groupByTeamMatch(matches: Match[]): Map<number, Match[]> {
  const m = new Map<number, Match[]>();
  for (const match of matches) {
    if (match.team_match_id == null) continue;
    const list = m.get(match.team_match_id) ?? [];
    list.push(match);
    m.set(match.team_match_id, list);
  }
  for (const list of m.values()) {
    list.sort((a, b) => (a.board_number ?? 0) - (b.board_number ?? 0));
  }
  return m;
}
