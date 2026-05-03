import Link from "next/link";

export default function HomePage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">Litour UI</h1>
      <p className="mt-4 text-muted-foreground">
        Next-gen Litour interface. Pages live under <code className="font-mono">/v2/*</code>.
      </p>
      <ul className="mt-8 space-y-2">
        <li>
          <Link
            href="/pairings/1"
            className="text-primary underline-offset-4 hover:underline"
          >
            Pairings (round 1)
          </Link>
          <span className="text-muted-foreground"> — replace the round id in the URL.</span>
        </li>
      </ul>
    </main>
  );
}
