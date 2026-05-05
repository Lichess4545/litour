import createOpenApiClient from "openapi-fetch";
import { type CockpitActionResultDTO, cockpitActionResultDto } from "./cockpit-messages";
import type { paths } from "./generated";
import { type JobLagHistoryDTO, jobLagHistoryDto } from "./jobs-messages";

export interface ClientInit {
  // Default headers applied to every request — used by the Next SSR layer
  // to forward Django's `sessionid` cookie, which FastAPI resolves into
  // permission flags on `RoundMatchesDTO.viewer`.
  headers?: HeadersInit;
}

export function createClient(baseUrl: string, init: ClientInit = {}) {
  return createOpenApiClient<paths>(
    init.headers === undefined ? { baseUrl } : { baseUrl, headers: init.headers },
  );
}

// Cockpit one-shot action client. The cockpit POST routes accept a thin
// JSON body and return ``CockpitActionResultDTO``; this helper parses
// that envelope so callers receive a typed result. Each route is a
// fixed string here rather than going through ``createOpenApiClient``
// because the action surface evolves faster than the regenerated
// OpenAPI types.
export type CockpitActionName =
  | "clear-caches"
  | "validate-tokens"
  | "update-fide-ratings"
  | "backfill-fide-data"
  | "generate-pairings"
  | "start-round"
  | "close-round"
  | "close-season"
  | "advance-tournament"
  | "finalize-tournament"
  | "generate-next-match-set"
  | "create-missing-matches";

// Fetch the rolled-up lag history (oldest → newest). Returns null on
// 401/network errors so the popover can render its waiting state.
export async function fetchJobLagHistory(
  baseUrl: string,
  granularity: "hour" | "day" | "week" | "month" | "year" = "hour",
  limit = 24,
): Promise<JobLagHistoryDTO | null> {
  const url = `${baseUrl.replace(/\/$/, "")}/v1/jobs/lag/history?granularity=${granularity}&limit=${limit}`;
  try {
    const response = await fetch(url, { credentials: "include" });
    if (!response.ok) return null;
    const json = await response.json();
    const parsed = jobLagHistoryDto.safeParse(json);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// Fetch the initial list of active + recent jobs for a season scope.
// The API returns the most recent ``limit`` jobs; the cockpit pre-renders
// these so the panel isn't empty on first paint, then patches via WS.
export async function listJobsForSeason(
  baseUrl: string,
  seasonSlug: string,
  options: { activeOnly?: boolean; limit?: number } = {},
): Promise<unknown[]> {
  const params = new URLSearchParams();
  params.set("season_slug", seasonSlug);
  if (options.activeOnly) params.set("active_only", "true");
  params.set("limit", String(options.limit ?? 50));
  const url = `${baseUrl.replace(/\/$/, "")}/v1/jobs?${params.toString()}`;
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) return [];
  return response.json();
}

export async function callCockpitAction(
  baseUrl: string,
  eventSlug: string,
  action: CockpitActionName,
  body: Record<string, unknown> = {},
): Promise<CockpitActionResultDTO> {
  const url = `${baseUrl.replace(/\/$/, "")}/v1/round_management/cockpit/events/${encodeURIComponent(
    eventSlug,
  )}/actions/${action}`;
  const response = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    return {
      status: "error",
      title:
        response.status === 401
          ? "Not signed in"
          : response.status === 403
            ? "Permission denied"
            : `Action failed (${response.status})`,
      detail: await response.text().catch(() => ""),
      refresh: false,
    };
  }
  const json = await response.json();
  return cockpitActionResultDto.parse(json);
}
