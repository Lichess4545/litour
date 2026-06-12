import {
  dehydrate,
  HydrationBoundary,
  type QueryClient,
} from "@tanstack/react-query";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { headers } from "next/headers";
import { cache, type ReactNode } from "react";
import { appRouter } from "@/server/api/root";
import { createTRPCContext } from "@/server/api/trpc";
import { makeQueryClient } from "@/trpc/query-client";

/**
 * RSC plumbing: a per-request query client and a tRPC options proxy that
 * executes procedures in-process (no HTTP round-trip on the server).
 *
 * This module must only be imported from React Server Components.
 */

const createContext = cache(async () => {
  const heads = new Headers(await headers());
  heads.set("x-trpc-source", "rsc");
  return createTRPCContext({ headers: heads });
});

export const getQueryClient = cache(makeQueryClient);

export const trpc = createTRPCOptionsProxy({
  ctx: createContext,
  router: appRouter,
  queryClient: getQueryClient,
});

export function HydrateClient({ children }: { children: ReactNode }) {
  const queryClient = getQueryClient();
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      {children}
    </HydrationBoundary>
  );
}

type PrefetchableQueryOptions = Parameters<QueryClient["prefetchQuery"]>[0];

export function prefetch(queryOptions: PrefetchableQueryOptions): void {
  void getQueryClient().prefetchQuery(queryOptions);
}
