import type { EventCardDTO } from "@litour/api-client";

import { EventCard } from "./EventCard";

interface Props {
  cards: EventCardDTO[];
}

export function EventGrid({ cards }: Props) {
  // The first active card (if any) gets the featured hairline; everything
  // else is standard. This is the only place lichess-blue shows up as
  // chrome on the home page (per DESIGN.md decision 2026-05-03).
  const featuredSlug = cards.find((c) => c.status_group === "active")?.slug;

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((card) => (
        <EventCard
          key={card.slug}
          card={card}
          featured={card.slug === featuredSlug}
        />
      ))}
    </div>
  );
}
