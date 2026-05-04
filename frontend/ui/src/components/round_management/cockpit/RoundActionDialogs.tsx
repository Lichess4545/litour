"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";

import { CockpitDialog } from "./CockpitDialog";
import { useCockpitAction } from "./useCockpitActions";

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
  const [overwrite, setOverwrite] = useState(false);
  const [autoForfeits, setAutoForfeits] = useState(true);
  const [publishImmediately, setPublishImmediately] = useState(false);

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
