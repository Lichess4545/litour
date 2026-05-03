# Design System — Palamedes

> Source of truth for visual decisions on Palamedes. Read before
> writing any UI code. Don't deviate without explicit approval.

## Product Context

- **What this is:** Palamedes (codebase: Litour) — multi-tenant chess
  tournament management platform. Originally the lichess4545 site
  (long-format team leagues, 45+45 classical), generalizing into a
  public platform where any organizer can run long-format chess events.
- **Who it's for:** First viewer is a would-be tournament organizer
  ("I could host my club's events here"). Second viewer is a returning
  4545 player. Players who want rapid/blitz arenas go to lichess.org;
  this is the long-format home.
- **Project type:** Hybrid. The home page is marketing-shaped (it
  sells the platform to organizers). Event drill-in pages are app UI
  (data-dense, real-time over websocket).
- **Memorable thing:** *"Palamedes looks like a serious chess
  publication that respects your time."*

## Aesthetic Direction

**Editorial Industrial.** The home page reads like a serious chess
publication. The app interior reads like an enterprise-grade pairings
tool. The two surfaces share a typographic palette but speak in
different registers — editorial-warmth at the marquee, calm-functional
at the workbench.

- **Decoration level:** Minimal. Typography does the work. No
  textures, no gradients, no decorative blobs, no icons-in-circles.
- **Mood:** Calm. Confident. Built for people who care about
  long-format chess. Subtraction default — every element earns its
  pixels.
- **Reference:** *New York Review of Books* typography meets a
  tournament hall pairings sheet.

## Approved Mockup

The approved direction for the home page lives at:
`~/.gstack/projects/lichess4545-litour/designs/design-system-20260503/round2/variant-A.png`

That mockup is the visual reference for the home page layout
(editorial featured-card direction). Renderings of fonts in the
mockup are AI approximations; the real fonts are Instrument Serif and
Geist as specified below.

## Typography

Two-typeface system. No third typeface enters without explicit review.

### Display — Instrument Serif

- **Role:** Brand line + tournament-name marquee
- **Variants used:**
  - **Italic** — only on the brand line `Palamedes`
  - **Upright Regular** — tournament names on cards, event detail
    page header, section headings on home
- **Loaded via:** `next/font/google` (or Bunny Fonts CDN as
  fallback). Self-hosted in production for reliability.
- **Fallback stack:** `"Instrument Serif", "Iowan Old Style", Georgia, serif`
- **Why Instrument Serif:** editorial without being staid; Italian-cinema
  feel in italic; pairs cleanly with a modern grotesk; signals
  "long-format chess publication," not "SaaS."

### Body / UI / Data — Geist

- **Role:** Everything that isn't display — body copy, organizer
  labels, format/schedule lines, slot counts, button text, filter
  chips, tabs, table rows.
- **Variants used:**
  - **Regular (400)** — body, organizer labels, schedule lines
  - **Medium (500)** — UI labels, status pills, button text
  - **Tabular nums** — `font-feature-settings: 'tnum'` for slot
    counts ("23 / 32 players"), ratings, scores, round numbers,
    timestamps
- **Loaded via:** `next/font` (Geist is shipped natively via Vercel's
  package).
- **Fallback stack:** `Geist, ui-sans-serif, system-ui, sans-serif`

### Rejected typefaces

| Reject | Why |
|--------|-----|
| Inter | Overused. The "I picked the safe sans" signal. |
| Roboto | Sterile. Wrong vibe for editorial-industrial. |
| Arial / Helvetica | Default-stack signal. |
| system-ui / -apple-system | "I gave up on typography." |
| Space Grotesk | Now its own AI-slop convergence. |
| Fraunces / Tiempos | Heavier serifs feel staid; we want Instrument's restraint. |
| Comic Sans, Papyrus, Lobster | Self-explanatory. |

### Type scale

```
Brand line (italic)         60-72px   Instrument Serif Italic
Page heading                40-48px   Instrument Serif Italic (h1)
Tournament name on card     22-26px   Instrument Serif Regular (upright)
Event-page heading          32-40px   Instrument Serif Regular
Section heading             20-24px   Instrument Serif Regular
Body                        16px      Geist Regular
Body small                  14px      Geist Regular
Tabular data                14-16px   Geist Regular tabular-nums
UI label / status pill      12-13px   Geist Medium uppercase tracking-wide
Caption / muted             12-13px   Geist Regular
```

