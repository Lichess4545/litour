import { PostsSection } from "@/components/posts/posts-section";
import { getQueryClient, HydrateClient, trpc } from "@/trpc/server";

// This page reads the request session (via tRPC context) — render per request.
export const dynamic = "force-dynamic";

export default function PostsPage() {
  // Kick off the query on the server; the client hydrates the result.
  void getQueryClient().prefetchQuery(trpc.post.list.queryOptions());

  return (
    <HydrateClient>
      <main className="mx-auto w-full max-w-3xl px-6 py-10">
        <PostsSection />
      </main>
    </HydrateClient>
  );
}
