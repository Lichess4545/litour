"use client";

import {
  type CockpitActionName,
  type CockpitActionResultDTO,
  callCockpitAction,
} from "@litour/api-client";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

import { useToaster } from "./Toaster";

interface RunOptions {
  successTitle?: string | undefined; // override the toast title on ok
  body?: Record<string, unknown> | undefined;
}

// Single-action runner with pending state, automatic toasting, and
// router.refresh on actions that signal `refresh: true`. The runner is
// per-component (each toolbar dropdown / CTA owns its own pending flag)
// so we don't fight over a global mutex.
export function useCockpitAction(apiBaseUrl: string, eventSlug: string) {
  const toaster = useToaster();
  const router = useRouter();
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
        if (result.refresh) {
          router.refresh();
        }
        return result;
      } catch (err) {
        const detail = err instanceof Error ? err.message : "Unknown error";
        toaster.push({ tone: "error", title: "Action failed", detail });
        return { status: "error", title: "Action failed", detail, refresh: false };
      } finally {
        setPending(false);
      }
    },
    [apiBaseUrl, eventSlug, pending, router, toaster],
  );

  return { run, pending };
}
