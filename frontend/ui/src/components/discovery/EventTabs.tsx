"use client";

import { useState } from "react";

interface Tab {
  id: string;
  label: string;
  available: boolean;
  comingSoon?: boolean;
}

interface Props {
  tabs: Tab[];
  initial?: string;
  children: (active: string) => React.ReactNode;
}

export function EventTabs({ tabs, initial, children }: Props) {
  const firstAvailable = tabs.find((t) => t.available)?.id ?? tabs[0]?.id ?? "";
  const [active, setActive] = useState<string>(initial ?? firstAvailable);

  return (
    <div className="space-y-6">
      <div role="tablist" className="border-border flex gap-6 border-b">
        {tabs.map((tab) => {
          const isActive = active === tab.id;
          const disabled = !tab.available;
          return (
            <button
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-disabled={disabled}
              key={tab.id}
              onClick={() => {
                if (!disabled) setActive(tab.id);
              }}
              className={`-mb-px border-b-2 px-1 pb-3 text-sm font-medium transition-colors ${
                isActive
                  ? "border-[var(--status-active)] text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
            >
              {tab.label}
              {tab.comingSoon ? (
                <span className="text-muted-foreground ml-2 text-xs uppercase tracking-wide">
                  Soon
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div role="tabpanel">{children(active)}</div>
    </div>
  );
}
