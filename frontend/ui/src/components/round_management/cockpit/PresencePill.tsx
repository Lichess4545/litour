// DR6: rename "Open" presence (clashes with discovery's "Open" status)
// to Online | Offline | Idle. Today the cockpit doesn't yet receive a
// resolved presence from the API DTO; the pill renders "Unknown" until
// presence wiring lands. The component accepts the value so the wiring
// is one-line later.
type Presence = "online" | "offline" | "idle" | "unknown";

const LABELS: Record<Presence, string> = {
  online: "Online",
  offline: "Offline",
  idle: "Idle",
  unknown: "Unknown",
};

export function PresencePill({ presence = "unknown" }: { presence?: Presence }) {
  return (
    <span className="text-muted-foreground text-xs">
      Player presence: <span className="text-foreground">{LABELS[presence]}</span>
    </span>
  );
}
