"use client";

import type { CockpitMatchDTO } from "@litour/api-client";

import { PlayerName } from "@/components/round_management/PlayerName";

import { AttentionBadge } from "./AttentionBadge";
import { AttentionChip } from "./AttentionChip";

interface Props {
  match: CockpitMatchDTO;
  showFideNames: boolean;
  isExpanded: boolean;
  isHistory: boolean;
  onToggle: () => void;
}

// DR1 L1 collapsed row: Player1 (rating) | result | Player2 (rating) | board |
// scheduled | attention. Tabular density, no fills, no icons.
// DR2 history: row renders at 90% opacity to signal read-only.
// Uses the shared PlayerName component so FIDE-vs-lichess display matches
// the rest of the round_management surface.
export function PairingRow({ match, showFideNames, isExpanded, isHistory, onToggle }: Props) {
  const scheduled = match.scheduled_at
    ? new Date(match.scheduled_at).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "—";
  const resultDisplay = formatResult(match.result);

  return (
    <tr
      className={`border-border hover:bg-muted/30 cursor-pointer border-b ${
        isHistory ? "opacity-90" : ""
      }`}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
      tabIndex={0}
      aria-expanded={isExpanded}
    >
      <td className="text-muted-foreground px-3 py-3 text-center text-xs tabular-nums">
        {match.board_number ?? ""}
      </td>
      <td className="px-3 py-3 text-sm">
        <PlayerName
          username={match.white_username}
          fideName={match.white_fide_name}
          showFideNames={showFideNames}
          align="start"
          trailing={
            match.white_rating ? (
              <span className="text-muted-foreground text-xs tabular-nums">
                ({match.white_rating})
              </span>
            ) : null
          }
        />
      </td>
      <td className="px-3 py-3 text-center font-medium tabular-nums">{resultDisplay}</td>
      <td className="px-3 py-3 text-sm">
        <PlayerName
          username={match.black_username}
          fideName={match.black_fide_name}
          showFideNames={showFideNames}
          align="end"
          trailing={
            match.black_rating ? (
              <span className="text-muted-foreground text-xs tabular-nums">
                ({match.black_rating})
              </span>
            ) : null
          }
        />
      </td>
      <td className="text-muted-foreground px-3 py-3 text-sm tabular-nums">{scheduled}</td>
      <td className="px-3 py-3 text-right">
        {match.attention.reasons.length > 0 ? (
          <span className="inline-flex flex-wrap justify-end gap-1">
            {match.attention.reasons.map((r) => (
              <AttentionChip key={r} reason={r} />
            ))}
          </span>
        ) : (
          <AttentionBadge level={match.attention.level} />
        )}
      </td>
    </tr>
  );
}

// Mirror the legacy `result_display`: ½ for halves, * for color-reversed,
// dash for unset.
function formatResult(raw: string): string {
  if (!raw) return "—";
  return raw.replace(/1\/2/g, "½");
}
