<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Palamedes

Standalone full-stack app: Bun + Next.js 16 App Router, tRPC v11, Prisma 7 +
Postgres, Better Auth, TanStack Query/Table/Form, Zustand, Tailwind v4 +
shadcn. It is not wired to the parent Django/FastAPI app: the root CLAUDE.md
"Architecture rules" do not apply here; everything else there
(command/test/git/migration policies, code style) still does.

Its substantive feature is a **recursive tournament meta-model**: every
chess format (swiss, knockout, the World Championship, the Grand Chess Tour
with whole tournaments nested inside it) is plain data interpreted by one
engine. `src/tournament/` is the engine (no chess vocabulary); `src/chess/`
is the chess vocabulary built on it (kinds + the `compose.ts` authoring
API); `src/components/tournament/` + `/tournaments` is the interactive
viewer. The rest of the tree (`posts/`, auth, the tRPC/Prisma plumbing) is
scaffold. The contract lives in `design/tournament-model.md`.

## Commands (suggest only — the user runs them)

- Dev server: `bun run dev` (postgres comes from `devenv up`)
- Typecheck: `bun run typecheck` · lint: `bun run lint` · autofix: `bun run fix`
- Tests: `bun run test` · coverage: `bun run test:coverage` (v8; HTML +
  JSON in `coverage/`)
- NEVER suggest `bun test` — that is Bun's built-in runner and it ignores
  `vitest.config.ts`.

## Invariants

- Only server-side code imports Prisma or the Better Auth server config:
  `src/server/`, the `src/app/api/` route handlers, `src/trpc/server.tsx`,
  `src/test/db.ts`, and `prisma/seed.ts`. Everything else talks to the
  backend through tRPC. Type-only imports (e.g. `AppRouter`) are fine.
- Generated — never hand-edit: `src/components/ui/` (shadcn),
  `src/generated/prisma/` (Prisma client).
- New env vars go through `src/env.ts` (t3-env + zod, validated at build
  time); don't read `process.env` anywhere else.
- Schema changes: edit `prisma/schema.prisma` only; never write into
  `prisma/migrations/` — tell the user to run
  `bun run db:migrate -- --name <change>`.

## Task docs (read on demand — not preloaded)

Match the task, read the doc before starting:

- The tournament meta-model — the engine, chess kinds, the `compose.ts`
  authoring API, or the viewer → `design/tournament-model.md` (the contract)
- Schema, models, migrations, seeds, or Prisma queries → `ai-docs/db.md`
- tRPC procedures, data fetching, forms, auth wiring, client state, shadcn components → `ai-docs/trpc.md`
- Writing or changing tests → `ai-docs/testing.md`
- Flow/diagram/canvas UI → `ai-docs/react-flow.md`
- Next.js specifics → `node_modules/next/dist/docs/01-app/` (start in
  `01-getting-started/`; file conventions in `03-api-reference/03-file-conventions/`)
- Adding an OAuth provider → `README.md` § "Adding an OAuth provider"
- Adding a dependency with install scripts → `README.md` § "Bun gotchas"
