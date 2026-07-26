// @vitest-environment node

import { z } from "@hono/zod-openapi";
import { afterAll, beforeAll, expect, it } from "vitest";
import { chessRegistry, parseEventDef } from "@/chess/registry";
import { db } from "@/server/db";
import { api } from "@/server/http/app";
import {
  appendChanges,
  CURRENT_SCHEMA_REV,
  readDefinition,
} from "@/server/tournament/change-store";
import { describeWithDb } from "@/test/db";
import { definitionToChanges } from "@/tournament/changes/decompose";
import { competitorId } from "@/tournament/core";
import type { ParsedEventDef } from "@/tournament/registry";

const freshId = (): string => `defs-read-${crypto.randomUUID()}`;

const buildDef = (id: string): ParsedEventDef =>
  parseEventDef({
    id,
    name: "Definitions read test event",
    competitors: [
      { id: "alice", name: "Alice" },
      { id: "bob", name: "Bob" },
    ],
    competition: {
      id: "main",
      entries: [
        { kind: "registration", seed: 1 },
        { kind: "registration", seed: 2 },
      ],
      run: {
        kind: "pool",
        pairing: { system: "roundRobin", cycles: 1 },
        encounter: { kind: "game", clock: { initial: 180, increment: 2 } },
        score: { kind: "passThrough" },
        tiebreaks: [],
      },
    },
  });

const listResponseSchema = z.object({
  definitions: z.array(
    z.object({
      streamId: z.string(),
      name: z.string(),
      version: z.number(),
      ownerId: z.string().nullable(),
    }),
  ),
});

const detailResponseSchema = z.object({
  streamId: z.string(),
  version: z.number(),
  definition: z.unknown(),
});

const changesResponseSchema = z.object({
  streamId: z.string(),
  version: z.number(),
  changes: z.array(
    z.object({
      version: z.number(),
      type: z.string(),
      actorId: z.string().nullable(),
      recordedAt: z.string(),
      schemaRev: z.number(),
      registryId: z.string(),
      change: z.unknown(),
    }),
  ),
});

const concreteResponseSchema = z.object({
  streamId: z.string(),
  version: z.number(),
  concrete: z.unknown(),
});

