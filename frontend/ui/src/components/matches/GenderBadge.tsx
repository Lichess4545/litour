interface Props {
  gender: string | null;
}

// Single-letter gender pill matching the legacy `gender_badge` template tag.
// Renders nothing when the player has no gender set, so callers can drop it
// into any layout unconditionally.
const TITLES: Record<string, string> = {
  male: "Male",
  female: "Female",
  "non-binary": "Non-binary",
  "not-represented": "My gender is not represented",
  "prefer-not-disclose": "Prefer not to disclose",
};

const TONE: Record<string, string> = {
  male: "bg-sky-200 text-sky-900 dark:bg-sky-900/40 dark:text-sky-200",
  female: "bg-pink-200 text-pink-900 dark:bg-pink-900/40 dark:text-pink-200",
  "non-binary": "bg-violet-200 text-violet-900 dark:bg-violet-900/40 dark:text-violet-200",
};

export function GenderBadge({ gender }: Props) {
  if (!gender) return null;
  const letter = gender.charAt(0).toUpperCase();
  const title = TITLES[gender] ?? gender;
  const tone = TONE[gender] ?? "bg-muted text-muted-foreground";
  return (
    <span
      title={title}
      className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm font-mono text-[10px] leading-none font-semibold ${tone}`}
    >
      {letter}
    </span>
  );
}
