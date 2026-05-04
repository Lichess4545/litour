"use client";

import { type CockpitMatchDTO, type CockpitViewerDTO, cockpitMatchDto } from "@litour/api-client";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

import { AttentionChip } from "./AttentionChip";
import { AuditTrailList } from "./AuditTrailList";
import { PresencePill } from "./PresencePill";

interface Props {
  match: CockpitMatchDTO;
  viewer: CockpitViewerDTO;
  isHistory: boolean;
  apiBaseUrl: string;
  stale: boolean;
  onClose: () => void;
  onIntervened: (updated: CockpitMatchDTO) => void;
}

type Pane = "overview" | "force_result" | "mark_forfeit" | "reschedule";

// DR1 L3: Sheet on mobile, side-panel on desktop. Slides in from right.
// DR2 history: only the audit-trail section renders; intervention buttons
// are absent (not disabled-but-visible per DR10).
// DR4: primary action button = `--primary` (default Button variant), NEVER
// lichess-blue.
export function PairingDetailDrawer({
  match,
  viewer,
  isHistory,
  apiBaseUrl,
  stale,
  onClose,
  onIntervened,
}: Props) {
  const [pane, setPane] = useState<Pane>("overview");

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (pane !== "overview") setPane("overview");
        else onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, pane]);

  return (
    <>
      <button
        type="button"
        aria-label="Close detail"
        onClick={onClose}
        className="fixed inset-0 z-40 bg-black/30"
      />
      <aside
        className="bg-background fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col overflow-y-auto border-l shadow-xl md:max-w-lg"
        role="dialog"
        aria-modal="true"
        aria-label="Pairing detail"
      >
        <header className="border-border flex items-start justify-between gap-3 border-b px-5 py-4">
          <div>
            <p className="text-muted-foreground text-xs uppercase tracking-wide">Pairing</p>
            <h2 className="text-lg font-medium tabular-nums">
              {match.white_username ?? "Unfilled"} <span className="text-muted-foreground">vs</span>{" "}
              {match.black_username ?? "Unfilled"}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close detail"
            className="text-muted-foreground hover:text-foreground text-2xl leading-none"
          >
            ×
          </button>
        </header>

        {stale ? (
          <div className="bg-muted/50 border-border border-b px-5 py-3 text-sm">
            <p className="text-foreground">This pairing was updated.</p>
            <button
              type="button"
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground mt-1 text-xs underline-offset-4 hover:underline"
            >
              Discard your edits and reload
            </button>
          </div>
        ) : null}

        <div className="space-y-6 px-5 py-5">
          {pane === "overview" ? (
            <Overview
              match={match}
              viewer={viewer}
              isHistory={isHistory}
              apiBaseUrl={apiBaseUrl}
              onPane={setPane}
            />
          ) : pane === "force_result" ? (
            <ForceResultForm
              match={match}
              apiBaseUrl={apiBaseUrl}
              onCancel={() => setPane("overview")}
              onSuccess={(updated) => {
                onIntervened(updated);
                setPane("overview");
              }}
            />
          ) : pane === "mark_forfeit" ? (
            <MarkForfeitForm
              match={match}
              apiBaseUrl={apiBaseUrl}
              onCancel={() => setPane("overview")}
              onSuccess={(updated) => {
                onIntervened(updated);
                setPane("overview");
              }}
            />
          ) : (
            <RescheduleForm
              match={match}
              apiBaseUrl={apiBaseUrl}
              onCancel={() => setPane("overview")}
              onSuccess={(updated) => {
                onIntervened(updated);
                setPane("overview");
              }}
            />
          )}
        </div>
      </aside>
    </>
  );
}

