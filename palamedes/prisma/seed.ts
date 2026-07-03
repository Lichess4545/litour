/**
 * Seed: a demo user (with a working email/password login) and a few posts.
 * Run with `bun run db:seed` (or `prisma db seed`).
 */
import { auth } from "../src/server/auth";
import { db } from "../src/server/db";
import { SEED_DEVIATIONS, seedLeagues } from "../src/server/tournament/seed";

const DEMO_EMAIL = "demo@example.com";
const DEMO_PASSWORD = "demo-password-123";

async function ensureDemoUser(): Promise<string> {
  const existing = await db.user.findUnique({ where: { email: DEMO_EMAIL } });
  if (existing !== null) {
    console.log(`Demo user already exists (${DEMO_EMAIL})`);
    return existing.id;
  }
  // Sign up through Better Auth so the password hash is real and login works.
  const result = await auth.api.signUpEmail({
    body: { name: "Demo User", email: DEMO_EMAIL, password: DEMO_PASSWORD },
  });
  console.log(`Created demo user ${DEMO_EMAIL} (password: ${DEMO_PASSWORD})`);
  return result.user.id;
}

async function main() {
  const userId = await ensureDemoUser();

  const postCount = await db.post.count({ where: { authorId: userId } });
  if (postCount > 0) {
    console.log(`Demo posts already exist (${postCount})`);
    return;
  }

  await db.post.createMany({
    data: [
      {
        title: "Hello Palamedes",
        content: "This post was created by prisma/seed.ts.",
        authorId: userId,
      },
      {
        title: "The stack is wired",
        content: "tRPC → Prisma → Postgres, with Better Auth sessions on top.",
        authorId: userId,
      },
      {
        title: "Next steps",
        content: "Replace the Post model with your real domain.",
        authorId: userId,
      },
    ],
  });
  console.log("Created 3 demo posts");
}

async function seedTournaments(): Promise<void> {
  const outcomes = await seedLeagues(db);
  for (const outcome of outcomes) {
    console.log(`League stream ${outcome.streamId}: ${outcome.status}`);
    if (outcome.status === "divergent") {
      console.warn(
        `  divergent content left untouched — inspect stream ${outcome.streamId} before reseeding`,
      );
    }
  }
  for (const deviation of SEED_DEVIATIONS) {
    console.log(`Seed deviation: ${deviation}`);
  }
}

main()
  .then(seedTournaments)
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
