import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { chessRegistry } from "@/chess/registry";
import { apiDefaultHook } from "@/server/http/errors";

const vocabularyRoute = createRoute({
  method: "get",
  path: "/",
  summary: "List the registered tournament vocabulary",
  description:
    "What composition can build with, today: every encounter kind, pairing system, scoring rule, tiebreak metric, tie rule, and seed kind the currently loaded registry recognizes. Encounters, scoring rules, tiebreak metrics, tie rules, and seed kinds are closed vocabularies: a definition's `run`, `score`, `tiebreaks`, and `entries` fields (and an encounter's own `tie`) may only name a kind listed here, and naming anything else fails validation. Pairing is the one open-world exception (see `src/tournament/registry.ts`): pairings arrive as inputs to a tournament rather than being fully organizer-authored, so a `pairing.system` outside this list is accepted as long as the definition also states its round count explicitly — `pairings` here is the set this server can schedule and validate structurally on its own, not an exhaustive list of what a definition may legally use. `\"expr\"` appears under both `scorings` and `metrics`: the expression language (ADR 0011) is itself a registered kind, so any scoring rule or tiebreak an organizer can write as a formula shows up here alongside the built-in named rules, not as a separate wire door. `registryId` identifies which vocabulary is loaded (`chess/1` today); a future registry extension would report a different id here.",
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            encounters: z.array(z.string()),
            pairings: z.array(z.string()),
            scorings: z.array(z.string()),
            metrics: z.array(z.string()),
            ties: z.array(z.string()),
            seeds: z.array(z.string()),
            registryId: z.string(),
          }),
        },
      },
      description: "The kinds this server's registry can interpret.",
    },
  },
});

export const vocabularyRouter = new OpenAPIHono({
  defaultHook: apiDefaultHook,
}).openapi(vocabularyRoute, (c) =>
  c.json(
    {
      encounters: [...chessRegistry.encounters.keys()],
      pairings: [...chessRegistry.pairings.keys()],
      scorings: [...chessRegistry.scorings.keys()],
      metrics: [...chessRegistry.metrics.keys()],
      ties: chessRegistry.spec.ties.map((tie) => tie.kind),
      seeds: [...chessRegistry.seeds.keys()],
      registryId: chessRegistry.id,
    },
    200,
  ),
);
