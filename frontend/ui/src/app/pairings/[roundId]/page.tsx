import type { ReactNode } from "react";
import { z } from "zod";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { publicApiBaseUrl, serverClient } from "@/lib/api";

import { PairingsLive } from "./PairingsLive";

const roundIdSchema = z.coerce.number().int().positive();

export default async function PairingsPage({
  params,
}: {
  params: Promise<{ roundId: string }>;
}) {
  const { roundId: rawRoundId } = await params;
  const parsed = roundIdSchema.safeParse(rawRoundId);
  if (!parsed.success) {
    return (
      <ErrorCard title="Invalid round id">
        <code className="font-mono">{rawRoundId}</code> is not a positive integer.
      </ErrorCard>
    );
  }
  const roundId = parsed.data;

  const client = serverClient();
  const { data, error, response } = await client.GET("/v1/rounds/{round_id}/pairings", {
    params: { path: { round_id: roundId } },
  });

  if (error || !data) {
    return (
      <ErrorCard title={`Could not load round ${roundId}`}>
        API responded {response.status} {response.statusText}.
      </ErrorCard>
    );
  }

  return <PairingsLive initial={data} apiBaseUrl={publicApiBaseUrl()} />;
}

function ErrorCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground text-sm">{children}</CardContent>
      </Card>
    </main>
  );
}
