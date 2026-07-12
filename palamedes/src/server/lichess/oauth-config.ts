import type { GenericOAuthConfig } from "better-auth/plugins";
import { z } from "zod";

const lichessProfileSchema = z
  .object({
    id: z.string().min(1),
    username: z.string().min(1),
  })
  .loose();

export type LichessOAuthConfigInput = {
  clientId: string;
  apiUrl: string;
};

export function lichessOAuthConfig({
  clientId,
  apiUrl,
}: LichessOAuthConfigInput): GenericOAuthConfig {
  return {
    providerId: "lichess",
    clientId,
    // NOTE: no clientSecret — lichess is a PKCE public client and issues
    // none. Adding one back is a security regression, not a fix for a
    // missing value: see README § "Adding an OAuth provider" and ADR 0009.
    pkce: true,
    // NOTE: `authentication` stays unset (better-auth defaults to "post").
    // Never set "basic" — lichess's token endpoint expects client_secret
    // omitted entirely; "basic" would instead send an empty Basic header.
    authorizationUrl: `${apiUrl}/oauth`,
    tokenUrl: `${apiUrl}/api/token`,
    userInfoUrl: `${apiUrl}/api/account`,
    scopes: [],
    // NOTE: placeholder email (D4, ADR 0009) — lichess grants no email
    // without the separate email:read scope, which this flow doesn't
    // request. That same absence is why the return {} below is harmless
    // today: on {}, better-auth's handleUserInfo falls back to the RAW,
    // unvalidated lichess userInfo (id/name/email), but lichess never
    // puts an email in that payload under scopes: [], so better-auth's
    // own missing-email check redirects first and the raw fallback is
    // never reached. Requesting email:read removes that guard —
    // re-examine this fallback against ADR 0009 before adding the scope.
    mapProfileToUser: (profile: unknown) => {
      const parsed = lichessProfileSchema.safeParse(profile);
      if (!parsed.success) {
        console.error(
          "lichessOAuthConfig: malformed lichess profile",
          parsed.error,
        );
        return {};
      }
      const { id, username } = parsed.data;
      return {
        email: `${id}@users.lichess.invalid`,
        name: username,
      };
    },
  };
}
