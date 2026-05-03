// Browser entry point: bundled to an IIFE that assigns these exports to
// `window.LitourApi`. Used by Django templates via a {% static %} <script> tag.
export { createClient, connectMatchStream } from "./client";
export type { MatchStream } from "./client";
export { wsMessage } from "./ws-messages";
export type {
  WSMessage,
  WSMatchResultUpdate,
  WSMatchGameLinkUpdate,
  WSPing,
} from "./ws-messages";
