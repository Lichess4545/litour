import type { z } from "zod";
import type { AnyEncounterDef } from "@/tournament/core";
import type { Expr } from "@/tournament/expr/ast";
import { evalScoring } from "@/tournament/expr/scoring";
import {
  type CardInfo,
  defineScoringKind,
  type EncounterOps,
  type Issue,
  type ScoringKind,
} from "@/tournament/registry";

/**
 * Turns a named, data-defined scoring rule into a `ScoringKind` the registry
 * can hold — the single adapter between the expression engine and the
 * standings pipeline. `card` is the rule's self-description for the viewer.
 */

export type ExprScoringSpec<R extends { readonly kind: string }> = {
  readonly kind: string;
  readonly schema: z.ZodType<R>;
  readonly expr: (rule: R) => Expr;
  readonly card: (rule: R) => CardInfo;
  readonly validate?: (
    rule: R,
    encounter: AnyEncounterDef,
    ops: EncounterOps,
    issue: Issue,
  ) => void;
};

export const exprScoring = <R extends { readonly kind: string }>(
  spec: ExprScoringSpec<R>,
): ScoringKind => {
  const validate = spec.validate;
  return defineScoringKind<R>({
    kind: spec.kind,
    schema: spec.schema,
    points: (rule, line, history) =>
      evalScoring(spec.expr(rule), line, history.length + 1),
    card: spec.card,
    ...(validate === undefined ? {} : { validate }),
  });
};
