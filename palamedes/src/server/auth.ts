import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { genericOAuth } from "better-auth/plugins";
import { env } from "@/env";
import { db } from "@/server/db";
import { lichessOAuthConfig } from "@/server/lichess/oauth-config";

export const auth = betterAuth({
  database: prismaAdapter(db, { provider: "postgresql" }),
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  onAPIError: { errorURL: "/sign-in" },
  emailAndPassword: { enabled: true },
  // Adopting a provider = fill the env vars + uncomment. Nothing else changes.
  socialProviders: {
    // github: { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET },
    // google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET },
  },
  plugins: [
    genericOAuth({
      config: [
        lichessOAuthConfig({
          clientId: env.LICHESS_CLIENT_ID,
          apiUrl: env.LICHESS_API_URL,
        }),
      ],
    }),
    nextCookies(),
  ],
});
