"use client";

import { type WSJobLag, wsJobLag } from "@litour/api-client";
import { useEffect } from "react";
import { create } from "zustand";

import { useChannel } from "@/lib/multiplex";

// Single global queue-lag store. There's exactly one canary stream
// per cluster; co-locate the store under ``lib/`` since it's not
// scoped to any one chess domain.

interface LagState {
  snapshot: WSJobLag | null;
  setSnapshot: (snapshot: WSJobLag | null) => void;
}

export const useLagStore = create<LagState>((set) => ({
  snapshot: null,
  setSnapshot: (snapshot) => set({ snapshot }),
}));

export const selectLagSnapshot = (s: LagState): WSJobLag | null => s.snapshot;

// Sync hook — call once per page that wants live lag (typically the
// cockpit's footer chip). ``initial`` seeds the SSR snapshot before
// the first WS envelope lands.
export function useLagSync(initial: WSJobLag | null): void {
  const setSnapshot = useLagStore((s) => s.setSnapshot);

  useEffect(() => {
    setSnapshot(initial);
  }, [initial, setSnapshot]);

  useChannel("system:queue_lag", {
    schema: wsJobLag,
    onMessage: (msg) => setSnapshot(msg),
  });
}
