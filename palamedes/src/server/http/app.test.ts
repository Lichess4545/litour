// @vitest-environment node
import { z } from "@hono/zod-openapi";
import type { ExtractSchema } from "hono/types";
import { describe, expect, it } from "vitest";
import { api, openApiDocument } from "@/server/http/app";

api.get("/__test-boom", () => {
  throw new Error("boom");
});

type RegisteredApiPaths = keyof ExtractSchema<typeof api>;
"/api/v1/health" satisfies RegisteredApiPaths;
"/api/v1/definitions" satisfies RegisteredApiPaths;
"/api/v1/definitions/:streamId" satisfies RegisteredApiPaths;
"/api/v1/definitions/:streamId/changes" satisfies RegisteredApiPaths;
"/api/v1/definitions/:streamId/concrete" satisfies RegisteredApiPaths;
"/api/v1/vocabulary" satisfies RegisteredApiPaths;

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
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining([
        "/api/v1/health",
        "/api/v1/definitions",
        "/api/v1/definitions/{streamId}",
        "/api/v1/definitions/{streamId}/changes",
        "/api/v1/definitions/{streamId}/concrete",
        "/api/v1/vocabulary",
      ]),
    );
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

  it("routes an unhandled throw on the real api instance through the JSON error envelope, not hono's default plain-text 500", async () => {
    const res = await api.request("/api/v1/__test-boom");
    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.json();
    expect(body).toEqual({
      error: {
        code: "internal",
        message: "An unexpected error occurred while handling this request.",
      },
    });
  });
});
