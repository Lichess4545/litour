import type { BoardSide } from "@/lib/scores";
import { resultBg } from "@/lib/scores";

interface Props {
  side: BoardSide;
  oppSide: BoardSide;
}

// Single score cell, colored by win/loss/tie *from this player's perspective*.
// The two halves of a finished result share an outer link wrapper (see
// `ResultCells`) so the whole score block is one hover target.
export function ScorePill({ side, oppSide }: Props) {
  return (
    <span
      className={`flex items-center justify-center font-mono text-sm tabular-nums ${resultBg(
        side.points,
        oppSide.points,
      )}`}
    >
      {side.display}
    </span>
  );
}
