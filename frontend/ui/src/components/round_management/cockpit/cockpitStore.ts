"use client";

import type { CockpitDTO, CockpitMatchDTO } from "@litour/api-client";
import { create } from "zustand";

// Cockpit DTO store, keyed by ``${slug}:${roundId}``.
//
// One source of truth for the live cockpit data. Both ``cockpit.snapshot``
// (full DTO replace, e.g. round transitions) and ``cockpit.match.update``
// (per-pairing merge) flow through here so any surface — header, lists,
// drawer — reads off the same array.
//
// Domain-scoped (cockpit-specific) so it lives next to the components
// that consume it, not under ``lib/``.

interface CockpitState {
  byKey: Record<string, CockpitDTO>;

  setSnapshot: (slug: string, roundId: number, dto: CockpitDTO) => void;
  applyMatchUpdate: (
    slug: string,
    roundId: number,
    match: CockpitMatchDTO,
    needsYouCount: number,
    lastEventId: number,
  ) => void;
  clear: (slug: string, roundId: number) => void;
}

const keyFor = (slug: string, roundId: number): string => `${slug}:${roundId}`;

export const useCockpitStore = create<CockpitState>((set) => ({
  byKey: {},

  setSnapshot: (slug, roundId, dto) =>
    set((state) => ({
      byKey: { ...state.byKey, [keyFor(slug, roundId)]: dto },
    })),

  applyMatchUpdate: (slug, roundId, match, needsYouCount, lastEventId) =>
    set((state) => {
      const k = keyFor(slug, roundId);
      const prev = state.byKey[k];
      if (prev === undefined) return state;
      const idx = prev.matches.findIndex((m) => m.id === match.id);
      const matches =
        idx === -1
          ? [...prev.matches, match]
          : prev.matches.map((m, i) => (i === idx ? match : m));
      return {
        byKey: {
          ...state.byKey,
          [k]: {
            ...prev,
            matches,
            needs_you_count: needsYouCount,
            last_event_id: lastEventId,
          },
        },
      };
    }),

  clear: (slug, roundId) =>
    set((state) => {
      const { [keyFor(slug, roundId)]: _dropped, ...byKey } = state.byKey;
      return { byKey };
    }),
}));

export const selectCockpitDto =
  (slug: string, roundId: number) =>
  (s: CockpitState): CockpitDTO | undefined =>
    s.byKey[keyFor(slug, roundId)];
