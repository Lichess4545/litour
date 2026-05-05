"use client";

import type { components } from "@litour/api-client";
import { create } from "zustand";

type Match = components["schemas"]["MatchDTO"];
type TeamMatch = components["schemas"]["TeamMatchDTO"];

// Matches store, keyed by round id. Holds both per-board matches and
// per-team-match aggregates so a public-page consumer (and any future
// surface — Slack-side mod tools, league admin views) reads the same
// data the cockpit watches via its own ``cockpit:event:...`` channel.

interface Bucket {
  matches: Match[];
  teamMatches: TeamMatch[];
}

interface MatchesState {
  byRound: Record<number, Bucket>;
  setSnapshot: (roundId: number, matches: Match[], teamMatches: TeamMatch[]) => void;
  applyMatchUpdate: (roundId: number, match: Match) => void;
  applyTeamMatchUpdate: (roundId: number, teamMatch: TeamMatch) => void;
  clear: (roundId: number) => void;
}

const EMPTY_BUCKET: Bucket = Object.freeze({
  matches: Object.freeze([]) as Match[],
  teamMatches: Object.freeze([]) as TeamMatch[],
}) as Bucket;

export const useMatchesStore = create<MatchesState>((set) => ({
  byRound: {},

  setSnapshot: (roundId, matches, teamMatches) =>
    set((state) => ({
      byRound: { ...state.byRound, [roundId]: { matches, teamMatches } },
    })),

  applyMatchUpdate: (roundId, match) =>
    set((state) => {
      const bucket = state.byRound[roundId] ?? EMPTY_BUCKET;
      return {
        byRound: {
          ...state.byRound,
          [roundId]: { ...bucket, matches: replaceById(bucket.matches, match) },
        },
      };
    }),

  applyTeamMatchUpdate: (roundId, teamMatch) =>
    set((state) => {
      const bucket = state.byRound[roundId] ?? EMPTY_BUCKET;
      return {
        byRound: {
          ...state.byRound,
          [roundId]: { ...bucket, teamMatches: replaceById(bucket.teamMatches, teamMatch) },
        },
      };
    }),

  clear: (roundId) =>
    set((state) => {
      const { [roundId]: _dropped, ...byRound } = state.byRound;
      return { byRound };
    }),
}));

export const selectMatchesForRound =
  (roundId: number) =>
  (s: MatchesState): Bucket =>
    s.byRound[roundId] ?? EMPTY_BUCKET;

function replaceById<T extends { id: number }>(prev: T[], next: T): T[] {
  let changed = false;
  const out = prev.map((item) => {
    if (item.id !== next.id) return item;
    changed = true;
    return next;
  });
  return changed ? out : prev;
}
