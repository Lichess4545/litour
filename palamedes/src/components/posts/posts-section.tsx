"use client";

import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useUiStore } from "@/stores/ui-store";
import { useTRPC } from "@/trpc/react";
import { CreatePostForm } from "./create-post-form";
import { PostsTable } from "./posts-table";

export function PostsSection() {
  const trpc = useTRPC();
  const postsQuery = useQuery(trpc.post.list.queryOptions());
  // Zustand demo: the create-post panel is driven by the per-request UI store.
  const sidebarOpen = useUiStore((state) => state.sidebarOpen);
  const toggleSidebar = useUiStore((state) => state.toggleSidebar);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="font-semibold text-2xl">Posts</h1>
        <Button onClick={toggleSidebar} variant="outline">
          {sidebarOpen ? "Hide panel" : "New post"}
        </Button>
      </div>
      {sidebarOpen ? (
        <Card>
          <CardHeader>
            <CardTitle>Create a post</CardTitle>
          </CardHeader>
          <CardContent>
            <CreatePostForm />
          </CardContent>
        </Card>
      ) : null}
      {postsQuery.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : postsQuery.isError ? (
        <p className="text-destructive">
          Failed to load posts: {postsQuery.error.message}
        </p>
      ) : (
        <PostsTable posts={postsQuery.data} />
      )}
    </div>
  );
}
