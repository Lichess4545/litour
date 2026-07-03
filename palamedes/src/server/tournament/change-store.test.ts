// @vitest-environment node
import { afterAll, expect, it } from "vitest";
import { parseEventDef } from "@/chess/registry";
import { db } from "@/server/db";
import { describeWithDb } from "@/test/db";
import { definitionToChanges } from "@/tournament/changes/decompose";
import type { DefChange } from "@/tournament/changes/types";
import { competitorId } from "@/tournament/core";
import type { ParsedEventDef } from "@/tournament/registry";
import {
  type AppendError,
  appendChanges,
  readAllChanges,
  readChanges,
  readDefinition,
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
    expect(page.length).toBe(2);
    expect(page[0]?.seq).toBe(firstSeq);
  });

  it("a corrupt stored payload throws with stream and seq context", async () => {
    const id = freshId();
    await db.definitionChange.create({
      data: {
        streamId: id,
        version: 1,
        type: "garbage",
        payload: { type: "garbage" },
      },
    });
    await expect(readChanges(db, id)).rejects.toThrow(/corrupt/);
    await expect(readChanges(db, id)).rejects.toThrow(id);
  });
});
