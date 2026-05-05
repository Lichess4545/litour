"use client";

import { type ChannelOptions, type ChannelStatus, MultiplexClient } from "@litour/api-client";
import { type ReactNode, createContext, useContext, useEffect, useRef, useState } from "react";

// One MultiplexClient per provider — i.e. per page-mount. The client
// owns a single ReconnectingWebSocket and reference-counts subscribers
// per channel, so multiple components on the same page share the same
// underlying socket without coordination.
//
// The client is created in a useEffect (not during render) because its
// constructor opens a WebSocket, and `window` is undefined under
// Next.js SSR. Until the post-mount effect lands, useChannel queues
// subscribes against null and the effect re-issues them once the
// client exists.
const MultiplexContext = createContext<MultiplexClient | null>(null);

export function MultiplexProvider({
  apiBaseUrl,
  children,
}: {
  apiBaseUrl: string;
  children: ReactNode;
}) {
  // If a parent already established a multiplex client, reuse it. This
  // lets composable pages (e.g. EventLive embedding MatchesLive) wrap
  // themselves in their own provider for standalone use without
  // opening a second WebSocket when nested inside another live page.
  const outer = useContext(MultiplexContext);
  const [client, setClient] = useState<MultiplexClient | null>(outer);

  useEffect(() => {
    if (outer !== null) {
      setClient(outer);
      return;
    }
    const c = new MultiplexClient(apiBaseUrl);
    setClient(c);
    return () => {
      c.close();
      setClient(null);
    };
  }, [apiBaseUrl, outer]);

  return <MultiplexContext.Provider value={client}>{children}</MultiplexContext.Provider>;
}

export function useMultiplexClient(): MultiplexClient | null {
  return useContext(MultiplexContext);
}

// Subscribe to one channel for the lifetime of the calling component.
//
// `channel` may be ``null`` to short-circuit subscription (e.g. when
// the round id isn't resolved yet). Changing the channel string
// unsubscribes from the old and subscribes to the new on the next
// render — same lifecycle as a useEffect dep.
//
// Callbacks are passed through refs so a component can hold stable
// state in the message handler without retriggering subscribe churn.
export function useChannel<T>(channel: string | null, options: ChannelOptions<T>): void {
  const client = useMultiplexClient();
  const optsRef = useRef(options);
  optsRef.current = options;

  useEffect(() => {
    if (channel === null || client === null) return;
    const unsubscribe = client.subscribe<T>(channel, {
      schema: optsRef.current.schema,
      onMessage: (msg) => optsRef.current.onMessage(msg),
      onStatus: (status: ChannelStatus, reason?: string) => {
        if (status === "error") {
          // Surface forbidden / unknown_channel by default — silently
          // failing leaves the page stuck on stale state with no
          // diagnostic. Callers can still override via options.onStatus.
          console.error(`[multiplex] channel=${channel} ${status}`, reason);
        }
        optsRef.current.onStatus?.(status, reason);
      },
      onParseError: (err) => {
        // Schema mismatches between the server's emitted payload and
        // the client's zod parser usually mean the page sat unexpectedly
        // stale — log so the failure isn't invisible.
        console.error(`[multiplex] channel=${channel} parse error`, err);
        optsRef.current.onParseError?.(err);
      },
    });
    return unsubscribe;
  }, [channel, client]);
}
