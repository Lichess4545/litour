"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

export type ToastTone = "ok" | "warning" | "error";

interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  detail?: string;
}

interface ToasterApi {
  push: (toast: Omit<Toast, "id">) => void;
}

const ToasterContext = createContext<ToasterApi | null>(null);

export function useToaster(): ToasterApi {
  const ctx = useContext(ToasterContext);
  if (!ctx) {
    throw new Error("useToaster must be used inside <ToasterProvider>");
  }
  return ctx;
}

export function ToasterProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);

  const push = useCallback((toast: Omit<Toast, "id">) => {
    idRef.current += 1;
    const id = idRef.current;
    setToasts((prev) => [...prev, { id, ...toast }]);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToasterContext.Provider value={{ push }}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4 sm:bottom-6"
        aria-live="polite"
        aria-atomic="false"
      >
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </ToasterContext.Provider>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  useEffect(() => {
    const ms = toast.tone === "error" ? 8000 : 4500;
    const handle = window.setTimeout(onDismiss, ms);
    return () => window.clearTimeout(handle);
  }, [toast.tone, onDismiss]);

  return (
    <div
      role="status"
      className={cn(
        "pointer-events-auto bg-card text-card-foreground border-border w-full max-w-md rounded-md border px-4 py-3 shadow-lg",
        toast.tone === "ok" && "border-status-active/40",
        toast.tone === "warning" && "border-yellow-500/40",
        toast.tone === "error" && "border-destructive/50",
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "mt-1 inline-block size-2 rounded-full",
            toast.tone === "ok" && "bg-status-active",
            toast.tone === "warning" && "bg-yellow-500",
            toast.tone === "error" && "bg-destructive",
          )}
          aria-hidden
        />
        <div className="flex-1">
          <p className="text-sm font-medium">{toast.title}</p>
          {toast.detail ? (
            <p className="text-muted-foreground mt-0.5 text-xs">{toast.detail}</p>
          ) : null}
        </div>
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground -mr-1 -mt-1 px-1 text-sm"
          onClick={onDismiss}
          aria-label="Dismiss"
        >
          ×
        </button>
      </div>
    </div>
  );
}
