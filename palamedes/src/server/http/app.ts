import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { Env, ErrorHandler } from "hono";
import {
  apiDefaultHook,
  toUnexpectedErrorResponse,
} from "@/server/http/errors";
import { definitionsReadRouter } from "@/server/http/routes/definitions-read";
import { vocabularyRouter } from "@/server/http/routes/vocabulary";

export const apiErrorHandler: ErrorHandler<Env> = (err, c) => {
  console.error("[http/app] unhandled error", err.name, err.message);
  const mapped = toUnexpectedErrorResponse();
  return c.json(mapped.body, mapped.status);
};

// A createRoute, not a bare c.json handler: the OpenAPI document below is
// generated from registered routes, so a bare handler would be invisible in it.
const healthRoute = createRoute({
  method: "get",
  path: "/health",
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({ status: z.literal("ok") }),
        },
      },
      description: "The API is reachable.",
    },
  },
});

const openApiConfig = {
  openapi: "3.1.0" as const,
  info: {
    title: "Palamedes API",
    version: "0.1.0",
    description:
      "A tournament **definition** is not a record you overwrite — it is " +
      "the fold of an append-only changelog of **changes** (never " +
      '"events": that name already belongs to the tournament model ' +
      "itself, `EventDef`/`EventState`). Every write appends an immutable " +
      "batch of changes (ADR 0002/0004); every read folds a stream's " +
      "changelog into the definition it currently describes. A stream's " +
      "**version** is the count of changes folded into it — the same " +
      "number optimistic-concurrency writes check against (ADR 0003).\n\n" +
      "Reads and writes are deliberately separate paths (CQRS), not a " +
      "CRUD resource model. The endpoints below are the read side: list " +
      "definitions, fetch one, walk its changelog, and expand it into " +
      "the **concrete** projection that display mechanisms run off " +
      "(`concretify`) — plus the registered **vocabulary**, the kind " +
      "names composition can build tournaments out of today.\n\n" +
      "Every route in this document is a read and requires no " +
      "authentication — anonymous access is the default (ADR 0009). The " +
      "`LichessToken` bearer scheme registered here belongs to the " +
      "definition-authoring write door, not these. See /docs for the " +
      "interactive reference.",
  },
};

// NOTE: `OpenAPIHono#openapi`/`#route` are fluent — each returns a NEW
// `OpenAPIHono<E, S & ToSchema<...>>`, widening the type rather than mutating the
// receiver. A route registered as a bare statement below this `const` still works at
// runtime (registration is a separate mutable side channel) but leaves the exported
// `api` binding's static route-schema type at `{}` — wrong by omission. Tasks 14/15
// must extend this chain itself (`.route("/definitions", definitionsRouter)`, appended
// here), not add statements below it. `app.test.ts` pins this with a
// `satisfies RegisteredApiPaths` check that fails to compile (TS1360) if the chain is
// broken apart — it is not pointless ceremony.
export const api = new OpenAPIHono({ defaultHook: apiDefaultHook })
  .basePath("/api/v1")
  .openapi(healthRoute, (c) => c.json({ status: "ok" as const }, 200))
  .route("/definitions", definitionsReadRouter)
  .route("/vocabulary", vocabularyRouter);

// Bare statement: mutates the registry in place and returns nothing type-bearing, so
// it has no seam in the chain above to join.
api.openAPIRegistry.registerComponent("securitySchemes", "LichessToken", {
  type: "http",
  scheme: "bearer",
});

// Bare statement, empirically required: chaining `.onError(apiErrorHandler)` onto the
// `api` chain above (after `.basePath()` — directly or via `.route()`, which calls it
// internally) makes `.onError()` return a detached clone with `openAPIRegistry`
// undefined — verified with a standalone repro: `step.onError(handler) !== step` and
// `step.onError(handler).openAPIRegistry` is `undefined`, because `.basePath()`'s
// `Object.assign(this, optionsWithoutStrict)` clobbers the new instance's own
// `onError` class field with a stale one bound to a discarded intermediate clone.
//
// That clone is not inert, which is *why* the bare call below still works: the same
// `Object.assign` clobbers `request`/`fetch` too, so `api.request()`/`api.fetch()` —
// the actual dispatch entry points every real request and `app.test.ts` go through —
// are bound to that identical clone, and read whatever `errorHandler` this bare call
// just set on it. `router`/`routes` are shared by reference (not copied) across every
// clone in this chain, so routes registered via `.openapi()`/`.route()` above still
// land in the one router `fetch` reads from, despite `.on`/`.get` having the same
// stale binding. Calling `.onError()` bare and mutating the clone directly is what
// lets error handling reach the object dispatch actually uses; chaining it into the
// fluent chain instead would make its return value — the `openAPIRegistry`-less
// detached clone — the new `api`, silently discarding `.doc31()`/`.openapi()`/
// `getOpenAPI31Document` along with it.
api.onError(apiErrorHandler);

// Deliberately NOT chained onto `api` above. In the installed @hono/zod-openapi
// (1.4.0), `OpenAPIHono#basePath` rebuilds the instance as
// `new OpenAPIHono({ ...super.basePath(path), defaultHook })`; the `HonoBase#clone()`
// that `super.basePath()` spreads from builds fresh `get`/`on`/`use` closures bound to
// a throwaway intermediate clone, and `Hono`'s own constructor then `Object.assign`s
// those stale closures over the new instance's. `.openapi()` survives this because its
// body is `this.on(...); return this;` — it discards `on()`'s stale return and hands
// back `this` explicitly. `.doc31()`/`.doc()` don't: their body is
// `return this.get(path, handler)`, which propagates the stale clone — no
// `openAPIRegistry`, not even an `OpenAPIHono`. Chaining `.doc31()` onto `.basePath()`
// therefore crashes the next line that touches `openAPIRegistry` on the result
// ("Cannot read properties of undefined (reading 'registerComponent')"). Re-check this
// against release notes before any @hono/zod-openapi upgrade — a fixed `basePath` would
// make chaining safe again.
api.doc31("/openapi.json", openApiConfig);

export function openApiDocument() {
  return api.getOpenAPI31Document(openApiConfig);
}
