"use client";

import { useState } from "react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { selectJobsForSlug, useJobsStore, useJobsSync } from "@/lib/jobsStore";

import { JobsPanel } from "./JobsPanel";

// Compact pill in the cockpit header. Wires the season-scoped jobs
// store (HTTP snapshot + WS subscribe), then derives the badge from
// the same store the panel reads from. The badge and panel can no
// longer disagree because they're both rendering off one zustand
// slice.
export function JobsButton({
  apiBaseUrl,
  eventSlug,
}: {
  apiBaseUrl: string;
  eventSlug: string;
}) {
  useJobsSync(apiBaseUrl, eventSlug);

  const [open, setOpen] = useState(false);
  const jobs = useJobsStore(selectJobsForSlug(eventSlug));

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
      <JobsPanel open={open} onClose={() => setOpen(false)} eventSlug={eventSlug} />
    </>
  );
}
