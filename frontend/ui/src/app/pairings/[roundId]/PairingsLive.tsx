"use client";

import { type WSMessage, connectPairingStream, type components } from "@litour/api-client";
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

type RoundPairings = components["schemas"]["RoundPairingsDTO"];
type Pairing = components["schemas"]["PairingDTO"];

type ConnectionState = "connecting" | "live" | "reconnecting";

interface Props {
  initial: RoundPairings;
  apiBaseUrl: string;
}

export function PairingsLive({ initial, apiBaseUrl }: Props) {
  const [pairings, setPairings] = useState<Pairing[]>(initial.pairings);
  const [connection, setConnection] = useState<ConnectionState>("connecting");

  useEffect(() => {
    let didError = false;
    const stream = connectPairingStream(
      apiBaseUrl,
      initial.round_id,
      (msg: WSMessage) => {
        didError = false;
        setConnection("live");
        if (msg.type === "ping") return;
        setPairings((prev) => patchPairing(prev, msg));
      },
      (err: unknown) => {
        didError = true;
        setConnection("reconnecting");
        console.error("pairing stream error", err);
      },
    );
    // partysocket fires open implicitly by sending the first message; until
    // then we leave the badge in "connecting" so the UI doesn't claim live
    // when it isn't.
    const ready = window.setTimeout(() => {
      if (!didError) setConnection("live");
    }, 1500);
    return () => {
      window.clearTimeout(ready);
      stream.close();
    };
  }, [apiBaseUrl, initial.round_id]);

  const sorted = useMemo(() => sortPairings(pairings), [pairings]);

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {initial.season_name} — Round {initial.round_number}
          </h1>
          <p className="text-muted-foreground text-sm">
            League: <span className="font-mono">{initial.league_tag}</span>
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
          {sorted.map((p) => (
            <PairingRow key={p.id} pairing={p} />
          ))}
        </TableBody>
      </Table>
    </main>
  );
}

function PairingRow({ pairing }: { pairing: Pairing }) {
  return (
    <TableRow>
      <TableCell className="text-muted-foreground font-mono">
        {pairing.board_number ?? "—"}
      </TableCell>
      <TableCell className="font-medium">{pairing.white_username ?? "—"}</TableCell>
      <TableCell className="text-muted-foreground text-right font-mono">
        {pairing.white_rating ?? ""}
      </TableCell>
      <TableCell className="text-center font-mono">{formatResult(pairing.result)}</TableCell>
      <TableCell className="font-medium">{pairing.black_username ?? "—"}</TableCell>
      <TableCell className="text-muted-foreground text-right font-mono">
        {pairing.black_rating ?? ""}
      </TableCell>
      <TableCell className="text-center">
        {pairing.game_link ? (
          <a
            href={pairing.game_link}
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

function patchPairing(prev: Pairing[], msg: WSMessage): Pairing[] {
  if (msg.type === "ping") return prev;
  let changed = false;
  const next = prev.map((p) => {
    if (p.id !== msg.pairing_id) return p;
    changed = true;
    if (msg.type === "pairing.result") {
      return {
        ...p,
        result: msg.result,
        white_username: msg.white_username,
        black_username: msg.black_username,
      };
    }
    return {
      ...p,
      game_link: msg.game_link,
      white_username: msg.white_username,
      black_username: msg.black_username,
    };
  });
  return changed ? next : prev;
}

function sortPairings(pairings: Pairing[]): Pairing[] {
  return [...pairings].sort((a, b) => {
    const aTeam = a.team_pairing_id ?? Number.POSITIVE_INFINITY;
    const bTeam = b.team_pairing_id ?? Number.POSITIVE_INFINITY;
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
