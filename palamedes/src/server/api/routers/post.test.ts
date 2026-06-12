// @vitest-environment node
import { afterAll, expect, it } from "vitest";
import { createCaller } from "@/server/api/root";
import type { TRPCContext } from "@/server/api/trpc";
import { db } from "@/server/db";
import { describeWithDb } from "@/test/db";

const TEST_EMAIL = "trpc-test@example.com";

function makeSession(user: {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
  updatedAt: Date;
}): NonNullable<TRPCContext["session"]> {
  const now = new Date();
  return {
    session: {
      id: crypto.randomUUID(),
      token: crypto.randomUUID(),
      userId: user.id,
      expiresAt: new Date(now.getTime() + 86_400_000),
      createdAt: now,
      updatedAt: now,
      ipAddress: null,
      userAgent: null,
    },
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: false,
      image: null,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    },
  };
}

describeWithDb("post router (integration)", () => {
  afterAll(async () => {
    // Deleting the user cascades to their posts.
    await db.user.deleteMany({ where: { email: TEST_EMAIL } });
  });

  it("rejects unauthenticated create", async () => {
    const caller = createCaller({ db, session: null });
    await expect(
      caller.post.create({ title: "nope", content: "nope" }),
    ).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("creates, lists, and fetches posts for an authenticated user", async () => {
    const user = await db.user.upsert({
      where: { email: TEST_EMAIL },
      create: { id: crypto.randomUUID(), name: "tRPC Test", email: TEST_EMAIL },
      update: {},
    });
    const caller = createCaller({ db, session: makeSession(user) });

    const created = await caller.post.create({
      title: "Integration post",
      content: "Created from vitest via createCaller",
    });
    expect(created.author.id).toBe(user.id);

    const listed = await caller.post.list();
    expect(listed.some((post) => post.id === created.id)).toBe(true);

    const fetched = await caller.post.byId({ id: created.id });
    expect(fetched.title).toBe("Integration post");
  });

  it("rejects zod-invalid input before hitting the database", async () => {
    const user = await db.user.upsert({
      where: { email: TEST_EMAIL },
      create: { id: crypto.randomUUID(), name: "tRPC Test", email: TEST_EMAIL },
      update: {},
    });
    const caller = createCaller({ db, session: makeSession(user) });
    await expect(
      caller.post.create({ title: "", content: "body" }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });
});
