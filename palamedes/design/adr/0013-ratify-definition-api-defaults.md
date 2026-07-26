# ADR 0013 — Ratifying the seven definition-API defaults (D1–D7)

Status: Accepted (2026-07-26)

## Context

The definition-API workstream carries seven individually-shipped defaults —
D1 through D7 — each recorded as a "Dr.-Dub-owned default" where it was
decided: D3 is labeled in ADR 0008; D1, D2, and D4 in ADR 0009; D6 in ADR
0011. No single ADR carries all seven. The full D1–D7 numbering, and the
framing of D5 and D7 as part of that same set, come from
`design/open-decisions.md` §1.5, which itself traces to the 2026-07-12
implementation plan (`~/.claude/plans/2026-07-12-palamedes-data-api.md` §
"Decisions for Dr. Dub"). Six of the seven have since shipped as code; only
D5 remains unbuilt.

Dr. Dub has granted full authority to settle each of these on his behalf,
provided every one is recorded here with honest forces and consequences. This
ADR is that record. It does not re-derive the underlying designs — those live
in the ADRs cross-referenced below and are not restated — it decides each open
default and states what living with it costs.

Two of the seven, D1 and D2, are not incidental defaults: **together they are
the entire authorization model** for the definition changelog. There is no
second gate behind them. Ratifying them ratifies who may read, create, write,
and moderate. D5 is the only unbuilt decision, and therefore the cheapest of
the seven to revisit — reversing it costs a schema/validation change, not a
migration of shipped data.

## Decision

Each default is decided below. D1, D2, D3, D4, D6, D7 are **ratified as-is**;
D5 is **ratified as-is** while still unbuilt. None is overridden — each shipped
default survived the check against its own forces.

### D1 — Scope→grant mapping (the authorization model)

**Ratified as-is.** `grantsFor` (`permissions.ts`) is the whole model: anonymous
→ `def:read`; any valid lichess token → additionally `def:create` and
`def:write:own`; a token bearing `web:mod` → additionally `def:moderate`. An
unrecognized scope maps to no grant, because lichess's scope vocabulary is
open-ended and palamedes's grant set is closed — the safe default for anything
unmapped is to grant nothing. This is the ADR 0009 D1 table expressed as code.

- **Option not taken:** gating `def:create` behind a `tournament:write` scope
  (this is D2, decided next) instead of "any valid token." Not taken as the
  read-side default because public anonymous read mirrors lichess's own API,
  where `GET /api/account` and friends need no scope — a stricter read gate
  would diverge from the provider palamedes federates identity with, for no
  attacker it stops.
- **Consequence:** authoring a definition requires only that a caller hold
  *any* valid lichess token — the bar to create is "has a lichess account and
  a token," not "has been granted an authoring role." There is no per-stream
  invite, no allowlist, no rate distinction between a first-time and a trusted
  author. `def:moderate` is likewise all-or-nothing, pinned to lichess's
  `web:mod`: palamedes cannot grant moderation independently of lichess. This
  is the accepted shape; tightening it later supersedes this ADR.

### D2 — Stream-creation gate

**Ratified as-is.** `canCreateStream` (`permissions.ts`) admits any valid token
— it is `grantsFor(auth).has("def:create")`, nothing more. `tournament:write`
confers nothing on the definition changelog today; per ADR 0009 it is reserved
to map to `run:write:own` once the results stream (ADR 0006) is built, and must
not be mistaken for a synonym for authoring definitions.

- **Option not taken:** requiring a `tournament:write` scope to create a
  stream, matching lichess's own gating of tournament-adjacent writes. Not
  taken because it would force every definition author to hold a scope *named
  for running lichess tournaments* — a mismatch of vocabulary as much as of
  strictness. A user authoring a tiebreak definition is not running a lichess
  Arena, and demanding that scope would conflate the two.
- **Consequence:** the create door is as wide as D1's token check — see D1's
  consequence. Because the alternative is recorded in full (here and in ADR
  0009), flipping to a `tournament:write` gate is a one-predicate change plus a
  superseding ADR, not a re-derivation.

### D3 — Results-write endpoint, this engagement

**Ratified as-is: OUT.** No results-write endpoint ships in this engagement.
ADR 0006 (results as a second stream) stays **Proposed** — designed, not built.
ADR 0008 reserves the URL space `/api/v1/definitions/{streamId}/runs…` so the
definition API's URL layout survives results landing without renegotiation; the
prefix is inert until ADR 0006 is accepted and built.

- **Option not taken:** building the results stream now, alongside the
  definition write door. Not taken because results are a distinct stream with
  their own OCC log, version-pinning against definition versions, and
  `materialize` fold (ADR 0006) — scope that would have doubled this
  engagement's write surface for a stream nothing yet reads. Reserving the URL
  space captures the forward-compatibility benefit at near-zero cost.
- **Consequence:** the `/runs` namespace is claimed but empty; a reader hitting
  it gets nothing until ADR 0006 is built. The definition API can reach
  feature-complete and be versioned independently of when results arrive.

### D4 — Placeholder email for lichess accounts

**Ratified as-is.** `mapProfileToUser` (`oauth-config.ts`) synthesizes
`<lichessUserId>@users.lichess.invalid` to satisfy Better Auth's
user-creation shape, rather than requesting the separate `email:read` scope.
Lichess accounts carry no guaranteed email, and `email:read` is unrequested.
The TLD is `.invalid` — a reserved TLD (RFC 2606/6761) that is guaranteed
never to resolve, so every synthesized address is provably undeliverable. (The
shipped value refines ADR 0009's `@lichess.invalid`-shaped sketch to
`@users.lichess.invalid`; both are under the reserved `.invalid` TLD.)

