import { z } from "zod";

// Mirror of cockpit DTOs in
// `heltour/api/round_management/cockpit/schemas.py`. Hand-written so the
// WS payload is parsed at runtime; openapi-typescript output isn't a zod
// schema. Field names match the Python DTOs verbatim.

export const cockpitMode = z.enum(["live", "pre_round", "history", "empty"]);

export const attentionLevel = z.enum(["none", "watch", "act"]);

export const attentionReason = z.enum([
  "no_schedule_near_deadline",
  "scheduled_but_not_started",
  "past_deadline_no_result",
]);

export const attentionDto = z.object({
  level: attentionLevel,
  reasons: z.array(attentionReason),
});

const matchDto = z.object({
  id: z.number().int(),
  white_username: z.string().nullable(),
  black_username: z.string().nullable(),
  white_fide_name: z.string().nullable(),
  black_fide_name: z.string().nullable(),
  white_rating: z.number().int().nullable(),
  black_rating: z.number().int().nullable(),
  white_gender: z.string().nullable(),
  black_gender: z.string().nullable(),
  white_is_captain: z.boolean(),
  black_is_captain: z.boolean(),
  result: z.string(),
  game_link: z.string(),
  board_number: z.number().int().nullable(),
  team_match_id: z.number().int().nullable(),
});

export const cockpitMatchDto = matchDto.extend({
  attention: attentionDto,
  scheduled_at: z.string().datetime({ offset: true }).nullable(),
  version: z.number().int(),
});

export const cockpitViewerDto = z.object({
  is_authenticated: z.boolean(),
  can_edit_pairings: z.boolean(),
  can_view_presence_log: z.boolean(),
  can_force_result: z.boolean(),
  can_mark_forfeit: z.boolean(),
  can_reschedule: z.boolean(),
});

export const cockpitAuditEntryDto = z.object({
  id: z.number().int(),
  intervention_type: z.enum(["force_result", "mark_forfeit", "reschedule"]),
  actor_username: z.string(),
  pairing_id: z.number().int(),
  before_summary: z.string(),
  after_summary: z.string(),
  reason: z.string(),
  created_at: z.string().datetime({ offset: true }),
});

const eventRoundDto = z.object({
  round_id: z.number().int(),
  round_number: z.number().int(),
  is_completed: z.boolean(),
  is_published: z.boolean(),
});

const eventSettingsDto = z.object({
  use_fide_information: z.boolean(),
});

const teamMatchDto = z.object({
  id: z.number().int(),
  pairing_order: z.number().int(),
  white_team_name: z.string(),
  white_team_number: z.number().int(),
  black_team_name: z.string().nullable(),
  black_team_number: z.number().int().nullable(),
  white_score: z.number(),
  black_score: z.number(),
  is_bye: z.boolean(),
});

export const cockpitDto = z.object({
  round_id: z.number().int(),
  round_number: z.number().int(),
  event_tag: z.string(),
  event_name: z.string(),
  league_tag: z.string(),
  is_completed: z.boolean(),
  is_team: z.boolean(),
  settings: eventSettingsDto,
  rounds: z.array(eventRoundDto),
  matches: z.array(cockpitMatchDto),
  team_matches: z.array(teamMatchDto),
  viewer: cockpitViewerDto,
  presence_events: z.record(z.string(), z.unknown()),
  mode: cockpitMode,
  needs_you_count: z.number().int(),
  last_event_id: z.number().int(),
  round_deadline: z.string().datetime({ offset: true }).nullable(),
});

export const wsCockpitMatchUpdate = z.object({
  type: z.literal("cockpit.match.update"),
  round_id: z.number().int(),
  match: cockpitMatchDto,
  needs_you_count: z.number().int(),
  last_event_id: z.number().int(),
});

export const wsCockpitClose = z.object({
  type: z.literal("cockpit.close"),
  reason: z.enum(["round_transition", "permission_revoked", "round_deleted"]),
});

export const wsCockpitMessage = z.discriminatedUnion("type", [
  wsCockpitMatchUpdate,
  wsCockpitClose,
]);

export type CockpitMode = z.infer<typeof cockpitMode>;
export type AttentionLevel = z.infer<typeof attentionLevel>;
export type AttentionReason = z.infer<typeof attentionReason>;
export type AttentionDTO = z.infer<typeof attentionDto>;
export type CockpitMatchDTO = z.infer<typeof cockpitMatchDto>;
export type CockpitViewerDTO = z.infer<typeof cockpitViewerDto>;
export type CockpitAuditEntryDTO = z.infer<typeof cockpitAuditEntryDto>;
export type CockpitDTO = z.infer<typeof cockpitDto>;
export type WSCockpitMatchUpdate = z.infer<typeof wsCockpitMatchUpdate>;
export type WSCockpitClose = z.infer<typeof wsCockpitClose>;
export type WSCockpitMessage = z.infer<typeof wsCockpitMessage>;
