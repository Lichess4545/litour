import type { EventCardDTO } from "@litour/api-client";
import Link from "next/link";

import { StatusPill } from "./StatusPill";

interface Props {
  card: EventCardDTO;
  featured?: boolean;
}

export function EventCard({ card, featured = false }: Props) {
  const featuredBorder = featured
    ? "border-t-[var(--status-active)]"
    : "border-t-border";

  return (
    <article
      className={`bg-card text-card-foreground flex flex-col gap-4 rounded-lg border border-border ${featuredBorder} p-6 transition-colors hover:border-[color-mix(in_oklch,var(--status-active)_30%,var(--border))]`}
      data-slug={card.slug}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-muted-foreground text-xs uppercase tracking-wide">
            {card.organizer_label}
          </p>
          <h2 className="font-display text-2xl leading-tight">
            <Link
              href={`/events/${card.slug}`}
              className="hover:text-[var(--status-active)]"
            >
              {card.name}
            </Link>
          </h2>
        </div>
        <StatusPill group={card.status_group} label={card.status_label} />
      </header>

      <dl className="text-muted-foreground space-y-1 text-sm">
        <div>{card.format_line}</div>
        {card.schedule_line ? <div>{card.schedule_line}</div> : null}
        {card.slot_status ? (
          <div className="text-foreground">{card.slot_status}</div>
        ) : null}
      </dl>

      <footer className="mt-auto flex items-center justify-between gap-3 pt-2">
        <Link
          href={`/events/${card.slug}`}
          className="text-sm font-medium underline-offset-4 hover:underline"
        >
          View event →
        </Link>
        {card.status_group === "upcoming" ? (
          <Link
            href={card.registration_url}
            className="bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-sm font-medium hover:opacity-90"
          >
            Register
          </Link>
        ) : null}
      </footer>
    </article>
  );
}
