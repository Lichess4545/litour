import { z } from "zod";

// Mirror of the discovery-domain DTOs in `heltour/api/discovery/schemas.py`.
// Hand-written so the WS payload is checked at runtime — generated types
// from openapi-typescript aren't zod schemas and the discovery WS routes
// are unprefixed (not in the OpenAPI doc anyway).

export const statusGroup = z.enum(["active", "upcoming", "awaiting", "completed"]);
export const statusLabel = z.enum([
  "Now playing",
  "Open",
  "Awaiting results",
  "Finished",
]);
export const visibility = z.enum(["public", "unlisted", "draft"]);

export const eventCardDto = z.object({
  name: z.string(),
  slug: z.string(),
  status_group: statusGroup,
  status_label: statusLabel,
  organizer_label: z.string(),
  organizer_tag: z.string(),
  format_line: z.string(),
  schedule_line: z.string(),
  slot_status: z.string(),
  registration_url: z.string(),
  visibility: visibility,
});

export const eventCardsPageDto = z.object({
  events: z.array(eventCardDto),
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
});

export const eventHeaderDto = eventCardDto.extend({
  registration_open: z.boolean(),
});

export const eventDetailDto = z.object({
  header: eventHeaderDto,
  tabs_available: z.array(z.string()),
  // The pairings payload reuses the round-management DTO shape verbatim;
  // we don't re-validate it here — it's forwarded to the existing
  // round-management views which own that shape.
  pairings: z.unknown().nullable(),
});

export const wsEventCardUpdate = z.object({
  type: z.literal("event.update"),
  slug: z.string(),
  card: eventCardDto,
});

export const wsEventDetailUpdate = z.object({
  type: z.literal("event.update"),
  slug: z.string(),
  detail: eventDetailDto,
});

export const wsEventRemoved = z.object({
  type: z.literal("event.removed"),
  slug: z.string(),
  reason: z.string(),
});

// Two discriminated unions — one per channel — because both channels use
// the same `event.update` discriminant but with different payload keys.
export const wsHomeMessage = z.union([wsEventCardUpdate, wsEventRemoved]);
export const wsEventMessage = z.union([wsEventDetailUpdate, wsEventRemoved]);

export type StatusGroup = z.infer<typeof statusGroup>;
export type StatusLabel = z.infer<typeof statusLabel>;
export type Visibility = z.infer<typeof visibility>;
export type EventCardDTO = z.infer<typeof eventCardDto>;
export type EventCardsPageDTO = z.infer<typeof eventCardsPageDto>;
export type EventHeaderDTO = z.infer<typeof eventHeaderDto>;
export type EventDetailDTO = z.infer<typeof eventDetailDto>;
export type WSHomeMessage = z.infer<typeof wsHomeMessage>;
export type WSEventMessage = z.infer<typeof wsEventMessage>;
