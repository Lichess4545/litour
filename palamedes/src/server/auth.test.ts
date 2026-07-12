// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { auth } from "@/server/auth";
import { lichessOAuthConfig } from "@/server/lichess/oauth-config";

describe("auth callback-stage error redirect", () => {
  it("routes callback-stage OAuth failures (cancel/deny, token errors) to the sign-in page", () => {
    expect(auth.options.onAPIError?.errorURL).toBe("/sign-in");
  });
});

describe("lichessOAuthConfig", () => {
  const cfg = lichessOAuthConfig({
    clientId: "palamedes-test",
    apiUrl: "https://lichess.example.test",
  });

  it("registers the lichess provider under the given client id", () => {
    expect(cfg.providerId).toBe("lichess");
    expect(cfg.clientId).toBe("palamedes-test");
  });

  it("derives every endpoint URL from the injected apiUrl", () => {
    expect(cfg.authorizationUrl).toBe("https://lichess.example.test/oauth");
    expect(cfg.tokenUrl).toBe("https://lichess.example.test/api/token");
    expect(cfg.userInfoUrl).toBe("https://lichess.example.test/api/account");
  });

  it("uses PKCE", () => {
    expect(cfg.pkce).toBe(true);
  });

  it("never carries a clientSecret key — lichess is a public client", () => {
    expect("clientSecret" in cfg).toBe(false);
  });

  it("never authenticates via HTTP Basic — lichess expects the post-body default", () => {
    expect(cfg.authentication).toBeUndefined();
  });

  it("maps a lichess profile to a name and a D4 placeholder email", () => {
    const mapProfileToUser = cfg.mapProfileToUser;
    if (mapProfileToUser === undefined) {
      throw new Error("mapProfileToUser must be defined");
    }
    const user = mapProfileToUser({ id: "thibault", username: "thibault" });
    expect(user).toEqual({
      email: "thibault@users.lichess.invalid",
      name: "thibault",
    });
  });

  it.each([
    ["missing id", { username: "thibault" }],
    ["missing username", { id: "thibault" }],
    ["wrong-typed id", { id: 12345, username: "thibault" }],
  ])(
    "returns an empty user shape and logs the failure on a malformed profile (%s), without throwing",
    (_label, profile) => {
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      const mapProfileToUser = cfg.mapProfileToUser;
      if (mapProfileToUser === undefined) {
        throw new Error("mapProfileToUser must be defined");
      }
      let user: unknown;
      expect(() => {
        user = mapProfileToUser(profile);
      }).not.toThrow();
      expect(user).toEqual({});
      expect(consoleError).toHaveBeenCalledTimes(1);
      consoleError.mockRestore();
    },
  );
});
