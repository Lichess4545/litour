"use client";

import {
  type BackgroundJobDTO,
  type WSJobEvent,
  backgroundJobDto,
  connectJobsSeasonStream,
  listJobsForSeason,
} from "@litour/api-client";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

import { CockpitDialog } from "./CockpitDialog";

interface Props {
  open: boolean;
  onClose: () => void;
  apiBaseUrl: string;
  eventSlug: string;
}

const STATUS_LABEL: Record<BackgroundJobDTO["status"], string> = {
  queued: "Queued",
  running: "Running",
  ok: "Done",
  warning: "Warning",
  failed: "Failed",
};

const SOURCE_LABEL: Record<BackgroundJobDTO["source"], string> = {
  manual: "Manual",
  scheduled: "Scheduled",
  system: "System",
};

const TERMINAL: ReadonlySet<BackgroundJobDTO["status"]> = new Set(["ok", "warning", "failed"]);

// Show 3 most-recent terminal jobs in full, then `COMPACT_PAGE` more in
// a one-line form per page; the user can keep paging back through the
// in-memory list (we already fetch the most recent 50 on open).
const FULL_DETAIL_COUNT = 3;
const COMPACT_PAGE = 7;

export function JobsPanel({ open, onClose, apiBaseUrl, eventSlug }: Props) {
  const [jobs, setJobs] = useState<BackgroundJobDTO[]>([]);
  const [openJob, setOpenJob] = useState<BackgroundJobDTO | null>(null);
  const [compactPages, setCompactPages] = useState(1);

  // Reset paging whenever the panel re-opens so we don't carry "Show older"
  // expansion across sessions.
  useEffect(() => {
    if (open) setCompactPages(1);
  }, [open]);

  // Initial fetch + live subscription. Subscribe lifecycle is bound to
  // the dialog being open so we don't hold a WebSocket open for closed
  // panels — the cockpit header pill uses its own lighter subscription.
  useEffect(() => {
    if (!open) return;
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
        setJobs((prev) => mergeJob(prev, msg.job));
      },
      (err) => console.error("jobs ws error", err),
      // Resync on every (re)connect — pub/sub envelopes published during
      // a network blip aren't replayed, so without this the active list
      // can stay stuck on a job that already finished server-side.
      refetch,
    );
    return () => {
      cancelled = true;
      stream.close();
    };
  }, [open, apiBaseUrl, eventSlug]);

  const active = jobs.filter((j) => !TERMINAL.has(j.status));
  const recent = jobs.filter((j) => TERMINAL.has(j.status));
  const recentFull = recent.slice(0, FULL_DETAIL_COUNT);
  const compactCap = FULL_DETAIL_COUNT + COMPACT_PAGE * compactPages;
  const recentCompact = recent.slice(FULL_DETAIL_COUNT, compactCap);
  const hasMore = recent.length > compactCap;

  return (
    <>
      <CockpitDialog open={open} onClose={onClose} title="Background jobs" size="lg">
        <Section title={`Running · ${active.length}`}>
          {active.length === 0 ? (
            <Empty label="Nothing running." />
          ) : (
            <ul className="space-y-2">
              {active.map((j) => (
                <li key={j.id}>
                  <JobRow job={j} onOpen={() => setOpenJob(j)} />
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="Recent">
          {recent.length === 0 ? (
            <Empty label="No recent jobs." />
          ) : (
            <>
              <ul className="space-y-2">
                {recentFull.map((j) => (
                  <li key={j.id}>
                    <JobRow job={j} onOpen={() => setOpenJob(j)} />
                  </li>
                ))}
              </ul>
              {recentCompact.length > 0 ? (
                <ul className="border-border mt-3 max-h-64 divide-y divide-border overflow-y-auto border-y">
                  {recentCompact.map((j) => (
                    <li key={j.id}>
                      <JobRowCompact job={j} onOpen={() => setOpenJob(j)} />
                    </li>
                  ))}
                </ul>
              ) : null}
              {hasMore ? (
                <button
                  type="button"
                  onClick={() => setCompactPages((n) => n + 1)}
                  className="text-muted-foreground hover:text-foreground mt-3 text-xs underline-offset-2 hover:underline"
                >
                  Show {Math.min(COMPACT_PAGE, recent.length - compactCap)} older
                </button>
              ) : null}
            </>
          )}
        </Section>
      </CockpitDialog>
      {openJob ? <JobDetailDialog job={openJob} onClose={() => setOpenJob(null)} /> : null}
    </>
  );
}

function JobRowCompact({ job, onOpen }: { job: BackgroundJobDTO; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="hover:bg-accent flex w-full items-center gap-3 px-2 py-1.5 text-left"
    >
      <StatusDot status={job.status} />
      <span className="min-w-0 flex-1 truncate text-sm">{job.title}</span>
      <span className="text-muted-foreground hidden text-xs sm:inline">{job.kind}</span>
      <span className="text-muted-foreground w-16 text-right text-xs tabular-nums">
        {formatRelativeShort(job.completed_at ?? job.created_at)}
      </span>
    </button>
  );
}

function StatusDot({ status }: { status: BackgroundJobDTO["status"] }) {
  const tone =
    status === "ok"
      ? "bg-status-active"
      : status === "warning"
        ? "bg-yellow-500"
        : status === "failed"
          ? "bg-destructive"
          : "bg-muted-foreground";
  return <span className={cn("inline-block size-2 shrink-0 rounded-full", tone)} aria-hidden />;
}

function formatRelativeShort(iso: string | null): string {
  if (!iso) return "";
  const ms = Date.now() - Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-2 first:mt-0">
      <h3 className="text-muted-foreground text-xs font-medium uppercase tracking-wide">{title}</h3>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function Empty({ label }: { label: string }) {
  return <p className="text-muted-foreground text-sm italic">{label}</p>;
}

function JobRow({ job, onOpen }: { job: BackgroundJobDTO; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="border-border bg-card hover:bg-accent w-full rounded-md border px-3 py-2 text-left"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{job.title}</p>
          <p className="text-muted-foreground mt-0.5 truncate text-xs">
            {job.kind} · {SOURCE_LABEL[job.source]}
            {job.triggered_by_username ? ` · ${job.triggered_by_username}` : ""}
          </p>
        </div>
        <StatusPill status={job.status} />
      </div>
      <div className="mt-2 flex items-center gap-2">
        <ProgressBar status={job.status} progress={job.progress} />
        <span className="text-muted-foreground w-10 text-right text-xs tabular-nums">
          {job.progress != null ? `${job.progress}%` : ""}
        </span>
      </div>
      {job.progress_message ? (
        <p className="text-muted-foreground mt-1 truncate text-xs">{job.progress_message}</p>
      ) : null}
    </button>
  );
}

function StatusPill({ status }: { status: BackgroundJobDTO["status"] }) {
  const tone =
    status === "ok"
      ? "bg-status-active/10 text-status-active"
      : status === "running" || status === "queued"
        ? "bg-status-active/10 text-status-active"
        : status === "warning"
          ? "bg-yellow-500/10 text-yellow-600"
          : status === "failed"
            ? "bg-destructive/10 text-destructive"
            : "bg-muted text-muted-foreground";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm px-2 py-0.5 text-xs font-medium tabular-nums",
        tone,
      )}
    >
      {(status === "running" || status === "queued") && (
        <span className="bg-current inline-block size-1.5 animate-pulse rounded-full" aria-hidden />
      )}
      {STATUS_LABEL[status]}
    </span>
  );
}

function ProgressBar({
  status,
  progress,
}: {
  status: BackgroundJobDTO["status"];
  progress: number | null;
}) {
  const isTerminal = TERMINAL.has(status);
  const pct = isTerminal ? 100 : (progress ?? 0);
  const indeterminate = !isTerminal && progress == null;
  return (
    <div className="bg-muted relative h-1.5 w-full overflow-hidden rounded-sm">
      <div
        className={cn(
          "h-full transition-[width] duration-300 ease-out",
          status === "failed" && "bg-destructive",
          status === "warning" && "bg-yellow-500",
          (status === "ok" || status === "running" || status === "queued") && "bg-status-active",
          indeterminate && "animate-pulse",
        )}
        style={{ width: indeterminate ? "33%" : `${pct}%` }}
      />
    </div>
  );
}

function JobDetailDialog({
  job,
  onClose,
}: {
  job: BackgroundJobDTO;
  onClose: () => void;
}) {
  return (
    <CockpitDialog open onClose={onClose} title={job.title} size="md">
      <dl className="grid grid-cols-[7rem_1fr] gap-y-2 text-sm">
        <dt className="text-muted-foreground">Kind</dt>
        <dd className="font-mono text-xs">{job.kind}</dd>
        <dt className="text-muted-foreground">Status</dt>
        <dd>
          <StatusPill status={job.status} />
        </dd>
        <dt className="text-muted-foreground">Source</dt>
        <dd>{SOURCE_LABEL[job.source]}</dd>
        {job.triggered_by_username ? (
          <>
            <dt className="text-muted-foreground">Triggered by</dt>
            <dd>{job.triggered_by_username}</dd>
          </>
        ) : null}
        {job.created_at ? (
          <>
            <dt className="text-muted-foreground">Created</dt>
            <dd>{new Date(job.created_at).toLocaleString()}</dd>
          </>
        ) : null}
        {job.completed_at ? (
          <>
            <dt className="text-muted-foreground">Completed</dt>
            <dd>{new Date(job.completed_at).toLocaleString()}</dd>
          </>
        ) : null}
      </dl>
      {job.description ? (
        <p className="text-muted-foreground mt-3 text-sm">{job.description}</p>
      ) : null}
      {job.progress_message ? (
        <p className="text-foreground mt-3 text-sm">{job.progress_message}</p>
      ) : null}
      {job.error_message ? (
        <pre className="border-destructive/30 bg-destructive/5 mt-4 max-h-60 overflow-auto rounded-md border p-3 text-xs whitespace-pre-wrap">
          {job.error_message}
        </pre>
      ) : null}
      {Object.keys(job.result).length > 0 ? (
        <pre className="bg-muted/40 mt-4 max-h-60 overflow-auto rounded-md p-3 text-xs">
          {JSON.stringify(job.result, null, 2)}
        </pre>
      ) : null}
    </CockpitDialog>
  );
}

function mergeJob(prev: BackgroundJobDTO[], updated: BackgroundJobDTO): BackgroundJobDTO[] {
  const idx = prev.findIndex((j) => j.id === updated.id);
  if (idx === -1) return [updated, ...prev];
  const next = prev.slice();
  next[idx] = updated;
  return next;
}
