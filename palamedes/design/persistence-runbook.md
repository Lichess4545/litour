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

A read returning `{ ok: false, error }` with `error.kind` one of
`corruptPayload` / `unknownSchemaRev` names the stream, `seq`, and `version` —
see "Diagnose payload drift" below.

## Diagnose payload drift

`readChanges`, `readDefinition`, and `readAllChanges` can all return a
`PayloadError` instead of succeeding. Two kinds, two different causes:

- **`corruptPayload`** — the row's payload, after upcasting, fails
  `defChangeSchema`. Either it was hand-edited or written outside the DAL, or
  it's an old, legitimate shape that needs an upcaster nobody wrote yet.
- **`unknownSchemaRev`** — the row's `schemaRev` has no path to
  `CURRENT_SCHEMA_REV`: either it's ahead of what this deploy knows (this
  deploy is older than the data — check you're not running behind a newer
  migration) or it's behind, with a gap in `UPCASTERS` (a rev nobody wrote an
  upcaster for).

Check `error.streamId` / `error.seq` / `error.version` (`corruptPayload` also
carries `error.issues`; `unknownSchemaRev` carries the offending
`error.schemaRev`) against `CURRENT_SCHEMA_REV` and the `UPCASTERS` map in
`change-store.ts`.

Never hand-edit or delete the row to make it read clean — rows are
write-once (ADR 0010); mutating history breaks replay. Fix forward: add the
missing rev's function to `UPCASTERS` (pure `unknown -> unknown`, old shape
in, next rev's shape out) and re-read.

Two call sites surface the identical drift as a throw instead of a typed
result, because each needs readable prior state to proceed and has nothing
sensible to fall back to:

- `submit` — the stream state it read before deciding is unreadable; the
  drifted row can be any historical version, not necessarily the head.
- `appendChanges` — its pre-write fold read hits an unreadable row among the
  stream's existing history, before it can fold the new batch on top.

Both throw messages include the `PayloadError` kind and, where present,
`seq`. Same fix applies to either — add the missing upcaster; the next call
reads cleanly.

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