function Overview({
  match,
  viewer,
  isHistory,
  apiBaseUrl,
  onPane,
}: {
  match: CockpitMatchDTO;
  viewer: CockpitViewerDTO;
  isHistory: boolean;
  apiBaseUrl: string;
  onPane: (p: Pane) => void;
}) {
  return (
    <div className="space-y-6">
      <section className="space-y-2 text-sm">
        <Row
          label="White"
          value={`${match.white_username ?? "Unfilled"}${
            match.white_rating ? ` (${match.white_rating})` : ""
          }`}
        />
        <Row
          label="Black"
          value={`${match.black_username ?? "Unfilled"}${
            match.black_rating ? ` (${match.black_rating})` : ""
          }`}
        />
        <Row
          label="Scheduled"
          value={match.scheduled_at ? new Date(match.scheduled_at).toLocaleString() : "—"}
        />
        <Row label="Result" value={match.result || "—"} />
        {match.game_link ? (
          <Row
            label="Game"
            value={
              <a
                href={match.game_link}
                target="_blank"
                rel="noreferrer"
                className="underline-offset-4 hover:underline"
              >
                Open on lichess →
              </a>
            }
          />
        ) : null}
      </section>

      {match.attention.reasons.length > 0 ? (
        <section className="space-y-2">
          <h3 className="text-muted-foreground text-xs uppercase tracking-wide">
            Why this needs you
          </h3>
          <div className="flex flex-wrap gap-2">
            {match.attention.reasons.map((r) => (
              <AttentionChip key={r} reason={r} />
            ))}
          </div>
          <PresencePill />
        </section>
      ) : null}

      {!isHistory ? (
        <section className="space-y-2">
          <h3 className="text-muted-foreground text-xs uppercase tracking-wide">Interventions</h3>
          <div className="flex flex-wrap gap-2">
            {viewer.can_force_result ? (
              <Button onClick={() => onPane("force_result")}>Force result</Button>
            ) : null}
            {viewer.can_mark_forfeit ? (
              <Button variant="ghost" onClick={() => onPane("mark_forfeit")}>
                Mark forfeit
              </Button>
            ) : null}
            {viewer.can_reschedule ? (
              <Button variant="ghost" onClick={() => onPane("reschedule")}>
                Reschedule
              </Button>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="space-y-3">
        <h3 className="text-muted-foreground text-xs uppercase tracking-wide">Audit trail</h3>
        <AuditTrailList pairingId={match.id} apiBaseUrl={apiBaseUrl} />
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground text-xs uppercase tracking-wide">{label}</dt>
      <dd className="text-foreground tabular-nums">{value}</dd>
    </div>
  );
}

// ---------- Intervention sub-forms ---------------------------------------------

async function postJson(apiBaseUrl: string, path: string, body: unknown): Promise<CockpitMatchDTO> {
  const res = await fetch(`${apiBaseUrl}${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as unknown;
    throw new Error(
      typeof detail === "object" && detail !== null && "detail" in detail
        ? JSON.stringify((detail as { detail: unknown }).detail)
        : `request failed (${res.status})`,
    );
  }
  return cockpitMatchDto.parse(await res.json());
}

function ForceResultForm({
  match,
  apiBaseUrl,
  onCancel,
  onSuccess,
}: {
  match: CockpitMatchDTO;
  apiBaseUrl: string;
  onCancel: () => void;
  onSuccess: (m: CockpitMatchDTO) => void;
}) {
  const [result, setResult] = useState<"1-0" | "0-1" | "1/2-1/2">("1-0");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      const updated = await postJson(
        apiBaseUrl,
        `/v1/round_management/cockpit/${match.id}/force-result`,
        { result, reason, expected_version: match.version },
      );
      onSuccess(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "unknown error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-3">
      <h3 className="text-foreground text-sm font-medium">Force result</h3>
      <fieldset className="space-y-1">
        <legend className="text-muted-foreground text-xs uppercase tracking-wide">Result</legend>
        {(["1-0", "0-1", "1/2-1/2"] as const).map((opt) => (
          <label key={opt} className="block text-sm">
            <input
              type="radio"
              name="force-result"
              value={opt}
              checked={result === opt}
              onChange={() => setResult(opt)}
              className="mr-2"
            />
            {opt}
          </label>
        ))}
      </fieldset>
      <ReasonField value={reason} onChange={setReason} />
      {error ? <p className="text-destructive text-xs">{error}</p> : null}
      <FormActions onCancel={onCancel} onSubmit={submit} submitting={submitting} />
    </div>
  );
}

function MarkForfeitForm({
  match,
  apiBaseUrl,
  onCancel,
  onSuccess,
}: {
  match: CockpitMatchDTO;
  apiBaseUrl: string;
  onCancel: () => void;
  onSuccess: (m: CockpitMatchDTO) => void;
}) {
  const [side, setSide] = useState<"white" | "black" | "double">("white");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      const updated = await postJson(
        apiBaseUrl,
        `/v1/round_management/cockpit/${match.id}/mark-forfeit`,
        { forfeit_side: side, reason, expected_version: match.version },
      );
      onSuccess(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "unknown error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-3">
      <h3 className="text-foreground text-sm font-medium">Mark forfeit</h3>
      <fieldset className="space-y-1">
        <legend className="text-muted-foreground text-xs uppercase tracking-wide">Side</legend>
        {(["white", "black", "double"] as const).map((opt) => (
          <label key={opt} className="block text-sm">
            <input
              type="radio"
              name="forfeit-side"
              value={opt}
              checked={side === opt}
              onChange={() => setSide(opt)}
              className="mr-2"
            />
            {opt === "white"
              ? "White forfeits"
              : opt === "black"
                ? "Black forfeits"
                : "Double forfeit"}
          </label>
        ))}
      </fieldset>
      <ReasonField value={reason} onChange={setReason} />
      {error ? <p className="text-destructive text-xs">{error}</p> : null}
      <FormActions onCancel={onCancel} onSubmit={submit} submitting={submitting} />
    </div>
  );
}

function RescheduleForm({
  match,
  apiBaseUrl,
  onCancel,
  onSuccess,
}: {
  match: CockpitMatchDTO;
  apiBaseUrl: string;
  onCancel: () => void;
  onSuccess: (m: CockpitMatchDTO) => void;
}) {
  const initial = match.scheduled_at ? new Date(match.scheduled_at).toISOString().slice(0, 16) : "";
  const [value, setValue] = useState(initial);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    setError(null);
    if (!value) {
      setError("pick a date/time");
      return;
    }
    setSubmitting(true);
    try {
      const isoUtc = new Date(value).toISOString();
      const updated = await postJson(
        apiBaseUrl,
        `/v1/round_management/cockpit/${match.id}/reschedule`,
        {
          new_scheduled_at: isoUtc,
          reason,
          expected_version: match.version,
        },
      );
      onSuccess(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "unknown error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-3">
      <h3 className="text-foreground text-sm font-medium">Reschedule</h3>
      <label className="block space-y-1 text-sm">
        <span className="text-muted-foreground text-xs uppercase tracking-wide">
          New time (your local timezone)
        </span>
        <input
          type="datetime-local"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="border-border bg-background w-full rounded-md border px-2 py-1"
        />
      </label>
      <ReasonField value={reason} onChange={setReason} />
      {error ? <p className="text-destructive text-xs">{error}</p> : null}
      <FormActions onCancel={onCancel} onSubmit={submit} submitting={submitting} />
    </div>
  );
}

function ReasonField({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="text-muted-foreground text-xs uppercase tracking-wide">
        Reason (audit trail)
      </span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        className="border-border bg-background w-full rounded-md border px-2 py-1 text-sm"
      />
    </label>
  );
}

function FormActions({
  onCancel,
  onSubmit,
  submitting,
}: {
  onCancel: () => void;
  onSubmit: () => void;
  submitting: boolean;
}) {
  return (
    <div className="flex justify-end gap-2 pt-2">
      <Button variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
      <Button onClick={onSubmit} disabled={submitting}>
        {submitting ? "Submitting…" : "Confirm"}
      </Button>
    </div>
  );
}
