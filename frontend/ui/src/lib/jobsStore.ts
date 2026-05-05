"use client";

import {
  type BackgroundJobDTO,
  type WSJobEvent,
  backgroundJobDto,
  listJobsForSeason,
  wsJobEvent,
} from "@litour/api-client";
import { useEffect } from "react";
import { create } from "zustand";

import { useChannel } from "@/lib/multiplex";

// Zustand store for season-scoped background jobs.
//
// Single source of truth for every consumer in a page (badge, panel,
// any future surface). The previous per-component ``useState`` arrays
// would diverge whenever one consumer fetched fresh while another
// missed a WS envelope; this store collapses them into one map keyed
// by season slug.

interface JobsState {
  bySlug: Record<string, BackgroundJobDTO[]>;
  // Tracks whether the HTTP snapshot has landed for a slug. Used by
  // ``useJobsSync`` to avoid an extra fetch when a sibling already
  // primed the slug — important because both JobsButton and any
  // future "jobs for this league" surface mount on the same page.
  hydrated: Record<string, true>;

  setSnapshot: (slug: string, jobs: BackgroundJobDTO[]) => void;
  applyEvent: (slug: string, event: WSJobEvent) => void;
  clear: (slug: string) => void;
}

export const useJobsStore = create<JobsState>((set) => ({
  bySlug: {},
  hydrated: {},

  setSnapshot: (slug, jobs) =>
    set((state) => ({
      bySlug: { ...state.bySlug, [slug]: jobs },
      hydrated: { ...state.hydrated, [slug]: true },
    })),

  applyEvent: (slug, event) =>
    set((state) => {
      const prev = state.bySlug[slug] ?? [];
      const idx = prev.findIndex((j) => j.id === event.job.id);
      const next =
        idx === -1
          ? [event.job, ...prev]
          : prev.map((j, i) => (i === idx ? event.job : j));
      return { bySlug: { ...state.bySlug, [slug]: next } };
    }),

  clear: (slug) =>
    set((state) => {
      const { [slug]: _dropped, ...bySlug } = state.bySlug;
      const { [slug]: _dropped2, ...hydrated } = state.hydrated;
      return { bySlug, hydrated };
    }),
}));

// Stable empty-array reference so consumers selecting a slug that
// hasn't been hydrated don't re-render every store update on the
// fresh ``[]`` allocation that ``?? []`` would otherwise produce.
const EMPTY: BackgroundJobDTO[] = Object.freeze([]) as BackgroundJobDTO[];

// Read selectors — call from any component that needs the data.
export const selectJobsForSlug =
  (slug: string) =>
  (s: JobsState): BackgroundJobDTO[] =>
    s.bySlug[slug] ?? EMPTY;

// Sync hook — call exactly once per page for a given slug (typically
// in the page-level Live component). Owns the HTTP snapshot fetch and
// the WS subscription; pushes both into the store. Multiple calls for
// the same slug are safe — the multiplex client ref-counts the
// underlying WS subscribe — but redundant.
export function useJobsSync(apiBaseUrl: string, slug: string): void {
  const setSnapshot = useJobsStore((s) => s.setSnapshot);
  const applyEvent = useJobsStore((s) => s.applyEvent);

  useEffect(() => {
    let cancelled = false;
    const fetchSnapshot = async () => {
      const raw = await listJobsForSeason(apiBaseUrl, slug, { limit: 50 });
      if (cancelled) return;
      const parsed = (raw as unknown[])
        .map((r) => {
          try {
            return backgroundJobDto.parse(r);
          } catch {
            return null;
          }
        })
        .filter((j): j is BackgroundJobDTO => j !== null);
      setSnapshot(slug, parsed);
    };
    void fetchSnapshot();
    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl, slug, setSnapshot]);

  useChannel(`jobs:season:${slug}`, {
    schema: wsJobEvent,
    onMessage: (msg) => applyEvent(slug, msg),
    // Re-snapshot on every (re)subscribe — Redis pub/sub doesn't
    // replay missed envelopes, so without this the badge could stick
    // on a phantom running job whose completion fired during a blip.
    onStatus: (status) => {
      if (status !== "subscribed") return;
      void listJobsForSeason(apiBaseUrl, slug, { limit: 50 }).then((raw) => {
        const parsed = (raw as unknown[])
          .map((r) => {
            try {
              return backgroundJobDto.parse(r);
            } catch {
              return null;
            }
          })
          .filter((j): j is BackgroundJobDTO => j !== null);
        setSnapshot(slug, parsed);
      });
    },
  });
}
