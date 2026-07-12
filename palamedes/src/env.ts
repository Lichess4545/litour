import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const lichessApiUrlSchema = (fallback: string) =>
  z
    .url()
    .default(fallback)
    .transform((url) => url.replace(/\/+$/, ""));

export const env = createEnv({
  server: {
    DATABASE_URL: z.url(),
    BETTER_AUTH_SECRET: z.string().min(16),
    BETTER_AUTH_URL: z.url(),
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    // OAuth providers — uncomment usage in src/server/auth.ts when adopted.
    GITHUB_CLIENT_ID: z.string().min(1).optional(),
    GITHUB_CLIENT_SECRET: z.string().min(1).optional(),
    GOOGLE_CLIENT_ID: z.string().min(1).optional(),
    GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
    LICHESS_API_TOKEN: z.string().min(1).optional(),
    LICHESS_CLIENT_ID: z.string().min(1).default("palamedes-dev"),
    LICHESS_API_URL: lichessApiUrlSchema("https://lichess.org"),
  },
  client: {
    // NEXT_PUBLIC_* variables go here.
  },
  runtimeEnv: {
    DATABASE_URL: process.env["DATABASE_URL"],
    BETTER_AUTH_SECRET: process.env["BETTER_AUTH_SECRET"],
    BETTER_AUTH_URL: process.env["BETTER_AUTH_URL"],
    NODE_ENV: process.env["NODE_ENV"],
    GITHUB_CLIENT_ID: process.env["GITHUB_CLIENT_ID"],
    GITHUB_CLIENT_SECRET: process.env["GITHUB_CLIENT_SECRET"],
    GOOGLE_CLIENT_ID: process.env["GOOGLE_CLIENT_ID"],
    GOOGLE_CLIENT_SECRET: process.env["GOOGLE_CLIENT_SECRET"],
    LICHESS_API_TOKEN: process.env["LICHESS_API_TOKEN"],
    LICHESS_CLIENT_ID: process.env["LICHESS_CLIENT_ID"],
    LICHESS_API_URL: process.env["LICHESS_API_URL"],
  },
  emptyStringAsUndefined: true,
  skipValidation: process.env["SKIP_ENV_VALIDATION"] !== undefined,
});
