import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

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
      "Reads and writes tournament definitions as an event-sourced " +
      "changelog: every write is an immutable, append-only batch of " +
      "changes (see ADR 0002/0004), and every read folds that changelog " +
      "into the current definition. Writes and reads are deliberately " +
      "separate paths (CQRS): this is not a CRUD resource model. Bearer " +
      "requests authenticate with a lichess OAuth access token via the " +
      "LichessToken security scheme. See /docs for the interactive " +
      "reference.",
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
export const api = new OpenAPIHono()
  .basePath("/api/v1")
  .openapi(healthRoute, (c) => c.json({ status: "ok" as const }, 200));

// Bare statement: mutates the registry in place and returns nothing type-bearing, so
// it has no seam in the chain above to join.
api.openAPIRegistry.registerComponent("securitySchemes", "LichessToken", {
  type: "http",
  scheme: "bearer",
});

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
