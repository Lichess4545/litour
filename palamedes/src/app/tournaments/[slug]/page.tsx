import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TournamentFlow } from "@/components/tournament/tournament-flow";
import { FORMAT_EXAMPLES } from "@/tournament/formats";

export function generateStaticParams() {
  return FORMAT_EXAMPLES.map((format) => ({ slug: format.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const format = FORMAT_EXAMPLES.find((f) => f.slug === slug);
  return { title: format === undefined ? "Tournament" : format.title };
}

export default async function TournamentPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const format = FORMAT_EXAMPLES.find((f) => f.slug === slug);
  if (format === undefined) notFound();

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
          <h1 className="font-semibold text-lg tracking-tight">
            {format.title}
          </h1>
          <p className="text-muted-foreground text-sm">{format.blurb}</p>
        </div>
      </header>
      <div className="min-h-0 flex-1">
        <TournamentFlow def={format.def} />
      </div>
    </main>
  );
}
