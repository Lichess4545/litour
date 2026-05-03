import { eventCardsPageDto } from "@litour/api-client";

import { serverApiBaseUrl, serverClient } from "@/lib/api";
import { publicApiBaseUrl } from "@/lib/api-public";

import { HomeLive } from "./HomeLive";

// Discovery home — `/v2/`. Server-fetches the initial event list (so SEO
// + first paint don't depend on JS), hands it to a client component that
// connects the `events:home` WS for real-time card updates.
export default async function HomePage() {
  const client = await serverClient();
  const { data, error } = await client.GET("/v1/discovery/events", {
    params: { query: {} },
  });

  if (error || !data) {
    throw new Error(`Failed to fetch discovery events: ${error ?? "unknown"}`);
  }

  // Re-validate the SSR response shape so a backend regression surfaces
  // here, not as a runtime crash inside the client tree. The generated
  // OpenAPI types may lag the Pydantic DTOs until the next regen.
  const initial = eventCardsPageDto.parse(data);
  // SSR can't read NEXT_PUBLIC_* at build time of the static client
  // bundle if the server URL differs, so we hand the browser the public
  // URL via prop. (Mirrors the pattern in [leagueTag]/.../matches.)
  void serverApiBaseUrl();
  const apiBaseUrl = publicApiBaseUrl();

  return <HomeLive initial={initial} apiBaseUrl={apiBaseUrl} />;
}
