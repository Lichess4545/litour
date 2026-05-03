import type { components } from "@litour/api-client";
import { Check } from "lucide-react";
import Link from "next/link";

type EventRound = components["schemas"]["EventRoundDTO"];

interface Props {
  rounds: EventRound[];
  currentRoundNumber: number;
  leagueTag: string;
  eventTag: string;
}

// Horizontal round navigator for round-scoped Event pages.
//   - completed (past): linked, muted background, with a check
//   - current: bold border, no link (you're already on it)
//   - unpublished (future): faded, not interactive
// Pills wrap on narrow viewports rather than scrolling, so the whole season
// stays visible at a glance even on phones.
export function RoundsNav({
  rounds,
  currentRoundNumber,
  leagueTag,
  eventTag,
}: Props) {
  return (
    <nav aria-label="Rounds" className="flex flex-wrap items-center gap-1.5">
      <span className="text-muted-foreground mr-1 text-xs uppercase tracking-wide">
        Rounds
      </span>
      {rounds.map((r) => (
        <RoundPill
          key={r.round_number}
          round={r}
          isCurrent={r.round_number === currentRoundNumber}
          leagueTag={leagueTag}
          eventTag={eventTag}
        />
      ))}
    </nav>
  );
}

function RoundPill({
  round,
  isCurrent,
  leagueTag,
  eventTag,
}: {
  round: EventRound;
  isCurrent: boolean;
  leagueTag: string;
  eventTag: string;
}) {
  const base =
    "inline-flex h-7 min-w-7 items-center justify-center gap-1 rounded-full border px-2 font-mono text-xs tabular-nums select-none";
  const number = round.round_number;
  const completed = round.is_completed;

  if (isCurrent) {
    return (
      <span
        aria-current="page"
        className={`${base} border-primary bg-primary/10 text-foreground border-2 font-bold`}
      >
        {number}
        {completed ? <Check className="size-3" aria-hidden /> : null}
      </span>
    );
  }

  if (!round.is_published) {
    return (
      <span
        aria-disabled
        title="Pairings not yet published"
        className={`${base} text-muted-foreground/50 border-border/40`}
      >
        {number}
      </span>
    );
  }

  return (
    <Link
      href={`/${leagueTag}/${eventTag}/round/${number}/matches`}
      aria-label={`Round ${number}${completed ? " (completed)" : ""}`}
      className={`${base} border-border bg-muted/40 hover:bg-muted hover:text-foreground text-muted-foreground transition-colors`}
    >
      {number}
      {completed ? <Check className="size-3" aria-hidden /> : null}
    </Link>
  );
}
