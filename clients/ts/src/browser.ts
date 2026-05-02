// Browser entry point: bundled to an IIFE that assigns these exports to
// `window.LitourApi`. Used by Django templates via a {% static %} <script> tag.
export { createClient, connectPairingStream } from "./client";
export type { PairingStream } from "./client";
export { wsMessage } from "./ws-messages";
export type {
  WSMessage,
  WSPairingResultUpdate,
  WSPairingGameLinkUpdate,
  WSPing,
} from "./ws-messages";