- **Option not taken (email source):** requesting `email:read` to obtain a
  real address. Not taken because it demands a scope purely to fill a field
  palamedes does not use, and — per ADR 0009 — it would remove the guard that
  lets `mapProfileToUser` return `{}` on a malformed profile and fall back
  safely; enabling it means re-examining that fallback first.
- **Option not taken (TLD choice):** `.placeholder`. Not taken because
  `.placeholder` is **not** a reserved TLD — it could someday be delegated,
  at which point a synthesized address might route somewhere real.
  `.invalid`'s reservation is permanent, so undeliverability is a guarantee,
  not a bet.
- **Consequence:** any palamedes feature that would email a lichess-identified
  user cannot — the address is deliberately dead. That is correct today (there
  is no such feature) and is the constraint to revisit if one is ever added;
  the fix is requesting `email:read`, gated on re-examining the fallback guard.

### D5 — Client-chosen stream ids (the only unbuilt default)

**Ratified as-is — and still unbuilt.** The intended shape: a create caller
supplies a slug matching `^[a-z0-9][a-z0-9-]{1,63}$`; a collision with an
existing stream returns 409. This is Task 15's write door and is **not yet
built** — no slug validation or duplicate check exists in the route layer
today. It is therefore the single most reversible of the seven: no shipped data
constrains it.

- **Option not taken:** server-minted opaque ids (e.g. a UUID or a generated
  short id), with no client say in the stream's identifier. Not taken because
  human-meaningful, author-chosen slugs make the URL space legible and
  shareable — the same reason lichess tournaments carry readable ids — and the
  collision case has a clean, standard answer (409). Server-minted ids trade
  that legibility for a guarantee of uniqueness the 409 already provides.
- **Consequence:** clients race for names in a shared, flat namespace —
  first-writer wins a slug, and there is no per-author namespacing, so a
  desirable short slug is claimable by whoever creates first. The `1,63`-char
  bound and the `[a-z0-9-]` character class are the injection/normalization
  guard for anything that later treats a stream id as a path or key. Because
  nothing is built, changing the regex, the collision policy, or the whole
  client-chosen premise is still free — this is the cheapest of the seven to
  revisit, and the one to reconsider first if the flat namespace chafes.

### D6 — Named / shared user-expression library

**Ratified as-is: inline only.** Per ADR 0011, a definition carries its
tiebreak/scoring expressions inline on the ref (`exprMetricRef`/
`exprScoringRef`), validated by `exprSchema`. An expression may name a *builtin*
via `{op:"metric", name}`, resolved through the same `named` wiring the
builtins use among themselves — but it may **not** name another
organizer-authored expression. A shared, growing library where user
expressions reference each other is out of scope.

- **Option not taken:** a named registry for user expressions, letting one
  organizer's expression reference another's by name. Not taken because it
  introduces a cross-definition namespace — naming, versioning, and the
  question of what happens when a referenced expression changes underneath its
  referrers — none of which the inline model has to answer. ADR 0011 records
  this as "deferred, not foreclosed": nothing in the wire shape prevents adding
  named user-expression registration later.
- **Consequence:** two definitions that want the same custom tiebreak each
  carry their own copy of the expression — there is no de-duplication and no
  single place to fix a shared rule. That duplication is the accepted price of
  not owning a cross-author namespace yet; the untrusted-evaluation step budget
  (ADR 0011) bounds inline and builtin-referencing expressions alike, so the
  inline model closes no safety door.

### D7 — secretspec provider and profile

**Ratified as-is.** `secretspec.toml` declares the secret set; `devenv.yaml`'s
secretspec block selects provider `keyring`, profile `development` — so the
devenv shell resolves secrets (`BETTER_AUTH_SECRET`, optional
`LICHESS_API_TOKEN`) from the OS keyring under the `development` profile.

- **Option not taken:** a file-backed or dotenv-style provider committed to the
  repo. Not taken because it invites checked-in secret material and a
  `.env`-drift class of mistake; `keyring` keeps real secrets in the OS
  credential store, off disk and out of git, consistent with ADR 0009's rule
  that only non-secret config (e.g. `LICHESS_CLIENT_ID`) lives in `env.ts`.
- **Consequence:** a contributor must populate their OS keyring before the
  devenv shell resolves — there is no zero-setup fallback, which is the
  intended friction. Production `DATABASE_URL` secret management is out of scope
  here (ADR 0009; `design/persistence-runbook.md` § "Secrets"), so D7 governs
  the development profile, not prod secret delivery.

## Consequences

- The six shipped defaults (D1, D2, D3, D4, D6, D7) are now **settled, not
  provisional**. Code touching them — `grantsFor`/`canCreateStream`/
  `canWriteStream` (`permissions.ts`), `mapProfileToUser` (`oauth-config.ts`),
  the expression refs (ADR 0011), the secretspec config — links to its ADR
  rather than re-arguing the choice.
- D1 + D2 being ratified means the **authorization model is frozen**: any valid
  lichess token can read, create, and write-its-own; `web:mod` moderates;
  everything unmapped grants nothing. Narrowing the create gate (D2's
  `tournament:write` alternative) or adding a palamedes-native authoring role
  is now a **superseding ADR**, not an edit here.
- D5 remains the live one. Ratified in intent but unbuilt, it is the only
  default whose shape can still change for free — Task 15 builds it against
  this record, and any change to the slug grammar, the 409 collision policy, or
  the client-chosen premise supersedes this ADR without a data migration.
- ADRs 0006 and 0009 that carried these as "Dr.-Dub-owned defaults" are not
  edited; this ADR is the decision that resolves their open flags. ADR 0006
  stays Proposed by design (D3), and its acceptance-and-build remains its own
  future decision.
