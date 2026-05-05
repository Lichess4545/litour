"use client";

import {
  type CockpitActionName,
  type CockpitActionResultDTO,
  callCockpitAction,
} from "@litour/api-client";
import { useCallback, useState } from "react";

import { useToaster } from "./Toaster";

interface RunOptions {
  successTitle?: string | undefined; // override the toast title on ok
  body?: Record<string, unknown> | undefined;
}

// Single-action runner with pending state and automatic toasting.
// Page state updates flow through the multiplex WS — the cockpit's
// `cockpit:event:...:round:...` channel pushes `cockpit.snapshot`
// envelopes whenever a round/season state change lands server-side, so
// callers don't need to refetch or refresh.
export function useCockpitAction(apiBaseUrl: string, eventSlug: string) {
  const toaster = useToaster();
  const [pending, setPending] = useState(false);

  const run = useCallback(
    async (action: CockpitActionName, opts: RunOptions = {}): Promise<CockpitActionResultDTO> => {
      if (pending) {
        return { status: "warning", title: "Busy", detail: "Already running.", refresh: false };
      }
      setPending(true);
      try {
        const result = await callCockpitAction(apiBaseUrl, eventSlug, action, opts.body ?? {});
        toaster.push({
          tone: result.status,
          title: opts.successTitle && result.status === "ok" ? opts.successTitle : result.title,
          detail: result.detail,
        });
        return result;
      } catch (err) {
        const detail = err instanceof Error ? err.message : "Unknown error";
        toaster.push({ tone: "error", title: "Action failed", detail });
        return { status: "error", title: "Action failed", detail, refresh: false };
      } finally {
        setPending(false);
      }
    },
    [apiBaseUrl, eventSlug, pending, toaster],
  );

  return { run, pending };
}
