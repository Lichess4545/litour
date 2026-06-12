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
