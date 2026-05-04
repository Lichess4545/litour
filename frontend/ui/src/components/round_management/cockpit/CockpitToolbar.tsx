"use client";

import type { CockpitActionName, CockpitManagementDTO } from "@litour/api-client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { ConfirmActionDialog } from "./RoundActionDialogs";

// Top-level disclosure menu used by the toolbar groups. Plain
// `<details>` keeps focus / outside-click handling simple, mirrors the
// CockpitRoundSelector pattern, and works without a shadcn dropdown
// dependency. The `<summary>` borrows `buttonVariants` so toolbar
// triggers visually match every other action button in the cockpit.
function DisclosureMenu({
  label,
  badge,
  warn,
  children,
}: {
  label: string;
  badge?: number | null;
  warn?: boolean;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement | null>(null);
  // Close the menu when the user clicks outside it.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      const el = ref.current;
      if (!el || !el.open) return;
      if (e.target instanceof Node && !el.contains(e.target)) {
        el.open = false;
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);
  return (
    <details ref={ref} className="relative">
      <summary
        className={cn(
          buttonVariants({ variant: "outline", size: "default" }),
          "w-full cursor-pointer list-none justify-between [&::-webkit-details-marker]:hidden",
          warn && "border-destructive/50 text-destructive",
        )}
      >
        <span className="inline-flex items-center gap-2">
          {label}
          {typeof badge === "number" && badge > 0 ? (
            <span className="bg-status-active inline-flex h-5 min-w-5 items-center justify-center rounded-sm px-1.5 text-xs font-medium tabular-nums text-white">
              {badge}
            </span>
          ) : null}
          {warn ? (
            <span className="bg-destructive inline-block size-2 rounded-full" aria-hidden />
          ) : null}
        </span>
        <span className="text-muted-foreground text-xs">▾</span>
      </summary>
      <div className="bg-card border-border absolute right-0 z-20 mt-2 w-72 origin-top-right rounded-md border p-1 shadow-md">
        {children}
      </div>
    </details>
  );
}

function MenuLink({
  href,
  label,
  hint,
  count,
  external = false,
  disabled = false,
}: {
  href: string;
  label: string;
  hint?: string | undefined;
  count?: number | null | undefined;
  external?: boolean;
  disabled?: boolean;
}) {
  if (disabled || !href) {
    return (
      <span className="text-muted-foreground flex items-center justify-between gap-2 rounded-sm px-3 py-2 text-sm opacity-60">
        <span>{label}</span>
        {hint ? <span className="text-xs">{hint}</span> : null}
      </span>
    );
  }
  const linkProps = external ? { href, target: "_self" as const } : { href };
  return (
    <Link
      {...linkProps}
      className="text-foreground hover:bg-accent flex items-center justify-between gap-2 rounded-sm px-3 py-2 text-sm"
    >
      <span>{label}</span>
      <span className="text-muted-foreground inline-flex items-center gap-2 text-xs">
        {hint ? <span>{hint}</span> : null}
        {typeof count === "number" && count > 0 ? (
          <span className="bg-status-active rounded-sm px-1.5 py-0.5 tabular-nums text-white">
            {count}
          </span>
        ) : null}
      </span>
    </Link>
  );
}

function MenuActionButton({
  label,
  hint,
  onClick,
  disabled,
  warn = false,
}: {
  label: string;
  hint?: string | undefined;
  onClick: () => void;
  disabled?: boolean;
  warn?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "hover:bg-accent flex w-full items-center justify-between gap-2 rounded-sm px-3 py-2 text-left text-sm disabled:opacity-50",
        warn ? "text-destructive" : "text-foreground",
      )}
    >
      <span>{label}</span>
      {hint ? <span className="text-muted-foreground text-xs">{hint}</span> : null}
    </button>
  );
}

function MenuDivider() {
  return <div className="bg-border my-1 h-px" aria-hidden />;
}

interface Props {
  management: CockpitManagementDTO;
  apiBaseUrl: string;
  eventSlug: string;
}

