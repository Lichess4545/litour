import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { type PostRow, PostsTable } from "@/components/posts/posts-table";

const posts: PostRow[] = [
  {
    id: "p1",
    title: "First post",
    content: "Hello",
    authorId: "u1",
    createdAt: new Date("2026-01-01T12:00:00Z"),
    author: { id: "u1", name: "Ada" },
  },
  {
    id: "p2",
    title: "Second post",
    content: "World",
    authorId: "u1",
    createdAt: new Date("2026-01-02T12:00:00Z"),
    author: { id: "u1", name: "Ada" },
  },
];

describe("PostsTable", () => {
  it("renders one row per post", () => {
    render(<PostsTable posts={posts} />);
    expect(screen.getByText("First post")).toBeInTheDocument();
    expect(screen.getByText("Second post")).toBeInTheDocument();
    expect(screen.getAllByText("Ada")).toHaveLength(2);
  });

  it("renders an empty state when there are no posts", () => {
    render(<PostsTable posts={[]} />);
    expect(screen.getByText("No posts yet.")).toBeInTheDocument();
  });
});
