import type { CockpitMode } from "@litour/api-client";

// DR2: pre_round / empty / history-without-data treatments. Each is its
// own deliberate visual moment, not a generic "no data" state.
//
// `hasPrimaryAction` suppresses the call-to-action link in pre_round
// when the round-scoped header CTA already points at the right next
// step ("Generate Pairings · Round N", "Start Round N"). Otherwise we'd
// be telling the user to fix the page from the page itself.
//
// External links use plain `<a>` because Next's `<Link>` prepends the
// app's basePath (`/v2`) to path-only hrefs — turning `/admin/...` into
// `/v2/admin/...` and 404'ing on the way to Django admin.
export function ModeBanner({
  mode,
  eventSlug,
  hasPrimaryAction = false,
}: {
  mode: CockpitMode;
  eventSlug: string;
  hasPrimaryAction?: boolean;
}) {
  if (mode === "pre_round") {
    return (
      <div className="text-foreground mt-12 space-y-3 py-12 text-center">
        <p className="font-display text-2xl">No round in flight.</p>
        <p className="text-muted-foreground text-sm">
          The next round will appear here when it opens.
        </p>
        {hasPrimaryAction ? null : (
          <p>
            <a
              href={`/admin/tournament/round/?season__slug__exact=${encodeURIComponent(eventSlug)}`}
              className="text-muted-foreground hover:text-foreground text-sm underline-offset-4 hover:underline"
            >
              Set up next round →
            </a>
          </p>
        )}
      </div>
    );
  }
  if (mode === "empty") {
    return (
      <div className="text-foreground mt-12 space-y-4 py-16 text-center">
        <p className="font-display text-4xl italic">No rounds yet.</p>
        <p className="text-muted-foreground text-sm">Configure your first round in event setup.</p>
        <p>
          <a
            href={`/admin/tournament/round/?season__slug__exact=${encodeURIComponent(eventSlug)}`}
            className="text-muted-foreground hover:text-foreground inline-block border-b text-sm"
          >
            Open event setup →
          </a>
        </p>
      </div>
    );
  }
  return null;
}
