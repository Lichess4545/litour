import type { Color, CompetitorId } from "../core";
import type { MetricRow, RoundLine, ScoredLineInput } from "../registry";

/**
 * The scoring expression language: the primitive the tournament model used to
 * deny ("there is no smaller primitive underneath Buchholz"). Every tiebreak
 * and scoring rule is now an `Expr` — plain data, parsed against `schema.ts`
 * and evaluated by `evaluate.ts` over precomputed standings rows. It is a
 * small functional query language (map/filter/sort/fold/lookup over the line
 * substrate), not arithmetic alone, because that is what real tiebreaks need.
 */

export type ValueTag = "num" | "bool" | "list" | "comp" | "line";

/** A fully-evaluated value. Tagged so the evaluator narrows without casts. */
export type Value =
  | { readonly t: "num"; readonly v: number }
  | { readonly t: "bool"; readonly v: boolean }
  | { readonly t: "list"; readonly v: readonly Value[] }
  | { readonly t: "comp"; readonly v: CompetitorId }
  | { readonly t: "line"; readonly v: RoundLine };

/** Numeric fields readable off a played line (the competitor's own row). */
export type LineField =
  | "standingsPoints"
  | "encounterPoints"
  | "opponentEncounterPoints"
  | "gamesWon"
  | "round";

/** Which points channel of a competitor's total to read. */
export type CompScore = "standings" | "encounter";

/** Which kind of round a line records. */
export type LineKind = "played" | "bye" | "absent";

export type ArithOp = "+" | "-" | "*" | "/";
export type CmpOp = "<" | "<=" | "==" | ">=" | ">";
export type CalcOp = "floor" | "ceil" | "abs" | "round";
export type SortDir = "asc" | "desc";

/** A played line's result from the competitor's own perspective. */
export type DecisionTag = "win" | "loss" | "draw" | "doubleLoss" | "pending";

export type MatchCase = {
  readonly when: DecisionTag;
  readonly result: Expr;
};

export type Binding = {
  readonly name: string;
  readonly value: Expr;
};