Names (`text-2xl` Instrument Serif) must be visibly heavier than body
on every card. The hierarchy is the point — what does the user see
first, second, third? Card name → status pill → format line → slot
count.

## Color System

Builds on the existing `globals.css` palette. The shadcn neutrals stay.
The `--result-*` palette stays (earned chess-result signal). One new
accent: lichess affiliation blue.

### Variables (light mode)

```css
:root {
  /* Existing shadcn neutrals — keep */
  --background:       oklch(1 0 0);              /* #ffffff */
  --foreground:       oklch(0.145 0 0);          /* near-black body */
  --card:             oklch(1 0 0);
  --card-foreground:  oklch(0.145 0 0);
  --muted:            oklch(0.97 0 0);
  --muted-foreground: oklch(0.556 0 0);
  --border:           oklch(0.922 0 0);
  --primary:          oklch(0.205 0 0);          /* charcoal */
  --primary-foreground: oklch(0.985 0 0);

  /* Existing chess-result tints — keep */
  --result-win:  oklch(0.951 0.026 236.824);     /* sky-100 */
  --result-loss: oklch(0.952 0.025 348.382);     /* pink-100 */
  --result-tie:  oklch(0.92  0.004 286.32);      /* stone-200 */

  /* NEW — lichess affiliation accent */
  --status-active: oklch(0.62 0.16 245);         /* ≈ #3893d0 lichess blue */
}
```

### Variables (dark mode)

```css
.dark {
  /* Existing shadcn neutrals — keep */
  --background:       oklch(0.145 0 0);
  --foreground:       oklch(0.985 0 0);
  --card:             oklch(0.205 0 0);
  --card-foreground:  oklch(0.985 0 0);
  --muted:            oklch(0.269 0 0);
  --muted-foreground: oklch(0.708 0 0);
  --border:           oklch(1 0 0 / 10%);

  /* Existing chess-result tints — keep */
  --result-win:  oklch(0.425 0.123 240.85);
  --result-loss: oklch(0.408 0.153 2.432);
  --result-tie:  oklch(0.37  0.013 285.805);

  /* NEW — lichess affiliation accent (lighter for dark mode) */
  --status-active: oklch(0.70 0.16 245);
}
```

### Color usage rules

| Token | When to use | When NOT to use |
|-------|-------------|----------------|
| `--status-active` | Live indicator dot on event cards · hairline accent on the active-round tab · 1px hairline top border on the featured EventCard · "Now playing" status pill text/border | Primary CTA buttons (use `--primary`) · decorative fills · backgrounds · borders on standard (non-featured) cards |
| `--result-win/loss/tie` | Match outcome cells in pairings · Team Match score header tint | Anywhere outside chess-result context |
| `--primary` | Primary buttons, focus rings | Body text (use `--foreground`) |
| `--muted-foreground` | Secondary information (organizer label, schedule line, slot count text, captions) | Anything the user needs to read at a glance |

**The lichess-blue is rare on purpose.** A status dot, a tab hairline,
a status-pill border. That's it. If lichess-blue starts appearing as a
fill on cards or as a primary button color, the platform stops feeling
like *lichess infrastructure* and starts feeling like *another chess
SaaS that picked blue*. Restraint is the signal.

### Status terminology (chess-native)

```
"Now playing"       — event is in progress (uses lichess-blue dot)
"Open"              — registration is accepting signups
"Awaiting results"  — all rounds played but the event hasn't been
                       marked complete yet (final results pending)
"Finished"          — event has ended
```

These replace the generic "Active / Upcoming / Completed" admin labels.
The user-facing surface uses the chess-native terms. The backend
`Season.is_active` / `is_completed` field names stay as-is (they're
internal).

## Spacing

- **Base unit:** 4px (Tailwind default)
- **Density:** Comfortable on the home page. Denser in app interior
  (data needs to breathe but not float — see `TeamMatchCard` for the
  established density baseline).
