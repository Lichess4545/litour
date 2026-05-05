"use client";

import Link from "next/link";
import { useState } from "react";

import type { components } from "@litour/api-client";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type RoundSummary = components["schemas"]["EventRoundDTO"];

interface Props {
  rounds: RoundSummary[];
  currentRoundId: number;
  currentRoundNumber: number;
  eventSlug: string;
}

// DR11: current round bold + last 3 dimmed + "Show all rounds" disclosure.
// Trigger styled as an outline button so it lines up with the sibling
// JobsButton in the cockpit header instead of clashing visually.
export function CockpitRoundSelector({
  rounds,
  currentRoundId,
  currentRoundNumber,
  eventSlug,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const sorted = [...rounds].sort((a, b) => b.round_number - a.round_number);
  const recent = sorted.slice(0, 3);
  const rest = sorted.slice(3);

  return (
    <details
      className="relative"
      onToggle={(e) => setExpanded((e.target as HTMLDetailsElement).open)}
    >
      <summary
        className={cn(
          buttonVariants({ variant: "outline", size: "sm" }),
          "h-11 cursor-pointer select-none justify-between gap-3 sm:h-8 sm:gap-2",
          "list-none [&::-webkit-details-marker]:hidden",
        )}
      >
        <span className="tabular-nums font-medium">Round {currentRoundNumber}</span>
        <span className="text-muted-foreground text-xs" aria-hidden>
          {expanded ? "▴" : "▾"}
        </span>
      </summary>
      <ul className="bg-card border-border absolute right-0 z-10 mt-2 w-full min-w-48 max-w-xs rounded-md border p-1 text-sm sm:w-48">
        {recent.map((r) => (
          <li key={r.round_id}>
            <RoundLink round={r} eventSlug={eventSlug} isCurrent={r.round_id === currentRoundId} />
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
      href={`/events/${encodeURIComponent(eventSlug)}/manage?round=${round.round_id}`}
      className="text-muted-foreground hover:text-foreground hover:bg-accent block px-3 py-2 tabular-nums rounded-sm"
    >
      Round {round.round_number}
      {round.is_completed ? <span className="ml-1 text-xs">· Finished</span> : null}
    </Link>
  );
}
