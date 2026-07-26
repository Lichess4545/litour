// @vitest-environment node
import { z } from "@hono/zod-openapi";
import { describe, expect, it } from "vitest";
import { api } from "@/server/http/app";

const vocabularyResponseSchema = z.object({
  encounters: z.array(z.string()),
  pairings: z.array(z.string()),
  scorings: z.array(z.string()),
  metrics: z.array(z.string()),
  ties: z.array(z.string()),
  seeds: z.array(z.string()),
  registryId: z.string(),
});

describe("GET /api/v1/vocabulary", () => {
  it("lists the registered chess vocabulary, including the expr wire door", async () => {
    const res = await api.request("/api/v1/vocabulary");
    expect(res.status).toBe(200);
    const body = vocabularyResponseSchema.parse(await res.json());
    expect(body.registryId).toBe("chess/1");
    expect(body.encounters).toContain("game");
    expect(body.pairings).toContain("roundRobin");
    expect(body.pairings).toContain("swiss");
    expect(body.seeds).toContain("registration");
    expect(body.ties).toContain("draw");
    expect(body.scorings).toContain("expr");
    expect(body.metrics).toContain("expr");
  });
});
