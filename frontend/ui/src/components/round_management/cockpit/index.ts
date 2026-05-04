// Cockpit components — running-the-tournament surface inside
// `round_management`. Per design doc DR5/DR6 + the four-layer rule
// (shadcn → primitive → domain → page), these compose primitives + UI
// elements; consistency rules in the design doc make every drawer/L2
// button use the same shadcn ghost variant, every divider the same
// hairline, every count tabular-nums.
export { AttentionBadge } from "./AttentionBadge";
export { AttentionChip } from "./AttentionChip";
export { AttentionList } from "./AttentionList";
export { AuditTrailList } from "./AuditTrailList";
export { CockpitHeader } from "./CockpitHeader";
export { CockpitRoundSelector } from "./CockpitRoundSelector";
export { InFlightList } from "./InFlightList";
export { ModeBanner } from "./ModeBanner";
export { PairingDetailDrawer } from "./PairingDetailDrawer";
export { PairingExpandedSummary } from "./PairingExpandedSummary";
export { PairingRow } from "./PairingRow";
export { PairingTableHead } from "./PairingTableHead";
export { PresencePill } from "./PresencePill";
