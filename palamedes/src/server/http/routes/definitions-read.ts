import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { defChangeSchema } from "@/chess/changes";
import { chessRegistry } from "@/chess/registry";
import { db } from "@/server/db";
import {
  apiDefaultHook,
  apiErrorCodes,
  toErrorResponse,
} from "@/server/http/errors";
import { readChanges, readDefinition } from "@/server/tournament/change-store";
import { type ConcreteEvent, concretify } from "@/tournament/concrete";

const streamIdParams = z.object({
  streamId: z
    .string()
    .min(1)
    .openapi({
      param: { name: "streamId", in: "path" },
      example: "team4545",
      description:
        "The stream id identifying a definition's changelog — the same id used when the stream was created.",
    }),
});

const toVersionQuery = z.object({
  toVersion: z.coerce
    .number()
    .int()
    .min(1)
    .optional()
    .openapi({
      param: { name: "toVersion", in: "query", required: false },
      example: 3,
      description:
        "Time-travel: only fold changes up to and including this version, showing the stream as it looked at that point in its history. Omit to read the current version.",
    }),
});

const errorEnvelopeSchema = z
  .object({
    error: z.object({
      code: z.enum(apiErrorCodes),
      message: z.string(),
      details: z.unknown().optional(),
    }),
  })
  .openapi("ErrorEnvelope");

const definitionSummarySchema = z.object({
  streamId: z.string(),
  name: z.string(),
  version: z.number().int(),
  ownerId: z.string().nullable(),
});

const listRoute = createRoute({
  method: "get",
  path: "/",
  summary: "List every known tournament definition",
  description:
    "Every tournament definition this server knows about, one row per stream, ordered by stream id ascending: its id, current name, the version its changelog is folded to, and its owner (null for the seeded lichess4545 league definitions, which predate per-user ownership — ADR 0009). A stream whose changelog cannot be folded into a valid definition — a corrupted row, a change at a schema revision this server has no upcaster for, or a changelog that folds cleanly yet whose resulting definition no longer passes validation because the registry's rules changed underneath it — is left off this list rather than failing the whole request; call the detail endpoint for that stream to see its specific error. This list is therefore not guaranteed exhaustive.",
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({ definitions: z.array(definitionSummarySchema) }),
        },
      },
      description: "The definitions this server knows about.",
    },
  },
});

const detailRoute = createRoute({
  method: "get",
  path: "/{streamId}",
  summary: "Fetch one tournament definition",
  description:
    "The definition for a single stream, folded from its full changelog: its name, competitors, and competition structure — the same data the tournament engine reads to run standings and pairings, not a summary of it. 404 if no stream exists at this id; 500 with code `invalid_stream` if the stream's changes exist but cannot be folded into a valid definition — a corrupted row, a change at a schema revision this server has no upcaster for, a changelog whose changes cannot be folded together at all (a structurally inapplicable change, or a stream with no changes recorded against it), or a changelog that folds cleanly yet whose resulting definition no longer passes validation because the registry's rules changed underneath it since the last write.",
  request: { params: streamIdParams },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            streamId: z.string(),
            version: z.number().int(),
            definition: chessRegistry.eventSchema,
          }),
        },
      },
      description: "The folded definition, at its current version.",
    },
    400: {
      content: { "application/json": { schema: errorEnvelopeSchema } },
      description:
        "A malformed `streamId` path parameter reaches this status — today, only an empty segment (the schema requires a non-empty string) can trip it. `details` carries zod's per-issue array (`path`, `code`, `message`); the raw input value is deliberately not echoed back.",
    },
    404: {
      content: { "application/json": { schema: errorEnvelopeSchema } },
      description: "No stream exists with this id.",
    },
    500: {
      content: { "application/json": { schema: errorEnvelopeSchema } },
      description:
        "Two disjoint outcomes share this status: `invalid_stream`, when this stream's changelog has a corrupted row, a change at a schema revision this server has no upcaster for, cannot be folded together at all (a structurally inapplicable change, or no changes recorded despite the stream existing), or folds cleanly yet its resulting definition no longer passes validation because the registry's rules changed underneath it since the last write (`details` carries the failure); `internal`, an unrelated server error (no `details`).",
    },
  },
});

const storedChangeSchema = z.object({
  version: z.number().int(),
  type: z.string(),
  actorId: z.string().nullable(),
  recordedAt: z.string(),
  schemaRev: z.number().int(),
  registryId: z.string(),
  change: defChangeSchema,
});

const changesRoute = createRoute({
  method: "get",
  path: "/{streamId}/changes",
  summary: "Fetch a definition's changelog",
  description:
    "The raw sequence of changes recorded against a stream, in version order — folding all of them is what `GET /definitions/{streamId}` returns. Each entry carries the version it produced, its `type`, who made it (`actorId`, null for seeded or system writes), and when it was recorded. Pass `toVersion` to see only the prefix up to and including that version; the detail and concrete endpoints always return the current version and take no such parameter today. 404 if no stream exists at this id; 500 with code `invalid_stream` if a stored change cannot be parsed, or was written at a schema revision this server does not understand.",
  request: { params: streamIdParams, query: toVersionQuery },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            streamId: z.string(),
            version: z.number().int(),
            changes: z.array(storedChangeSchema),
          }),
        },
      },
      description: "The stream's changelog, in version order.",
    },
    400: {
      content: { "application/json": { schema: errorEnvelopeSchema } },
      description:
        "A malformed path or query parameter reaches this status: an empty `streamId`, or a `toVersion` that isn't a positive integer — non-numeric (`abc`), fractional, or less than 1 (`0`, negative). `details` carries zod's per-issue array (`path`, `code`, `message`); the raw input value is deliberately not echoed back.",
    },
    404: {
      content: { "application/json": { schema: errorEnvelopeSchema } },
      description: "No stream exists with this id.",
    },
    500: {
      content: { "application/json": { schema: errorEnvelopeSchema } },
      description:
        "Two disjoint outcomes share this status: `invalid_stream`, when a stored change in this stream could not be parsed or was written at an unsupported schema revision (`details` carries the failure); `internal`, an unrelated server error (no `details`).",
    },
  },
});

