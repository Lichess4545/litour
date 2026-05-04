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

export type JobStatus = z.infer<typeof jobStatus>;
export type JobSource = z.infer<typeof jobSource>;
export type BackgroundJobDTO = z.infer<typeof backgroundJobDto>;
export type WSJobEvent = z.infer<typeof wsJobEvent>;
