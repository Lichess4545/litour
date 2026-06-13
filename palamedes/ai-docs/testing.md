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