const concreteRoute = createRoute({
  method: "get",
  path: "/{streamId}/concrete",
  summary: "Fetch a definition's concrete display projection",
  description:
    "Expands a definition — a pairing system, a scoring rule, a tiebreak list, described in the abstract — into the literal, walkable structure a display renders directly: every round, every pairing slot, the standings card, and each tiebreak's computation as plain data (`concretify`, the mandate that display mechanisms run off this data rather than bespoke per-format rendering code). `concrete` is an honest `unknown` for now: it is the recursive `ConcreteEvent` shape from `src/tournament/concrete.ts`, and a tightened wire schema for it is tracked as a follow-up rather than hand-declared here and left to drift. 404 if no stream exists at this id; 500 with code `invalid_stream` if the underlying definition cannot be read.",
  request: { params: streamIdParams },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            streamId: z.string(),
            version: z.number().int(),
            concrete: z
              .unknown()
              .refine(
                (value): value is ConcreteEvent =>
                  typeof value === "object" && value !== null,
              )
              .openapi({
                description:
                  "The ConcreteEvent tree: the fully expanded, registry-resolved structure of the tournament (rounds, pairings, standings cards, tiebreak formulas) that a display renders directly.",
                example: {
                  root: {
                    id: "main",
                    title: "main",
                    entrants: 2,
                    card: {
                      kind: "pool",
                      title: "Round Robin",
                      lines: [],
                    },
                    intakes: [],
                    tier: 0,
                    run: {
                      kind: "rounds",
                      system: "roundRobin",
                      scoring: {
                        kind: "passThrough",
                        title: "Game points",
                        lines: ["each side keeps its points"],
                      },
                      rounds: { open: false, items: [] },
                      between: {
                        standings: {
                          kind: "standings",
                          title: "Standings",
                          lines: [],
                        },
                        tiebreaks: [],
                      },
                      final: {
                        standings: {
                          kind: "standings",
                          title: "Standings",
                          lines: [],
                        },
                        tiebreaks: [],
                      },
                    },
                  },
                },
              }),
          }),
        },
      },
      description: "The concrete projection of this definition.",
    },
    400: {
      content: { "application/json": { schema: errorEnvelopeSchema } },
      description:
        "A malformed `streamId` path parameter reaches this status — today, only an empty segment (the schema requires a non-empty string) can trip it. `details` carries zod's per-issue array (`path`, `code`, `message`); the raw input value is deliberately not echoed back.",
    },
    404: {
      content: { "application/json": { schema: errorEnvelopeSchema } },
      description: "No stream exists with this id.",
    },
    500: {
      content: { "application/json": { schema: errorEnvelopeSchema } },
      description:
        "Two disjoint outcomes share this status: `invalid_stream`, when the underlying definition's changelog failed to fold or validate (`details` carries the failure); `internal`, an unrelated server error (no `details`).",
    },
  },
});

export const definitionsReadRouter = new OpenAPIHono({
  defaultHook: apiDefaultHook,
})
  .openapi(listRoute, async (c) => {
    const streams = await db.definitionStream.findMany({
      orderBy: { streamId: "asc" },
    });
    const definitions: z.infer<typeof definitionSummarySchema>[] = [];
    for (const stream of streams) {
      const read = await readDefinition(db, stream.streamId);
      // NOTE: skipped, not 500'd — see listRoute's description above.
      if (!read.ok) continue;
      definitions.push({
        streamId: stream.streamId,
        name: read.def.name,
        version: read.version,
        ownerId: stream.ownerId,
      });
    }
    return c.json({ definitions }, 200);
  })
  .openapi(detailRoute, async (c) => {
    const { streamId } = c.req.valid("param");
    const read = await readDefinition(db, streamId);
    if (!read.ok) {
      const mapped = toErrorResponse(read.error);
      return c.json(mapped.body, mapped.status);
    }
    return c.json(
      { streamId, version: read.version, definition: read.def },
      200,
    );
  })
  .openapi(changesRoute, async (c) => {
    const { streamId } = c.req.valid("param");
    const { toVersion } = c.req.valid("query");
    const read = await readChanges(
      db,
      streamId,
      toVersion === undefined ? {} : { toVersion },
    );
    if (!read.ok) {
      const mapped = toErrorResponse(read.error);
      return c.json(mapped.body, mapped.status);
    }
    const version = read.changes[read.changes.length - 1]?.version ?? 0;
    return c.json(
      {
        streamId,
        version,
        changes: read.changes.map((stored) => ({
          version: stored.version,
          type: stored.change.type,
          actorId: stored.actorId,
          recordedAt: stored.recordedAt.toISOString(),
          schemaRev: stored.schemaRev,
          registryId: stored.registryId,
          change: stored.change,
        })),
      },
      200,
    );
  })
  .openapi(concreteRoute, async (c) => {
    const { streamId } = c.req.valid("param");
    const read = await readDefinition(db, streamId);
    if (!read.ok) {
      const mapped = toErrorResponse(read.error);
      return c.json(mapped.body, mapped.status);
    }
    const concrete = concretify(read.def, chessRegistry);
    return c.json({ streamId, version: read.version, concrete }, 200);
  });
