"use client";

import {
  type CockpitDTO,
  type WSCockpitMessage,
  type WSJobLag,
  cockpitDto,
  wsCockpitMessage,
} from "@litour/api-client";
import { useEffect, useRef, useState } from "react";

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
import {
  selectCockpitDto,
  useCockpitStore,
} from "@/components/round_management/cockpit/cockpitStore";
import { useLagSync } from "@/lib/lagStore";
import { useChannel } from "@/lib/multiplex";

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
  // Lag store: global single value, no slug. The Sync hook handles
  // both the SSR seed and the live WS push.
  useLagSync(initialLag);

  // Cockpit store: ``${slug}:${roundId}`` keyed. Seed it from SSR
  // initial data and replace whenever the route hydrates a new
  // ``initial`` (round navigation re-keys the page).
  const setSnapshot = useCockpitStore((s) => s.setSnapshot);
  const applyMatchUpdate = useCockpitStore((s) => s.applyMatchUpdate);
  useEffect(() => {
    setSnapshot(eventSlug, initial.round_id, initial);
  }, [eventSlug, initial, setSnapshot]);

  const dto = useCockpitStore(selectCockpitDto(eventSlug, initial.round_id)) ?? initial;

  const [openPairingId, setOpenPairingId] = useState<number | null>(null);
  const [expandedPairingId, setExpandedPairingId] = useState<number | null>(null);
  const [staleBannerForPairing, setStaleBannerForPairing] = useState<number | null>(null);

  // Refs let the WS callback read current values without forcing a
  // resubscribe on every match update.
  const openPairingIdRef = useRef(openPairingId);
  useEffect(() => {
    openPairingIdRef.current = openPairingId;
  }, [openPairingId]);

  // Cockpit channel — ``cockpit.snapshot`` (round transitions / new
  // pairings) and ``cockpit.match.update`` (per-pairing merge) both
  // dispatch into the cockpit store. The component layer only owns
  // the stale-banner heuristic, which depends on transient UI state
  // (which pairing the operator currently has open).
  const cockpitChannel =
    initial.mode === "empty"
      ? null
      : `cockpit:event:${encodeURIComponent(eventSlug)}:round:${initial.round_id}`;

  useChannel(cockpitChannel, {
    schema: wsCockpitMessage,
    onMessage: (msg: WSCockpitMessage) => {
      if (msg.type === "cockpit.match.update") {
        // Capture the previous version BEFORE the store update so the
        // stale-banner check has a real before/after pair.
        const prevVersion = useCockpitStore
          .getState()
          .byKey[`${eventSlug}:${initial.round_id}`]?.matches.find((m) => m.id === msg.match.id)
          ?.version;
        applyMatchUpdate(
          eventSlug,
          initial.round_id,
          msg.match,
          msg.needs_you_count,
          msg.last_event_id,
        );
        if (
          openPairingIdRef.current === msg.match.id &&
          prevVersion !== undefined &&
          prevVersion !== msg.match.version
        ) {
          setStaleBannerForPairing(msg.match.id);
        }
      } else if (msg.type === "cockpit.snapshot") {
        setSnapshot(eventSlug, initial.round_id, msg.dto);
        setStaleBannerForPairing(null);
      }
    },
  });

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
        <ModeBanner
          mode={dto.mode}
          eventSlug={eventSlug}
          hasPrimaryAction={dto.management?.primary_action != null}
        />
        {dto.management ? (
          <CockpitStatusStrip management={dto.management} apiBaseUrl={apiBaseUrl} />
        ) : null}
      </main>
    );
  }

  const needsYou = dto.matches.filter(
    (m) => m.attention.level === "act" || m.attention.level === "watch",
  );
  const calm = dto.matches.filter((m) => m.attention.level === "none");
  const awaiting = calm.filter((m) => !m.result);
  const finished = calm.filter((m) => !!m.result);
  const showFideNames = dto.settings.use_fide_information;
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
        <CockpitStatusStrip management={dto.management} apiBaseUrl={apiBaseUrl} />
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
            // Read the latest needs_you / last_event_id straight from
            // the store so a WS push between render and click doesn't
            // get clobbered by stale closure values.
            const cur = useCockpitStore
              .getState()
              .byKey[`${eventSlug}:${initial.round_id}`];
            applyMatchUpdate(
              eventSlug,
              initial.round_id,
              updated,
              cur?.needs_you_count ?? dto.needs_you_count,
              cur?.last_event_id ?? dto.last_event_id,
            );
            setStaleBannerForPairing(null);
          }}
        />
      ) : null}
    </main>
  );
}

// Keep the cockpit dto schema pinned so changes upstream surface as
// type errors here too — ws messages already validate at the boundary.
void cockpitDto;
