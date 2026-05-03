"use client";

interface Organizer {
  tag: string;
  label: string;
}

interface Props {
  organizers: Organizer[];
  selected: Set<string>;
  onToggle: (tag: string) => void;
}

export function OrganizerFilter({ organizers, selected, onToggle }: Props) {
  if (organizers.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-muted-foreground text-xs uppercase tracking-wide">Organizer</span>
      {organizers.map((o) => {
        const pressed = selected.has(o.tag);
        return (
          <button
            type="button"
            key={o.tag}
            aria-pressed={pressed}
            onClick={() => onToggle(o.tag)}
            className={`rounded-full border px-3 py-1 text-sm transition-colors ${
              pressed
                ? "border-foreground bg-foreground text-background"
                : "border-border text-foreground hover:bg-muted"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
