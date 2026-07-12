import type { LichessAuth } from "@/server/lichess/introspection";

export type Grant =
  | "def:read"
  | "def:create"
  | "def:write:own"
  | "def:moderate";

export type StreamOwnership = { readonly ownerId: string | null };

/**
 * Derives the closed set of definition-changelog grants for a verified
 * lichess auth, or for an anonymous request (`auth === null`, a first-class
 * case here, not an error path — it yields read-only).
 *
 * The mapping is ADR 0009's D1 table
 * (`design/adr/0009-lichess-oauth-and-permissions.md`) expressed as code;
 * this function must not drift from that table's rationale, which lives
 * there and only there.
 *
 * Two things a future edit could mistake for bugs:
 * - `tournament:write` confers nothing today — it's reserved for the
 *   results stream (ADR 0006), not a synonym for writing definitions.
 * - A scope this module doesn't recognize maps to no grant. lichess's scope
 *   vocabulary is open-ended and evolving; palamedes's grant set is closed,
 *   and the safe default for anything unmapped is to grant nothing.
 */
export function grantsFor(auth: LichessAuth | null): ReadonlySet<Grant> {
  if (auth === null) {
    return new Set<Grant>(["def:read"]);
  }
  const grants = new Set<Grant>(["def:read", "def:create", "def:write:own"]);
  if (auth.scopes.has("web:mod")) {
    grants.add("def:moderate");
  }
  return grants;
}

export function canCreateStream(auth: LichessAuth | null): boolean {
  return grantsFor(auth).has("def:create");
}

/**
 * The ownership predicate the write endpoints enforce. Anonymous
 * (`auth === null`) is always false, checked before ownership.
 *
 * `ownership.ownerId === null` — a seeded stream with no creating user
 * (ADR 0005) — is deliberately NOT writable by an ordinary `def:write:own`
 * holder: there is no "own" to match against. Only `def:moderate` can
 * write an ownerless stream. This looks like a gap (why can't a logged-in
 * user fix up an unowned thing?) but is the intended behavior from ADR
 * 0009's ownership rules.
 */
export function canWriteStream(
  auth: LichessAuth | null,
  ownership: StreamOwnership,
): boolean {
  if (auth === null) {
    return false;
  }
  const grants = grantsFor(auth);
  if (grants.has("def:moderate")) {
    return true;
  }
  return (
    grants.has("def:write:own") &&
    ownership.ownerId !== null &&
    ownership.ownerId === auth.userId
  );
}
