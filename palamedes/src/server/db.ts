import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "@/env";
import { PrismaClient } from "@/generated/prisma/client";

const createPrismaClient = () =>
  new PrismaClient({
    adapter: new PrismaPg({ connectionString: env.DATABASE_URL }),
  });

// Cache the client on globalThis in dev so Next.js hot reloads don't exhaust
// the connection pool. The intersection type keeps this cast-free.
const globalForPrisma: typeof globalThis & { prismaGlobal?: PrismaClient } =
  globalThis;

export const db = globalForPrisma.prismaGlobal ?? createPrismaClient();

if (env.NODE_ENV !== "production") {
  globalForPrisma.prismaGlobal = db;
}
