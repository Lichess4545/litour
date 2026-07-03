# ADR 0007 — Snapshots and a portable global-order counter row

Status: Proposed (2026-07-02) — designed, not built

## Context

Definition streams are short (a created definition plus edits), so folding
from scratch is cheap; and no global pollers exist, so `seq` skew (ADR 0003)
is harmless today.

## Proposal

1. Snapshots: a `DefinitionSnapshot(streamId, version, payload Json)` row
   every N changes, read as fold(snapshot ++ suffix). Only worth building
   when streams grow long (an editor autosaving per keystroke).
2. Global order for pollers: a single counter row updated in the same
   transaction as each append serializes writers portably (sqlite included),
   making `afterSeq` pagination gap-free and commit-ordered. Adopt only when
   a projection/poller exists; it deliberately reintroduces the transaction
   ADR 0003 avoided.

## Consequences (anticipated)

- Both are additive migrations inside the ADR 0001 portable subset.
