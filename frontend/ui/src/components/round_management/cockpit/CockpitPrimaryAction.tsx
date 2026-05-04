"use client";

import type { CockpitDTO, CockpitPrimaryActionDTO } from "@litour/api-client";
import Link from "next/link";
import { useState } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import {
  ConfirmActionDialog,
  GeneratePairingsDialog,
  StartRoundDialog,
} from "./RoundActionDialogs";

// State-aware primary CTA shown next to the round selector. Action kind
// is computed server-side (cockpit/service.py::_primary_action) so the
// UI always renders exactly one next-action.  Each kind maps to either:
//   * a confirmation/form dialog (generate-pairings, start-round, close-*)
//   * a one-click POST (advance / finalize / generate-next-match-set / create-missing-matches)
//   * an external link (review-nominations, pre-round-report secondary)
export function CockpitPrimaryAction({
  action,
  dto,
  apiBaseUrl,
  eventSlug,
}: {
  action: CockpitPrimaryActionDTO;
  dto: CockpitDTO;
  apiBaseUrl: string;
  eventSlug: string;
}) {
  const [openDialog, setOpenDialog] = useState<
    | "generate-pairings"
    | "start-round"
    | "close-round"
    | "close-season"
    | "advance"
    | "finalize"
    | "next-match-set"
    | "create-missing"
    | null
  >(null);
  function onPrimaryClick(e: React.MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    switch (action.kind) {
      case "generate_pairings":
        setOpenDialog("generate-pairings");
        return;
      case "start_round":
        setOpenDialog("start-round");
        return;
      case "close_round":
        setOpenDialog("close-round");
        return;
      case "close_season":
        setOpenDialog("close-season");
        return;
      case "advance_tournament":
        setOpenDialog("advance");
        return;
      case "finalize_tournament":
        setOpenDialog("finalize");
        return;
      case "generate_next_match_set":
        setOpenDialog("next-match-set");
        return;
      case "create_missing_matches":
        setOpenDialog("create-missing");
        return;
      // pre_round_report / review_nominations fall through and the
      // outer Link path renders a real navigation link instead.
      default:
        return;
    }
  }

  // Pre-round report and review-nominations are read-only navigations.
  const isLink = action.kind === "review_nominations" || action.kind === "pre_round_report";

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {action.secondary_href && action.secondary_label ? (
          <Link
            href={action.secondary_href}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          >
            {action.secondary_label}
          </Link>
        ) : null}
        {isLink ? (
          <Link
            href={action.href}
            className={cn(buttonVariants({ variant: "default", size: "default" }))}
          >
            {action.label}
            <span aria-hidden>→</span>
          </Link>
        ) : (
          <Button onClick={onPrimaryClick} variant="default" size="default">
            {action.label}
            <span aria-hidden>→</span>
          </Button>
        )}
      </div>

      <GeneratePairingsDialog
        open={openDialog === "generate-pairings"}
        onClose={() => setOpenDialog(null)}
        apiBaseUrl={apiBaseUrl}
        eventSlug={eventSlug}
        roundNumber={extractRoundNumber(action.label)}
      />

      <StartRoundDialog
        open={openDialog === "start-round"}
        onClose={() => setOpenDialog(null)}
        apiBaseUrl={apiBaseUrl}
        eventSlug={eventSlug}
        roundNumber={extractRoundNumber(action.label)}
        isTeamLeague={dto.management?.is_team_league ?? false}
      />

      <ConfirmActionDialog
        open={openDialog === "close-round"}
        onClose={() => setOpenDialog(null)}
        apiBaseUrl={apiBaseUrl}
        eventSlug={eventSlug}
        action="close-round"
        title={action.label}
        body="Mark this round complete. Players will see the round as finished, and unfinished games are recorded as-is."
        confirmLabel="Close round"
      />

      <ConfirmActionDialog
        open={openDialog === "close-season"}
        onClose={() => setOpenDialog(null)}
        apiBaseUrl={apiBaseUrl}
        eventSlug={eventSlug}
        action="close-season"
        title="Close season"
        body="Mark this season complete. The standings page becomes the final result."
        confirmLabel="Close season"
        destructive
      />

      <ConfirmActionDialog
        open={openDialog === "advance"}
        onClose={() => setOpenDialog(null)}
        apiBaseUrl={apiBaseUrl}
        eventSlug={eventSlug}
        action="advance-tournament"
        title="Advance tournament"
        body="Create the next round from the winners of the last completed round."
        confirmLabel="Advance"
      />

      <ConfirmActionDialog
        open={openDialog === "finalize"}
        onClose={() => setOpenDialog(null)}
        apiBaseUrl={apiBaseUrl}
        eventSlug={eventSlug}
        action="finalize-tournament"
        title="Finalize tournament"
        body="Mark this knockout tournament complete. The bracket becomes the final result."
        confirmLabel="Finalize"
        destructive
      />

      <ConfirmActionDialog
        open={openDialog === "next-match-set"}
        onClose={() => setOpenDialog(null)}
        apiBaseUrl={apiBaseUrl}
        eventSlug={eventSlug}
        action="generate-next-match-set"
        title="Generate next match set"
        body="Create the next match in this multi-match knockout stage. Colours alternate from the previous match."
        confirmLabel="Generate"
      />

      <ConfirmActionDialog
        open={openDialog === "create-missing"}
        onClose={() => setOpenDialog(null)}
        apiBaseUrl={apiBaseUrl}
        eventSlug={eventSlug}
        action="create-missing-matches"
        title="Create missing matches"
        body="Create the initial match set for this knockout stage."
        confirmLabel="Create"
      />
    </>
  );
}

function extractRoundNumber(label: string): number | undefined {
  const match = label.match(/Round\s+(\d+)/i);
  return match ? Number(match[1]) : undefined;
}
