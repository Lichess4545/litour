"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

import { CockpitDialog } from "./CockpitDialog";
import { useCockpitAction } from "./useCockpitActions";

// Persist the generate-pairings form values per tournament so an
// operator's chosen knobs (auto-forfeit, publish, overwrite) carry
// over the next time they hit Generate. Scoped by event slug so
// preferences stay tournament-local. Falls back gracefully on SSR
// (no `window`) and on quota / disabled-storage errors.
interface GeneratePairingsPrefs {
  overwrite: boolean;
  autoForfeits: boolean;
  publishImmediately: boolean;
}

const GP_DEFAULTS: GeneratePairingsPrefs = {
  overwrite: false,
  autoForfeits: true,
  publishImmediately: false,
};

function generatePairingsKey(eventSlug: string): string {
  return `cockpit:generate-pairings:${eventSlug}`;
}

function loadGeneratePairingsPrefs(eventSlug: string): GeneratePairingsPrefs {
  if (typeof window === "undefined") return GP_DEFAULTS;
  try {
    const raw = window.localStorage.getItem(generatePairingsKey(eventSlug));
    if (!raw) return GP_DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<GeneratePairingsPrefs>;
    return {
      overwrite: typeof parsed.overwrite === "boolean" ? parsed.overwrite : GP_DEFAULTS.overwrite,
      autoForfeits:
        typeof parsed.autoForfeits === "boolean" ? parsed.autoForfeits : GP_DEFAULTS.autoForfeits,
      publishImmediately:
        typeof parsed.publishImmediately === "boolean"
          ? parsed.publishImmediately
          : GP_DEFAULTS.publishImmediately,
    };
  } catch {
    return GP_DEFAULTS;
  }
}

function saveGeneratePairingsPrefs(eventSlug: string, prefs: GeneratePairingsPrefs): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(generatePairingsKey(eventSlug), JSON.stringify(prefs));
  } catch {
    // Storage disabled / quota — silently keep in-memory state only.
  }
}

interface BaseProps {
  open: boolean;
  onClose: () => void;
  apiBaseUrl: string;
  eventSlug: string;
  roundNumber?: number | undefined;
}

// ---- Generate Pairings ---------------------------------------------------

export function GeneratePairingsDialog({
  open,
  onClose,
  apiBaseUrl,
  eventSlug,
  roundNumber,
}: BaseProps) {
  const { run, pending } = useCockpitAction(apiBaseUrl, eventSlug);
  // Lazy-init from localStorage so SSR renders defaults; the client
  // re-syncs on first effect tick if the cached prefs differ.
  const [overwrite, setOverwrite] = useState(GP_DEFAULTS.overwrite);
  const [autoForfeits, setAutoForfeits] = useState(GP_DEFAULTS.autoForfeits);
  const [publishImmediately, setPublishImmediately] = useState(GP_DEFAULTS.publishImmediately);

  useEffect(() => {
    const prefs = loadGeneratePairingsPrefs(eventSlug);
    setOverwrite(prefs.overwrite);
    setAutoForfeits(prefs.autoForfeits);
    setPublishImmediately(prefs.publishImmediately);
  }, [eventSlug]);

  useEffect(() => {
    saveGeneratePairingsPrefs(eventSlug, { overwrite, autoForfeits, publishImmediately });
  }, [eventSlug, overwrite, autoForfeits, publishImmediately]);

  async function onSubmit() {
    const result = await run("generate-pairings", {
      body: {
        overwrite,
        auto_assign_forfeits: autoForfeits,
        publish_immediately: publishImmediately,
      },
    });
    if (result.status === "ok") onClose();
  }

  return (
    <CockpitDialog
      open={open}
      onClose={onClose}
      title={roundNumber ? `Generate pairings — Round ${roundNumber}` : "Generate pairings"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={pending}>
            {pending ? "Generating…" : "Generate pairings"}
          </Button>
        </>
      }
    >
      <p className="text-muted-foreground text-sm">
        This pairs unassigned players for the next round, using the league's pairing rules.
      </p>
      <fieldset className="mt-4 space-y-3">
        <Checkbox
          checked={autoForfeits}
          onChange={setAutoForfeits}
          label="Auto-assign forfeits for unavailable players"
          hint="Marks no-show / removed players as forfeits before pairing."
        />
        <Checkbox
          checked={publishImmediately}
          onChange={setPublishImmediately}
          label="Publish pairings immediately"
          hint="Makes pairings visible to players right away."
        />
        <Checkbox
          checked={overwrite}
          onChange={setOverwrite}
          label="Overwrite existing pairings"
          hint="Use this only if a previous draft is wrong; pairings with results cannot be overwritten."
          warn
        />
      </fieldset>
    </CockpitDialog>
  );
}

// ---- Start Round ---------------------------------------------------------

export function StartRoundDialog({
  open,
  onClose,
  apiBaseUrl,
  eventSlug,
  roundNumber,
  isTeamLeague,
}: BaseProps & { isTeamLeague: boolean }) {
  const { run, pending } = useCockpitAction(apiBaseUrl, eventSlug);
  const [updateBoardOrder, setUpdateBoardOrder] = useState(false);

  async function onSubmit() {
    const result = await run("start-round", {
      body: { update_board_order: updateBoardOrder },
    });
    if (result.status === "ok") onClose();
  }

  return (
    <CockpitDialog
      open={open}
      onClose={onClose}
      title={roundNumber ? `Start Round ${roundNumber}` : "Start round"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={pending}>
            {pending ? "Starting…" : "Start round"}
          </Button>
        </>
      }
    >
      <p className="text-muted-foreground text-sm">
        Publishes pairings so players can see them. Make sure pairings have been generated and
        reviewed first.
      </p>
      {isTeamLeague ? (
        <fieldset className="mt-4 space-y-3">
          <Checkbox
            checked={updateBoardOrder}
            onChange={setUpdateBoardOrder}
            label="Update board order before starting"
            hint="Rebalances boards based on current ratings."
          />
        </fieldset>
      ) : null}
    </CockpitDialog>
  );
}

// ---- Confirm-only dialogs -----------------------------------------------

export function ConfirmActionDialog({
  open,
  onClose,
  apiBaseUrl,
  eventSlug,
  action,
  title,
  body,
  confirmLabel,
  destructive = false,
  successTitle,
}: BaseProps & {
  action: Parameters<ReturnType<typeof useCockpitAction>["run"]>[0];
  title: string;
  body: string;
  confirmLabel: string;
  destructive?: boolean | undefined;
  successTitle?: string | undefined;
}) {
  const { run, pending } = useCockpitAction(apiBaseUrl, eventSlug);

  async function onSubmit() {
    const result = await run(action, successTitle ? { successTitle } : {});
    if (result.status === "ok" || result.status === "warning") onClose();
  }

  return (
    <CockpitDialog
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            onClick={onSubmit}
            disabled={pending}
          >
            {pending ? "Working…" : confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm">{body}</p>
    </CockpitDialog>
  );
}

// ---- Shared checkbox row ------------------------------------------------

function Checkbox({
  checked,
  onChange,
  label,
  hint,
  warn = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  hint?: string | undefined;
  warn?: boolean;
}) {
  return (
    <label className="flex items-start gap-3 text-sm cursor-pointer">
      <input
        type="checkbox"
        className="mt-1"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="flex-1">
        <span className={warn ? "text-destructive font-medium" : "font-medium"}>{label}</span>
        {hint ? <span className="text-muted-foreground mt-0.5 block text-xs">{hint}</span> : null}
      </span>
    </label>
  );
}