export function CockpitToolbar({ management, apiBaseUrl, eventSlug }: Props) {
  const m = management;
  const opsWarn = m.celery_down || (m.lichess_token != null && !m.lichess_token.valid);
  const peopleBadge =
    m.pending_reg_count + m.pending_modreq_count + (m.alternate_search_count ?? 0);

  // Confirmation dialogs for in-line actions. We track which one is open
  // so a single state variable serves all four toolbar groups.
  const [confirm, setConfirm] = useState<null | {
    action: CockpitActionName;
    title: string;
    body: string;
    confirmLabel: string;
    destructive?: boolean | undefined;
  }>(null);

  return (
    <>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
        <DisclosureMenu label="People" badge={peopleBadge}>
          <MenuLink
            href={m.urls.registrations}
            label="Review Registrations"
            count={m.pending_reg_count}
            external
          />
          <MenuLink
            href={m.urls.mod_requests}
            label="Review Mod Requests"
            count={m.pending_modreq_count}
            external
          />
          <MenuLink
            href={m.urls.manage_players}
            label={m.is_team_league ? "Edit Rosters" : "Manage Players"}
            hint={
              m.is_team_league && m.unassigned_player_count > 0
                ? `${m.unassigned_player_count} unassigned`
                : undefined
            }
            external
          />
          {m.is_team_league && m.alternate_search_count !== null ? (
            <MenuLink
              href={m.urls.alternates ?? ""}
              label="Alternate Searches"
              count={m.alternate_search_count}
            />
          ) : null}
          {m.is_team_league && m.urls.team_composition ? (
            <>
              <MenuDivider />
              <MenuLink href={m.urls.team_composition} label="Team Composition" />
              <MenuLink
                href={m.urls.team_spam ?? ""}
                label="Message All Teams"
                external
                disabled={!m.urls.team_spam}
              />
            </>
          ) : null}
        </DisclosureMenu>

        <DisclosureMenu label="Data">
          <MenuLink href={m.urls.game_ids} label="Game IDs" />
          {m.show_fide_names && m.urls.broadcast_players ? (
            <MenuLink href={m.urls.broadcast_players} label="Broadcast Players" />
          ) : null}
          <MenuLink href={m.urls.export_trf16} label="Export TRF16" />
          {m.is_knockout_tournament && m.urls.knockout_bracket ? (
            <MenuLink href={m.urls.knockout_bracket} label="View Knockout Bracket" />
          ) : null}
          {m.require_fide_id ? (
            <>
              <MenuDivider />
              <MenuActionButton
                label="Update FIDE Ratings"
                hint="Background"
                onClick={() =>
                  setConfirm({
                    action: "update-fide-ratings",
                    title: "Update FIDE ratings",
                    body: "Queue a background job to refresh FIDE ratings for all players in this league.",
                    confirmLabel: "Queue update",
                  })
                }
                disabled={confirm !== null}
              />
              <MenuActionButton
                label="Backfill FIDE IDs & Gender"
                hint="Background"
                onClick={() =>
                  setConfirm({
                    action: "backfill-fide-data",
                    title: "Backfill FIDE data",
                    body: "Copy FIDE IDs and gender from registrations to player records, then refresh FIDE profiles. Runs in the background.",
                    confirmLabel: "Queue backfill",
                  })
                }
                disabled={confirm !== null}
              />
            </>
          ) : null}
        </DisclosureMenu>

        <DisclosureMenu label="Ops" warn={opsWarn}>
          <div className="px-3 py-2 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Lichess API token</span>
              {m.lichess_token ? (
                <span className={m.lichess_token.valid ? "text-status-active" : "text-destructive"}>
                  {m.lichess_token.valid ? "OK" : "FAILED"}
                </span>
              ) : (
                <span className="text-muted-foreground">unknown</span>
              )}
            </div>
            <div className="mt-1 flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Celery</span>
              <span className={m.celery_down ? "text-destructive" : "text-status-active"}>
                {m.celery_down ? "down" : "up"}
              </span>
            </div>
          </div>
          <MenuDivider />
          <MenuActionButton
            label="Validate Tokens"
            hint="Background"
            onClick={() =>
              setConfirm({
                action: "validate-tokens",
                title: "Validate Lichess tokens",
                body: "Queue a background job to refresh / validate Lichess OAuth tokens for everyone playing this season.",
                confirmLabel: "Validate now",
              })
            }
            disabled={confirm !== null}
          />
          <MenuActionButton
            label="Clear All Caches"
            hint="Now"
            warn
            onClick={() =>
              setConfirm({
                action: "clear-caches",
                title: "Clear caches",
                body: "Invalidate the Django cache and cacheops. The site may briefly slow down while caches warm.",
                confirmLabel: "Clear caches",
                destructive: true,
              })
            }
            disabled={confirm !== null}
          />
        </DisclosureMenu>

        <DisclosureMenu label="Settings">
          <MenuLink
            href={m.urls.season_admin}
            label="Edit Season"
            hint={m.registration_open ? "Reg: open" : "Reg: closed"}
            external
          />
          <MenuLink href={m.urls.season_create} label="Create New Season" external />
          <MenuDivider />
          <MenuLink href={m.urls.tournament_admin} label="Tournament Admin" external />
          {m.can_admin_users ? (
            <MenuLink href={m.urls.user_admin} label="User Admin" external />
          ) : null}
        </DisclosureMenu>
      </div>

      {confirm ? (
        <ConfirmActionDialog
          open={true}
          onClose={() => setConfirm(null)}
          apiBaseUrl={apiBaseUrl}
          eventSlug={eventSlug}
          action={confirm.action}
          title={confirm.title}
          body={confirm.body}
          confirmLabel={confirm.confirmLabel}
          destructive={confirm.destructive}
        />
      ) : null}
    </>
  );
}
