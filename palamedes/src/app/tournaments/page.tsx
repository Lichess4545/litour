import type { Metadata } from "next";
import Link from "next/link";
import { FORMAT_EXAMPLES } from "@/chess/formats";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { allLeaves } from "@/tournament/engine";

export const metadata: Metadata = {
  title: "Tournament formats",
  description: "Every chess tournament format as one recursive meta-model.",
};

export default function TournamentsPage() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="font-semibold text-2xl tracking-tight">
        Tournament formats
      </h1>
      <p className="mt-2 max-w-3xl text-muted-foreground text-sm">
        Every format below is plain data interpreted by one recursive model:
        competitions nest inside competitions, and encounters (game, series,
        match) nest freely inside pools. Open one to explore its structure —
        click any composite node to fold or unfold the recursion.
      </p>
      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FORMAT_EXAMPLES.map((format) => (
          <Link
            key={format.slug}
            href={`/tournaments/${format.slug}`}
            className="group focus-visible:outline-none"
          >
            <Card className="h-full transition-colors group-hover:border-foreground/30 group-focus-visible:ring-2 group-focus-visible:ring-ring">
              <CardHeader>
                <CardTitle className="text-base">{format.title}</CardTitle>
                <CardDescription>{format.blurb}</CardDescription>
                <p className="pt-1 text-muted-foreground text-xs">
                  {format.def.competitors.length} competitors ·{" "}
                  {allLeaves(format.def).length} competition
                  {allLeaves(format.def).length === 1 ? "" : "s"}
                </p>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </main>
  );
}
