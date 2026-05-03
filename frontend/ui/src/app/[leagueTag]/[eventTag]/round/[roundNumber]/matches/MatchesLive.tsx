"use client";

import { type WSMessage, connectMatchStream, type components } from "@litour/api-client";
import { useEffect, useState } from "react";

import { RoundsNav } from "@/components/event";
import {
  ConnectionBadge,
  type ConnectionState,
  LoneMatchesView,
  TeamMatchesView,
} from "@/components/matches";

type RoundMatches = components["schemas"]["RoundMatchesDTO"];
type Match = components["schemas"]["MatchDTO"];

interface Props {
  initial: RoundMatches;
  apiBaseUrl: string;
}

export function MatchesLive({ initial, apiBaseUrl }: Props) {
  const [matches, setMatches] = useState<Match[]>(initial.matches);
  const [connection, setConnection] = useState<ConnectionState>("connecting");

  useEffect(() => {
    let didError = false;
    const stream = connectMatchStream(
      apiBaseUrl,
      initial.round_id,
      (msg: WSMessage) => {
        didError = false;
        setConnection("live");
        if (msg.type === "ping") return;
        setMatches((prev) => patchMatch(prev, msg));
      },
      (err: unknown) => {
        didError = true;
        setConnection("reconnecting");
        console.error("match stream error", err);
      },
    );
    const ready = window.setTimeout(() => {
      if (!didError) setConnection("live");
    }, 1500);
    return () => {
      window.clearTimeout(ready);
      stream.close();
    };
  }, [apiBaseUrl, initial.round_id]);

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
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
          <ConnectionBadge state={connection} />
        </div>
        <RoundsNav
          rounds={initial.rounds}
          currentRoundNumber={initial.round_number}
          leagueTag={initial.league_tag}
          eventTag={initial.event_tag}
        />
      </header>

      {initial.is_team ? (
        <TeamMatchesView
          teamMatches={initial.team_matches}
          matches={matches}
          eventSettings={initial.settings}
        />
      ) : (
        <LoneMatchesView matches={matches} eventSettings={initial.settings} />
      )}
    </main>
  );
}

function patchMatch(prev: Match[], msg: WSMessage): Match[] {
  if (msg.type === "ping") return prev;
  let changed = false;
  const next = prev.map((m) => {
    if (m.id !== msg.match_id) return m;
    changed = true;
    if (msg.type === "match.result") {
      return {
        ...m,
        result: msg.result,
        white_username: msg.white_username,
        black_username: msg.black_username,
      };
    }
    return {
      ...m,
      game_link: msg.game_link,
      white_username: msg.white_username,
      black_username: msg.black_username,
    };
  });
  return changed ? next : prev;
}
