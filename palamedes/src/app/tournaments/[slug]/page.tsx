import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TournamentFlow } from "@/components/tournament/tournament-flow";
import { FORMAT_EXAMPLES } from "@/tournament/formats";

// The slug universe is a closed compile-time set; 404 unknown ones without
// rendering.
export const dynamicParams = false;

export function generateStaticParams() {
  return FORMAT_EXAMPLES.map((format) => ({ slug: format.slug }));
}

export async function generateMetadata(
  props: PageProps<"/tournaments/[slug]">,
): Promise<Metadata> {
  const { slug } = await props.params;
  const format = FORMAT_EXAMPLES.find((f) => f.slug === slug);
  return format === undefined
    ? { title: "Tournament" }
    : { title: format.title, description: format.blurb };
}

export default async function TournamentPage(
  props: PageProps<"/tournaments/[slug]">,
) {
  const { slug } = await props.params;
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
        {/* Keyed by slug: the collapse state inside is meaningful only for this def. */}
        <TournamentFlow key={format.slug} def={format.def} />
      </div>
    </main>
  );
}
