"use client";

import {
  type EventCardsPageDTO,
  type WSHomeMessage,
  wsHomeMessage,
} from "@litour/api-client";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";

import { EmptyState, EventGrid, OrganizerFilter } from "@/components/discovery";
import {
  selectCards,
  useDiscoveryStore,
} from "@/components/discovery/discoveryStore";
import { ConnectionBadge, type ConnectionState } from "@/components/primitives";
import { useChannel } from "@/lib/multiplex";
import palamedesMark from "../../public/palamedes-mark.png";

interface Props {
  initial: EventCardsPageDTO;
  apiBaseUrl: string;
}

export function HomeLive({ initial }: Props) {
  const setCards = useDiscoveryStore((s) => s.setCards);
  const upsertCard = useDiscoveryStore((s) => s.upsertCard);
  const removeCard = useDiscoveryStore((s) => s.removeCard);

  // Seed the cards slice from SSR. Subsequent updates flow via WS
  // events into the same store slice, so HomeLive and any future
  // surface that wants the live event grid (admin home, dashboards)
  // read off the same data.
  useEffect(() => {
    setCards(initial.events);
  }, [initial.events, setCards]);

  const cards = useDiscoveryStore(selectCards);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [organizerFilter, setOrganizerFilter] = useState<Set<string>>(new Set());

  useChannel("events:home", {
    schema: wsHomeMessage,
    onMessage: (msg: WSHomeMessage) => {
      if (msg.type === "event.update") {
        upsertCard(msg.card);
      } else if (msg.type === "event.removed") {
        removeCard(msg.slug, msg.reason);
      }
    },
    onStatus: (status) => {
      setConnection(status === "subscribed" ? "live" : "reconnecting");
    },
  });

  const organizers = useMemo(() => uniqueOrganizers(cards), [cards]);
  const visible = useMemo(
    () =>
      organizerFilter.size === 0
        ? cards
        : cards.filter((c) => organizerFilter.has(c.organizer_tag)),
    [cards, organizerFilter],
  );

  return (
    <main className="mx-auto max-w-7xl px-6 py-12 lg:px-8">
      <header className="mb-8 flex items-end justify-between gap-6">
        <div>
          <div className="flex items-center gap-2">
            <Image
              src={palamedesMark}
              alt=""
              width={24}
              height={24}
              className="dark:invert"
              priority
            />
            <p className="font-display text-muted-foreground text-base italic">Palamedes</p>
          </div>
          <h1 className="font-display mt-1 text-4xl tracking-tight md:text-5xl">What's playing</h1>
        </div>
        <ConnectionBadge state={connection} />
      </header>

      <div className="mb-8">
        <OrganizerFilter
          organizers={organizers}
          selected={organizerFilter}
          onToggle={(tag) => {
            setOrganizerFilter((prev) => {
              const next = new Set(prev);
              if (next.has(tag)) {
                next.delete(tag);
              } else {
                next.add(tag);
              }
              return next;
            });
          }}
        />
      </div>

      {visible.length === 0 ? (
        <EmptyState
          variant={cards.length === 0 ? "cold" : "filter"}
          onClear={() => setOrganizerFilter(new Set())}
        />
      ) : (
        <EventGrid cards={visible} />
      )}
    </main>
  );
}

function uniqueOrganizers(
  cards: { organizer_tag: string; organizer_label: string }[],
): { tag: string; label: string }[] {
  const seen = new Map<string, string>();
  for (const c of cards) {
    if (!seen.has(c.organizer_tag)) {
      seen.set(c.organizer_tag, c.organizer_label);
    }
  }
  return Array.from(seen, ([tag, label]) => ({ tag, label })).sort((a, b) =>
    a.label.localeCompare(b.label),
  );
}
