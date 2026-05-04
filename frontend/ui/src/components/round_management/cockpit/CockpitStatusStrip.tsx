import type { CockpitManagementDTO, WSJobLag } from "@litour/api-client";

import { cn } from "@/lib/utils";

import { JobLagPill } from "./JobLagPill";

// Always-visible health line at the bottom of the cockpit. Surfaces
// the same operational signals the Django dashboard renders inline with
// the action list (Lichess token, queue-lag canary, last-validated
// tokens). `lagSnapshot` arrives over the lag WebSocket so the
// chip updates without polling; `lagHistory` is the rolling buffer
// of recent `queue_lag_latest` values for the popover sparkline.
export function CockpitStatusStrip({
  management,
  lagSnapshot,
  apiBaseUrl,
}: {
  management: CockpitManagementDTO;
  lagSnapshot: WSJobLag | null;
  apiBaseUrl: string;
}) {
  const m = management;
  const tokenOk = m.lichess_token?.valid ?? null;
  return (
    <footer
      className="border-border text-muted-foreground mt-12 flex flex-wrap items-center gap-x-6 gap-y-2 border-t pt-3 text-xs"
      aria-label="System status"
    >
      <Chip
        label="Lichess token"
        valueLabel={
          tokenOk === null ? "unknown" : tokenOk ? `OK${userIdSuffix(m.lichess_token)}` : "FAILED"
        }
        tone={tokenOk === null ? "neutral" : tokenOk ? "ok" : "destructive"}
      />
      <JobLagPill snapshot={lagSnapshot} apiBaseUrl={apiBaseUrl} variant="chip" />
      {m.token_validation ? (
        <Chip
          label="Tokens"
          valueLabel={
            m.token_validation.failed_count > 0
              ? `${m.token_validation.failed_count} failed`
              : `${m.token_validation.refreshed_count}/${m.token_validation.total} refreshed`
          }
          tone={m.token_validation.failed_count > 0 ? "destructive" : "neutral"}
        />
      ) : null}
    </footer>
  );
}

function userIdSuffix(token: CockpitManagementDTO["lichess_token"]): string {
  if (!token || !token.user_id) return "";
  return ` · ${token.user_id}`;
}

function Chip({
  label,
  valueLabel,
  tone,
}: {
  label: string;
  valueLabel: string;
  tone: "ok" | "destructive" | "neutral";
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={cn(
          "inline-block size-2 rounded-full",
          tone === "ok" && "bg-status-active",
          tone === "destructive" && "bg-destructive",
          tone === "neutral" && "bg-muted-foreground",
        )}
        aria-hidden
      />
      <span>
        {label}: <span className="text-foreground">{valueLabel}</span>
      </span>
    </span>
  );
}
