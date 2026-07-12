# ADR 0008 — The definition API: hono + zod-openapi, CQRS over the changelog

Status: Accepted (2026-07-12)

## Context

The changelog (ADR 0002/0004) has a DAL but no HTTP surface: nothing outside
the Bun process can append or read a definition. tRPC v11 + superjson already
serves the Next.js frontend and must keep doing so — this ADR is about the
REST/OpenAPI surface a third party (or lichess-style external client) needs,
which tRPC's wire format does not serve.

Candidates evaluated (workstream 2 research, 2026-07-12 registry pulls):
ts-rest (`@ts-rest/core` 3.52.1 pins `zod ^3.22.3`; the zod-v4 line stalled
at rc and breaks against stable zod 4 — incompatible with palamedes' zod
`^4.4.3`), trpc-to-openapi 3.3.0 (README-documented: superjson is ignored,
so every exposed procedure's Dates and other transformed values would
silently bypass it), oRPC (`@orpc/server`/`@orpc/openapi` 1.14.7 stable but
2.0 is in beta — a major rewrite in flight; its tRPC bridge's superjson
behavior is undocumented), and hand-rolled route handlers (bespoke method
routing, input parsing, and error envelopes to hand-maintain for every
route). None fit without an accepted cost this API doesn't need to pay.

## Decision

- **Layer**: `hono` (^4.12) + `@hono/zod-openapi` (^1.4.0), whose peer
  dependency is zod `^4.0.0` — satisfied by palamedes' zod `^4.4.3` with no conflict
  (neither library is in `package.json` today; this ADR adopts them). The
  hono app is mounted at `src/app/api/v1/[[...route]]/route.ts` via
  `handle()` from `hono/vercel`, the same pattern hono's own Next.js App
  Router guide documents. The `Hono` app object itself lives server-side in
  `src/server/http/`, per palamedes' existing Prisma-import boundary
  (`palamedes/AGENTS.md`). This stack is totally isolated from tRPC v11 +
  superjson: no shared handlers, no transformer interaction. The two share
  zod schemas and server-side service functions only.
- **CQRS shape**: writes go through `appendChanges` — ADR 0004's single
  door — and the API defines no second write path into
  `DefinitionChange`. Reads fold-on-read via `readDefinition`/`readChanges`
  today; this is explicitly allowed to grow into a separate read
  projection later without changing the wire contract. List reads are
  O(streams × changes), which is acceptable at current scale; a projection
  is the named escape hatch, not a prerequisite.
- **Spec**: OpenAPI 3.1 generated from the zod route definitions
  (`@hono/zod-openapi`'s `doc31`), served at `/api/v1/openapi.json`. This is
  a deliberate divergence from lichess: lichess-org/api hand-writes
  multi-file YAML bundled by `@redocly/cli` because its server is Scala,
  where no in-process schema can generate a spec. Palamedes' route
  boundaries are zod already, so generation is the non-drifting choice —
  hand-written YAML would be a second, driftable copy of the same
  contract. Docs are rendered by `@scalar/api-reference` — verified as the
  exact package `lichess-org/api`'s `doc/package.json` uses for
  lichess.org/api — on a `/docs` page, viewable in dev via `bun run dev`.
- **Versioning**: path-prefixed at `/api/v1`; a breaking wire change bumps
  the prefix rather than versioning individual routes.
- **Error envelope**: every non-2xx response body is
  `{ "error": { "code": string, "message": string, "details"?: unknown } }`.
  `change-store.ts`'s `AppendError` union maps onto HTTP status by kind:
  `versionConflict` → 409, `notFound` → 404, `alreadyExists` → 409,
  `emptyBatch` / `malformedChange` / `invalidBatch` / `invalidDefinition` →
  422.
- **Reserved URL space**: `/api/v1/definitions/{streamId}/runs…` is reserved
  for the results stream (ADR 0006, proposed but not built — deferred
  pending Dr. Dub decision D3) so the definition API's URL space doesn't
  need renegotiating once results land.

## Consequences

- Every operation exposed both to tRPC and to this API needs its business
  logic extracted into a server-side service function called from both —
  writing the handler twice is the accepted cost of total isolation from
  tRPC/superjson.
- The OpenAPI spec, the Scalar docs page, and typed clients all derive
  from the same zod schemas the changelog already validates against; there
  is one schema to keep in sync, not two.
- List-read performance is deferred, not solved: O(streams × changes)
  holds until a projection is built.
- The `/runs` prefix is inert until ADR 0006 is accepted and built; this
  ADR only reserves the namespace.
