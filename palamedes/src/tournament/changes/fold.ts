import type { CompetitionDef, CompetitorDef, EventDef } from "../core";
import { assertNever } from "../core";
import { isContainer } from "../registry";
import type { DefChange } from "./types";

export type FoldError =
  | { readonly kind: "streamNotCreated"; readonly index: number }
  | { readonly kind: "alreadyCreated"; readonly index: number }
  | {
      readonly kind: "unknownCompetition";
      readonly index: number;
      readonly competitionId: string;
    }
  | {
      readonly kind: "parentNotContainer";
      readonly index: number;
      readonly parentId: string;
    }
  | {
      readonly kind: "duplicateCompetitionId";
      readonly index: number;
      readonly competitionId: string;
    }
  | {
      readonly kind: "unknownCompetitor";
      readonly index: number;
      readonly competitorId: string;
    }
  | {
      readonly kind: "duplicateCompetitorId";
      readonly index: number;
      readonly competitorId: string;
    }
  | {
      readonly kind: "competitorIdMismatch";
      readonly index: number;
      readonly competitorId: string;
      readonly payloadId: string;
    }
  | { readonly kind: "rootRemoval"; readonly index: number };

export type FoldResult =
  | { readonly ok: true; readonly candidate: EventDef }
  | { readonly ok: false; readonly error: FoldError };

type Draft = {
  readonly name: string;
  readonly competitors: readonly CompetitorDef[];
  readonly competition: CompetitionDef;
};

type StepResult =
  | { readonly ok: true; readonly draft: Draft }
  | { readonly ok: false; readonly error: FoldError };

const subtreeIds = (comp: CompetitionDef): readonly string[] => [
  comp.id,
  ...(isContainer(comp.run) ? comp.run.competitions.flatMap(subtreeIds) : []),
];

const findCompetition = (
  comp: CompetitionDef,
  id: string,
): CompetitionDef | undefined => {
  if (comp.id === id) return comp;
  if (!isContainer(comp.run)) return undefined;
  for (const child of comp.run.competitions) {
    const hit = findCompetition(child, id);
    if (hit !== undefined) return hit;
  }
  return undefined;
};

type Edit = (comp: CompetitionDef) => CompetitionDef | null;

const editCompetition = (
  comp: CompetitionDef,
  id: string,
  edit: Edit,
): CompetitionDef | null | undefined => {
  if (comp.id === id) return edit(comp);
  if (!isContainer(comp.run)) return undefined;
  const children = comp.run.competitions;
  for (let i = 0; i < children.length; i += 1) {
    const child = children[i];
    if (child === undefined) continue;
    const edited = editCompetition(child, id, edit);
    if (edited === undefined) continue;
    const competitions =
      edited === null
        ? children.filter((_, j) => j !== i)
        : children.map((c, j) => (j === i ? edited : c));
    return { ...comp, run: { kind: "competitions", competitions } };
  }
  return undefined;
};

const insertAt = <T>(
  items: readonly T[],
  item: T,
  index: number | undefined,
): readonly T[] =>
  index === undefined || index >= items.length
    ? [...items, item]
    : [...items.slice(0, index), item, ...items.slice(index)];

const withoutName = (comp: CompetitionDef): CompetitionDef => {
  const { name: _name, ...rest } = comp;
  return rest;
};

const withoutEntries = (comp: CompetitionDef): CompetitionDef => {
  const { entries: _entries, ...rest } = comp;
  return rest;
};

