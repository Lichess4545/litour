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
export function CockpitRoundSelector({ rounds, currentRoundId, eventSlug }: Props) {
  const [expanded, setExpanded] = useState(false);
  const sorted = [...rounds].sort((a, b) => b.round_number - a.round_number);
  const recent = sorted.slice(0, 3);
  const rest = sorted.slice(3);

  return (
    <div className="border-border inline-flex flex-col items-end border-b pb-1">
      <details
        className="text-sm"
        onToggle={(e) => setExpanded((e.target as HTMLDetailsElement).open)}
      >
        <summary className="cursor-pointer list-none select-none tabular-nums">
          Round {sorted.find((r) => r.round_id === currentRoundId)?.round_number ?? "?"}
          <span className="text-muted-foreground ml-1 text-xs">{expanded ? "▴" : "▾"}</span>
        </summary>
        <ul className="bg-card border-border mt-2 w-48 rounded-md border p-1 text-right text-sm">
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
      <span className="text-foreground block px-2 py-1 font-medium tabular-nums">
        Round {round.round_number} <span className="text-muted-foreground text-xs">(current)</span>
      </span>
    );
  }
  return (
    <Link
      href={`/events/${encodeURIComponent(eventSlug)}/manage/?round=${round.round_id}`}
      className="text-muted-foreground hover:text-foreground block px-2 py-1 tabular-nums"
    >
      Round {round.round_number}
      {round.is_completed ? <span className="ml-1 text-xs">· Finished</span> : null}
    </Link>
  );
}