describeWithDb("definitions read API", () => {
  const streamIds: string[] = [];

  let streamId: string;
  let def: ParsedEventDef;
  let version: number;

  const addCarol = {
    type: "competitor-added" as const,
    competitor: { id: competitorId("carol"), name: "Carol" },
  };

  beforeAll(async () => {
    streamId = freshId();
    streamIds.push(streamId);
    def = buildDef(streamId);
    const appended = await appendChanges(
      db,
      streamId,
      0,
      definitionToChanges(def),
    );
    if (!appended.ok) {
      throw new Error(
        `fixture setup failed: ${JSON.stringify(appended.error)}`,
      );
    }
    const second = await appendChanges(db, streamId, appended.version, [
      addCarol,
    ]);
    if (!second.ok) {
      throw new Error(
        `fixture second batch failed: ${JSON.stringify(second.error)}`,
      );
    }
    version = second.version;
    await db.definitionStream.upsert({
      where: { streamId },
      create: { streamId, ownerId: "lichess:fixture", createdAt: new Date() },
      update: {},
    });
  });

  afterAll(async () => {
    await db.definitionChange.deleteMany({
      where: { streamId: { in: streamIds } },
    });
    await db.definitionStream.deleteMany({
      where: { streamId: { in: streamIds } },
    });
  });

  it("list returns the created stream with its name/version/ownerId", async () => {
    const res = await api.request("/api/v1/definitions");
    expect(res.status).toBe(200);
    const body = listResponseSchema.parse(await res.json());
    const entry = body.definitions.find((d) => d.streamId === streamId);
    expect(entry).toEqual({
      streamId,
      name: def.name,
      version,
      ownerId: "lichess:fixture",
    });
  });

  it("list orders streams by streamId ascending, independent of insertion order", async () => {
    const idZ = `defs-read-zzz-${crypto.randomUUID()}`;
    const idA = `defs-read-aaa-${crypto.randomUUID()}`;
    streamIds.push(idZ, idA);
    for (const id of [idZ, idA]) {
      const orderingDef = buildDef(id);
      const appended = await appendChanges(
        db,
        id,
        0,
        definitionToChanges(orderingDef),
      );
      if (!appended.ok) {
        throw new Error(
          `ordering fixture setup failed: ${JSON.stringify(appended.error)}`,
        );
      }
      await db.definitionStream.upsert({
        where: { streamId: id },
        create: { streamId: id, ownerId: null, createdAt: new Date() },
        update: {},
      });
    }

    const res = await api.request("/api/v1/definitions");
    expect(res.status).toBe(200);
    const body = listResponseSchema.parse(await res.json());
    const orderedIds = body.definitions
      .map((d) => d.streamId)
      .filter((id) => id === idZ || id === idA);
    expect(orderedIds).toEqual([idA, idZ]);
  });

  it("detail returns a def deep-equal to the one appended", async () => {
    const res = await api.request(`/api/v1/definitions/${streamId}`);
    expect(res.status).toBe(200);
    const body = detailResponseSchema.parse(await res.json());
    expect(body.streamId).toBe(streamId);
    expect(body.version).toBe(version);
    const current = await readDefinition(db, streamId);
    if (!current.ok)
      throw new Error("expected the fixture stream to read back ok");
    expect(body.definition).toEqual(JSON.parse(JSON.stringify(current.def)));
  });

  it("changes returns exactly N stored changes in version order with actorId", async () => {
    const res = await api.request(`/api/v1/definitions/${streamId}/changes`);
    expect(res.status).toBe(200);
    const body = changesResponseSchema.parse(await res.json());
    expect(body.streamId).toBe(streamId);
    expect(body.version).toBe(version);
    expect(body.changes).toHaveLength(version);
    expect(body.changes.map((c) => c.version)).toEqual(
      Array.from({ length: version }, (_, i) => i + 1),
    );
    for (const change of body.changes) {
      expect(Object.hasOwn(change, "actorId")).toBe(true);
    }
  });

  it("toVersion=1 truncates", async () => {
    const res = await api.request(
      `/api/v1/definitions/${streamId}/changes?toVersion=1`,
    );
    expect(res.status).toBe(200);
    const body = changesResponseSchema.parse(await res.json());
    expect(body.version).toBe(1);
    expect(body.changes).toHaveLength(1);
    expect(body.changes[0]?.version).toBe(1);
  });

  it("toVersion=abc fails validation with the error envelope, not a raw zod result", async () => {
    const res = await api.request(
      `/api/v1/definitions/${streamId}/changes?toVersion=abc`,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: {
        code: "invalid_request",
        message: expect.any(String),
        details: expect.anything(),
      },
    });
  });

  it("toVersion=0 fails validation with the error envelope, not a raw zod result", async () => {
    const res = await api.request(
      `/api/v1/definitions/${streamId}/changes?toVersion=0`,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: {
        code: "invalid_request",
        message: expect.any(String),
        details: expect.anything(),
      },
    });
  });

  it("toVersion=1.5 fails validation with the error envelope, not a raw zod result", async () => {
    const res = await api.request(
      `/api/v1/definitions/${streamId}/changes?toVersion=1.5`,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: {
        code: "invalid_request",
        message: expect.any(String),
        details: expect.anything(),
      },
    });
  });

  it("changes on an unknown streamId → 404 with the error envelope shape", async () => {
    const res = await api.request(
      `/api/v1/definitions/${freshId()}-does-not-exist/changes`,
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: { code: "not_found", message: expect.any(String) },
    });
  });

  it("changes on a stream corrupted via direct updateMany → 500s with invalid_stream", async () => {
    const corruptId = freshId();
    streamIds.push(corruptId);
    const corruptDef = buildDef(corruptId);
    const appended = await appendChanges(
      db,
      corruptId,
      0,
      definitionToChanges(corruptDef),
    );
    if (!appended.ok) {
      throw new Error(
        `changes-route corrupt fixture setup failed: ${JSON.stringify(appended.error)}`,
      );
    }
    await db.definitionChange.updateMany({
      where: { streamId: corruptId, version: 1 },
      data: { payload: { type: "no-such-change-type" } },
    });

    const res = await api.request(`/api/v1/definitions/${corruptId}/changes`);
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({
      error: { code: "invalid_stream" },
    });
  });

  it("concrete responds 200 and contains the pool label text known to be in the fixture", async () => {
    const res = await api.request(`/api/v1/definitions/${streamId}/concrete`);
    expect(res.status).toBe(200);
    const body = concreteResponseSchema.parse(await res.json());
    expect(body.streamId).toBe(streamId);
    expect(JSON.stringify(body.concrete)).toContain("Standings");
  });

  it("unknown streamId → 404 with the error envelope shape", async () => {
    const res = await api.request(
      `/api/v1/definitions/${freshId()}-does-not-exist`,
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: { code: "not_found", message: expect.any(String) },
    });
  });

  it("a stream corrupted via direct updateMany → detail 500s with invalid_stream while list still succeeds without it", async () => {
    const corruptId = freshId();
    streamIds.push(corruptId);
    const corruptDef = buildDef(corruptId);
    const appended = await appendChanges(
      db,
      corruptId,
      0,
      definitionToChanges(corruptDef),
    );
    if (!appended.ok) {
      throw new Error(
        `corrupt fixture setup failed: ${JSON.stringify(appended.error)}`,
      );
    }
    await db.definitionStream.upsert({
      where: { streamId: corruptId },
      create: { streamId: corruptId, ownerId: null, createdAt: new Date() },
      update: {},
    });
    await db.definitionChange.updateMany({
      where: { streamId: corruptId, version: 1 },
      data: { payload: { type: "no-such-change-type" } },
    });

    const detailRes = await api.request(`/api/v1/definitions/${corruptId}`);
    expect(detailRes.status).toBe(500);
    const detailBody = await detailRes.json();
    expect(detailBody).toMatchObject({ error: { code: "invalid_stream" } });

    const listRes = await api.request("/api/v1/definitions");
    expect(listRes.status).toBe(200);
    const listBody = listResponseSchema.parse(await listRes.json());
    expect(listBody.definitions.some((d) => d.streamId === corruptId)).toBe(
      false,
    );
    expect(listBody.definitions.some((d) => d.streamId === streamId)).toBe(
      true,
    );
  });

  it("readDefinition with toVersion before the first recorded version → invalidPrefix reason fold at version 0", async () => {
    const result = await readDefinition(db, streamId, { toVersion: 0 });
    expect(result).toEqual({
      ok: false,
      error: { kind: "invalidPrefix", version: 0, reason: "fold" },
    });
  });

  it("a stream folded from a raw duplicate-competitor row → detail 500s with invalid_stream, reason fold", async () => {
    const corruptId = freshId();
    streamIds.push(corruptId);
    const corruptDef = buildDef(corruptId);
    const appended = await appendChanges(
      db,
      corruptId,
      0,
      definitionToChanges(corruptDef),
    );
    if (!appended.ok) {
      throw new Error(
        `duplicate-competitor fixture setup failed: ${JSON.stringify(appended.error)}`,
      );
    }
    await db.definitionStream.upsert({
      where: { streamId: corruptId },
      create: { streamId: corruptId, ownerId: null, createdAt: new Date() },
      update: {},
    });
    await db.definitionChange.create({
      data: {
        streamId: corruptId,
        version: appended.version + 1,
        type: "competitor-added",
        payload: {
          type: "competitor-added",
          competitor: { id: "alice", name: "Alice Duplicate" },
        },
        schemaRev: CURRENT_SCHEMA_REV,
        registryId: chessRegistry.id,
        actorId: null,
      },
    });

    const res = await api.request(`/api/v1/definitions/${corruptId}`);
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({
      error: {
        code: "invalid_stream",
        details: {
          kind: "invalidPrefix",
          reason: "fold",
          version: appended.version + 1,
        },
      },
    });
  });

  it("a stream folded from a raw entries-removal row that fails definition validation → detail 500s with invalid_stream, reason definition", async () => {
    const corruptId = freshId();
    streamIds.push(corruptId);
    const corruptDef = buildDef(corruptId);
    const appended = await appendChanges(
      db,
      corruptId,
      0,
      definitionToChanges(corruptDef),
    );
    if (!appended.ok) {
      throw new Error(
        `entries-removal fixture setup failed: ${JSON.stringify(appended.error)}`,
      );
    }
    await db.definitionStream.upsert({
      where: { streamId: corruptId },
      create: { streamId: corruptId, ownerId: null, createdAt: new Date() },
      update: {},
    });
    await db.definitionChange.create({
      data: {
        streamId: corruptId,
        version: appended.version + 1,
        type: "entries-set",
        payload: {
          type: "entries-set",
          competitionId: "main",
          entries: null,
        },
        schemaRev: CURRENT_SCHEMA_REV,
        registryId: chessRegistry.id,
        actorId: null,
      },
    });

    const res = await api.request(`/api/v1/definitions/${corruptId}`);
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({
      error: {
        code: "invalid_stream",
        details: {
          kind: "invalidPrefix",
          reason: "definition",
          version: appended.version + 1,
        },
      },
    });
  });

  it("a stream with a schemaRev beyond CURRENT_SCHEMA_REV → detail 500s with invalid_stream, distinct from corruptPayload", async () => {
    const corruptId = freshId();
    streamIds.push(corruptId);
    const corruptDef = buildDef(corruptId);
    const appended = await appendChanges(
      db,
      corruptId,
      0,
      definitionToChanges(corruptDef),
    );
    if (!appended.ok) {
      throw new Error(
        `schemaRev fixture setup failed: ${JSON.stringify(appended.error)}`,
      );
    }
    await db.definitionChange.updateMany({
      where: { streamId: corruptId, version: 1 },
      data: { schemaRev: CURRENT_SCHEMA_REV + 1 },
    });

    const res = await api.request(`/api/v1/definitions/${corruptId}`);
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({
      error: {
        code: "invalid_stream",
        details: {
          kind: "unknownSchemaRev",
          schemaRev: CURRENT_SCHEMA_REV + 1,
        },
      },
    });
  });
});
