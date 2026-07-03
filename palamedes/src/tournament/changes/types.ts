import type {
  CompetitionDef,
  CompetitorDef,
  EntriesDef,
  RunDef,
} from "../core";

// NOTE: Named DefChange (not DefEvent) — "event" already names the aggregate (EventDef, EventState);
// see design/adr/0002-definition-changelog-model.md.
export type DefChange =
  | {
      readonly type: "definition-created";
      readonly name: string;
      readonly competition: CompetitionDef;
    }
  | { readonly type: "definition-renamed"; readonly name: string }
  | {
      readonly type: "competitor-added";
      readonly competitor: CompetitorDef;
      readonly index?: number | undefined;
    }
  | {
      readonly type: "competitor-updated";
      readonly competitorId: string;
      readonly competitor: CompetitorDef;
    }
  | { readonly type: "competitor-removed"; readonly competitorId: string }
  | {
      readonly type: "competition-added";
      readonly parentId: string;
      readonly competition: CompetitionDef;
      readonly index?: number | undefined;
    }
  | {
      readonly type: "competition-renamed";
      readonly competitionId: string;
      readonly name?: string | undefined;
    }
  | { readonly type: "competition-removed"; readonly competitionId: string }
  | {
      readonly type: "run-set";
      readonly competitionId: string;
      readonly run: RunDef;
    }
  | {
      readonly type: "entries-set";
      readonly competitionId: string;
      readonly entries: EntriesDef | null;
    };

export type DefChangeType = DefChange["type"];
