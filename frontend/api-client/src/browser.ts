// Browser entry point: bundled to an IIFE that assigns these exports to
// `window.LitourApi`. Used by Django templates via a {% static %} <script> tag.
export { createClient } from "./client";
export { MultiplexClient } from "./multiplex";
export { wsMessage } from "./ws-messages";
export type {
  WSMessage,
  WSMatchUpdate,
  WSTeamMatchUpdate,
  WSPing,
} from "./ws-messages";
export {
  wsHomeMessage,
  wsEventMessage,
  eventCardDto,
  eventCardsPageDto,
  eventDetailDto,
  eventHeaderDto,
} from "./discovery-messages";
export type {
  StatusGroup,
  StatusLabel,
  Visibility,
  EventCardDTO,
  EventCardsPageDTO,
  EventHeaderDTO,
  EventDetailDTO,
  WSHomeMessage,
  WSEventMessage,
} from "./discovery-messages";
