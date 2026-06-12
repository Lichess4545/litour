import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="font-semibold text-2xl tracking-tight">Not found</h1>
      <p className="text-muted-foreground text-sm">
        Nothing lives at this address.
      </p>
      <Link
        href="/tournaments"
        className="text-sm underline underline-offset-4 hover:text-foreground"
      >
        Browse the tournament formats
      </Link>
    </main>
  );
}
