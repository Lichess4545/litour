// @vitest-environment node
import { afterAll, expect, it } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { describeWithDb } from "@/test/db";

const streamId = `smoke-${crypto.randomUUID()}`;

describeWithDb("DefinitionChange model", () => {
  afterAll(async () => {
    await db.definitionChange.deleteMany({ where: { streamId } });
  });

  it("createMany inserts dense versions and reads back in order", async () => {
    const created = await db.definitionChange.createMany({
      data: [
        { streamId, version: 1, type: "definition-created", payload: { a: 1 } },
        { streamId, version: 2, type: "definition-renamed", payload: { b: 2 } },
      ],
    });
    expect(created.count).toBe(2);
    const rows = await db.definitionChange.findMany({
      where: { streamId },
      orderBy: { version: "asc" },
    });
    expect(rows.map((r) => r.version)).toEqual([1, 2]);
    expect(rows.map((r) => r.type)).toEqual([
      "definition-created",
      "definition-renamed",
    ]);
    expect(rows[0]?.payload).toEqual({ a: 1 });
    expect(rows[0]?.seq).toBeTypeOf("number");
    expect(rows[0]?.recordedAt).toBeInstanceOf(Date);
  });

  it("duplicate (streamId, version) raises P2002; a mid-batch duplicate persists ZERO rows", async () => {
    const attempt = db.definitionChange.createMany({
      data: [
        { streamId, version: 3, type: "definition-renamed", payload: {} },
        { streamId, version: 3, type: "definition-renamed", payload: {} },
      ],
    });
    await expect(attempt).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002",
    );
    const count = await db.definitionChange.count({
      where: { streamId, version: 3 },
    });
    expect(count).toBe(0);
  });
});
