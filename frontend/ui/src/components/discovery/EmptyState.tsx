interface Props {
  variant: "cold" | "filter" | "error";
  onClear?: () => void;
}

export function EmptyState({ variant, onClear }: Props) {
  const copy = COPY[variant];
  return (
    <div className="border-border bg-card flex flex-col items-center justify-center rounded-lg border border-dashed px-6 py-16 text-center">
      <p className="font-display text-2xl">{copy.title}</p>
      <p className="text-muted-foreground mt-2 max-w-md text-sm">{copy.body}</p>
      {variant === "filter" && onClear ? (
        <button
          type="button"
          onClick={onClear}
          className="text-sm font-medium underline-offset-4 hover:underline mt-4"
        >
          Clear filters
        </button>
      ) : null}
    </div>
  );
}

const COPY: Record<"cold" | "filter" | "error", { title: string; body: string }> = {
  cold: {
    title: "No events yet",
    body: "When organizers publish events, they'll appear here.",
  },
  filter: {
    title: "No matching events",
    body: "Nothing matches the current filter. Clear it to see everything in flight.",
  },
  error: {
    title: "We couldn't load events",
    body: "The list will refresh automatically when the connection comes back.",
  },
};
