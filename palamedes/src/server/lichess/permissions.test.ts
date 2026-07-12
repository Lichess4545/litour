// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { LichessAuth } from "@/server/lichess/introspection";
import {
  canCreateStream,
  canWriteStream,
  type Grant,
  grantsFor,
  type StreamOwnership,
} from "@/server/lichess/permissions";

const makeAuth = (
  userId: string,
  scopes: readonly string[] = [],
): LichessAuth => ({
  userId,
  scopes: new Set(scopes),
  expiresAt: null,
});

describe("grantsFor — ADR 0009 D1 matrix", () => {
  it.each([
    ["anonymous (no auth)", null, ["def:read"]],
    [
      "plain token, no scopes",
      makeAuth("ada"),
      ["def:read", "def:create", "def:write:own"],
    ],
    [
      "token with an unrecognized scope",
      makeAuth("ada", ["puzzle:read"]),
      ["def:read", "def:create", "def:write:own"],
    ],
    [
      "token with tournament:write only — reserved, adds nothing today",
      makeAuth("ada", ["tournament:write"]),
      ["def:read", "def:create", "def:write:own"],
    ],
    [
      "token with web:mod",
      makeAuth("ada", ["web:mod"]),
      ["def:read", "def:create", "def:write:own", "def:moderate"],
    ],
    [
      "token with web:mod and tournament:write together",
      makeAuth("ada", ["web:mod", "tournament:write"]),
      ["def:read", "def:create", "def:write:own", "def:moderate"],
    ],
    [
      "token with web:modx — a prefix-extension of web:mod, not the scope itself",
      makeAuth("ada", ["web:modx"]),
      ["def:read", "def:create", "def:write:own"],
    ],
    [
      "token with web:moderator — a plausible future lichess scope sharing web:mod's prefix",
      makeAuth("ada", ["web:moderator"]),
      ["def:read", "def:create", "def:write:own"],
    ],
    [
      "token with web: alone — the bare namespace prefix, not a scope in its own right",
      makeAuth("ada", ["web:"]),
      ["def:read", "def:create", "def:write:own"],
    ],
  ] as const)("%s", (_label, auth, expected) => {
    expect(grantsFor(auth)).toEqual(new Set<Grant>(expected));
  });
});

describe("canCreateStream", () => {
  it("anonymous cannot create", () => {
    expect(canCreateStream(null)).toBe(false);
  });

  it("any valid token can create", () => {
    expect(canCreateStream(makeAuth("ada"))).toBe(true);
  });

  it("tournament:write alone does not add create beyond the plain-token grant (there is nothing to add)", () => {
    expect(canCreateStream(makeAuth("ada", ["tournament:write"]))).toBe(true);
  });
});

describe("canWriteStream — ownership predicate", () => {
  const owned: StreamOwnership = { ownerId: "ada" };
  const ownerless: StreamOwnership = { ownerId: null };

  it("anonymous can never write, regardless of ownership", () => {
    expect(canWriteStream(null, owned)).toBe(false);
    expect(canWriteStream(null, ownerless)).toBe(false);
  });

  it("def:write:own holder can write their own stream", () => {
    expect(canWriteStream(makeAuth("ada"), owned)).toBe(true);
  });

  it("def:write:own holder cannot write another user's stream", () => {
    expect(canWriteStream(makeAuth("bertrand"), owned)).toBe(false);
  });

  it("def:write:own holder cannot write an ownerless (seeded) stream — only moderate can", () => {
    expect(canWriteStream(makeAuth("ada"), ownerless)).toBe(false);
  });

  it("web:mod holder can write any stream, including ownerless ones", () => {
    expect(canWriteStream(makeAuth("ada", ["web:mod"]), ownerless)).toBe(true);
    expect(
      canWriteStream(makeAuth("ada", ["web:mod"]), { ownerId: "bertrand" }),
    ).toBe(true);
  });

  it("web:mod holder can write their own stream too", () => {
    expect(canWriteStream(makeAuth("ada", ["web:mod"]), owned)).toBe(true);
  });

  it("tournament:write alone confers no write grant beyond def:write:own — cannot write another user's stream", () => {
    expect(
      canWriteStream(makeAuth("bertrand", ["tournament:write"]), owned),
    ).toBe(false);
  });
});
