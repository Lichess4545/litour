"use client";

import type { EventCardDTO, EventDetailDTO } from "@litour/api-client";
import { create } from "zustand";

// Discovery store — home grid (``events:home``) + per-slug detail
// (``events:slug:{slug}``) flow through here. Two consumers in tree
// (HomeLive, EventLive) both render off the same slices.
//
// Lives under ``components/discovery/`` because the domain is
// discovery-specific; cross-domain stores (jobs, lag) live under
// ``lib/``.

interface DiscoveryState {
  cards: EventCardDTO[];
  detailBySlug: Record<string, EventDetailDTO>;
  removalReasonBySlug: Record<string, string>;

  setCards: (cards: EventCardDTO[]) => void;
  upsertCard: (card: EventCardDTO) => void;
  removeCard: (slug: string, reason: string) => void;

  setDetail: (slug: string, detail: EventDetailDTO) => void;
  markDetailRemoved: (slug: string, reason: string) => void;
  clearDetailRemoval: (slug: string) => void;
}

const EMPTY_CARDS: EventCardDTO[] = Object.freeze([]) as EventCardDTO[];

export const useDiscoveryStore = create<DiscoveryState>((set) => ({
  cards: EMPTY_CARDS,
  detailBySlug: {},
  removalReasonBySlug: {},

  setCards: (cards) => set({ cards }),

  upsertCard: (card) =>
    set((state) => {
      let replaced = false;
      const next = state.cards.map((c) => {
        if (c.slug !== card.slug) return c;
        replaced = true;
        return card;
      });
      return { cards: replaced ? next : [...state.cards, card] };
    }),

  removeCard: (slug, _reason) =>
    set((state) => ({ cards: state.cards.filter((c) => c.slug !== slug) })),

  setDetail: (slug, detail) =>
    set((state) => ({
      detailBySlug: { ...state.detailBySlug, [slug]: detail },
    })),

  markDetailRemoved: (slug, reason) =>
    set((state) => ({
      removalReasonBySlug: { ...state.removalReasonBySlug, [slug]: reason },
    })),

  clearDetailRemoval: (slug) =>
    set((state) => {
      const { [slug]: _dropped, ...removalReasonBySlug } = state.removalReasonBySlug;
      return { removalReasonBySlug };
    }),
}));

export const selectCards = (s: DiscoveryState): EventCardDTO[] => s.cards;
export const selectDetailForSlug =
  (slug: string) =>
  (s: DiscoveryState): EventDetailDTO | undefined =>
    s.detailBySlug[slug];
export const selectRemovalReasonForSlug =
  (slug: string) =>
  (s: DiscoveryState): string | undefined =>
    s.removalReasonBySlug[slug];
