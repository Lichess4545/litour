import type { AttentionLevel } from "@litour/api-client";

// DR4: pairing-row status pills are text-only — no lichess-blue fill or
// border. DR7: status communication never relies on color alone.
const LABELS: Record<AttentionLevel, string> = {
  act: "Past deadline",
  watch: "Needs attention",
  none: "On track",
};

export function AttentionBadge({ level }: { level: AttentionLevel }) {
  if (level === "none") return null;
  return (
    <span className="text-foreground text-xs font-medium uppercase tracking-wide">
      {LABELS[level]}
    </span>
  );
}
