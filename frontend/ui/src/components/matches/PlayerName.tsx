import type { ReactNode } from "react";

interface Props {
  username: string | null;
  fideName: string | null;
  // League-level preference: when true and a `fideName` is available, render
  // FIDE name as the primary label and put the lichess handle on a second
  // line as a muted pill. When false (or no FIDE name) just the username.
  showFideNames: boolean;
  // Side determines stack alignment when both names are shown — left places
  // the pill under the FIDE name's start, right under its end. Also drives
  // text-align on the wrapper so the names mirror the card.
  align?: "start" | "end";
  // Inline node rendered next to the primary name on the same line (rating,
  // gender badge, etc.). Layout owner controls what goes here so PlayerName
  // doesn't have to know about all the surrounding metadata.
  trailing?: ReactNode;
}

// Reusable player label with one source of truth for league-aware display.
//
// Layout when FIDE info is shown:
//   FIDE Name <trailing>
//   [pill: lichess_user]
// Otherwise:
//   lichess_user <trailing>
//
// In both cases the link target is `lichess.org/@/<username>` so FIDE-named
// players still resolve to a real profile.
export function PlayerName({
  username,
  fideName,
  showFideNames,
  align = "start",
  trailing,
}: Props) {
  if (!username) {
    return <span className="text-muted-foreground">—</span>;
  }

  const wrapperAlign = align === "end" ? "items-end text-right" : "items-start";
  const inlineJustify = align === "end" ? "justify-end" : "";

  if (showFideNames && fideName) {
    return (
      <a
        href={`https://lichess.org/@/${username}`}
        target="_blank"
        rel="noopener noreferrer"
        className={`group hover:text-primary inline-flex min-w-0 flex-col gap-0.5 ${wrapperAlign}`}
      >
        <span
          className={`flex flex-wrap items-baseline gap-x-1.5 gap-y-0 [overflow-wrap:anywhere] ${inlineJustify}`}
        >
          <span className="font-medium group-hover:underline">{fideName}</span>
          {trailing}
        </span>
        <UsernamePill username={username} />
      </a>
    );
  }

  return (
    <span
      className={`flex flex-wrap items-baseline gap-x-1.5 gap-y-0 ${inlineJustify}`}
    >
      <a
        href={`https://lichess.org/@/${username}`}
        target="_blank"
        rel="noopener noreferrer"
        className="hover:text-primary font-medium hover:underline [overflow-wrap:anywhere]"
      >
        {username}
      </a>
      {trailing}
    </span>
  );
}

function UsernamePill({ username }: { username: string }) {
  return (
    <span className="bg-muted text-muted-foreground inline-flex w-fit max-w-full items-center rounded px-1.5 py-0.5 font-mono text-[10px] leading-none [overflow-wrap:anywhere]">
      {username}
    </span>
  );
}
