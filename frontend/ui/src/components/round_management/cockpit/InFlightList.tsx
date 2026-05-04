"use client";

import { useState } from "react";

import type { CockpitMatchDTO, CockpitViewerDTO } from "@litour/api-client";

import { PairingExpandedSummary } from "./PairingExpandedSummary";
import { PairingRow } from "./PairingRow";
import { PairingTableHead } from "./PairingTableHead";

interface Props {
  // Section heading — DR5 binds to DESIGN.md status terms ("Awaiting results"
  // for ongoing/scheduled-without-result, "Finished" for completed pairings).
  label: string;
  matches: CockpitMatchDTO[];
  viewer: CockpitViewerDTO;
  isHistory: boolean;
  showFideNames: boolean;
  // Whether to render this section collapsed by default. "Awaiting results"
  // is the active mid-round state — keep it open. "Finished" is the
  // accomplishment state — collapsed (anchored mockup pattern).
  defaultOpen?: boolean;
  expandedPairingId: number | null;
  onToggleExpand: (id: number) => void;
  onOpenDrawer: (id: number) => void;
}

export function InFlightList({
  label,
  matches,
  viewer,
  isHistory,
  showFideNames,
  defaultOpen = false,
  expandedPairingId,
  onToggleExpand,
  onOpenDrawer,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);

  if (matches.length === 0) {
    return null;
  }

  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="text-muted-foreground hover:text-foreground mb-3 flex w-full items-center justify-between text-xs uppercase tracking-wide"
        aria-expanded={open}
      >
        <span>
          {label} <span className="text-foreground tabular-nums">{matches.length}</span>
        </span>
        <span aria-hidden>{open ? "▴" : "▾"}</span>
      </button>
      {open ? (
        <table className="w-full">
          <PairingTableHead />
          <tbody>
            {matches.map((m) => (
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
      ) : (
        <p className="text-muted-foreground text-sm tabular-nums">
          {matches.length} pairing{matches.length === 1 ? "" : "s"}
        </p>
      )}
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
