"use client";

import { type CockpitAuditEntryDTO, cockpitAuditEntryDto } from "@litour/api-client";
import { useEffect, useState } from "react";
import { z } from "zod";

interface Props {
  pairingId: number;
  apiBaseUrl: string;
}

// DR9: chronological list, most-recent first. Each row: timestamp ·
// actor · intervention_type, then before→after summary. No timeline
// graphic — same tabular density as the pairing-row list. Empty state
// is muted Italic "No interventions yet."
const auditList = z.array(cockpitAuditEntryDto);

const TYPE_LABELS: Record<CockpitAuditEntryDTO["intervention_type"], string> = {
  force_result: "Force result",
  mark_forfeit: "Mark forfeit",
  reschedule: "Reschedule",
};

export function AuditTrailList({ pairingId, apiBaseUrl }: Props) {
  const [entries, setEntries] = useState<CockpitAuditEntryDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fetchUrl = `${apiBaseUrl}/v1/round_management/cockpit/${pairingId}/audit`;
    fetch(fetchUrl, { credentials: "include" })
      .then((res) => {
        if (!res.ok) throw new Error(`audit fetch ${res.status}`);
        return res.json();
      })
      .then((data: unknown) => {
        if (cancelled) return;
        setEntries(auditList.parse(data));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "audit load failed");
      });
    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl, pairingId]);

  if (error) {
    return <p className="text-muted-foreground text-sm italic">Couldn&apos;t load audit trail.</p>;
  }
  if (entries === null) {
    return <p className="text-muted-foreground text-sm italic">Loading…</p>;
  }
  if (entries.length === 0) {
    return <p className="text-muted-foreground text-sm italic">No interventions yet.</p>;
  }
  return (
    <ul className="divide-border divide-y">
      {entries.map((e) => (
        <li key={e.id} className="py-3">
          <div className="text-muted-foreground text-xs tabular-nums">
            {new Date(e.created_at).toLocaleString()} · {e.actor_username} ·{" "}
            <span className="text-foreground">{TYPE_LABELS[e.intervention_type]}</span>
          </div>
          <div className="text-foreground mt-1 text-sm">
            {e.before_summary} → {e.after_summary}
            {e.reason ? (
              <span className="text-muted-foreground"> · &ldquo;{e.reason}&rdquo;</span>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
