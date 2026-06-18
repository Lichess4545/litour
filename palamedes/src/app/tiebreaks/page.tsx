import type { Metadata } from "next";
import Link from "next/link";
import { chessRegistry } from "@/chess/registry";
import { TiebreaksFlow } from "@/components/tournament/tournament-flow";
import { concretifyTiebreaks } from "@/tournament/concrete";
import type { MetricRef } from "@/tournament/core";

export const metadata: Metadata = {
  title: "Tiebreaks",
  description:
    "Every tiebreak by itself — a fan-out/fan-in computation you can zoom into.",
};

/**
 * The tiebreaks to show, each with a representative ref. Same refs a format's
 * standings would carry; here they stand alone so the formulas can be studied
 * without a tournament around them. Buchholz appears twice to show the cut.
 */
const TIEBREAK_REFS: readonly MetricRef[] = [
  { metric: "sonnebornBerger" },
  { metric: "buchholz" },
  { metric: "buchholz", cut: 1 },
  { metric: "medianBuchholz" },
  { metric: "extendedSB", opponentTotal: "standings", scored: "standings" },
  { metric: "headToHead" },
  { metric: "cumulative" },
  { metric: "encounterPoints" },
  { metric: "gamesWon" },
  { metric: "matchWins" },
  { metric: "boardPoints", board: 1 },
  { metric: "gamesWithBlack" },
];

export default function TiebreaksPage() {
  // Pure, deterministic registry work — safe at build time; only the
  // interactive canvas over the result is client-side.
  const tiebreaks = concretifyTiebreaks(TIEBREAK_REFS, chessRegistry);

  return (
    <main className="flex h-dvh flex-col">
      <header className="border-b px-6 py-4">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <Link
            href="/tournaments"
            className="text-muted-foreground text-sm hover:text-foreground"
          >
            ← all formats
          </Link>
          <h1 className="font-semibold text-lg tracking-tight">Tiebreaks</h1>
          <p className="text-muted-foreground text-sm">
            Each tiebreak on its own — click any to zoom into how it is
            computed.
          </p>
        </div>
      </header>
      <div className="min-h-0 flex-1">
        <TiebreaksFlow tiebreaks={tiebreaks} />
      </div>
    </main>
  );
}