function applyChange(
  draft: Draft,
  change: Exclude<DefChange, { type: "definition-created" }>,
  index: number,
): StepResult {
  switch (change.type) {
    case "definition-renamed":
      return { ok: true, draft: { ...draft, name: change.name } };

    case "competitor-added": {
      if (draft.competitors.some((c) => c.id === change.competitor.id)) {
        return {
          ok: false,
          error: {
            kind: "duplicateCompetitorId",
            index,
            competitorId: change.competitor.id,
          },
        };
      }
      return {
        ok: true,
        draft: {
          ...draft,
          competitors: insertAt(
            draft.competitors,
            change.competitor,
            change.index,
          ),
        },
      };
    }

    case "competitor-updated": {
      const at = draft.competitors.findIndex(
        (c) => c.id === change.competitorId,
      );
      if (at < 0) {
        return {
          ok: false,
          error: {
            kind: "unknownCompetitor",
            index,
            competitorId: change.competitorId,
          },
        };
      }
      if (change.competitor.id !== change.competitorId) {
        return {
          ok: false,
          error: {
            kind: "competitorIdMismatch",
            index,
            competitorId: change.competitorId,
            payloadId: change.competitor.id,
          },
        };
      }
      return {
        ok: true,
        draft: {
          ...draft,
          competitors: draft.competitors.map((c, i) =>
            i === at ? change.competitor : c,
          ),
        },
      };
    }

    case "competitor-removed": {
      if (!draft.competitors.some((c) => c.id === change.competitorId)) {
        return {
          ok: false,
          error: {
            kind: "unknownCompetitor",
            index,
            competitorId: change.competitorId,
          },
        };
      }
      return {
        ok: true,
        draft: {
          ...draft,
          competitors: draft.competitors.filter(
            (c) => c.id !== change.competitorId,
          ),
        },
      };
    }

    case "competition-added": {
      const parent = findCompetition(draft.competition, change.parentId);
      if (parent === undefined) {
        return {
          ok: false,
          error: {
            kind: "unknownCompetition",
            index,
            competitionId: change.parentId,
          },
        };
      }
      if (!isContainer(parent.run)) {
        return {
          ok: false,
          error: {
            kind: "parentNotContainer",
            index,
            parentId: change.parentId,
          },
        };
      }
      const existing = new Set(subtreeIds(draft.competition));
      const clash = subtreeIds(change.competition).find((cid) =>
        existing.has(cid),
      );
      if (clash !== undefined) {
        return {
          ok: false,
          error: {
            kind: "duplicateCompetitionId",
            index,
            competitionId: clash,
          },
        };
      }
      const competition = editCompetition(
        draft.competition,
        change.parentId,
        (comp) =>
          isContainer(comp.run)
            ? {
                ...comp,
                run: {
                  kind: "competitions",
                  competitions: insertAt(
                    comp.run.competitions,
                    change.competition,
                    change.index,
                  ),
                },
              }
            : comp,
      );
      if (competition === undefined || competition === null) {
        return {
          ok: false,
          error: {
            kind: "unknownCompetition",
            index,
            competitionId: change.parentId,
          },
        };
      }
      return { ok: true, draft: { ...draft, competition } };
    }

    case "competition-renamed":
    case "competition-removed":
    case "run-set":
    case "entries-set": {
      if (
        change.type === "competition-removed" &&
        change.competitionId === draft.competition.id
      ) {
        return { ok: false, error: { kind: "rootRemoval", index } };
      }
      const edit: Edit =
        change.type === "competition-removed"
          ? () => null
          : change.type === "run-set"
            ? (comp) => ({ ...comp, run: change.run })
            : change.type === "entries-set"
              ? (comp) =>
                  change.entries === null
                    ? withoutEntries(comp)
                    : { ...comp, entries: change.entries }
              : (comp) =>
                  change.name === undefined
                    ? withoutName(comp)
                    : { ...comp, name: change.name };
      const competition = editCompetition(
        draft.competition,
        change.competitionId,
        edit,
      );
      if (competition === undefined) {
        return {
          ok: false,
          error: {
            kind: "unknownCompetition",
            index,
            competitionId: change.competitionId,
          },
        };
      }
      if (competition === null) {
        return { ok: false, error: { kind: "rootRemoval", index } };
      }
      return { ok: true, draft: { ...draft, competition } };
    }

    default:
      return assertNever(change);
  }
}

/**
 * `candidate.id` is always `streamId`; identity lives on the stream, not in
 * any change payload.
 *
 * A successful fold is not a validity gate — whole-definition laws (leaf/container
 * entries, depth caps, registry kinds) belong to `safeParseEventDef`, not here.
 *
 * NOTE: design/adr/0002-definition-changelog-model.md — change grammar and batch-atomic validity.
 */
export function foldDefinition(
  streamId: string,
  changes: readonly DefChange[],
): FoldResult {
  let draft: Draft | undefined;
  for (let index = 0; index < changes.length; index += 1) {
    const change = changes[index];
    if (change === undefined) continue;
    if (change.type === "definition-created") {
      if (draft !== undefined) {
        return { ok: false, error: { kind: "alreadyCreated", index } };
      }
      draft = {
        name: change.name,
        competitors: [],
        competition: change.competition,
      };
      continue;
    }
    if (draft === undefined) {
      return { ok: false, error: { kind: "streamNotCreated", index } };
    }
    const step = applyChange(draft, change, index);
    if (!step.ok) return step;
    draft = step.draft;
  }
  if (draft === undefined) {
    return { ok: false, error: { kind: "streamNotCreated", index: 0 } };
  }
  return {
    ok: true,
    candidate: {
      id: streamId,
      name: draft.name,
      competitors: draft.competitors,
      competition: draft.competition,
    },
  };
}
