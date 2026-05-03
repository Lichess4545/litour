import { Swords } from "lucide-react";

import { ScorePill } from "./ScorePill";

interface Props {
  // Already oriented for the row — the score for the player on the left/
  // right side of *this card*, not necessarily the chess white/black.
  leftScore: number | null;
  rightScore: number | null;
  gameLink: string;
}

// Renders the two centre cells of a `BoardRow`. Designed to live inside a
// 5-col subgrid: the wrapper anchor (when present) spans columns 3-4 and
// itself uses `grid-cols-subgrid` so the two `ScorePill`s align with the
// header's score columns. For in-progress / pending states the centre is
// merged with `col-span-2`.
export function ResultCells({ leftScore, rightScore, gameLink }: Props) {
  const finished = leftScore != null && rightScore != null;
  const inProgress = !finished && Boolean(gameLink);

  if (finished) {
    const inner = (
      <>
        <ScorePill score={leftScore} oppScore={rightScore} />
        <ScorePill score={rightScore} oppScore={leftScore} />
      </>
    );
    if (gameLink) {
      return (
        <a
          href={gameLink}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Open finished game on lichess"
          className="col-span-2 grid grid-cols-subgrid hover:opacity-90"
        >
          {inner}
        </a>
      );
    }
    return inner;
  }

  if (inProgress) {
    return (
      <a
        href={gameLink}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Open live game on lichess"
        className="text-muted-foreground hover:bg-muted/50 hover:text-foreground col-span-2 flex items-center justify-center"
      >
        <Swords className="size-4" />
      </a>
    );
  }

  return (
    <span className="text-muted-foreground col-span-2 flex items-center justify-center text-sm">
      —
    </span>
  );
}
