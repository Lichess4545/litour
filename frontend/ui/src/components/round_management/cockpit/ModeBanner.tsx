import Link from "next/link";

import type { CockpitMode } from "@litour/api-client";

// DR2: pre_round / empty / history-without-data treatments. Each is its
// own deliberate visual moment, not a generic "no data" state.
export function ModeBanner({
  mode,
  eventSlug,
}: {
  mode: CockpitMode;
  eventSlug: string;
}) {
  if (mode === "pre_round") {
    return (
      <div className="text-foreground mt-12 space-y-3 py-12 text-center">
        <p className="font-display text-2xl">No round in flight.</p>
        <p className="text-muted-foreground text-sm">
          The next round will appear here when it opens.
        </p>
        <p>
          <Link
            href={`/admin/tournament/round/?season__slug__exact=${encodeURIComponent(eventSlug)}`}
            className="text-muted-foreground hover:text-foreground text-sm underline-offset-4 hover:underline"
          >
            Set up next round →
          </Link>
        </p>
      </div>
    );
  }
  if (mode === "empty") {
    return (
      <div className="text-foreground mt-12 space-y-4 py-16 text-center">
        <p className="font-display text-4xl italic">No rounds yet.</p>
        <p className="text-muted-foreground text-sm">Configure your first round in event setup.</p>
        <p>
          <Link
            href={`/admin/tournament/round/?season__slug__exact=${encodeURIComponent(eventSlug)}`}
            className="text-muted-foreground hover:text-foreground inline-block border-b text-sm"
          >
            Open event setup →
          </Link>
        </p>
      </div>
    );
  }
  return null;
}
