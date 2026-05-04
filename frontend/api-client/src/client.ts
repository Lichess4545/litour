import createOpenApiClient from "openapi-fetch";
import { WebSocket as ReconnectingWebSocket } from "partysocket";
import {
  type CockpitActionResultDTO,
  type WSCockpitMessage,
  cockpitActionResultDto,
  wsCockpitMessage,
} from "./cockpit-messages";
import {
  type WSEventMessage,
  type WSHomeMessage,
  wsEventMessage,
  wsHomeMessage,
} from "./discovery-messages";
import type { paths } from "./generated";
import { type WSMessage, wsMessage } from "./ws-messages";

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

export interface MatchStream {
  close(): void;
}

export function connectMatchStream(
  baseUrl: string,
  roundId: number,
  onMessage: (msg: WSMessage) => void,
  onError?: (err: unknown) => void,
): MatchStream {
  const ws = new ReconnectingWebSocket(toWsUrl(baseUrl, `/ws/rounds/${roundId}/matches`), [], {
    minReconnectionDelay: 1000,
    maxReconnectionDelay: 30_000,
    reconnectionDelayGrowFactor: 2,
  });

  ws.addEventListener("message", (ev) => {
    try {
      const parsed = wsMessage.parse(JSON.parse(ev.data as string));
      onMessage(parsed);
    } catch (err) {
      onError?.(err);
    }
  });

  if (onError) {
    ws.addEventListener("error", onError);
  }

  return {
    close() {
      ws.close();
    },
  };
}

export interface DiscoveryStream {
  close(): void;
}

export function connectDiscoveryHomeStream(
  baseUrl: string,
  onMessage: (msg: WSHomeMessage) => void,
  onError?: (err: unknown) => void,
): DiscoveryStream {
  return openValidatedStream(baseUrl, "/ws/discovery/home", wsHomeMessage, onMessage, onError);
}

export function connectDiscoveryEventStream(
  baseUrl: string,
  slug: string,
  onMessage: (msg: WSEventMessage) => void,
  onError?: (err: unknown) => void,
): DiscoveryStream {
  return openValidatedStream(
    baseUrl,
    `/ws/discovery/events/${encodeURIComponent(slug)}`,
    wsEventMessage,
    onMessage,
    onError,
  );
}

export interface CockpitStream {
  close(): void;
}

export function connectCockpitStream(
  baseUrl: string,
  eventSlug: string,
  onMessage: (msg: WSCockpitMessage) => void,
  onError?: (err: unknown) => void,
): CockpitStream {
  return openValidatedStream(
    baseUrl,
    `/ws/round_management/events/${encodeURIComponent(eventSlug)}/cockpit`,
    wsCockpitMessage,
    onMessage,
    onError,
  );
}

function openValidatedStream<T>(
  baseUrl: string,
  path: string,
  schema: { parse(data: unknown): T },
  onMessage: (msg: T) => void,
  onError?: (err: unknown) => void,
): DiscoveryStream {
  const ws = new ReconnectingWebSocket(toWsUrl(baseUrl, path), [], {
    minReconnectionDelay: 1000,
    maxReconnectionDelay: 30_000,
    reconnectionDelayGrowFactor: 2,
  });

  ws.addEventListener("message", (ev) => {
    try {
      const parsed = schema.parse(JSON.parse(ev.data as string));
      onMessage(parsed);
    } catch (err) {
      onError?.(err);
    }
  });

  if (onError) {
    ws.addEventListener("error", onError);
  }

  return {
    close() {
      ws.close();
    },
  };
}

// Resolve a WebSocket URL from a baseUrl that may be absolute (`http(s)://host`)
// or path-relative (`/v2/api`). For path-relative, we resolve against the
// current page's origin so the connection rides the same TLS cert as the page.
function toWsUrl(baseUrl: string, path: string): string {
  if (/^https?:\/\//i.test(baseUrl)) {
    return baseUrl.replace(/^http/i, "ws") + path;
  }
  const wsOrigin = window.location.origin.replace(/^http/i, "ws");
  return `${wsOrigin}${baseUrl}${path}`;
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
