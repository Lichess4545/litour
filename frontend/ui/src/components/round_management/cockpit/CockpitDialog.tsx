"use client";

import { useEffect } from "react";

import { cn } from "@/lib/utils";

// Lightweight modal dialog — no shadcn dialog dep. Backdrop click + Esc
// close; the active element is restored on unmount.
export function CockpitDialog({
  open,
  onClose,
  title,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previouslyFocused?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 px-4 py-6 sm:items-center"
    >
      <button
        type="button"
        aria-label="Close dialog backdrop"
        className="absolute inset-0 cursor-default bg-transparent"
        onClick={onClose}
      />
      <div
        className={cn(
          "relative",
          "bg-card text-card-foreground border-border w-full rounded-md border shadow-xl",
          size === "sm" && "max-w-sm",
          size === "md" && "max-w-lg",
          size === "lg" && "max-w-3xl",
        )}
      >
        <header className="border-border flex items-center justify-between border-b px-5 py-3">
          <h2 className="font-display text-lg">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground -mr-1 px-1 text-lg"
            aria-label="Close dialog"
          >
            ×
          </button>
        </header>
        <div className="px-5 py-4">{children}</div>
        {footer ? (
          <footer className="border-border bg-muted/40 flex flex-wrap items-center justify-end gap-2 border-t px-5 py-3">
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  );
}
