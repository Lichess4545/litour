# Database: Prisma 7 + Postgres (devenv)

Read this when touching `prisma/schema.prisma`, migrations, seeds, or writing
Prisma queries.

## Prisma 7 differs from your training data

- The client is generated into `src/generated/prisma/` (generator
  `prisma-client`). Import `PrismaClient` from `@/generated/prisma/client` —
  not from `@prisma/client`.
- The datasource URL lives in `prisma.config.ts` (read from `.env` via
  dotenv); the datasource block in `schema.prisma` has no `url`.
- The app connects through the driver adapter `@prisma/adapter-pg`. Always use
  the `db` singleton from `@/server/db`; never construct a new `PrismaClient`.

## Workflow

Agents edit `prisma/schema.prisma` only, then ask the user to run:

| Task | Command |
|---|---|
| Create + apply migration (dev) | `bun run db:migrate -- --name <change>` |
| Apply pending migrations (prod-style) | `bun run db:deploy` |
| Regenerate client | `bun run db:generate` (also runs on install via postinstall) |
| Seed | `bun run db:seed` (runs `prisma/seed.ts`) |
| Browse data | `bun run db:studio` |

`prisma migrate dev` does NOT auto-regenerate the Prisma client in this Prisma 7
configuration — run `bun run db:generate` after every `bun run db:migrate`.

- Postgres comes from `devenv up`: PostgreSQL 18 on `127.0.0.1:5432`,
  database/user/password all `palamedes` (`devenv.nix`).
- `prisma migrate dev` needs a shadow database; the devenv postgres grants the
  role `CREATEDB` for exactly that. Shadow-DB permission errors usually mean
  postgres wasn't started via devenv.

## Schema notes

- `User` / `Session` / `Account` / `Verification` mirror the Better Auth CLI
  output (`bunx @better-auth/cli generate`) and are `@@map`ped to lowercase
  table names. If a Better Auth config change requires schema changes,
  regenerate and diff — don't hand-invent fields.
- Domain models go under the "Domain models" section of `schema.prisma`;
  `Post` is the disposable example (trpc.md and testing.md cite its files as
  pattern exemplars — repoint them when it goes).
- The seed creates `demo@example.com` / `demo-password-123` through the real
  Better Auth sign-up flow, so the password hash works for login.

## The tournament definition changelog

Domain model `DefinitionChange` (`@@map("definition_change")`) is an
event-sourced changelog of tournament DEFINITIONS: one row per **change**
(never "event" — `EventDef` is the tournament itself), streams keyed by
`streamId == EventDef.id`, versions 1-based and dense per stream,
`payload Json` holding the whole zod-validated `DefChange`, `type`
duplicating the discriminant, `seq` a passive global order (gaps + commit
skew — not a poller cursor). Decisions: `design/adr/0001-0005`.

- ALL reads and writes go through `src/server/tournament/change-store.ts`
  (`appendChanges`/`readChanges`/`readDefinition`/`readAllChanges`/`submit`)
  — never query the table directly outside tests. Appends are batch-atomic
  and gated (fold + `safeParseEventDef`), concurrency is optimistic via the
  `@@unique([streamId, version])` constraint (P2002 ⇒ typed
  versionConflict; no transactions).
- The PURE change domain (types/schemas/fold/decompose) is
  `src/tournament/changes/` — no Prisma imports there, ever.
- Stay inside the portable-Prisma subset for this table (ADR 0001): no
  enums, no `@db.*`, no scalar lists, no `skipDuplicates`, no
  `isolationLevel`, no raw SQL, `Int` seq, payloads as opaque whole values.
- `recordedAt` is `TIMESTAMP(3)` (naive datetime) — the portable subset
  forbids `@db.Timestamptz`; the DAL sets `recordedAt: new Date()` explicitly
  on every `createMany` row (the adapter serializes UTC); the column
  `@default(now())` fires only if a row is written outside the DAL (e.g. a
  direct SQL insert in a test), where the database's local timezone applies —
  avoid writing rows outside the DAL; see ADR 0001.
- `bun run db:seed` also seeds the two lichess4545 league streams
  (`team4545`, `lonewolf`) idempotently via
  `src/server/tournament/seed.ts`; divergent streams are reported, never
  clobbered (ADR 0005).
