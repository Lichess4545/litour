import type { AttentionReason } from "@litour/api-client";

// Concrete reasons, not vague labels (Pass 4 AI Slop check). Per DR4,
// chips use --muted background with --foreground text — no lichess-blue.
const LABELS: Record<AttentionReason, string> = {
  past_deadline_no_result: "Past deadline",
  scheduled_but_not_started: "No game started",
  no_schedule_near_deadline: "Unscheduled",
};

export function AttentionChip({ reason }: { reason: AttentionReason }) {
  return (
    <span className="bg-muted text-foreground rounded-sm px-2 py-0.5 text-xs">
      {LABELS[reason]}
    </span>
  );
}
