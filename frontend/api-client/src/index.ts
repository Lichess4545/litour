export {
  createClient,
  connectMatchStream,
  connectDiscoveryHomeStream,
  connectDiscoveryEventStream,
} from "./client";
export type { MatchStream, DiscoveryStream } from "./client";
export type {
  WSMessage,
  WSMatchUpdate,
  WSTeamMatchUpdate,
  WSPing,
} from "./ws-messages";
export { wsMessage } from "./ws-messages";
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
export type { paths, components } from "./generated";
