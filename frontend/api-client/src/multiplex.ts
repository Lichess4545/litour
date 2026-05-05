import { WebSocket as ReconnectingWebSocket } from "partysocket";
import { z } from "zod";

// Wire envelopes from the multiplex endpoint at `/ws`. Mirrors the
// shapes documented in `heltour/api/shared/ws_multiplex.py`.
const wsServerEnvelope = z.discriminatedUnion("type", [
  z.object({ type: z.literal("subscribed"), channel: z.string() }),
  z.object({ type: z.literal("unsubscribed"), channel: z.string() }),
  z.object({
    type: z.literal("subscribe.error"),
    channel: z.string(),
    reason: z.string(),
  }),
  z.object({
    type: z.literal("event"),
    channel: z.string(),
    payload: z.unknown(),
  }),
]);

export type ChannelStatus = "subscribing" | "subscribed" | "error";

export interface ChannelOptions<T> {
  // Runtime validator for each event payload — surfaces shape drift
  // immediately rather than letting the UI consume a malformed object.
  schema: { parse(data: unknown): T };
  onMessage: (msg: T) => void;
  onStatus?: (status: ChannelStatus, reason?: string) => void;
  onParseError?: (err: unknown) => void;
}

interface InternalSubscription {
  // Distinct refs so multiple consumers can listen to the same channel
  // (cockpit page + jobs button) without stepping on each other; the
  // backing channel is unsubscribed only when the last ref drops.
  refs: Set<symbol>;
  options: Map<symbol, ChannelOptions<unknown>>;
}

export class MultiplexClient {
  private ws: ReconnectingWebSocket;
  private subs = new Map<string, InternalSubscription>();
  private opened = false;

  constructor(baseUrl: string) {
    this.ws = new ReconnectingWebSocket(toWsUrl(baseUrl, "/ws"), [], {
      minReconnectionDelay: 1000,
      maxReconnectionDelay: 30_000,
      reconnectionDelayGrowFactor: 2,
    });
    this.ws.addEventListener("open", () => {
      this.opened = true;
      // Re-issue every active subscribe on reconnect — Redis pubsub on
      // the server doesn't replay missed events, so consumers should
      // re-snapshot too (their concern, signalled via status="subscribing").
      for (const [channel, sub] of this.subs.entries()) {
        for (const opts of sub.options.values()) {
          opts.onStatus?.("subscribing");
        }
        this.send({ type: "subscribe", channel });
      }
    });
    this.ws.addEventListener("close", () => {
      this.opened = false;
    });
    this.ws.addEventListener("message", (ev) => {
      this.onMessage(ev.data as string);
    });
  }

  subscribe<T>(channel: string, options: ChannelOptions<T>): () => void {
    const ref = Symbol(channel);
    let sub = this.subs.get(channel);
    if (sub === undefined) {
      sub = { refs: new Set(), options: new Map() };
      this.subs.set(channel, sub);
    }
    sub.refs.add(ref);
    sub.options.set(ref, options as ChannelOptions<unknown>);
    options.onStatus?.("subscribing");
    if (this.opened && sub.refs.size === 1) {
      this.send({ type: "subscribe", channel });
    }
    return () => {
      const cur = this.subs.get(channel);
      if (cur === undefined) return;
      cur.refs.delete(ref);
      cur.options.delete(ref);
      if (cur.refs.size === 0) {
        this.subs.delete(channel);
        if (this.opened) {
          this.send({ type: "unsubscribe", channel });
        }
      }
    };
  }

  close(): void {
    this.subs.clear();
    this.ws.close();
  }

  private send(msg: { type: string; channel: string }): void {
    try {
      this.ws.send(JSON.stringify(msg));
    } catch {
      // Send before open / during close — the open handler will
      // resend everything on connect, so dropping here is safe.
    }
  }

  private onMessage(raw: string): void {
    let parsed: z.infer<typeof wsServerEnvelope>;
    try {
      parsed = wsServerEnvelope.parse(JSON.parse(raw));
    } catch {
      return;
    }
    const sub = this.subs.get(parsed.channel);
    if (sub === undefined) return;
    if (parsed.type === "event") {
      // Cheap visibility into the live stream — turn on if the page
      // looks stuck; the server logs ``ws forward`` lines line up with
      // these. Comment out if it gets too noisy in production.
      if (typeof console !== "undefined" && console.debug) {
        console.debug("[multiplex] event", parsed.channel, parsed.payload);
      }
      for (const opts of sub.options.values()) {
        try {
          const validated = opts.schema.parse(parsed.payload);
          opts.onMessage(validated);
        } catch (err) {
          opts.onParseError?.(err);
        }
      }
      return;
    }
    if (parsed.type === "subscribed") {
      for (const opts of sub.options.values()) opts.onStatus?.("subscribed");
      return;
    }
    if (parsed.type === "unsubscribed") {
      // No-op: unsubscribe is fire-and-forget on the client side.
      return;
    }
    if (parsed.type === "subscribe.error") {
      for (const opts of sub.options.values()) opts.onStatus?.("error", parsed.reason);
      return;
    }
  }
}

function toWsUrl(baseUrl: string, path: string): string {
  if (/^https?:\/\//i.test(baseUrl)) {
    return baseUrl.replace(/^http/i, "ws") + path;
  }
  // Path-relative baseUrl resolves against the page origin so the WS
  // rides the same TLS cert. Guard `window` because the MultiplexClient
  // is sometimes constructed during a Next.js SSR render path; the
  // returned URL is harmless on the server because the constructor
  // doesn't dial until the partysocket internals run on the client.
  if (typeof window === "undefined") {
    return `ws://localhost${baseUrl}${path}`;
  }
  const wsOrigin = window.location.origin.replace(/^http/i, "ws");
  return `${wsOrigin}${baseUrl}${path}`;
}
