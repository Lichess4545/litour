import type { components } from "@litour/api-client";

import { ColorDot } from "./ColorDot";
import { GenderBadge } from "./GenderBadge";
import { PlayerName } from "./PlayerName";

type EventSettings = components["schemas"]["EventSettingsDTO"];

interface Props {
  username: string | null;
  fideName: string | null;
  rating: number | null;
  gender: string | null;
  side: "left" | "right";
  pieceColor: "white" | "black";
  eventSettings: EventSettings;
}

// Symmetric player layout matching the legacy template:
//   left:  `[dot] <PlayerName trailing={gender, rating}>`
//   right: `<PlayerName trailing={gender, rating}> [dot]`
// `PlayerName` owns the FIDE-name vs lichess-only stacking; this component
// handles the row-level mirroring (dot side, alignment).
export function PlayerCell({
  username,
  fideName,
  rating,
  gender,
  side,
  pieceColor,
  eventSettings,
}: Props) {
  const trailing = (
    <>
      <GenderBadge gender={gender} />
      {rating != null ? (
        <span className="text-muted-foreground font-mono text-xs">({rating})</span>
      ) : null}
    </>
  );

  if (side === "left") {
    return (
      <div className="flex items-center gap-1.5 px-2 py-2 sm:gap-2 sm:px-3 sm:py-2.5">
        <ColorDot color={pieceColor} />
        <PlayerName
          username={username}
          fideName={fideName}
          showFideNames={eventSettings.use_fide_information}
          align="start"
          trailing={trailing}
        />
      </div>
    );
  }
  return (
    <div className="flex items-center justify-end gap-1.5 px-2 py-2 sm:gap-2 sm:px-3 sm:py-2.5">
      <PlayerName
        username={username}
        fideName={fideName}
        showFideNames={eventSettings.use_fide_information}
        align="end"
        trailing={trailing}
      />
      <ColorDot color={pieceColor} />
    </div>
  );
}
