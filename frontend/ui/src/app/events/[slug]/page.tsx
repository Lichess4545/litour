import { eventDetailDto } from "@litour/api-client";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";

import { serverClient } from "@/lib/api";
import { publicApiBaseUrl } from "@/lib/api-public";

import { EventLive } from "./EventLive";

// Discovery slugs are slugify(league.tag + season.tag + season.id), max 100.
const slugSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[-a-zA-Z0-9_]+$/);

async function loadDetail(rawSlug: string) {
  const parsed = slugSchema.safeParse(rawSlug);
  if (!parsed.success) return null;

  const client = await serverClient();
  const { data, error } = await client.GET("/v1/discovery/events/{slug}", {
    params: { path: { slug: parsed.data } },
  });
  if (error || !data) return null;
  return eventDetailDto.parse(data);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const raw = await params;
  const detail = await loadDetail(raw.slug);
  if (!detail) return { title: "Event not found" };

  // Per `discovery.permissions`: unlisted = URL-only, draft = staff-only.
  // Both must signal `noindex` so search engines don't treat them as
  // discoverable. (The home channel already filters them out client-side;
  // this is the SEO complement.)
  const noindex = detail.header.visibility === "unlisted" || detail.header.visibility === "draft";

  return {
    title: `${detail.header.name} — ${detail.header.organizer_label}`,
    robots: noindex ? { index: false, follow: false } : undefined,
  };
}

export default async function EventDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const raw = await params;
  const detail = await loadDetail(raw.slug);
  if (!detail) notFound();

  return <EventLive initial={detail} apiBaseUrl={publicApiBaseUrl()} />;
}
