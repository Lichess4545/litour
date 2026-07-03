// @vitest-environment node
import { afterAll, expect, it } from "vitest";
import { parseEventDef } from "@/chess/registry";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { describeWithDb } from "@/test/db";
import { definitionToChanges } from "@/tournament/changes/decompose";
import { competitorId } from "@/tournament/core";
import type { ParsedEventDef } from "@/tournament/registry";
import {
  appendChanges,
  type ChangeStoreClient,
  type NewChange,
  readDefinition,
  submit,
} from "./change-store";

const streamIds: string[] = [];
const freshId = (): string => {
  const id = `sub-${crypto.randomUUID()}`;
  streamIds.push(id);
  return id;
};

const buildDef = (id: string): ParsedEventDef =>
  parseEventDef({
    id,
    name: "Submit test event",
    competitors: [],
    competition: {
      id: "main",
      entries: { open: true },
      run: {
        kind: "pool",
        pairing: { system: "swiss" },
        rounds: 3,
        encounter: { kind: "game", clock: { initial: 180, increment: 2 } },
        score: { kind: "passThrough" },
        tiebreaks: [],
      },
    },
  });

describeWithDb("submit — the optimistic command loop", () => {
  afterAll(async () => {
    await db.definitionChange.deleteMany({
      where: { streamId: { in: streamIds } },
    });
  });

  it("creates a stream when decide sees version 0", async () => {
    const id = freshId();
    const def = buildDef(id);
    const result = await submit(db, id, (state) =>
      state.version === 0
        ? definitionToChanges(def)
        : { reject: "already there" },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.version).toBe(1);
  });

  it("relays a rejection with its typed reason", async () => {
    const id = freshId();
    const def = buildDef(id);
    await submit(db, id, () => definitionToChanges(def));
    const result = await submit(db, id, (state) =>
      state.version === 0 ? definitionToChanges(def) : { reject: "exists" },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({ kind: "rejected", reason: "exists" });
  });

  it("an empty decision is a no-op success at the current version", async () => {
    const id = freshId();
    const def = buildDef(id);
    await submit(db, id, () => definitionToChanges(def));
    const result = await submit(db, id, () => []);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.version).toBe(1);
      expect(result.seqs).toEqual([]);
    }
  });

  it("K parallel submits all land: dense versions, all changes present, deterministic refold", async () => {
    const id = freshId();
    const def = buildDef(id);
    const created = await submit(db, id, () => definitionToChanges(def));
    expect(created.ok).toBe(true);

    const K = 8;
    const names = Array.from({ length: K }, (_, i) => `player-${i + 1}`);
    const results = await Promise.all(
      names.map((name) =>
        submit(
          db,
          id,
          (state) =>
            state.def === null ||
            state.def.competitors.some((c) => c.id === name)
              ? { reject: `unexpected state for ${name}` }
              : [
                  {
                    type: "competitor-added",
                    competitor: { id: competitorId(name), name },
                  },
                ],
          { retries: K + 4 },
        ),
      ),
    );
    for (const result of results) expect(result.ok).toBe(true);

    const head = await readDefinition(db, id);
    expect(head.ok).toBe(true);
    if (!head.ok) return;
    expect(head.version).toBe(K + 1);
    expect(new Set(head.def.competitors.map((c) => c.id))).toEqual(
      new Set(names),
    );

    const rows = await db.definitionChange.findMany({
      where: { streamId: id },
      orderBy: { version: "asc" },
    });
    expect(rows.map((r) => r.version)).toEqual(
      Array.from({ length: K + 1 }, (_, i) => i + 1),
    );
  });

  it("a non-conflict append error passes through unretried", async () => {
    const id = freshId();
    const def = buildDef(id);
    await submit(db, id, () => definitionToChanges(def));

    let calls = 0;
    const result = await submit(
      db,
      id,
      () => {
        calls += 1;
        return definitionToChanges(def).slice(0, 1);
      },
      { retries: 5 },
    );
    expect(!result.ok && result.error.kind).toBe("invalidBatch");
    expect(calls).toBe(1);
  });

  it("exhausts retries: surfaces retriesExhausted with correct attempts count", async () => {
    const id = freshId();
    const def = buildDef(id);
    // Create the stream at version 1.
    await submit(db, id, () => definitionToChanges(def));

    // Wrap the delegate so the FIRST findMany call intercepts the read, inserts an
    // interleaved competitor directly at version 2, then returns the original stale rows.
    // submit then tries to append at version 1 but appendChanges sees actual=2 →
    // versionConflict → retries=0 → retriesExhausted. No concurrency, fully deterministic.
    let interleaved = false;
    const delegate = db.definitionChange;

    // Object.assign on a Promise's Symbol.toStringTag throws at runtime because
    // Promise.prototype defines it as non-writable (Object.assign uses [[Set]]).
    // Instead, build a facade object that owns the property and delegates then/catch/finally.
    const makePrismaPromise = <T>(p: Promise<T>): Prisma.PrismaPromise<T> => ({
      [Symbol.toStringTag]: "PrismaPromise" as const,
      // biome-ignore lint/suspicious/noThenProperty: required to satisfy Prisma.PrismaPromise<T> structurally
      then<TResult1 = T, TResult2 = never>(
        onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?:
          | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
          | null,
      ): Promise<TResult1 | TResult2> {
        return p.then<TResult1, TResult2>(onfulfilled, onrejected);
      },
      catch<TResult = never>(
        onrejected?:
          | ((reason: unknown) => TResult | PromiseLike<TResult>)
          | null,
      ): Promise<T | TResult> {
        return p.catch<TResult>(onrejected);
      },
      finally(onfinally?: (() => void) | null): Promise<T> {
        return p.finally(onfinally);
      },
    });

    const interleavedChange: NewChange = {
      type: "competitor-added",
      competitor: {
        id: competitorId("racer-interleaved"),
        name: "racer-interleaved",
      },
    };

    const interceptedFindMany = <T extends Prisma.DefinitionChangeFindManyArgs>(
      args?: Prisma.SelectSubset<T, Prisma.DefinitionChangeFindManyArgs>,
    ) => {
      const basePromise = delegate.findMany<T>(args);
      if (!interleaved) {
        interleaved = true;
        return makePrismaPromise(
          basePromise.then(async (rows) => {
            const head = await db.definitionChange.findFirst({
              where: { streamId: id },
              orderBy: { version: "desc" },
            });
            await appendChanges(db, id, head?.version ?? 0, [
              interleavedChange,
            ]);
            return rows;
          }),
        );
      }
      return basePromise;
    };

    const wrapper = {
      definitionChange: {
        findMany: interceptedFindMany,
        findFirst: delegate.findFirst.bind(delegate),
        createMany: delegate.createMany.bind(delegate),
        count: delegate.count.bind(delegate),
      },
    } satisfies ChangeStoreClient;

    const result = await submit(
      wrapper,
      id,
      (state) =>
        state.def === null
          ? { reject: "unexpected" }
          : [
              {
                type: "competitor-added",
                competitor: {
                  id: competitorId("racer-winner"),
                  name: "racer-winner",
                },
              },
            ],
      { retries: 0 },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({ kind: "retriesExhausted", attempts: 1 });

    // Prove the interleaved write landed and the winner's write did not.
    const head = await readDefinition(db, id);
    expect(head.ok).toBe(true);
    if (!head.ok) return;
    const competitorIds = head.def.competitors.map((c) => c.id);
    expect(competitorIds).toContain(competitorId("racer-interleaved"));
    expect(competitorIds).not.toContain(competitorId("racer-winner"));
  });
});
