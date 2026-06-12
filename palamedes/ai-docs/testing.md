# Testing

Read this when writing or changing tests.

- Run: `bun run test` · one file: `bun run test <path>` · watch:
  `bun run test:watch`.
- Vitest 4 + Testing Library + fast-check. Tests are co-located as
  `*.test.ts` / `*.test.tsx` next to the source.
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
