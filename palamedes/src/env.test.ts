// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { lichessApiUrlSchema } from "@/env";

describe("env", () => {
  it("strips a trailing slash from LICHESS_API_URL", async () => {
    vi.resetModules();
    const original = process.env["LICHESS_API_URL"];
    process.env["LICHESS_API_URL"] = "https://lichess.example.test/";
    try {
      const { env } = await import("@/env");
      expect(env.LICHESS_API_URL).toBe("https://lichess.example.test");
    } finally {
      if (original === undefined) {
        delete process.env["LICHESS_API_URL"];
      } else {
        process.env["LICHESS_API_URL"] = original;
      }
      vi.resetModules();
    }
  });

  it("falls back to the default when LICHESS_API_URL is unset", async () => {
    vi.resetModules();
    const original = process.env["LICHESS_API_URL"];
    delete process.env["LICHESS_API_URL"];
    try {
      const { env } = await import("@/env");
      expect(env.LICHESS_API_URL).toBe("https://lichess.org");
    } finally {
      if (original !== undefined) {
        process.env["LICHESS_API_URL"] = original;
      }
      vi.resetModules();
    }
  });

  it("normalizes the fallback through the transform too, not just an explicit value (default-then-transform ordering)", () => {
    const schema = lichessApiUrlSchema("https://lichess.example.test/");
    expect(schema.parse(undefined)).toBe("https://lichess.example.test");
  });
});
