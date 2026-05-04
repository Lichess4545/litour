"use client";

import Link from "next/link";
import { useState } from "react";

import type { components } from "@litour/api-client";

type RoundSummary = components["schemas"]["EventRoundDTO"];

interface Props {
  rounds: RoundSummary[];
  currentRoundId: number;
  eventSlug: string;
}

// DR11: current round bold + last 3 dimmed + "Show all rounds" disclosure.
// DR4: the active round-selector hairline is one of the three lichess-blue
// chrome elements (live mode only — the parent header drops the accent in
// history mode).
// Mobile: full-width tap target, larger summary, panel anchored to right.
export function CockpitRoundSelector({ rounds, currentRoundId, eventSlug }: Props) {
  const [expanded, setExpanded] = useState(false);
  const sorted = [...rounds].sort((a, b) => b.round_number - a.round_number);
  const recent = sorted.slice(0, 3);
  const rest = sorted.slice(3);
  const currentRoundNumber = sorted.find((r) => r.round_id === currentRoundId)?.round_number ?? "?";

  return (
    <div className="border-border w-full sm:w-auto sm:inline-flex sm:flex-col sm:items-end sm:border-b sm:pb-1">
      <details
        className="relative w-full text-sm"
        onToggle={(e) => setExpanded((e.target as HTMLDetailsElement).open)}
      >
        <summary className="border-border bg-background flex h-11 w-full cursor-pointer list-none items-center justify-between gap-2 rounded-md border px-3 select-none sm:h-auto sm:border-0 sm:bg-transparent sm:px-0 sm:py-0 sm:hover:bg-transparent">
          <span className="tabular-nums font-medium">Round {currentRoundNumber}</span>
          <span className="text-muted-foreground text-xs">{expanded ? "▴" : "▾"}</span>
        </summary>
        <ul className="bg-card border-border absolute right-0 z-10 mt-2 w-full min-w-48 max-w-xs rounded-md border p-1 text-sm sm:right-0 sm:w-48 sm:text-right">
          {recent.map((r) => (
            <li key={r.round_id}>
              <RoundLink
                round={r}
                eventSlug={eventSlug}
                isCurrent={r.round_id === currentRoundId}
              />
            </li>
          ))}
          {rest.length > 0 && expanded
            ? rest.map((r) => (
                <li key={r.round_id}>
                  <RoundLink
                    round={r}
                    eventSlug={eventSlug}
                    isCurrent={r.round_id === currentRoundId}
                  />
                </li>
              ))
            : null}
        </ul>
      </details>
    </div>
  );
}

function RoundLink({
  round,
  eventSlug,
  isCurrent,
}: {
  round: RoundSummary;
  eventSlug: string;
  isCurrent: boolean;
}) {
  if (isCurrent) {
    return (
      <span className="text-foreground block px-3 py-2 font-medium tabular-nums">
        Round {round.round_number} <span className="text-muted-foreground text-xs">(current)</span>
      </span>
    );
  }
  return (
    <Link
      href={`/events/${encodeURIComponent(eventSlug)}/manage/?round=${round.round_id}`}
      className="text-muted-foreground hover:text-foreground hover:bg-accent block px-3 py-2 tabular-nums rounded-sm"
    >
      Round {round.round_number}
      {round.is_completed ? <span className="ml-1 text-xs">· Finished</span> : null}
    </Link>
  );
}
