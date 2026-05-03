"use client";

import { type WSMessage, connectMatchStream, type components } from "@litour/api-client";
import { ExternalLink } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type RoundMatches = components["schemas"]["RoundMatchesDTO"];
type Match = components["schemas"]["MatchDTO"];

type ConnectionState = "connecting" | "live" | "reconnecting";

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

  const sorted = useMemo(() => sortMatches(matches), [matches]);

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-6 flex items-center justify-between gap-4">
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
      </header>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-12">Bd</TableHead>
            <TableHead>White</TableHead>
            <TableHead className="w-20 text-right">Rating</TableHead>
            <TableHead className="w-28 text-center">Result</TableHead>
            <TableHead>Black</TableHead>
            <TableHead className="w-20 text-right">Rating</TableHead>
            <TableHead className="w-12 text-center">Game</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((m) => (
            <MatchRow key={m.id} match={m} />
          ))}
        </TableBody>
      </Table>
    </main>
  );
}

function MatchRow({ match }: { match: Match }) {
  return (
    <TableRow>
      <TableCell className="text-muted-foreground font-mono">
        {match.board_number ?? "—"}
      </TableCell>
      <TableCell className="font-medium">{match.white_username ?? "—"}</TableCell>
      <TableCell className="text-muted-foreground text-right font-mono">
        {match.white_rating ?? ""}
      </TableCell>
      <TableCell className="text-center font-mono">{formatResult(match.result)}</TableCell>
      <TableCell className="font-medium">{match.black_username ?? "—"}</TableCell>
      <TableCell className="text-muted-foreground text-right font-mono">
        {match.black_rating ?? ""}
      </TableCell>
      <TableCell className="text-center">
        {match.game_link ? (
          <a
            href={match.game_link}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open game on lichess"
            className="text-primary inline-flex items-center justify-center"
          >
            <ExternalLink className="size-4" />
          </a>
        ) : null}
      </TableCell>
    </TableRow>
  );
}

function ConnectionBadge({ state }: { state: ConnectionState }) {
  if (state === "live") {
    return <Badge variant="secondary">Live</Badge>;
  }
  if (state === "reconnecting") {
    return <Badge variant="destructive">Reconnecting…</Badge>;
  }
  return <Badge variant="outline">Connecting…</Badge>;
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

function sortMatches(matches: Match[]): Match[] {
  return [...matches].sort((a, b) => {
    const aTeam = a.team_match_id ?? Number.POSITIVE_INFINITY;
    const bTeam = b.team_match_id ?? Number.POSITIVE_INFINITY;
    if (aTeam !== bTeam) return aTeam - bTeam;
    const aBoard = a.board_number ?? Number.POSITIVE_INFINITY;
    const bBoard = b.board_number ?? Number.POSITIVE_INFINITY;
    if (aBoard !== bBoard) return aBoard - bBoard;
    return a.id - b.id;
  });
}

function formatResult(result: string): string {
  if (!result) return "—";
  return result.replace("1/2", "½");
}
