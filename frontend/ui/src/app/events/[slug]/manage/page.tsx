import { cockpitDto, wsJobLag } from "@litour/api-client";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";

import { serverClient } from "@/lib/api";
import { publicApiBaseUrl } from "@/lib/api-public";

import { CockpitLive } from "./CockpitLive";

// Cockpit slugs follow the same shape as discovery slugs.
const slugSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[-a-zA-Z0-9_]+$/);

const roundIdSchema = z.coerce.number().int().positive().optional();

async function loadCockpit(rawSlug: string, rawRoundId: string | string[] | undefined) {
  const parsedSlug = slugSchema.safeParse(rawSlug);
  if (!parsedSlug.success) return { kind: "not_found" as const };

  const parsedRound = roundIdSchema.safeParse(
    Array.isArray(rawRoundId) ? rawRoundId[0] : rawRoundId,
  );
  const roundQuery = parsedRound.success && parsedRound.data ? { round_id: parsedRound.data } : {};

  const client = await serverClient();
  const { data, error, response } = await client.GET(
    "/v1/round_management/events/{event_slug}/cockpit",
    {
      params: {
        path: { event_slug: parsedSlug.data },
        query: roundQuery,
      },
    },
  );
  if (error || !data) {
    if (response?.status === 401 || response?.status === 403) {
      return { kind: "forbidden" as const };
    }
    return { kind: "not_found" as const };
  }

  // Hydrate the queue-lag canary on the server so the footer chip
  // renders with real numbers on first paint instead of "—" until the
  // first WS envelope arrives. Failure here is non-fatal — the chip
  // falls back to its waiting state.
  const lagRes = await client.GET("/v1/jobs/lag");
  const initialLag =
    lagRes.data != null
      ? (() => {
          const parsed = wsJobLag.safeParse({ type: "queue_lag", ...lagRes.data });
          return parsed.success ? parsed.data : null;
        })()
      : null;

  return { kind: "ok" as const, dto: cockpitDto.parse(data), initialLag };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const raw = await params;
  return {
    title: `Cockpit — ${raw.slug}`,
    robots: { index: false, follow: false },
  };
}

export default async function CockpitPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ round?: string }>;
}) {
  const raw = await params;
  const search = await searchParams;
  const result = await loadCockpit(raw.slug, search.round);

  if (result.kind === "forbidden") {
    redirect(`/events/${encodeURIComponent(raw.slug)}/`);
  }
  if (result.kind === "not_found") {
    notFound();
  }
  return (
    <CockpitLive
      initial={result.dto}
      initialLag={result.initialLag}
      apiBaseUrl={publicApiBaseUrl()}
      eventSlug={raw.slug}
    />
  );
}
