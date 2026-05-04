"use client";

import {
  type EventCardDTO,
  type EventCardsPageDTO,
  type WSHomeMessage,
  connectDiscoveryHomeStream,
} from "@litour/api-client";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";

import { EmptyState, EventGrid, OrganizerFilter } from "@/components/discovery";
import { ConnectionBadge, type ConnectionState } from "@/components/primitives";
import palamedesMark from "../../public/palamedes-mark.png";

interface Props {
  initial: EventCardsPageDTO;
  apiBaseUrl: string;
}

export function HomeLive({ initial, apiBaseUrl }: Props) {
  const [cards, setCards] = useState<EventCardDTO[]>(initial.events);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [organizerFilter, setOrganizerFilter] = useState<Set<string>>(new Set());

  useEffect(() => {
    let didError = false;
    const stream = connectDiscoveryHomeStream(
      apiBaseUrl,
      (msg: WSHomeMessage) => {
        didError = false;
        setConnection("live");
        if (msg.type === "event.update") {
          setCards((prev) => upsertBySlug(prev, msg.card));
        } else if (msg.type === "event.removed") {
          setCards((prev) => prev.filter((c) => c.slug !== msg.slug));
        }
      },
      (err: unknown) => {
        didError = true;
        setConnection("reconnecting");
        console.error("discovery home stream error", err);
      },
    );
    const ready = window.setTimeout(() => {
      if (!didError) setConnection("live");
    }, 1500);
    return () => {
      window.clearTimeout(ready);
      stream.close();
    };
  }, [apiBaseUrl]);

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

function upsertBySlug(prev: EventCardDTO[], next: EventCardDTO): EventCardDTO[] {
  let replaced = false;
  const out = prev.map((c) => {
    if (c.slug !== next.slug) return c;
    replaced = true;
    return next;
  });
  if (replaced) return out;
  return [...prev, next];
}

function uniqueOrganizers(cards: EventCardDTO[]): { tag: string; label: string }[] {
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
