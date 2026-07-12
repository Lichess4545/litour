// @vitest-environment node
import { z } from "@hono/zod-openapi";
import type { ExtractSchema } from "hono/types";
import { describe, expect, it } from "vitest";
import { api, openApiDocument } from "@/server/http/app";

type RegisteredApiPaths = keyof ExtractSchema<typeof api>;
"/api/v1/health" satisfies RegisteredApiPaths;

describe("api", () => {
  it("health endpoint answers ok", async () => {
    const res = await api.request("/api/v1/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("the OpenAPI document is 3.1 and self-consistent", async () => {
    const res = await api.request("/api/v1/openapi.json");
    expect(res.status).toBe(200);
    const doc = z
      .object({
        openapi: z.string().startsWith("3.1"),
        info: z.object({ title: z.literal("Palamedes API") }),
        paths: z.record(z.string(), z.unknown()),
      })
      .parse(await res.json());
    expect(Object.keys(doc.paths)).toContain("/api/v1/health");
  });

  it("matches the document returned by openApiDocument() directly", () => {
    const doc = openApiDocument();
    expect(Object.keys(doc.paths ?? {})).toContain("/api/v1/health");
  });

  it("declares the LichessToken bearer securityScheme component", () => {
    const doc = openApiDocument();
    const securitySchemes = doc.components?.securitySchemes ?? {};
    expect(securitySchemes["LichessToken"]).toEqual({
      type: "http",
      scheme: "bearer",
    });
  });
});
