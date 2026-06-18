import type {
  CompScore,
  Expr,
  LineField,
  LineKind,
} from "@/tournament/expr/ast";

/**
 * Tiebreaks as data. Each export is the expression the engine evaluates over a
 * standings row — the same formulas that used to live as hand-written
 * `value()` functions in `metrics.ts`, now in the scoring language. The
 * differential tests pin each one to its legacy implementation, byes and
 * unresolvable opponents included.
 *
 * The local constructors keep the data legible; the authoring layer
 * (compose.ts) will eventually replace them, but this is the wire shape.
 */

const self: Expr = { op: "self" };
const v = (name: string): Expr => ({ op: "var", name });
const lit = (value: number | boolean): Expr => ({ op: "lit", value });
const score = (of: Expr, key: CompScore): Expr => ({ op: "score", of, key });
const opponents = (of: Expr): Expr => ({ op: "opponents", of });
const opponentOf = (line: Expr): Expr => ({ op: "opponent", line });
const rounds = (of: Expr): Expr => ({ op: "rounds", of });
const kindIs = (line: Expr, kind: LineKind): Expr => ({
  op: "kindIs",
  line,
  kind,
});
const lineNum = (line: Expr, field: LineField): Expr => ({
  op: "lineNum",
  line,
  field,
});
const boardPoint = (line: Expr, board: number): Expr => ({
  op: "boardPoint",
  line,
  board,
});
const map = (over: Expr, as: string, body: Expr): Expr => ({
  op: "map",
  over,
  as,
  body,
});
const filter = (over: Expr, as: string, pred: Expr): Expr => ({
  op: "filter",
  over,
  as,
  pred,
});
const sortAsc = (over: Expr, as: string, by: Expr): Expr => ({
  op: "sortBy",
  over,
  as,
  by,
  dir: "asc",
});
const drop = (over: Expr, n: Expr): Expr => ({ op: "drop", over, n });
const concat = (left: Expr, right: Expr): Expr => ({
  op: "concat",
  left,
  right,
});
const sum = (over: Expr): Expr => ({ op: "sum", over });
const count = (over: Expr): Expr => ({ op: "count", over });
const arith = (f: "+" | "-" | "*" | "/", a: Expr, b: Expr): Expr => ({
  op: "arith",
  f,
  a,
  b,
});
const cmp = (f: "<" | "<=" | "==" | ">=" | ">", a: Expr, b: Expr): Expr => ({
  op: "cmp",
  f,
  a,
  b,
});
const eq = (a: Expr, b: Expr): Expr => ({ op: "eq", a, b });
const member = (of: Expr, container: Expr): Expr => ({
  op: "member",
  of,
  container,
});
const tiedWith = (of: Expr): Expr => ({ op: "tiedWith", of });
const ifE = (cond: Expr, whenTrue: Expr, whenFalse: Expr): Expr => ({
  op: "if",
  cond,
  whenTrue,
  whenFalse,
});
const orE = (a: Expr, b: Expr): Expr => ifE(a, lit(true), b);
const isWin = (line: Expr): Expr => ({
  op: "match",
  line,
  cases: [{ when: "win", result: lit(true) }],
  otherwise: lit(false),
});
/** ∀ item ∈ over: pred — via "every kept = every item". */
const forAll = (over: Expr, as: string, pred: Expr): Expr =>
  cmp("==", count(filter(over, as, pred)), count(over));

const take = (over: Expr, n: Expr): Expr => ({ op: "take", over, n });
const colorIs = (line: Expr, color: "white" | "black"): Expr => ({
  op: "colorIs",
  line,
  color,
});
const scan = (
  over: Expr,
  init: Expr,
  item: string,
  acc: string,
  body: Expr,
): Expr => ({ op: "scan", over, init, item, acc, body });

/** Every played round (resolvable opponent or not) — line-local metrics fold over these. */
const PLAYED: Expr = filter(rounds(self), "r", kindIs(v("r"), "played"));
/** The bye rounds. */
const BYES: Expr = filter(rounds(self), "r", kindIs(v("r"), "bye"));

// --- the catalogue ----------------------------------------------------------

/** Game/encounter points accumulated — the competitor's own total. */
export const ENCOUNTER_POINTS: Expr = score(self, "encounter");

/** Individual games (boards) won across all played rounds. */
export const GAMES_WON: Expr = sum(
  map(PLAYED, "r", lineNum(v("r"), "gamesWon")),
);

/** Count of played rounds won (from this competitor's perspective). */
export const MATCH_WINS: Expr = count(filter(PLAYED, "r", isWin(v("r"))));

/** Sonneborn-Berger: beaten opponents' scores in full, drawn opponents' in half. */
export const SONNEBORN_BERGER: Expr = sum(
  map(opponents(self), "o", {
    op: "match",
    line: v("o"),
    cases: [
      { when: "win", result: score(opponentOf(v("o")), "standings") },
      {
        when: "draw",
        result: arith("/", score(opponentOf(v("o")), "standings"), lit(2)),
      },
    ],
    otherwise: lit(0),
  }),
);

