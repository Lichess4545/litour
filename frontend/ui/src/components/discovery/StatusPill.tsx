import type { StatusGroup, StatusLabel } from "@litour/api-client";

interface Props {
  group: StatusGroup;
  label: StatusLabel;
}

// 12-13px Geist Medium uppercase tracking-wide per DESIGN.md.
// "Now playing" is the only place lichess-blue (status-active) appears
// in pill chrome — Open and Finished use neutral palette.
export function StatusPill({ group, label }: Props) {
  const tone = TONE[group];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium uppercase tracking-wide ${tone}`}
    >
      {group === "active" ? <LiveDot /> : null}
      {label}
    </span>
  );
}

const TONE: Record<StatusGroup, string> = {
  active: "border-[var(--status-active)] text-[var(--status-active)] bg-transparent",
  upcoming: "border-border text-foreground bg-transparent",
  awaiting: "border-border text-foreground bg-muted",
  completed: "border-border text-muted-foreground bg-muted",
};

function LiveDot() {
  return (
    <span
      aria-hidden
      className="inline-block size-1.5 rounded-full bg-[var(--status-active)]"
    />
  );
}
