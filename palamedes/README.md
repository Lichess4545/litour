# Palamedes

A production-shaped full-stack scaffold: Next.js App Router + tRPC + Prisma +
Better Auth + TanStack + Zustand, with Postgres run by devenv.

## Quickstart

```sh
direnv allow                      # loads the devenv environment (bun, node, postgres tooling)
devenv up                         # starts backend services (postgres) — keep it running
bun run db:migrate -- --name init # first migration (already created if you cloned with prisma/migrations/)
bun run db:seed                   # demo user + posts (demo@example.com / demo-password-123)
bun run dev                       # the Next.js app on http://localhost:3000
```

`devenv up` runs services only. The app is deliberately not a devenv process —
run it yourself with `bun run dev`.

## Stack

| Layer | Choice |
|---|---|
| Package manager / scripts | Bun |
| Framework | Next.js 16 (App Router, `src/`, Turbopack) + React 19 |
| Language | TypeScript, `@tsconfig/strictest` + `@tsconfig/next`, zero `any`, zero casts |
| Lint/format | Biome only |
| UI | Tailwind v4 + shadcn/ui (`src/components/ui/` is generated — don't hand-edit) |
| API layer | tRPC v11 + `@trpc/tanstack-react-query` + superjson; zod on every input |
| Server state | TanStack Query v5 (via tRPC) |
| Client state | Zustand v5 (per-request store provider — see `src/stores/ui-store.tsx`) |
| Tables / forms | TanStack Table + TanStack Form (zod via standard-schema) |
| Database | PostgreSQL 18 (devenv service) + Prisma 7 (driver adapter `@prisma/adapter-pg`) |
| Auth | Better Auth + Prisma adapter; email+password on, OAuth provider-agnostic |
| Env | `@t3-oss/env-nextjs` + zod, validated at build time (`src/env.ts`) |
| Tests | Vitest + Testing Library + fast-check |
| Dev env | devenv + direnv |

## Folder map

```
src/
  tournament/                # THE tournament engine — no chess vocabulary
                             #   core · registry · evaluate · engine · standings · concrete · builder
  chess/                     # the chess vocabulary, built on the engine
                             #   encounters · pairings · scorings · metrics · ties · seeds
                             #   compose.ts (authoring API) · formats.ts (the catalog)
  app/                       # routes & composition only — no business logic
    api/auth/[...all]/route.ts
    api/trpc/[trpc]/route.ts
    (auth)/sign-in/page.tsx
    posts/page.tsx
    tournaments/             # the meta-model viewer (list + [slug])
  components/
    ui/                      # shadcn-generated — never hand-edit
    tournament/              # the React Flow viewer (def-graph.ts layout + tournament-flow.tsx)
    posts/                   # domain components (table, form, section)
  server/                    # THE backend — server-side code only (see boundary rule)
    db.ts                    # prisma singleton (driver adapter)
    auth.ts                  # better-auth instance
    api/
      trpc.ts                # init, context, public/protected procedures
      root.ts                # appRouter + createCaller
      routers/post.ts
  trpc/                      # typed client plumbing (provider, RSC helpers, types)
  stores/                    # zustand stores (provider pattern)
  lib/                       # shared pure utils + auth-client
  env.ts                     # t3-env + zod
  test/                      # vitest setup + describeWithDb
  generated/prisma/          # prisma-generated client — never hand-edit
design/
  tournament-model.md        # the meta-model's design contract
prisma/
  schema.prisma
  seed.ts
prisma.config.ts             # Prisma 7 config (datasource url, seed command)
```

The tournament meta-model is the substantive feature; `design/tournament-model.md`
is its design contract. Everything else (`posts/`, auth, the tRPC/Prisma
plumbing) is full-stack scaffold.

## The API boundary rule

**Only server-side code imports Prisma or the Better Auth server config:**
`src/server/`, the `src/app/api/` route handlers, `src/trpc/server.tsx`,
`src/test/db.ts`, and `prisma/seed.ts`. Client and UI code talks to the backend
exclusively through the tRPC client (`useTRPC()` in client components,
`src/trpc/server.tsx` in RSCs). Type-only imports (e.g. `AppRouter`) are fine —
they are erased at build time.

## Adding an OAuth provider (e.g. GitHub)

1. Fill `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` in `.env` (they're already
   declared, optional, in `src/env.ts`).
2. Uncomment the provider in `socialProviders` in `src/server/auth.ts`.
3. Add an entry to `oauthProviders` in `src/app/(auth)/sign-in/page.tsx`.

Nothing else changes — the sign-in page renders a button per configured
provider and works with email+password before any provider exists.

## Database workflow

```sh
bun run db:migrate -- --name <change>  # create + apply a migration (dev)
bun run db:deploy                      # apply pending migrations (prod-style)
bun run db:seed                        # run prisma/seed.ts
bun run db:studio                      # browse data
bun run db:generate                    # regenerate the client (also runs on postinstall)
```

Notes:

- Prisma 7: the datasource URL lives in `prisma.config.ts` (loaded from `.env`
  via dotenv); the app connects through `@prisma/adapter-pg` in
  `src/server/db.ts`; the client is generated into `src/generated/prisma/`.
- `prisma migrate dev` needs a shadow database; the devenv postgres grants the
  `palamedes` role `CREATEDB` for exactly that.

## Testing

```sh
bun run test          # vitest run
bun run test:watch    # vitest watch mode
bun run test:coverage # vitest run --coverage (v8 → text + HTML + JSON in coverage/)
```

> **Warning:** do NOT run `bun test` — that invokes Bun's built-in test runner,
> which ignores `vitest.config.ts` entirely. Always `bun run test`.

- The tournament engine + chess library are the well-covered core (~93–96%
  lines); the viewer's layout is tested as a pure function (`def-graph.test.ts`);
  the full-stack scaffold is intentionally light. Coverage excludes generated
  code (Prisma, shadcn `ui/`) and the test setup.
- DB-backed suites use `describeWithDb` from `src/test/db.ts`: when postgres
  isn't running they are skipped **visibly** (shown as skipped + a warning),
  never silently green.
- `src/server/api/routers/post.test.ts` exercises the router through
  `createCaller` against the real database.
- `src/lib/slugify.test.ts` shows fast-check property tests.

## Bun gotchas (encoded in this scaffold)

- Bun blocks dependencies' postinstall scripts by default. `prisma` and
  `@prisma/engines` are in `trustedDependencies` in `package.json`; if another
  dep genuinely needs its lifecycle script, add it there too.
- The project's own `"postinstall": "prisma generate"` does run on
  `bun install`.

## Environment variables

Typed and validated in `src/env.ts` (t3-env + zod); a bad or missing variable
fails the build via the `import "./src/env"` in `next.config.ts`. Copy
`.env.example` to `.env` to get started. Set `SKIP_ENV_VALIDATION=1` to bypass
validation (e.g. for Docker image builds without secrets).
