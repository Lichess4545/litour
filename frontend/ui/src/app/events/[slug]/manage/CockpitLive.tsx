"use client";

import {
  type CockpitDTO,
  type CockpitMatchDTO,
  type WSCockpitMessage,
  type WSJobLag,
  connectCockpitStream,
  connectJobsLagStream,
} from "@litour/api-client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import {
  AttentionList,
  CockpitHeader,
  CockpitStatusStrip,
  CockpitToolbar,
  InFlightList,
  ModeBanner,
  PairingDetailDrawer,
  ToasterProvider,
} from "@/components/round_management/cockpit";

interface Props {
  initial: CockpitDTO;
  initialLag: WSJobLag | null;
  apiBaseUrl: string;
  eventSlug: string;
}

export function CockpitLive(props: Props) {
  return (
    <ToasterProvider>
      <CockpitLiveInner {...props} />
    </ToasterProvider>
  );
}

function CockpitLiveInner({ initial, initialLag, apiBaseUrl, eventSlug }: Props) {
  const router = useRouter();
  const [dto, setDto] = useState<CockpitDTO>(initial);
  // L3 drawer: which pairing is open. null = closed.
  const [openPairingId, setOpenPairingId] = useState<number | null>(null);
  // L2 expanded: which row is showing inline summary.
  const [expandedPairingId, setExpandedPairingId] = useState<number | null>(null);
  // Stale-banner: which pairing the open drawer was anchored on, for the
  // version-mismatch banner per design doc Real-time strategy section.
  const [staleBannerForPairing, setStaleBannerForPairing] = useState<number | null>(null);
  // Latest queue-lag snapshot from the canary. Hydrated server-side so
  // the footer chip renders real numbers on first paint; the WS stream
  // patches it every ~5s thereafter.
  const [lagSnapshot, setLagSnapshot] = useState<WSJobLag | null>(initialLag);

  useEffect(() => {
    // CLAUDE.md rule 6: every page is real-time. Open the cockpit WS in
    // every mode that has a resolvable round (live / pre_round / history);
    // `empty` has nothing for the WS to subscribe to and the server will
    // close 1008 — the client tolerates that gracefully.
    if (initial.mode === "empty") {
      return;
    }

    const stream = connectCockpitStream(
      apiBaseUrl,
      eventSlug,
      (msg: WSCockpitMessage) => {
        if (msg.type === "cockpit.match.update") {
          setDto((prev) => mergeMatch(prev, msg.match, msg.needs_you_count, msg.last_event_id));
          // If the open drawer was anchored on this pairing and version changed,
          // surface the stale-banner. The drawer reads from dto, so the check
          // can use the current state directly via the merged callback below.
          setStaleBannerForPairing((prevStale) => {
            if (openPairingId === msg.match.id) {
              const before = dto.matches.find((m) => m.id === msg.match.id);
              if (before && before.version !== msg.match.version) {
                return msg.match.id;
              }
            }
            return prevStale;
          });
        } else if (msg.type === "cockpit.close") {
          if (msg.reason === "permission_revoked") {
            router.replace(`/events/${encodeURIComponent(eventSlug)}/`);
          } else {
            // Round transition / round deleted: refetch to pick up the new
            // mode (history / pre_round / empty).
            router.refresh();
          }
        }
      },
      (err: unknown) => {
        console.error("cockpit stream error", err);
      },
    );
    return () => stream.close();
  }, [apiBaseUrl, eventSlug, initial.mode, router, openPairingId, dto.matches]);

  // Queue-health canary stream — opens on every mode (incl. pre_round /
  // history / empty) so the footer chip is live regardless of round
  // state. Independent of the cockpit WS lifecycle on purpose.
  useEffect(() => {
    const stream = connectJobsLagStream(
      apiBaseUrl,
      (msg) => setLagSnapshot(msg),
      (err) => console.error("lag stream error", err),
    );
    return () => stream.close();
  }, [apiBaseUrl]);

  const openPairing = openPairingId
    ? (dto.matches.find((m) => m.id === openPairingId) ?? null)
    : null;

  if (dto.mode !== "live" && dto.mode !== "history") {
    return (
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
        <CockpitHeader dto={dto} eventSlug={eventSlug} apiBaseUrl={apiBaseUrl} />
        {dto.management ? (
          <div className="mt-8">
            <CockpitToolbar
              management={dto.management}
              apiBaseUrl={apiBaseUrl}
              eventSlug={eventSlug}
            />
          </div>
        ) : null}
        <ModeBanner mode={dto.mode} eventSlug={eventSlug} />
        {dto.management ? (
        <CockpitStatusStrip
          management={dto.management}
          lagSnapshot={lagSnapshot}
          apiBaseUrl={apiBaseUrl}
        />
      ) : null}
      </main>
    );
  }

  const needsYou = dto.matches.filter(
    (m) => m.attention.level === "act" || m.attention.level === "watch",
  );
  // Split the calm pairings (attention=none) into "Awaiting results"
  // (still in flight — no result posted) and "Finished" (result posted)
  // per DESIGN.md status terminology + the user-facing distinction.
  const calm = dto.matches.filter((m) => m.attention.level === "none");
  const awaiting = calm.filter((m) => !m.result);
  const finished = calm.filter((m) => !!m.result);
  const showFideNames = dto.settings.use_fide_information;
  // Per DR2: history mode hides intervention buttons throughout.
  const isHistory = dto.mode === "history";

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-10">
      <CockpitHeader dto={dto} eventSlug={eventSlug} apiBaseUrl={apiBaseUrl} />
      {dto.management ? (
        <div className="mt-6 sm:mt-8">
          <CockpitToolbar
            management={dto.management}
            apiBaseUrl={apiBaseUrl}
            eventSlug={eventSlug}
          />
        </div>
      ) : null}
      <section className="mt-8 space-y-10 sm:mt-10 sm:space-y-12">
        <AttentionList
          matches={needsYou}
          viewer={dto.viewer}
          isHistory={isHistory}
          showFideNames={showFideNames}
          expandedPairingId={expandedPairingId}
          onToggleExpand={(id) => setExpandedPairingId((prev) => (prev === id ? null : id))}
          onOpenDrawer={(id) => setOpenPairingId(id)}
        />
        <InFlightList
          label="Awaiting results"
          matches={awaiting}
          viewer={dto.viewer}
          isHistory={isHistory}
          showFideNames={showFideNames}
          defaultOpen
          expandedPairingId={expandedPairingId}
          onToggleExpand={(id) => setExpandedPairingId((prev) => (prev === id ? null : id))}
          onOpenDrawer={(id) => setOpenPairingId(id)}
        />
        <InFlightList
          label="Finished"
          matches={finished}
          viewer={dto.viewer}
          isHistory={isHistory}
          showFideNames={showFideNames}
          expandedPairingId={expandedPairingId}
          onToggleExpand={(id) => setExpandedPairingId((prev) => (prev === id ? null : id))}
          onOpenDrawer={(id) => setOpenPairingId(id)}
        />
      </section>
      {dto.management ? (
        <CockpitStatusStrip
          management={dto.management}
          lagSnapshot={lagSnapshot}
          apiBaseUrl={apiBaseUrl}
        />
      ) : null}
      {openPairing ? (
        <PairingDetailDrawer
          match={openPairing}
          viewer={dto.viewer}
          isHistory={isHistory}
          apiBaseUrl={apiBaseUrl}
          stale={staleBannerForPairing === openPairing.id}
          onClose={() => {
            setOpenPairingId(null);
            setStaleBannerForPairing(null);
          }}
          onIntervened={(updated) => {
            setDto((prev) => mergeMatch(prev, updated, prev.needs_you_count, prev.last_event_id));
            setStaleBannerForPairing(null);
          }}
        />
      ) : null}
    </main>
  );
}

function mergeMatch(
  prev: CockpitDTO,
  updated: CockpitMatchDTO,
  needsYouCount: number,
  lastEventId: number,
): CockpitDTO {
  return {
    ...prev,
    matches: prev.matches.map((m) => (m.id === updated.id ? updated : m)),
    needs_you_count: needsYouCount,
    last_event_id: lastEventId,
  };
}
