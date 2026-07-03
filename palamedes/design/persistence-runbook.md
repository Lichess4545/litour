# Runbook — tournament definition changelog

Operating the definition change store on a dev machine. All commands run
from `palamedes/`.

## Bring up the database

```bash
devenv up -d         # detached; or omit -d to run foreground
pg_isready -h 127.0.0.1 -p 5432   # inside devenv shell → "accepting connections"
```

PostgreSQL 18 on 127.0.0.1:5432, db/user/password all `palamedes`
(devenv.nix). `.env` carries DATABASE_URL.

## Migrate

```bash
bun run db:migrate -- --name <change>   # dev: creates + applies migration
bun run db:generate                     # REQUIRED after migrate — client is NOT auto-regenerated
bun run db:deploy                       # prod-style: apply pending only
```

Schema changes are made in `prisma/schema.prisma` ONLY; migration SQL is
always generated, never hand-written. Shadow-db errors mean postgres wasn't
started via devenv. In this Prisma 7 configuration `prisma migrate dev` does
not auto-regenerate the client — always run `bun run db:generate` after.

## Seed

```bash
bun run db:seed
```

Idempotent. Seeds in order:

1. Demo auth user (`demo@example.com` / `demo-password-123`) + 3 demo posts.
2. `team4545` league definition stream.
3. `lonewolf` league definition stream (Open + U1800 sections).

Re-runs print `unchanged` for streams whose content matches canon. A stream
whose content diverges from canon prints `divergent` and is left untouched —
inspect and delete before reseeding. Known structural deviations from the
live lichess4545.com are printed on every run (see ADR 0005).

## Inspect

```bash
bun run db:studio    # browse definition_change rows
```

Programmatic:

- `readChanges(db, streamId)` — one stream, version order.
- `readDefinition(db, streamId, { toVersion? })` — rehydrate; time-travel at
  batch boundaries only (mid-batch prefix may return `invalidPrefix`).
- `readAllChanges(db, { afterSeq?, limit? })` — global scan in seq order;
  seq has gaps and commit-skew — use for inspection only, not as a reliable
  poller cursor (see ADR 0003, ADR 0007).

A `corrupt DefinitionChange payload` error names the stream and seq: a row
was written outside the DAL. Fix by deleting the offending row (dev only)
or escalating.

## Test

```bash
bun run test                                    # everything (db suites skip visibly when pg is down)
bun run test src/server/tournament              # the store suites only
```

`describeWithDb` skips its suite with a console warning when postgres is
unreachable — never silently passes. A change that touches the store must
not be judged green on skipped suites; bring postgres up first.

## Recover / reset (dev only)

Streams are append-only; there is no delete API. To remove dev debris:

- Via studio: `bun run db:studio` → delete the stream's `definition_change`
  rows.
- Via script: `db.definitionChange.deleteMany({ where: { streamId } })` in
  a scratch file.

Never edit rows in place — versions must stay dense and payloads must keep
folding. To reset ALL tournament data: delete every row in
`definition_change` via studio or `db.definitionChange.deleteMany({})`, then
re-run `bun run db:seed`.
