import { z } from "zod";

// Mirror of BackgroundJobDTO in
// heltour/api/shared/jobs_routes.py + the dict shape produced by
// `_job_to_dict` in heltour/api/shared/jobs.py.

export const jobStatus = z.enum(["queued", "running", "ok", "warning", "failed"]);
export const jobSource = z.enum(["manual", "scheduled", "system"]);

export const backgroundJobDto = z.object({
  id: z.number().int(),
  kind: z.string(),
  status: jobStatus,
  source: jobSource,
  title: z.string(),
  description: z.string(),
  progress: z.number().int().nullable(),
  progress_message: z.string(),
  result: z.record(z.string(), z.unknown()),
  error_message: z.string(),
  triggered_by_username: z.string().nullable(),
  season_id: z.number().int().nullable(),
  season_slug: z.string().nullable(),
  league_tag: z.string().nullable(),
  created_at: z.string().nullable(),
  started_at: z.string().nullable(),
  completed_at: z.string().nullable(),
});

export const wsJobEvent = z.object({
  type: z.enum(["job.created", "job.started", "job.progress", "job.completed"]),
  job: backgroundJobDto,
});

// Lag-only WS message — pushed by `/ws/jobs/lag` every time the canary
// records a sample. Same shape as the REST `/v1/jobs/lag` snapshot
// plus a `type` discriminator.
export const wsJobLag = z.object({
  type: z.literal("queue_lag"),
  samples: z.number().int(),
  queue_lag_latest: z.number().nullable(),
  queue_lag_avg: z.number().nullable(),
  queue_lag_stddev: z.number().nullable(),
  queue_lag_p95: z.number().nullable(),
  queue_lag_max: z.number().nullable(),
  last_observed_at: z.string().nullable(),
});

// Hourly (or coarser) rolled-up lag buckets for the popover sparkline.
// Mirrors `JobLagHistoryDTO` in `heltour/api/shared/jobs_routes.py`.
export const jobLagHistoryPoint = z.object({
  bucket_start: z.string(),
  queue_lag_mean: z.number(),
  queue_lag_p95: z.number(),
  queue_lag_max: z.number(),
  sample_count: z.number().int(),
});

export const jobLagHistoryDto = z.object({
  granularity: z.enum(["hour", "day", "week", "month", "year"]),
  points: z.array(jobLagHistoryPoint),
});

export type JobStatus = z.infer<typeof jobStatus>;
export type JobSource = z.infer<typeof jobSource>;
export type BackgroundJobDTO = z.infer<typeof backgroundJobDto>;
export type WSJobEvent = z.infer<typeof wsJobEvent>;
export type WSJobLag = z.infer<typeof wsJobLag>;
export type JobLagHistoryPoint = z.infer<typeof jobLagHistoryPoint>;
export type JobLagHistoryDTO = z.infer<typeof jobLagHistoryDto>;
