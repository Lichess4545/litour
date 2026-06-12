import { postRouter } from "@/server/api/routers/post";
import { createCallerFactory, createTRPCRouter } from "@/server/api/trpc";

export const appRouter = createTRPCRouter({
  post: postRouter,
});

export type AppRouter = typeof appRouter;

/**
 * Server-side caller — used by integration tests and server code that wants
 * to invoke procedures without HTTP.
 */
export const createCaller = createCallerFactory(appRouter);
