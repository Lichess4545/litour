"use client";

import {
  type JobLagHistoryDTO,
  type JobLagHistoryPoint,
  type WSJobLag,
  fetchJobLagHistory,
} from "@litour/api-client";
import { useEffect, useState } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

// Compact queue-health indicator. Visible value is the latest canary
// queue-lag sample; clicking opens a popover with the breakdown plus
// an hourly sparkline pulled from the rollup pyramid (last 24 hours
// by default). Gaps in the timeline (hours with no data) stay as gaps
// — we don't synthesize values.
export function JobLagPill({
  snapshot,
  apiBaseUrl,
  variant = "default",
}: {
  snapshot: WSJobLag | null;
  apiBaseUrl: string;
  variant?: "default" | "chip";
}) {
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<JobLagHistoryDTO | null>(null);
  const [historyLoaded, setHistoryLoaded] = useState(false);

  // Lazy fetch — only hit the endpoint when the user opens the popover.
  // Refetch on every open so the graph stays fresh without a poll.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void fetchJobLagHistory(apiBaseUrl, "hour", 24).then((h) => {
      if (cancelled) return;
      setHistory(h);
      setHistoryLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [open, apiBaseUrl]);

  const latest = snapshot?.queue_lag_latest ?? null;
  const tone = lagTone(latest);
  const value = formatSeconds(latest);

  const trigger =
    variant === "chip" ? (
      <button
        type="button"
        className="inline-flex cursor-pointer items-center gap-1.5 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span
          className={cn(
            "inline-block size-2 rounded-full",
            tone === "ok" && "bg-status-active",
            tone === "warn" && "bg-yellow-500",
            tone === "down" && "bg-destructive",
            tone === "neutral" && "bg-muted-foreground",
          )}
          aria-hidden
        />
        <span>
          Queue lag: <span className="text-foreground tabular-nums">{value}</span>
        </span>
      </button>
    ) : (
      <button
        type="button"
        className={cn(
          "inline-flex cursor-pointer items-center gap-1.5 rounded-sm px-2 py-0.5 text-xs font-medium tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring",
          tone === "ok" && "bg-status-active/10 text-status-active",
          tone === "warn" && "bg-yellow-500/10 text-yellow-600",
          tone === "down" && "bg-destructive/10 text-destructive",
          tone === "neutral" && "bg-muted text-muted-foreground",
        )}
      >
        <span className="text-[0.7rem] uppercase tracking-wide opacity-70">queue</span>
        {value}
      </button>
    );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="start" className="w-80 text-xs">
        <LagDetail snapshot={snapshot} history={history} historyLoaded={historyLoaded} />
      </PopoverContent>
    </Popover>
  );
}

function LagDetail({
  snapshot,
  history,
  historyLoaded,
}: {
  snapshot: WSJobLag | null;
  history: JobLagHistoryDTO | null;
  historyLoaded: boolean;
}) {
  if (!snapshot) {
    return (
      <p className="text-muted-foreground italic">
        Queue-lag canary — waiting for the first sample.
      </p>
    );
  }
  const avgText =
    snapshot.queue_lag_stddev != null
      ? `${formatSeconds(snapshot.queue_lag_avg)} ± ${formatSeconds(snapshot.queue_lag_stddev)}`
      : formatSeconds(snapshot.queue_lag_avg);
  return (
    <div className="space-y-3">
      <div>
        <p className="text-muted-foreground text-[0.7rem] uppercase tracking-wide">
          Broker round-trip · last hour
        </p>
        <p className="mt-1.5 flex flex-wrap items-baseline gap-x-1 gap-y-0.5 tabular-nums">
          <span className="text-foreground text-sm font-medium">
            {formatSeconds(snapshot.queue_lag_latest)}
          </span>
          <span className="text-muted-foreground">
            · avg {avgText} · p95 {formatSeconds(snapshot.queue_lag_p95)} · max{" "}
            {formatSeconds(snapshot.queue_lag_max)} · {snapshot.samples} samples
          </span>
        </p>
      </div>
      <div>
        <p className="text-muted-foreground text-[0.7rem] uppercase tracking-wide">
          Hourly mean · last 24h
        </p>
        <Sparkline points={history?.points ?? []} loaded={historyLoaded} />
      </div>
    </div>
  );
}

// SVG sparkline: hourly mean (line) with the per-hour max as a faint
// upper envelope so spikes are visible without dominating the scale.
// X-axis position = bucket_start clock time; gaps in the rollup data
// stay as visual gaps (no interpolation).
function Sparkline({ points, loaded }: { points: JobLagHistoryPoint[]; loaded: boolean }) {
  const W = 280;
  const H = 56;
  const PAD = 4;

  if (!loaded) {
    return <p className="text-muted-foreground mt-1.5 italic">Loading…</p>;
  }
  if (points.length === 0) {
    return (
      <p className="text-muted-foreground mt-1.5 italic">
        No hourly data yet — first rollup runs at the top of the hour.
      </p>
    );
  }

  const times = points.map((p) => Date.parse(p.bucket_start));
  const tMin = times[0];
  const tMax = times[times.length - 1];
  const tRange = tMax !== undefined && tMin !== undefined && tMax > tMin ? tMax - tMin : 1;

  const yMax = Math.max(0.001, ...points.map((p) => p.queue_lag_max));

  const xFor = (i: number) => {
    const t = times[i];
    if (t === undefined || tMin === undefined) return PAD;
    return PAD + ((t - tMin) / tRange) * (W - 2 * PAD);
  };
  const yFor = (v: number) => H - PAD - (v / yMax) * (H - 2 * PAD);

  const meanPath = points
    .map(
      (p, i) => `${i === 0 ? "M" : "L"} ${xFor(i).toFixed(1)} ${yFor(p.queue_lag_mean).toFixed(1)}`,
    )
    .join(" ");
  const maxPath = points
    .map(
      (p, i) => `${i === 0 ? "M" : "L"} ${xFor(i).toFixed(1)} ${yFor(p.queue_lag_max).toFixed(1)}`,
    )
    .join(" ");

  return (
    <div className="mt-1.5">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block w-full"
        role="img"
        aria-label="Hourly queue lag for the last 24 hours"
      >
        <path d={maxPath} className="stroke-muted-foreground/40" strokeWidth={1} fill="none" />
        <path d={meanPath} className="stroke-status-active" strokeWidth={1.5} fill="none" />
        {points.map((p, i) => (
          <circle
            key={p.bucket_start}
            cx={xFor(i)}
            cy={yFor(p.queue_lag_mean)}
            r={1.5}
            className="fill-status-active"
          />
        ))}
      </svg>
      <div className="text-muted-foreground mt-1 flex justify-between text-[0.65rem] tabular-nums">
        <span>{formatHour(points[0]?.bucket_start)}</span>
        <span>peak {formatSeconds(yMax)}</span>
        <span>{formatHour(points[points.length - 1]?.bucket_start)}</span>
      </div>
    </div>
  );
}

function formatHour(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "numeric", hour12: false });
}

type Tone = "ok" | "warn" | "down" | "neutral";

function lagTone(seconds: number | null): Tone {
  if (seconds == null) return "neutral";
  if (seconds < 1) return "ok";
  if (seconds < 5) return "warn";
  return "down";
}

function formatSeconds(seconds: number | null): string {
  if (seconds == null) return "—";
  if (seconds < 1) return `${Math.round(seconds * 1000)}ms`;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  return `${Math.round(seconds)}s`;
}
