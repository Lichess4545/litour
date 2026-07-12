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

## Secrets (secretspec)

`BETTER_AUTH_SECRET` and the optional `LICHESS_API_TOKEN` no longer live in
`.env`. `secretspec.toml` declares them; `devenv.yaml`'s `secretspec` block
resolves them (`provider: keyring`, `profile: development`); `devenv.nix`
feeds the result in as `env.BETTER_AUTH_SECRET` and `env.LICHESS_API_TOKEN`.
`.env` (via `dotenv.enable`) still carries everything non-secret —
`DATABASE_URL`, `BETTER_AUTH_URL`, the OAuth client ids.

Dev `DATABASE_URL` stays in `.env` by design, not by omission: it isn't in
`secretspec.toml`. Per "Precedence" below, a secretspec-fed `env.*` value
always wins over `.env` — managing `DATABASE_URL` there would silently
override whatever database URL a developer has configured locally, every
time. Production `DATABASE_URL` secret management is a separate, deferred
problem — Task 9 doesn't solve it.

### One-time provisioning

The `secretspec` binary must already be on PATH — it resolves secrets
before devenv can enter a shell, so devenv can't hand it to you. Install:
`curl -sSL https://install.secretspec.dev | sh` (Nix and other options at
https://secretspec.dev).

```bash
cd palamedes
secretspec config init          # choose the keyring provider
secretspec set BETTER_AUTH_SECRET
secretspec set LICHESS_API_TOKEN   # optional — only if you run server-side lichess jobs
secretspec check                # confirms all required secrets resolve
devenv up                       # or: devenv shell
```

Never put a real value in `secretspec.toml`, `devenv.yaml`, `devenv.nix`,
any doc, or `.env` — `secretspec.toml` declares names and metadata only;
the values live in your OS keyring (or whatever provider you configure),
never in the repo.

If you already have `BETTER_AUTH_SECRET` in your own `.env` from before
this change, remove it there — see "Migrating an existing `.env`" below.

### Migrating an existing `.env`

This repo's `.env` is untracked, so nothing in git changed underneath you.
On your own machine, once `secretspec set BETTER_AUTH_SECRET` has run
successfully, delete the `BETTER_AUTH_SECRET` line from your `.env` — it's
dead weight now (see "Precedence" below for why leaving it in place is
harmless but pointless, not dangerous).

### Precedence

`devenv.nix`'s `env.BETTER_AUTH_SECRET = config.secretspec.secrets.BETTER_AUTH_SECRET or ""`
wins over any value `dotenv.enable` loads from `.env`, for any variable
both define. Verified by setting differing dummy values in each and
checking which one a shell inside `devenv shell` actually sees, with
the provider overridden to `env` (`SECRETSPEC_PROVIDER=env` — this
sandbox has no keyring backend; see "Headless / CI / container
machines" below). The result holds regardless of which provider
resolves the secretspec side: this is a Nix module-merge fact about
`env.*` beating `dotenv`, not a keyring-specific behavior. The `.env`
value is not merged, ignored partially, or used as a fallback when
secretspec has an answer — secretspec's value replaces it outright.

The `or ""` isn't a guard against a normal missing secret — secretspec's
own required-secret check blocks `devenv shell` before Nix ever evaluates
this expression (see "Missing secret" below). It guards against
`secretspec.toml` and `devenv.nix` drifting out of sync — a key renamed or
removed in one file but not the other.

### Missing secret

`BETTER_AUTH_SECRET` is `required = true` in the `development` profile.
If it isn't set yet, `devenv shell` and `devenv up` refuse to enter at
all — and so does plain `direnv allow`: secret resolution runs inside
devenv's own `Devenv::new()`, which every devenv subcommand goes through,
including the `direnv-export` step `.envrc`'s `use devenv` invokes. On a
fresh clone, `direnv allow` fails with this same error before any devenv
command runs directly:

```
devenv::secrets_need_prompting
  × Missing required secrets: BETTER_AUTH_SECRET
  help: Run `devenv shell` to set the missing secrets.
```

This is a breaking change to the old dev loop, by design: a missing
secret fails the shell instead of silently producing a broken app. Run
`secretspec set BETTER_AUTH_SECRET` once and re-enter.

Even in a hypothetical path where an unset secret reached the app as an
empty string, it wouldn't get far: `src/env.ts`'s
`emptyStringAsUndefined: true` turns `""` into `undefined`, and
`BETTER_AUTH_SECRET: z.string().min(16)` has no `.optional()`, so
`createEnv()` throws the moment anything imports `src/env.ts`. That
happens at `next build`/`dev`/`start` (via `next.config.ts`) and at
`bun run test` (transitively — `src/test/db.ts` → `src/server/db.ts` →
`src/env.ts` — crashing test collection loudly, not quietly). It does
**not** happen at `bun run typecheck` or `bun run lint`: `tsc --noEmit`
and `biome check` are static analysis and never execute `createEnv()`, so
a broken env passes both of those cleanly — don't rely on typecheck or
lint to catch this.

On a machine where `devenv shell` fails before ever reaching this error
(no keyring backend, not a missing secret) — see "Headless / CI /
container machines" below.

### Headless / CI / container machines

`provider: keyring` needs a D-Bus Secret Service (a desktop session
keyring). On a machine without one, `devenv shell` fails at the keyring
step before your commands even run. Override the provider for that shell:

```bash
devenv --secretspec-provider env shell
# or: SECRETSPEC_PROVIDER=env devenv shell
```

`env` resolves each secret from a same-named process environment variable
instead of the keyring — set it however your CI already injects secrets.
`dotenv` is the same idea sourced from a file instead. This is the
supported override, not a workaround.

### Not a secret

`LICHESS_CLIENT_ID` is deliberately absent from `secretspec.toml` — it
isn't a secret. See `design/adr/0009-lichess-oauth-and-permissions.md`
§ "Secrets" for why.

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
