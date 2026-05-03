import { formatBoardScore, resultBg } from "@/lib/scores";

interface Props {
  score: number | null;
  oppScore: number | null;
}

// Single score cell, colored by win/loss/tie *from this player's perspective*.
// The two halves of a finished result share an outer link wrapper (see
// `ResultCells`) so the whole score block is one hover target.
export function ScorePill({ score, oppScore }: Props) {
  return (
    <span
      className={`flex items-center justify-center font-mono text-sm tabular-nums ${resultBg(
        score,
        oppScore,
      )}`}
    >
      {formatBoardScore(score)}
    </span>
  );
}
