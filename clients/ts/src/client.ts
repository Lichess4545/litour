import createOpenApiClient from "openapi-fetch";
import { WebSocket as ReconnectingWebSocket } from "partysocket";
import type { paths } from "./generated";
import { type WSMessage, wsMessage } from "./ws-messages";

export function createClient(baseUrl: string) {
  return createOpenApiClient<paths>({ baseUrl });
}

export interface PairingStream {
  close(): void;
}

export function connectPairingStream(
  baseUrl: string,
  roundId: number,
  onMessage: (msg: WSMessage) => void,
  onError?: (err: unknown) => void,
): PairingStream {
  const wsBase = baseUrl.replace(/^http/, "ws");
  const ws = new ReconnectingWebSocket(`${wsBase}/ws/pairings/${roundId}`, [], {
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
