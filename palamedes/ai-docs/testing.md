# Testing

Read this when writing or changing tests.

- Run: `bun run test` · one file: `bun run test <path>` · watch:
  `bun run test:watch` · coverage: `bun run test:coverage`.
- Vitest 4 + Testing Library + fast-check. Tests are co-located as
  `*.test.ts` / `*.test.tsx` next to the source.
- Coverage is v8 (`@vitest/coverage-v8`), configured in `vitest.config.ts`
  with `all: true` so untested files report as 0% rather than vanishing;
  it excludes generated code (`src/generated/`, `src/components/ui/`), the
  test setup, and `src/env.ts`. Reports land in `coverage/` (open
  `coverage/index.html`).
- The default environment is jsdom, with setup `src/test/setup.ts` (jest-dom
  matchers). Server/DB test files opt out with a first-line pragma:
  `// @vitest-environment node` (see `src/server/api/routers/post.test.ts`).
- `vitest.config.ts` loads `.env` into the test process so `src/env.ts`
  validates — a `.env` file must exist (copy `.env.example`).

## DB-backed suites

- Use `describeWithDb` from `@/test/db` instead of `describe`. When postgres
  is unreachable the suite is skipped visibly (console warning + skipped in
  the summary), never silently green. Postgres comes from `devenv up`.
- Clean up created rows in `afterAll`; deleting a user cascades to its
  sessions, accounts, and posts.

## Patterns to copy

- Router integration (real DB, no HTTP): build a caller with
  `createCaller({ db, session })` from `@/server/api/root`;
  `src/server/api/routers/post.test.ts` includes a `makeSession` helper for
  authenticated calls.
- Component tests: Testing Library — `src/components/posts/posts-table.test.tsx`.
- Property-based tests: fast-check — `src/lib/slugify.test.ts`.

## Tournament-model suites

The meta-model's tests live in `src/tournament/*.test.ts` and `src/chess/*.test.ts`
(all `// @vitest-environment node`). The shapes worth copying:

- **Driving an event end-to-end**: the fluent `runEvent(def, chessRegistry)`
  driver (`src/tournament/builder.ts`) scripts pairings/results by NAME and
  throws on any rejected input; `expectStandings(run).competitor(…)` asserts
  points/rank/metrics. `formats.test.ts` is the regression net — every
  catalog format driven to completion.
- **The format catalog as a contract**: `src/chess/formats.ts` parses at
  import, so a def that stops validating fails the build. `def.test.ts`
  covers the parse-rejection paths.
- **A kind in isolation**: get it from `chessRegistry` and call its methods
  directly — `src/chess/seeds.test.ts` (resolve + validate) is the model.
- **Pure layout**: `buildGraph` (the viewer's layout) is a pure
  `(ConcreteEvent, expanded) → FlowGraph`, tested without a DOM in
  `src/components/tournament/def-graph.test.ts`.

## Change-store suites

`src/server/tournament/*.test.ts` are db-backed (`describeWithDb` +
`// @vitest-environment node`). Conventions:

- Every test mints FRESH stream ids with `crypto.randomUUID()` (usually
  prefixed, e.g. `cs-<uuid>`) — streams persist on the shared dev database,
  so reused ids collide across runs.
- Track created stream ids and delete them in `afterAll` via
  `db.definitionChange.deleteMany({ where: { streamId: { in: ids } } })`.
- Postgres must be UP (`devenv up`) for these suites to RUN rather than
  skip; a change that touches the store must not be judged green on skipped
  suites.
- The pure change domain (`src/tournament/changes/*.test.ts`) needs no
  database; its round-trip suite runs `definitionToChanges → foldDefinition
  → safeParseEventDef` over the whole format catalog.
- Concurrency tests drive REAL races (`Promise.all` of conflicting
  appends / parallel `submit`s) against postgres — exactly-one-winner and
  dense-version assertions, no mocks.

### The ChangeStoreClient seam

`ChangeStoreClient` is a structural narrow type (`{ definitionChange: Pick<PrismaClient["definitionChange"], "findMany" | "findFirst" | "createMany" | "count"> }`). Every DAL function takes it as its first argument instead of `PrismaClient` directly. The real `db` singleton satisfies it; a plain object literal does too, which is how `submit.test.ts` pins the `retriesExhausted` path without real concurrency:

Construct a facade that wraps `db.definitionChange` but intercepts the FIRST `findMany` call to write a competing change directly to the stream before returning the (now stale) original rows. `submit` then tries to append at the wrong expected version, gets a typed `versionConflict`, exhausts retries, and surfaces `retriesExhausted` — all deterministic, no `Promise.all` timing required. The facade must wrap each return value in a `Prisma.PrismaPromise<T>` shape (plain `Promise` doesn't satisfy it — Prisma's type checks `Symbol.toStringTag: "PrismaPromise"`); build the facade object explicitly rather than using `Object.assign` on a real `PrismaPromise` (its `Symbol.toStringTag` is non-writable).
