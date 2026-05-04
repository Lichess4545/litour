"use client";

import type { CockpitMatchDTO, CockpitViewerDTO } from "@litour/api-client";

import { PairingExpandedSummary } from "./PairingExpandedSummary";
import { PairingRow } from "./PairingRow";
import { PairingTableHead } from "./PairingTableHead";

interface Props {
  matches: CockpitMatchDTO[];
  viewer: CockpitViewerDTO;
  isHistory: boolean;
  showFideNames: boolean;
  expandedPairingId: number | null;
  onToggleExpand: (id: number) => void;
  onOpenDrawer: (id: number) => void;
}

// DR3: when needs-you is empty in live mode, show muted italic
// "Caught up. Nothing needs you right now." — actual rendering of the
// empty case happens in CockpitHeader's count badge to keep the
// accomplishment quiet (DR3 explicitly: the silence IS the message).
export function AttentionList({
  matches,
  viewer,
  isHistory,
  showFideNames,
  expandedPairingId,
  onToggleExpand,
  onOpenDrawer,
}: Props) {
  if (matches.length === 0) {
    return null;
  }
  // Per DR7: act first, watch second — sort order, not color, conveys the
  // distinction.
  const sorted = [...matches].sort((a, b) => {
    if (a.attention.level === b.attention.level) return 0;
    if (a.attention.level === "act") return -1;
    if (b.attention.level === "act") return 1;
    return 0;
  });

  return (
    <section>
      <h2 className="text-muted-foreground mb-3 text-xs uppercase tracking-wide">
        Needs you <span className="text-foreground tabular-nums">{matches.length}</span>
      </h2>
      <table className="w-full">
        <PairingTableHead />
        <tbody>
          {sorted.map((m) => (
            <FragmentRow
              key={m.id}
              match={m}
              viewer={viewer}
              isHistory={isHistory}
              showFideNames={showFideNames}
              isExpanded={expandedPairingId === m.id}
              onToggle={() => onToggleExpand(m.id)}
              onOpenDrawer={() => onOpenDrawer(m.id)}
            />
          ))}
        </tbody>
      </table>
    </section>
  );
}

function FragmentRow(props: {
  match: CockpitMatchDTO;
  viewer: CockpitViewerDTO;
  isHistory: boolean;
  showFideNames: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  onOpenDrawer: () => void;
}) {
  return (
    <>
      <PairingRow
        match={props.match}
        showFideNames={props.showFideNames}
        isExpanded={props.isExpanded}
        isHistory={props.isHistory}
        onToggle={props.onToggle}
      />
      {props.isExpanded ? (
        <PairingExpandedSummary
          match={props.match}
          viewer={props.viewer}
          isHistory={props.isHistory}
          onOpenDrawer={props.onOpenDrawer}
        />
      ) : null}
    </>
  );
}
