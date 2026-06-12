import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-6">
      <h1 className="font-semibold text-4xl">Palamedes</h1>
      <p className="max-w-md text-center text-muted-foreground">
        Next.js + tRPC + Prisma + Better Auth + TanStack + Zustand, wired end to
        end.
      </p>
      <div className="flex gap-3">
        <Button asChild>
          <Link href="/posts">Browse posts</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/sign-in">Sign in</Link>
        </Button>
      </div>
    </main>
  );
}
