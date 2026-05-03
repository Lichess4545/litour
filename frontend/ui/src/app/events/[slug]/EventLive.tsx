"use client";

import {
  type EventDetailDTO,
  type WSEventMessage,
  type components,
  connectDiscoveryEventStream,
} from "@litour/api-client";
import Link from "next/link";
import { useEffect, useState } from "react";

import { MatchesLive } from "@/app/[leagueTag]/[eventTag]/round/[roundNumber]/matches/MatchesLive";
import { EventTabs, StatusPill } from "@/components/discovery";
import { ConnectionBadge, type ConnectionState } from "@/components/primitives";

type RoundMatches = components["schemas"]["RoundMatchesDTO"];

interface Props {
  initial: EventDetailDTO;
  apiBaseUrl: string;
}

export function EventLive({ initial, apiBaseUrl }: Props) {
  const [detail, setDetail] = useState<EventDetailDTO>(initial);
  const [removed, setRemoved] = useState<string | null>(null);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const slug = initial.header.slug;

  useEffect(() => {
    let didError = false;
    const stream = connectDiscoveryEventStream(
      apiBaseUrl,
      slug,
      (msg: WSEventMessage) => {
        didError = false;
        setConnection("live");
        if (msg.type === "event.update") {
          setDetail(msg.detail);
        } else if (msg.type === "event.removed") {
          setRemoved(msg.reason);
        }
      },
      (err: unknown) => {
        didError = true;
        setConnection("reconnecting");
        console.error("discovery event stream error", err);
      },
    );
    const ready = window.setTimeout(() => {
      if (!didError) setConnection("live");
    }, 1500);
    return () => {
      window.clearTimeout(ready);
      stream.close();
    };
  }, [apiBaseUrl, slug]);

  if (removed) {
    return (
      <main className="mx-auto max-w-4xl px-6 py-16 text-center">
        <p className="font-display text-3xl">This event is no longer available</p>
        <p className="text-muted-foreground mt-2 text-sm">Reason: {removed}</p>
        <Link
          href="/"
          className="mt-6 inline-block text-sm font-medium underline-offset-4 hover:underline"
        >
          ← Back to events
        </Link>
      </main>
    );
  }

  const header = detail.header;
  const tabs = [
    {
      id: "pairings",
      label: "Pairings",
      available: detail.tabs_available.includes("pairings"),
    },
    { id: "standings", label: "Standings", available: false, comingSoon: true },
    { id: "roster", label: "Roster", available: false, comingSoon: true },
  ];

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <header className="mb-8 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <Link href="/" className="text-muted-foreground text-sm hover:text-foreground">
            ← All events
          </Link>
          <ConnectionBadge state={connection} />
        </div>
        <div className="space-y-2">
          <p className="text-muted-foreground text-xs uppercase tracking-wide">
            {header.organizer_label}
          </p>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <h1 className="font-display text-4xl tracking-tight md:text-5xl">{header.name}</h1>
            <StatusPill group={header.status_group} label={header.status_label} />
          </div>
          <dl className="text-muted-foreground space-y-0.5 text-sm">
            <div>{header.format_line}</div>
            {header.schedule_line ? <div>{header.schedule_line}</div> : null}
            {header.slot_status ? (
              <div className="text-foreground">{header.slot_status}</div>
            ) : null}
          </dl>
        </div>
        {header.registration_open && header.status_group === "upcoming" ? (
          <Link
            href={header.registration_url}
            className="bg-primary text-primary-foreground inline-block rounded-md px-4 py-2 text-sm font-medium hover:opacity-90"
          >
            Register
          </Link>
        ) : null}
      </header>

      <EventTabs tabs={tabs}>
        {(active) => {
          if (active === "pairings") {
            if (detail.pairings_error) {
              return (
                <p className="text-muted-foreground py-12 text-center text-sm">
                  Couldn&apos;t load pairings. The page will refresh when the connection comes back.
                </p>
              );
            }
            if (detail.pairings == null) {
              return (
                <p className="text-muted-foreground py-12 text-center text-sm">
                  Pairings will appear once the first round is published.
                </p>
              );
            }
            const pairings = detail.pairings as RoundMatches;
            return <MatchesLive initial={pairings} apiBaseUrl={apiBaseUrl} embedded />;
          }
          return <p className="text-muted-foreground py-12 text-center text-sm">Coming soon.</p>;
        }}
      </EventTabs>
    </main>
  );
}