export type Expr =
  // Leaves and context
  | { readonly op: "lit"; readonly value: number | boolean }
  | { readonly op: "self" }
  | { readonly op: "var"; readonly name: string }
  // Reuse: evaluate another named metric's expression for the current row.
  | { readonly op: "metric"; readonly name: string }
  // Substrate accessors
  | { readonly op: "opponents"; readonly of: Expr }
  | { readonly op: "opponent"; readonly line: Expr }
  | { readonly op: "lineNum"; readonly line: Expr; readonly field: LineField }
  | { readonly op: "score"; readonly of: Expr; readonly key: CompScore }
  // The ratings seam: metric-context rows carry `rating` from `CompetitorDef`
  // (standings.ts); any other key, or a competitor with no rating, errors
  // cleanly rather than yielding 0.
  | { readonly op: "attribute"; readonly of: Expr; readonly key: string }
  // Competitors currently tied with `of` (head-to-head / direct encounter).
  | { readonly op: "tiedWith"; readonly of: Expr }
  | { readonly op: "member"; readonly of: Expr; readonly container: Expr }
  // Full round history (incl. byes/absences) + line-kind test, for bye-aware metrics.
  | { readonly op: "rounds"; readonly of: Expr }
  | { readonly op: "kindIs"; readonly line: Expr; readonly kind: LineKind }
  // True only for a played line with the flag set; byes and absences are
  // never `unplayed`, even though both are colloquially "not played".
  | { readonly op: "unplayed"; readonly line: Expr }
  | { readonly op: "boardPoint"; readonly line: Expr; readonly board: number }
  | { readonly op: "colorIs"; readonly line: Expr; readonly color: Color }
  | { readonly op: "concat"; readonly left: Expr; readonly right: Expr }
  // Scoring context (one scored line + its round): valid only while scoring.
  | { readonly op: "linePoints" }
  | { readonly op: "round" }
  | { readonly op: "legIndex" }
  | {
      readonly op: "outcome";
      readonly cases: readonly MatchCase[];
      readonly otherwise: Expr;
    }
  // Collections
  | {
      readonly op: "map";
      readonly over: Expr;
      readonly as: string;
      readonly body: Expr;
    }
  | {
      readonly op: "filter";
      readonly over: Expr;
      readonly as: string;
      readonly pred: Expr;
    }
  | {
      readonly op: "sortBy";
      readonly over: Expr;
      readonly as: string;
      readonly by: Expr;
      readonly dir: SortDir;
    }
  | { readonly op: "take"; readonly over: Expr; readonly n: Expr }
  | { readonly op: "drop"; readonly over: Expr; readonly n: Expr }
  | { readonly op: "sum"; readonly over: Expr }
  | { readonly op: "count"; readonly over: Expr }
  | { readonly op: "min"; readonly over: Expr }
  | { readonly op: "max"; readonly over: Expr }
  | { readonly op: "avg"; readonly over: Expr }
  | {
      readonly op: "scan";
      readonly over: Expr;
      readonly init: Expr;
      readonly item: string;
      readonly acc: string;
      readonly body: Expr;
    }
  // Scalars and control flow
  | {
      readonly op: "arith";
      readonly f: ArithOp;
      readonly a: Expr;
      readonly b: Expr;
    }
  | { readonly op: "calc"; readonly f: CalcOp; readonly a: Expr }
  | {
      readonly op: "cmp";
      readonly f: CmpOp;
      readonly a: Expr;
      readonly b: Expr;
    }
  | { readonly op: "eq"; readonly a: Expr; readonly b: Expr }
  | {
      readonly op: "if";
      readonly cond: Expr;
      readonly whenTrue: Expr;
      readonly whenFalse: Expr;
    }
  | {
      readonly op: "match";
      readonly line: Expr;
      readonly cases: readonly MatchCase[];
      readonly otherwise: Expr;
    }
  | {
      readonly op: "let";
      readonly bindings: readonly Binding[];
      readonly body: Expr;
    };

/** Lexical bindings introduced by `let`, `map`, `filter`, `sortBy`. */
export type Scope = ReadonlyMap<string, Value>;

/**
 * Everything an expression reads that is not lexical. The function-shaped
 * fields are the seams the rest of the system fills: `tiedGroup` is the
 * ranking-in-progress (phase 4 supplies the real re-partitioning; phase 1
 * tests inject equal-points peers), `attribute` is ratings,
 * `named` is the tiebreak-reuse registry.
 */
export type Env = {
  readonly self: CompetitorId;
  readonly all: ReadonlyMap<CompetitorId, MetricRow>;
  readonly attribute: (comp: CompetitorId, key: string) => number | undefined;
  readonly tiedGroup: (comp: CompetitorId) => readonly CompetitorId[];
  readonly named: (name: string) => Expr | undefined;
  /** Present only while scoring a line: the line being scored and its round. */
  readonly scoring?: { readonly line: ScoredLineInput; readonly round: number };
};

export type ExprError =
  | {
      readonly kind: "type";
      readonly expected: ValueTag;
      readonly got: ValueTag;
      readonly at: string;
    }
  | { readonly kind: "unknownVar"; readonly name: string }
  | { readonly kind: "notPlayed"; readonly at: string }
  | {
      readonly kind: "noScoringContext";
      readonly op: "linePoints" | "round" | "legIndex" | "outcome";
    }
  | { readonly kind: "unknownMetric"; readonly name: string }
  | { readonly kind: "unknownCompetitor"; readonly id: CompetitorId }
  | {
      readonly kind: "unknownAttribute";
      readonly id: CompetitorId;
      readonly key: string;
    }
  | { readonly kind: "divByZero" }
  | { readonly kind: "emptyReduce"; readonly op: "min" | "max" | "avg" }
  | {
      readonly kind: "badCount";
      readonly op: "take" | "drop";
      readonly n: number;
    }
  | { readonly kind: "budget"; readonly limit: number };

export type EvalResult =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly error: ExprError };