/**
 * Buchholz: sum of opponents' scores. A bye contributes the competitor's own
 * score (matching the legacy convention); the optional cut drops the `cut`
 * lowest contributions before summing.
 */
export const buchholz = (cut = 0): Expr =>
  sum(
    drop(
      sortAsc(
        concat(
          map(opponents(self), "o", score(opponentOf(v("o")), "standings")),
          map(BYES, "r", score(self, "standings")),
        ),
        "x",
        v("x"),
      ),
      lit(cut),
    ),
  );

/**
 * Extended Sonneborn-Berger (FIDE family): Σ opponentTotal × scoredAgainst.
 * The game-game variant additionally counts byes against the competitor's own
 * encounter total (FIDE Art. 16.4); the other three variants ignore byes.
 */
export const extendedSB = (
  opponentTotal: CompScore,
  scored: CompScore,
): Expr => {
  const scoredField: LineField =
    scored === "standings" ? "standingsPoints" : "encounterPoints";
  const played = sum(
    map(
      opponents(self),
      "o",
      arith(
        "*",
        score(opponentOf(v("o")), opponentTotal),
        lineNum(v("o"), scoredField),
      ),
    ),
  );
  if (opponentTotal === "encounter" && scored === "encounter") {
    const byes = sum(
      map(
        BYES,
        "r",
        arith(
          "*",
          score(self, "encounter"),
          lineNum(v("r"), "encounterPoints"),
        ),
      ),
    );
    return arith("+", played, byes);
  }
  return played;
};

/**
 * Head-to-head / direct encounter: points scored against the tied group — but
 * only when every pair in the group has actually met, and the group has at
 * least two members; otherwise zero.
 */
export const HEAD_TO_HEAD: Expr = (() => {
  const tied = tiedWith(self);
  const metBy = (who: Expr): Expr =>
    map(opponents(who), "o", opponentOf(v("o")));
  const allMet = forAll(
    tied,
    "x",
    forAll(tied, "y", orE(eq(v("y"), v("x")), member(v("y"), metBy(v("x"))))),
  );
  const applicable = ifE(cmp(">=", count(tied), lit(2)), allMet, lit(false));
  const h2hSum = sum(
    map(
      filter(opponents(self), "o", member(opponentOf(v("o")), tied)),
      "o",
      lineNum(v("o"), "standingsPoints"),
    ),
  );
  return ifE(applicable, h2hSum, lit(0));
})();

/** Points won on a specific board across all played rounds (team tiebreak). */
export const boardPoints = (board: number): Expr =>
  sum(map(PLAYED, "r", boardPoint(v("r"), board)));

/**
 * Median Buchholz (Harkness): Buchholz with the `cut` highest and lowest
 * opponent scores discarded before summing — blunts the effect of a single
 * very strong or very weak opponent. `cut` 0 is plain Buchholz.
 */
export const medianBuchholz = (cut = 1): Expr => {
  const scores = sortAsc(
    concat(
      map(opponents(self), "o", score(opponentOf(v("o")), "standings")),
      map(BYES, "r", score(self, "standings")),
    ),
    "x",
    v("x"),
  );
  const keep = arith("-", count(scores), lit(2 * cut));
  return sum(
    take(drop(scores, lit(cut)), ifE(cmp("<", keep, lit(0)), lit(0), keep)),
  );
};

/**
 * Cumulative (progressive) score: the sum of the running total after each
 * round — rewards scoring early. Absent rounds contribute 0.
 */
export const CUMULATIVE: Expr = sum(
  scan(
    map(
      rounds(self),
      "r",
      ifE(kindIs(v("r"), "absent"), lit(0), lineNum(v("r"), "standingsPoints")),
    ),
    lit(0),
    "s",
    "a",
    arith("+", v("a"), v("s")),
  ),
);

/** Games played with the black pieces (an individual-swiss tiebreak). */
export const GAMES_WITH_BLACK: Expr = count(
  filter(PLAYED, "r", colorIs(v("r"), "black")),
);

/** Param-free tiebreaks available for reuse via `{ op: "metric", name }`. */
export const tiebreakExprs: ReadonlyMap<string, Expr> = new Map([
  ["encounterPoints", ENCOUNTER_POINTS],
  ["gamesWon", GAMES_WON],
  ["matchWins", MATCH_WINS],
  ["sonnebornBerger", SONNEBORN_BERGER],
  ["buchholz", buchholz()],
  ["headToHead", HEAD_TO_HEAD],
  ["medianBuchholz", medianBuchholz()],
  ["cumulative", CUMULATIVE],
  ["gamesWithBlack", GAMES_WITH_BLACK],
]);
