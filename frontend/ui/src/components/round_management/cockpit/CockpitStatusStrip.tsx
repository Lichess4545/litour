import type { CockpitManagementDTO } from "@litour/api-client";

import { cn } from "@/lib/utils";

// Always-visible health line at the bottom of the cockpit. Surfaces
// the same operational signals the Django dashboard renders inline with
// the action list (Lichess token, Celery uptime, last-validated tokens).
export function CockpitStatusStrip({ management }: { management: CockpitManagementDTO }) {
  const m = management;
  const tokenOk = m.lichess_token?.valid ?? null;
  const celeryUp = !m.celery_down;
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
      <Chip
        label="Celery"
        valueLabel={celeryUp ? "up" : "down"}
        tone={celeryUp ? "ok" : "destructive"}
      />
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
