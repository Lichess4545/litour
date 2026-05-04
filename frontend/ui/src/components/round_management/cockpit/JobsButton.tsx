"use client";

import {
  type BackgroundJobDTO,
  type WSJobEvent,
  backgroundJobDto,
  connectJobsSeasonStream,
  listJobsForSeason,
} from "@litour/api-client";
import { useEffect, useState } from "react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { JobsPanel } from "./JobsPanel";

// Compact pill in the cockpit header. Holds an open WebSocket so the
// "running" count stays accurate without polling. Clicking opens the
// JobsPanel dialog. Subscription lifecycle is bound to mount; the
// panel reuses the same data via its own subscription on open.
export function JobsButton({
  apiBaseUrl,
  eventSlug,
}: {
  apiBaseUrl: string;
  eventSlug: string;
}) {
  const [open, setOpen] = useState(false);
  const [jobs, setJobs] = useState<BackgroundJobDTO[]>([]);

  useEffect(() => {
    let cancelled = false;
    const refetch = () => {
      void listJobsForSeason(apiBaseUrl, eventSlug, { limit: 50 }).then((raw) => {
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
        setJobs(parsed);
      });
    };
    refetch();
    const stream = connectJobsSeasonStream(
      apiBaseUrl,
      eventSlug,
      (msg: WSJobEvent) => {
        setJobs((prev) => {
          const idx = prev.findIndex((j) => j.id === msg.job.id);
          if (idx === -1) return [msg.job, ...prev];
          const next = prev.slice();
          next[idx] = msg.job;
          return next;
        });
      },
      (err) => console.error("jobs ws error", err),
      // Resync after every (re)connect — Redis pub/sub doesn't replay,
      // so envelopes published during a blip would otherwise leave the
      // badge stuck on a phantom running job.
      refetch,
    );
    return () => {
      cancelled = true;
      stream.close();
    };
  }, [apiBaseUrl, eventSlug]);

  const running = jobs.filter((j) => j.status === "running" || j.status === "queued").length;
  const failed = jobs.filter((j) => j.status === "failed").length;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          buttonVariants({ variant: "outline", size: "sm" }),
          "h-11 sm:h-8",
          failed > 0 && "border-destructive/50 text-destructive",
        )}
      >
        Jobs
        {running > 0 ? (
          <span className="bg-status-active inline-flex h-5 min-w-5 items-center justify-center rounded-sm px-1.5 text-xs font-medium tabular-nums text-white">
            {running}
          </span>
        ) : null}
        {failed > 0 ? (
          <span className="bg-destructive inline-flex h-5 min-w-5 items-center justify-center rounded-sm px-1.5 text-xs font-medium tabular-nums text-white">
            {failed}
          </span>
        ) : null}
      </button>
      <JobsPanel
        open={open}
        onClose={() => setOpen(false)}
        apiBaseUrl={apiBaseUrl}
        eventSlug={eventSlug}
      />
    </>
  );
}
