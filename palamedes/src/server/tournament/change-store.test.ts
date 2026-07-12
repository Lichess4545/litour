// @vitest-environment node
import { afterAll, expect, it } from "vitest";
import { z } from "zod";
import { defChangeSchema } from "@/chess/changes";
import { chessRegistry, parseEventDef } from "@/chess/registry";
import { db } from "@/server/db";
import { describeWithDb } from "@/test/db";
import { definitionToChanges } from "@/tournament/changes/decompose";
import type { DefChange } from "@/tournament/changes/types";
import { competitorId } from "@/tournament/core";
import type { ParsedEventDef } from "@/tournament/registry";
import {
  type AppendError,
  appendChanges,
  CURRENT_SCHEMA_REV,
  readAllChanges,
  readChanges,
  readDefinition,
  upcastPayload,
} from "./change-store";

const streamIds: string[] = [];
const freshId = (): string => {
  const id = `cs-${crypto.randomUUID()}`;
  streamIds.push(id);
  return id;
};

const buildDef = (id: string): ParsedEventDef =>
  parseEventDef({
    id,
    name: "Store test event",
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

const addCharlie: DefChange = {
  type: "competitor-added",
  competitor: { id: competitorId("charlie"), name: "Charlie" },
};

describeWithDb("change store — append/read", () => {
  afterAll(async () => {
    await db.definitionChange.deleteMany({
      where: { streamId: { in: streamIds } },
    });
  });

  it("append(0, decompose(def)) then readDefinition round-trips the def", async () => {
    const id = freshId();
    const def = buildDef(id);
    const batch = definitionToChanges(def);

    const appended = await appendChanges(db, id, 0, batch);
    expect(appended.ok).toBe(true);
    if (!appended.ok) return;
    expect(appended.version).toBe(batch.length);
    expect(appended.seqs).toHaveLength(batch.length);
    expect([...appended.seqs].sort((a, b) => a - b)).toEqual([
      ...appended.seqs,
    ]);

    const readBack = await readChanges(db, id);
    expect(readBack.ok).toBe(true);
    if (!readBack.ok) return;
    expect(readBack.changes.map((c) => c.version)).toEqual(
      batch.map((_, i) => i + 1),
    );
    expect(readBack.changes.map((c) => c.change)).toEqual([...batch]);

    const rawRows = await db.definitionChange.findMany({
      where: { streamId: id },
      orderBy: { version: "asc" },
    });
    expect(rawRows.every((r) => r.recordedAt instanceof Date)).toBe(true);
    expect(rawRows.map((r) => r.type)).toEqual(batch.map((c) => c.type));

    const definition = await readDefinition(db, id);
    expect(definition.ok).toBe(true);
    if (!definition.ok) return;
    expect(definition.def).toEqual(def);
    expect(definition.version).toBe(batch.length);
  });

  it("a second batch at the right version lands; the def reflects it", async () => {
    const id = freshId();
    const def = buildDef(id);
    const first = await appendChanges(db, id, 0, definitionToChanges(def));
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = await appendChanges(db, id, first.version, [addCharlie]);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.version).toBe(first.version + 1);

    const definition = await readDefinition(db, id);
    expect(
      definition.ok &&
        definition.def.competitors.some((c) => c.id === "charlie"),
    ).toBe(true);
  });

  it("expectedVersion 0 on an existing stream → alreadyExists", async () => {
    const id = freshId();
    const def = buildDef(id);
    await appendChanges(db, id, 0, definitionToChanges(def));
    const again = await appendChanges(db, id, 0, definitionToChanges(def));
    expect(!again.ok && again.error.kind).toBe("alreadyExists");
  });

  it("expectedVersion > 0 on a missing stream → notFound; reads → notFound", async () => {
    const id = freshId();
    const append = await appendChanges(db, id, 3, [addCharlie]);
    expect(!append.ok && append.error.kind).toBe("notFound");
    const changes = await readChanges(db, id);
    expect(!changes.ok && changes.error.kind).toBe("notFound");
    const definition = await readDefinition(db, id);
    expect(!definition.ok && definition.error.kind).toBe("notFound");
  });

  it("a stale expectedVersion → versionConflict with expected and actual", async () => {
    const id = freshId();
    const def = buildDef(id);
    const first = await appendChanges(db, id, 0, definitionToChanges(def));
    if (!first.ok) return;
    const stale = await appendChanges(db, id, first.version - 1, [addCharlie]);
    expect(stale.ok).toBe(false);
    if (!stale.ok) {
      expect(stale.error).toEqual({
        kind: "versionConflict",
        expected: first.version - 1,
        actual: first.version,
      });
    }
  });

  it("two concurrent appends at the same version: exactly one wins (research B, check b)", async () => {
    const id = freshId();
    const def = buildDef(id);
    const base = await appendChanges(db, id, 0, definitionToChanges(def));
    if (!base.ok) return;

    const addDana: DefChange = {
      type: "competitor-added",
      competitor: { id: competitorId("dana"), name: "Dana" },
    };
    const [a, b] = await Promise.all([
      appendChanges(db, id, base.version, [addCharlie]),
      appendChanges(db, id, base.version, [addDana]),
    ]);
    const winners = [a, b].filter((r) => r.ok);
    const losers = [a, b].filter(
      (r): r is { readonly ok: false; readonly error: AppendError } => !r.ok,
    );
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    const loser = losers[0];
    expect(loser).toBeDefined();
    if (!loser) return;
    expect(loser.error).toMatchObject({
      kind: "versionConflict",
      expected: base.version,
      actual: base.version + 1,
    });

    const definition = await readDefinition(db, id);
    expect(definition.ok).toBe(true);
    if (!definition.ok) return;
    expect(definition.version).toBe(base.version + 1);
  });

  it("an invalid batch (fold error) persists NOTHING", async () => {
    const id = freshId();
    const def = buildDef(id);
    const base = await appendChanges(db, id, 0, definitionToChanges(def));
    if (!base.ok) return;

    const bad = await appendChanges(db, id, base.version, [
      addCharlie,
      { type: "competitor-removed", competitorId: "nobody" },
    ]);
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.error.kind).toBe("invalidBatch");
      if (bad.error.kind === "invalidBatch") {
        expect(bad.error.error.kind).toBe("unknownCompetitor");
      }
    }
    const count = await db.definitionChange.count({ where: { streamId: id } });
    expect(count).toBe(base.version);
  });

  it("a batch that folds but fails the gate (invalidDefinition) persists NOTHING", async () => {
    const id = freshId();
    const def = buildDef(id);
    const base = await appendChanges(db, id, 0, definitionToChanges(def));
    if (!base.ok) return;

    const bad = await appendChanges(db, id, base.version, [
      { type: "entries-set", competitionId: "main", entries: null },
    ]);
    expect(bad.ok).toBe(false);
    if (bad.ok || bad.error.kind !== "invalidDefinition") {
      throw new Error("expected invalidDefinition");
    }
    expect(bad.error.issues.length).toBeGreaterThan(0);
    const count = await db.definitionChange.count({ where: { streamId: id } });
    expect(count).toBe(base.version);
  });

  it("an empty batch → emptyBatch", async () => {
    const id = freshId();
    const result = await appendChanges(db, id, 0, []);
    expect(!result.ok && result.error.kind).toBe("emptyBatch");
  });

  it("toVersion time-travels at batch boundaries", async () => {
    const id = freshId();
    const def = buildDef(id);
    const base = await appendChanges(db, id, 0, definitionToChanges(def));
    if (!base.ok) return;
    await appendChanges(db, id, base.version, [addCharlie]);

    const then = await readDefinition(db, id, { toVersion: base.version });
    expect(then.ok).toBe(true);
    if (then.ok) {
      expect(then.def).toEqual(def);
      expect(then.version).toBe(base.version);
    }
    const changes = await readChanges(db, id, { toVersion: base.version });
    expect(changes.ok && changes.changes.length).toBe(base.version);
  });

  it("readAllChanges pages by seq", async () => {
    const id = freshId();
    const def = buildDef(id);
    const base = await appendChanges(db, id, 0, definitionToChanges(def));
    if (!base.ok) return;
    const firstSeq = base.seqs[0];
    if (firstSeq === undefined) return;
    const page = await readAllChanges(db, { afterSeq: firstSeq - 1, limit: 2 });
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    expect(page.changes.length).toBe(2);
    expect(page.changes[0]?.seq).toBe(firstSeq);
  });

  it("a batch element failing the change schema → malformedChange at index 0, zero rows written", async () => {
    const id = freshId();
    const def = buildDef(id);
    const base = await appendChanges(db, id, 0, definitionToChanges(def));
    if (!base.ok) return;

    const result = await appendChanges(db, id, base.version, [
      {
        type: "competitor-added",
        competitor: { id: competitorId("dave"), name: "Dave" },
        index: -1,
      },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("malformedChange");
      if (result.error.kind === "malformedChange") {
        expect(result.error.index).toBe(0);
        expect(result.error.issues.length).toBeGreaterThan(0);
      }
    }
    const count = await db.definitionChange.count({ where: { streamId: id } });
    expect(count).toBe(base.version);
  });

  it("malformedChange.index reflects position in batch: second element malformed reports index 1", async () => {
    const id = freshId();
    const def = buildDef(id);
    const base = await appendChanges(db, id, 0, definitionToChanges(def));
    if (!base.ok) return;

    const validFirst: DefChange = {
      type: "competitor-added",
      competitor: { id: competitorId("eve"), name: "Eve" },
    };
    const malformedSecond: DefChange = {
      type: "competitor-added",
      competitor: { id: competitorId("frank"), name: "Frank" },
      index: -1,
    };
    const result = await appendChanges(db, id, base.version, [
      validFirst,
      malformedSecond,
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("malformedChange");
      if (result.error.kind === "malformedChange") {
        expect(result.error.index).toBe(1);
        expect(result.error.issues.length).toBeGreaterThan(0);
      }
    }
    const count = await db.definitionChange.count({ where: { streamId: id } });
    expect(count).toBe(base.version);
  });

  it("appendChanges stamps schemaRev, registryId, and actorId on every row", async () => {
    const id = freshId();
    const def = buildDef(id);
    const batch = definitionToChanges(def);
    const result = await appendChanges(db, id, 0, batch, {
      actorId: "lichess:thibault",
    });
    expect(result.ok).toBe(true);
    const rows = await db.definitionChange.findMany({
      where: { streamId: id },
    });
    for (const row of rows) {
      expect(row.schemaRev).toBe(CURRENT_SCHEMA_REV);
      expect(row.registryId).toBe(chessRegistry.id);
      expect(row.actorId).toBe("lichess:thibault");
    }
  });

  it("appendChanges without opts stamps null actorId", async () => {
    const id = freshId();
    const def = buildDef(id);
    await appendChanges(db, id, 0, definitionToChanges(def));
    const row = await db.definitionChange.findFirstOrThrow({
      where: { streamId: id },
    });
    expect(row.actorId).toBeNull();
  });

  it("readChanges surfaces a corrupt payload as a typed error with stream/version/issues context, not a throw", async () => {
    const id = freshId();
    const def = buildDef(id);
    const base = await appendChanges(db, id, 0, definitionToChanges(def));
    if (!base.ok) return;
    await db.definitionChange.updateMany({
      where: { streamId: id, version: 1 },
      data: { payload: { type: "no-such-change-type" } },
    });
    const result = await readChanges(db, id);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("corruptPayload");
    if (result.error.kind === "corruptPayload") {
      expect(result.error.streamId).toBe(id);
      expect(result.error.version).toBe(1);
      expect(result.error.issues.length).toBeGreaterThan(0);
    }
  });

  it("readChanges rejects a future schemaRev as unknownSchemaRev, reporting the schemaRev", async () => {
    const id = freshId();
    const def = buildDef(id);
    const base = await appendChanges(db, id, 0, definitionToChanges(def));
    if (!base.ok) return;
    await db.definitionChange.updateMany({
      where: { streamId: id, version: 1 },
      data: { schemaRev: 999 },
    });
    const result = await readChanges(db, id);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("unknownSchemaRev");
    if (result.error.kind === "unknownSchemaRev") {
      expect(result.error.schemaRev).toBe(999);
    }
  });

  it("readAllChanges surfaces a corrupt payload as a typed error, not a throw", async () => {
    const id = freshId();
    const def = buildDef(id);
    const base = await appendChanges(db, id, 0, definitionToChanges(def));
    if (!base.ok) return;
    const firstSeq = base.seqs[0];
    if (firstSeq === undefined) return;
    await db.definitionChange.updateMany({
      where: { streamId: id, version: 1 },
      data: { payload: { type: "no-such-change-type" } },
    });
    const result = await readAllChanges(db, { afterSeq: firstSeq - 1 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("corruptPayload");
    expect(result.error.seq).toBe(firstSeq);
  });

  it("appendChanges throws with the error kind and serialized detail when an existing row's payload is corrupted", async () => {
    const id = freshId();
    const def = buildDef(id);
    const base = await appendChanges(db, id, 0, definitionToChanges(def));
    if (!base.ok) return;
    await db.definitionChange.updateMany({
      where: { streamId: id, version: 1 },
      data: { payload: { type: "no-such-change-type" } },
    });
    let thrown: unknown;
    try {
      await appendChanges(db, id, base.version, [addCharlie]);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(Error);
    const message = thrown instanceof Error ? thrown.message : "";
    expect(message).toContain("corruptPayload");
    expect(message).toContain("issues");
  });
});

const rev0CompetitorAddedSchema = z.object({
  type: z.literal("competitor-added"),
  competitor: z.object({ id: z.string(), label: z.string() }),
});

const renameLabelToName = (payload: unknown): unknown => {
  const parsed = rev0CompetitorAddedSchema.safeParse(payload);
  if (!parsed.success) return payload;
  return {
    type: parsed.data.type,
    competitor: {
      id: parsed.data.competitor.id,
      name: parsed.data.competitor.label,
    },
  };
};

it("upcastPayload maps a rev-0-shaped payload forward before parsing (pure seam, no db)", () => {
  const rev0Payload = {
    type: "competitor-added",
    competitor: { id: "harriet", label: "Harriet" },
  };
  const upcasters: ReadonlyMap<number, (payload: unknown) => unknown> = new Map(
    [[0, renameLabelToName]],
  );

  const upcasted = upcastPayload(rev0Payload, 0, upcasters);
  expect(upcasted.ok).toBe(true);
  if (!upcasted.ok) return;

  const parsed = defChangeSchema.safeParse(upcasted.payload);
  expect(parsed.success).toBe(true);
  if (parsed.success) {
    expect(parsed.data).toEqual({
      type: "competitor-added",
      competitor: { id: "harriet", name: "Harriet" },
    });
  }
});

it("upcastPayload reports the missing rev when no upcaster covers the gap", () => {
  const upcasted = upcastPayload({ type: "competitor-added" }, 0, new Map());
  expect(upcasted).toEqual({ ok: false, missingRev: 0 });
});