- **Scale (Tailwind):** 1 (4px), 2 (8px), 3 (12px), 4 (16px),
  6 (24px), 8 (32px), 12 (48px), 16 (64px). The 24px gap (`gap-6`) is
  the default between cards in the home grid.

## Border radius

Existing `--radius: 0.625rem` (10px) stays. Hierarchy:

```
--radius-sm    6px   small chips, status pills
--radius-md    8px   inputs, buttons
--radius-lg   10px   cards (the default)
--radius-xl   14px   large feature cards on home
```

Avoid `rounded-full` on cards (that's the SaaS-bubble signal). Pills
and indicator dots use `rounded-full`; everything structural uses the
hierarchical scale.

## Layout

### Home page — editorial featured-card

```
┌──────────────────────────────────────────────────────────┐
│        Palamedes         (Instrument Serif Italic)       │
│   A chess tournament platform for long-format events.    │
│                                                          │
│   [Now playing]  [Open]  [Finished]   League: 4545 ▾     │
│                                                          │
│   ┌──────────────────────────┐  ┌────────────────┐       │
│   │  4545 League             │  │ OSICL Season 9 │       │
│   │  Team 4545 League        │  │ OSICL          │       │
│   │  Team Swiss · 8 rounds   │  │ Team Swiss · …│       │
│   │  45+45 · Sundays 11am UTC│  │  20 / 60       │       │
│   │  23/32 players  ● Now    │  │  Open          │       │
│   └──────────────────────────┘  └────────────────┘       │
│                                                          │
│   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│   │ Weekly Class.│  │ ENY Indiv.   │  │ 4545 Cup     │   │
│   │ Lichess      │  │ ENYCA        │  │ Team 4545    │   │
│   │ Open         │  │ Finished     │  │ Finished     │   │
│   └──────────────┘  └──────────────┘  └──────────────┘   │
└──────────────────────────────────────────────────────────┘
```

- The "Now playing" event (or the next-most-active) gets the featured
  position: 2-column-wide card at the top-left.
- Other cards are uniform 1-column in the 3-column grid below.
- If no event is "Now playing," the next "Open" event takes the
  featured slot.
- If no events exist (cold start), the empty-state organizer-CTA fills
  the featured slot.

### Event drill-in — app workbench grid

```
┌──────────────────────────────────────────────────────────┐
│   4545 League  Season 30   (Instrument Serif Regular)    │
│   Team 4545 League · Team Swiss · 8 rounds · 45+45 …     │
│   ● Now playing — Round 4 of 8                           │
│   [Register]                                             │
│                                                          │
│   ┌──────────────────────────────────────────────────┐   │
│   │  [Pairings] | Standings (Coming soon) | Roster…  │   │
│   ├──────────────────────────────────────────────────┤   │
│   │                                                  │   │
│   │   (existing TeamMatchCard / BoardRow surface)    │   │
│   │                                                  │   │
│   └──────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────┘
```

- Tabs use existing shadcn `Tabs` primitive. Active tab gets the
  `--status-active` hairline (border-bottom).
- Standings and Roster tabs render as **disabled tabs with "Coming
  soon" tooltip** in this branch (see Litour discovery-domain plan).
  When their schemas land, the tooltip drops and the tabs activate.

### Grid breakpoints

| Viewport | Grid | Featured card |
|----------|------|---------------|
| `< 640px` | 1 column | Same width as other cards (no spanning) |
| `640–1024px` | 2 columns | Spans 2 columns (full row) |
| `≥ 1024px` | 3 columns | Spans 2 columns at top-left |

Max content width: `1280px` (Tailwind `max-w-7xl`). Page gutter:
`px-6` mobile, `px-8` desktop.

## Motion

**Minimal-functional.** Chess players hate UI that plays.

| Where | What | Duration | Easing |
|-------|------|----------|--------|
| Tab switch | Opacity fade | 150ms | ease-out |
| WS lifecycle update on a card | Color-wash on changed cell | 300ms | ease-out |
| Filter chip toggle | Background color + border | 100ms | ease-out |
| Page load | NO entrance animation | — | — |
| Hover on card | Border color shift to `--status-active` at 30% | 100ms | ease-out |

**No** scroll-linked motion. **No** parallax. **No** card flips, bounces,
or springs. **No** entrance staggers. **No** typing-effect text. **No**
loading spinners that move more than necessary (use shadcn `Skeleton`
which is a calm pulse).

## Accessibility

- **Contrast:** body text vs. background must be ≥ 4.5:1; UI controls
  ≥ 3:1. The default `--foreground` over `--background` is 19:1 light,
  16:1 dark.
- **Touch targets:** ≥ 44px on touch devices. Status pills + filter
  chips on mobile use `min-h-11`.
- **Focus rings:** visible. Use `--ring` (existing `--ring` token).
  Never `outline: none` without a replacement.
- **Keyboard nav:**
  - Filter chips: tab through, space to toggle.
  - Tabs (event drill-in): left/right arrow between tabs, home/end to
    jump. Disabled "Coming soon" tabs are skipped by tab key but
    reachable via arrow keys (so users learn they exist).
  - Cards: enter activates the link to the event drill-in.
- **Screen readers:** Status pills carry an aria-label
  (`aria-label="Now playing — round 4 of 8"`). Live regions (the WS
  hydration target) use `aria-live="polite"` so updates don't interrupt.
- **Reduced motion:** respect `prefers-reduced-motion: reduce`. The
  WS color-wash drops to an instant border change; tab fade becomes
  immediate.

## Component vocabulary

The four-layer separation in `components/` (per CLAUDE.md):

```
components/ui/         shadcn raw — DO NOT EDIT
components/primitives/ small chess chips: ScorePill, ConnectionBadge, …
components/<domain>/   chess logic per domain: round_management/, …
app/...                page composition (server-rendered + ws-hydrated)
```

This branch's discovery domain adds:

```
components/discovery/
  EventCard.tsx         single event card (featured + standard variants)
  EventGrid.tsx         3-column grid with featured slot
  EventTabs.tsx         tabs with "Coming soon" disabled state
  StatusPill.tsx        Now playing / Open / Awaiting results / Finished pill
  EmptyState.tsx        cold-start + filter-mismatch empty states
  OrganizerFilter.tsx   chip-row organizer filter for the home grid
```

`StatusPill` lives at `components/discovery/` (it's chess-domain), not
`components/primitives/` (which is for cross-domain chips).

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-05-03 | Initial design system created | Editorial Industrial aesthetic agreed; mockup variant A (round 2) approved |
| 2026-05-03 | Typography: Instrument Serif (italic brand, upright names) + Geist | Editorial moment + grotesk workhorse; rejects Inter/Roboto/system-ui |
| 2026-05-03 | Accent: lichess blue ≈ #3893d0 | Affiliation with lichess (Palamedes runs on Lichess infrastructure), not differentiation; replaces a tournament-hall green that risked chess.com confusion |
| 2026-05-03 | Status terms: Now playing / Open / Finished | Chess-native, action-oriented; replaces admin labels Active/Upcoming/Completed |
| 2026-05-03 | Italic dropped from tournament names | Round 1 mockup feedback: italic on names didn't look right; italic stays only on brand line |
| 2026-05-03 | Layout: editorial featured-card on home | Magazine cover energy; the most active event leads the page |
| 2026-05-03 | "Coming soon" tabs for Standings/Roster | Discovery-domain wedge: visible promise of upcoming work, not hidden |
| 2026-05-03 | Featured EventCard gets 1px `--status-active` hairline top border | Editorial moment of restraint: the only place lichess-blue appears as chrome (not status) on the home page. Marks the leading event without drifting toward decorative use. (`/plan-design-review` D1) |
| 2026-05-03 | User-facing filter axis is **"Organizer"**, not "League" | The data model still has `League`, but the UI never says it. "Organizer" matches the platform-shape framing (multi-tenant, organizer-as-first-viewer) and avoids prejudging future entities (clubs, individuals). Implementer rule: any string a user reads says "Organizer"; only DB columns / Python identifiers say "league". (`/design-html` 2026-05-03 review feedback) |
