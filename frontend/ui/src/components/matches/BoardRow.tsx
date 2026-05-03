import type { components } from "@litour/api-client";

import { parseBoardScore } from "@/lib/scores";

import { PlayerCell } from "./PlayerCell";
import { ResultCells } from "./ResultCells";

type Match = components["schemas"]["MatchDTO"];
type EventSettings = components["schemas"]["EventSettingsDTO"];

interface Props {
  match: Match;
  // True for team mode (alternating piece colors by board, board# label).
  // False for lone (no flipping, no board label).
  teamMode: boolean;
  eventSettings: EventSettings;
}

// Renders into a 4-col subgrid:
//   [left player | left score | right score | right player]
// Symmetric — board number, when relevant, lives as a small corner label
// outside the grid columns rather than a leading column that breaks symmetry.
export function BoardRow({ match, teamMode, eventSettings }: Props) {
  const oriented = orientForCard(match, teamMode);

  // Team mode: put the board number inside both color markers (so each
  // side of the row visibly carries the board) instead of a separate
  // corner label.
  const boardLabel = teamMode ? match.board_number : null;

  return (
    <div className="col-span-full grid min-h-14 grid-cols-subgrid items-stretch text-sm">
      <PlayerCell
        username={oriented.left.username}
        fideName={oriented.left.fideName}
        rating={oriented.left.rating}
        gender={oriented.left.gender}
        isCaptain={oriented.left.isCaptain}
        pieceColor={oriented.left.pieceColor}
        boardLabel={boardLabel}
        side="left"
        eventSettings={eventSettings}
      />
      <ResultCells
        leftSide={oriented.left.score}
        rightSide={oriented.right.score}
        gameLink={match.game_link}
      />
      <PlayerCell
        username={oriented.right.username}
        fideName={oriented.right.fideName}
        rating={oriented.right.rating}
        gender={oriented.right.gender}
        isCaptain={oriented.right.isCaptain}
        pieceColor={oriented.right.pieceColor}
        boardLabel={boardLabel}
        side="right"
        eventSettings={eventSettings}
      />
    </div>
  );
}

interface OrientedSide {
  username: string | null;
  fideName: string | null;
  rating: number | null;
  gender: string | null;
  pieceColor: "white" | "black";
  score: number | null;
}

function orientForCard(
  match: Match,
  teamMode: boolean,
): { left: OrientedSide; right: OrientedSide } {
  const [whitePieceScore, blackPieceScore] = parseBoardScore(match.result);
  const board = match.board_number ?? 1;
  // Lone tournaments: no flipping — left = white pieces, right = black pieces.
  // Team tournaments: on even boards the white-team player holds black
  // pieces (and vice versa), so we swap which `MatchDTO` field feeds the
  // left side of the card.
  const leftHasWhitePieces = !teamMode || board % 2 === 1;
  if (leftHasWhitePieces) {
    return {
      left: {
        username: match.white_username,
        fideName: match.white_fide_name,
        rating: match.white_rating,
        gender: match.white_gender,
        pieceColor: "white",
        score: whitePieceScore,
      },
      right: {
        username: match.black_username,
        fideName: match.black_fide_name,
        rating: match.black_rating,
        gender: match.black_gender,
        pieceColor: "black",
        score: blackPieceScore,
      },
    };
  }
  return {
    left: {
      username: match.black_username,
      fideName: match.black_fide_name,
      rating: match.black_rating,
      gender: match.black_gender,
      pieceColor: "black",
      score: blackPieceScore,
    },
    right: {
      username: match.white_username,
      fideName: match.white_fide_name,
      rating: match.white_rating,
      gender: match.white_gender,
      pieceColor: "white",
      score: whitePieceScore,
    },
  };
}
