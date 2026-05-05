"use client";

import { type WSMessage, type components, wsMessage } from "@litour/api-client";
import { useEffect, useState } from "react";

import { ConnectionBadge, type ConnectionState } from "@/components/primitives";
import {
  LoneMatchesView,
  MatchesSummary,
  RoundsNav,
  TeamMatchesView,
  ViewerBadge,
} from "@/components/round_management";
import {
  selectMatchesForRound,
  useMatchesStore,
} from "@/components/round_management/matchesStore";
import { ModeToggle } from "@/components/theme/ModeToggle";
import type { MatchFilter } from "@/lib/match-filter";
import { useChannel } from "@/lib/multiplex";

type RoundMatches = components["schemas"]["RoundMatchesDTO"];

interface Props {
  initial: RoundMatches;
  apiBaseUrl: string;
  // When true, render only the matches body (RoundsNav + summary + view) so
  // a host page like the discovery event detail can supply its own page
  // chrome (heading, ConnectionBadge, ModeToggle) without duplication.
  embedded?: boolean;
}

export function MatchesLive({ initial, embedded = false }: Props) {
  const setSnapshot = useMatchesStore((s) => s.setSnapshot);
  const applyMatchUpdate = useMatchesStore((s) => s.applyMatchUpdate);
  const applyTeamMatchUpdate = useMatchesStore((s) => s.applyTeamMatchUpdate);

  // Seed from SSR initial. ``initial`` re-keys when the operator
  // navigates between rounds (page.tsx changes its child key on
  // round_id), so this also covers re-hydration.
  useEffect(() => {
    setSnapshot(initial.round_id, initial.matches, initial.team_matches);
  }, [initial, setSnapshot]);

  const { matches, teamMatches } = useMatchesStore(selectMatchesForRound(initial.round_id));
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [filter, setFilter] = useState<MatchFilter>("all");

  useChannel(`matches:round:${initial.round_id}`, {
    schema: wsMessage,
    onMessage: (msg: WSMessage) => {
      if (msg.type === "match.update") {
        applyMatchUpdate(initial.round_id, msg.match);
      } else if (msg.type === "team_match.update") {
        applyTeamMatchUpdate(initial.round_id, msg.team_match);
      }
    },
    onStatus: (status) => {
      setConnection(status === "subscribed" ? "live" : "reconnecting");
    },
  });

  const body = (
    <>
      {!embedded ? (
        <header className="mb-6 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">
                {initial.event_name} — Round {initial.round_number}
              </h1>
              <p className="text-muted-foreground text-sm">
                <span className="font-mono">
                  {initial.league_tag}/{initial.event_tag}
                </span>
                {initial.is_completed ? " · completed" : " · in progress"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <ViewerBadge viewer={initial.viewer} />
              <ConnectionBadge state={connection} />
              <ModeToggle />
            </div>
          </div>
          <RoundsNav
            rounds={initial.rounds}
            currentRoundNumber={initial.round_number}
            leagueTag={initial.league_tag}
            eventTag={initial.event_tag}
          />
          <MatchesSummary matches={matches} filter={filter} onFilterChange={setFilter} />
        </header>
      ) : (
        <div className="mb-6 space-y-4">
          <RoundsNav
            rounds={initial.rounds}
            currentRoundNumber={initial.round_number}
            leagueTag={initial.league_tag}
            eventTag={initial.event_tag}
          />
          <MatchesSummary matches={matches} filter={filter} onFilterChange={setFilter} />
        </div>
      )}

      {initial.is_team ? (
        <TeamMatchesView
          teamMatches={teamMatches}
          matches={matches}
          eventSettings={initial.settings}
          filter={filter}
          viewer={initial.viewer}
          presenceEvents={initial.presence_events}
        />
      ) : (
        <LoneMatchesView
          matches={matches}
          eventSettings={initial.settings}
          filter={filter}
          viewer={initial.viewer}
          presenceEvents={initial.presence_events}
        />
      )}
    </>
  );

  if (embedded) return body;
  return <main className="mx-auto max-w-5xl px-6 py-10">{body}</main>;
}
