export function parseBoardScore(result: string): [number | null, number | null] {
  if (!result) return [null, null];
  const r = result.trim();
  if (r === "1-0") return [1, 0];
  if (r === "0-1") return [0, 1];
  if (r === "1/2-1/2") return [0.5, 0.5];
  if (r === "1X-0F" || r === "1X-0") return [1, 0];
  if (r === "0F-1X" || r === "0-1X") return [0, 1];
  if (r === "0F-0F") return [0, 0];
  return [null, null];
}

export function formatBoardScore(s: number | null): string {
  if (s == null) return "";
  if (s === 0.5) return "½";
  return String(s);
}

export function formatTeamScore(score: number): string {
  return Number.isInteger(score)
    ? String(score)
    : score.toFixed(1).replace(".5", "½");
}

// CSS-variable backed tints (see `app/globals.css`) so light/dark mode are
// theme-aware while staying pixel-identical to the legacy `_common.scss`
// palette in light mode.
export function resultBg(score: number | null, opp: number | null): string {
  if (score == null || opp == null) return "";
  if (score > opp) return "bg-result-win";
  if (score < opp) return "bg-result-loss";
  return "bg-result-tie";
}
