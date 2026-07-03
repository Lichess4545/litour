# ADR 0005 — lichess4545 seed canon: the live site over the fork's defaults

Status: Accepted (2026-07-02)

## Context

The seeder ships two league definitions. The heltour FORK in this repo
defaults lonewolf tiebreaks to head_to_head/buchholz_cut1/buchholz/…, which
is NOT what lichess4545.com runs. The live lichess4545.com site and the upstream heltour repository (not the fork's defaults in this repo) are authoritative for league structure and tiebreaks.

## Decision

Seed both leagues as definition streams via `definitionToChanges`:

- TEAM (`team4545`): teams of 8 boards, 8 rounds, ONE open swiss section,
  45+45; game points 1/0.5/0; match points 2/1/0; standings order match
  points → game points → head-to-head → games won → Sonneborn-Berger. Team
  bye = 1 match point + boards/2 game points (`byePoints(1, 4)`).
- LONEWOLF (`lonewolf`): individuals, 11 rounds, TWO sister sections (Open +
  U1800), 30+30, points 1/0.5/0; standings order points → Modified Median →
  Solkoff (= plain Buchholz) → Cumulative → Cumulative Opposition.

Idempotent: an existing stream with the same content → no-op ("unchanged");
different content → report "divergent", don't clobber (typed outcome
printed). Seed functions accept a stream-id prefix so tests seed under fresh
uuid-prefixed ids on the shared dev database.

Named deviations (structural seed vs the live operation):
1. LoneWolf acceleration: seeded as PLAIN swiss. The FAQ says accelerated
   (Baku); the rules page is silent; the repo's demo seeder uses plain
   swiss-dutch. Recorded, not modeled.
2. Team-bye pairing-history wart: the live site feeds the bye to JavaFo as a
   win-like 1.0; palamedes' own bye semantics are used as-is.
3. Operational/dynamic machinery is deliberately OMITTED from structural
   seeds: alternates, scheduling, moderation byes, registration workflow,
   prizes, playoffs.
4. Any tiebreak not faithfully available after the tiebreak-fidelity task →
   a further named deviation in the seed output (none expected; revisit during the tiebreak-fidelity work).

## Consequences

- The seeded defs are the fidelity contract for a future heltour import.
- Season parameters (8 boards / 8 rounds / 11 rounds) are seeded at current
  values; a new season is a new stream or a batch of changes.
