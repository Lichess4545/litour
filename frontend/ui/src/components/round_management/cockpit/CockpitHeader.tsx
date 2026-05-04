import Link from "next/link";

import type { CockpitDTO } from "@litour/api-client";

import { CockpitPrimaryAction } from "./CockpitPrimaryAction";
import { CockpitRoundSelector } from "./CockpitRoundSelector";

// DR2: live → blue dot + "Now playing — Round N of M"; history → muted
// dot + "Round N of M · Finished"; pre_round + empty handled by ModeBanner.
// DR4: header status dot is one of the three lichess-blue chrome elements.
// DR5: copy bound to DESIGN.md status terminology tokens exactly.
export function CockpitHeader({
  dto,
  eventSlug,
  apiBaseUrl,
}: {
  dto: CockpitDTO;
  eventSlug: string;
  apiBaseUrl: string;
}) {
  const totalRounds = dto.rounds.length;
  // DR2: history mode hides the primary CTA — past rounds are read-only.
  const showPrimaryCta = dto.mode !== "history" && dto.management?.primary_action != null;

  return (
    <header className="flex flex-col gap-6">
      <div>
        <Link
          href={`/events/${encodeURIComponent(eventSlug)}/`}
          className="text-muted-foreground hover:text-foreground text-sm"
        >
          ← Back to event
        </Link>
      </div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="space-y-2">
          <p className="text-muted-foreground text-xs uppercase tracking-wide">
            Tournament Cockpit
          </p>
          <h1 className="font-display text-3xl tracking-tight sm:text-4xl md:text-5xl">
            {dto.event_name}
          </h1>
          <StatusLine dto={dto} totalRounds={totalRounds} />
        </div>
        {dto.rounds.length > 0 ? (
          <CockpitRoundSelector
            rounds={dto.rounds}
            currentRoundId={dto.round_id}
            eventSlug={eventSlug}
          />
        ) : null}
      </div>
      {showPrimaryCta && dto.management?.primary_action ? (
        <div className="flex flex-wrap items-center gap-3">
          <CockpitPrimaryAction
            action={dto.management.primary_action}
            dto={dto}
            apiBaseUrl={apiBaseUrl}
            eventSlug={eventSlug}
          />
        </div>
      ) : null}
      {dto.mode === "live" ? (
        <div
          aria-live="polite"
          aria-atomic="true"
          className="border-border flex items-center gap-3 border-b pb-3 text-sm"
        >
          <NeedsYouCount count={dto.needs_you_count} />
        </div>
      ) : null}
    </header>
  );
}

// DR2 mode-specific status lines + DR5 token bindings.
function StatusLine({ dto, totalRounds }: { dto: CockpitDTO; totalRounds: number }) {
  if (dto.mode === "live") {
    return (
      <p className="text-foreground flex items-center gap-2 text-sm">
        <span className="bg-status-active inline-block size-2 rounded-full" aria-hidden />
        <span>
          <span className="text-muted-foreground">Now playing — </span>
          <span className="tabular-nums">
            Round {dto.round_number} of {totalRounds}
          </span>
        </span>
      </p>
    );
  }
  if (dto.mode === "history") {
    return (
      <p className="text-muted-foreground flex items-center gap-2 text-sm">
        <span className="bg-muted-foreground inline-block size-2 rounded-full" aria-hidden />
        <span className="tabular-nums">
          Round {dto.round_number} of {totalRounds} · Finished
        </span>
      </p>
    );
  }
  // pre_round / empty don't render a round-specific status line in the
  // header; the ModeBanner handles those.
  return null;
}

// DR4: "Needs you N" count badge — blue background fill, white text. DR8:
// container is the parent's aria-live region so SR users hear changes
// without row reordering spamming them.
function NeedsYouCount({ count }: { count: number }) {
  if (count === 0) {
    return (
      <span className="text-muted-foreground italic">Caught up. Nothing needs you right now.</span>
    );
  }
  return (
    <span className="text-muted-foreground inline-flex items-center gap-2 uppercase tracking-wide text-xs">
      Needs you{" "}
      <span className="bg-status-active rounded-sm px-2 py-0.5 text-white tabular-nums text-xs font-medium">
        {count}
      </span>
    </span>
  );
}
