"use client";

import type { CockpitMatchDTO, CockpitViewerDTO } from "@litour/api-client";

import { Button } from "@/components/ui/button";

import { AttentionChip } from "./AttentionChip";
import { PresencePill } from "./PresencePill";

interface Props {
  match: CockpitMatchDTO;
  viewer: CockpitViewerDTO;
  isHistory: boolean;
  onOpenDrawer: () => void;
}

// DR1 L2: inline expansion that follows the collapsed row. Reveals
// "Why this needs you" chips, presence, three quiet ghost buttons (DR6
// consistency rule), and a link to L3 drawer for deeper detail.
// DR2: history mode hides intervention buttons here too.
export function PairingExpandedSummary({ match, viewer, isHistory, onOpenDrawer }: Props) {
  return (
    <tr className="bg-muted/30">
      <td colSpan={6} className="px-6 py-4">
        <div className="space-y-3">
          {match.attention.reasons.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground text-xs uppercase tracking-wide">
                Why this needs you
              </span>
              {match.attention.reasons.map((r) => (
                <AttentionChip key={r} reason={r} />
              ))}
            </div>
          ) : null}
          <PresencePill />
          <div className="flex flex-wrap items-center gap-2">
            {!isHistory && viewer.can_force_result ? (
              <Button variant="ghost" size="sm" onClick={onOpenDrawer}>
                Force result
              </Button>
            ) : null}
            {!isHistory && viewer.can_mark_forfeit ? (
              <Button variant="ghost" size="sm" onClick={onOpenDrawer}>
                Mark forfeit
              </Button>
            ) : null}
            {!isHistory && viewer.can_reschedule ? (
              <Button variant="ghost" size="sm" onClick={onOpenDrawer}>
                Reschedule
              </Button>
            ) : null}
            <button
              type="button"
              onClick={onOpenDrawer}
              className="text-muted-foreground hover:text-foreground text-sm underline-offset-4 hover:underline"
            >
              Open detail →
            </button>
          </div>
        </div>
      </td>
    </tr>
  );
}
