# ADR 0016 — Every registry extension mints a new id, additive or not

Status: Accepted (2026-07-26)

## Context

ADR 0010 pinned a `registryId` on every `DefinitionChange` row at write time
and made the *mechanism* of choosing an identity unavoidable:
`extendRegistry`'s `extra` parameter is typed `Omit<Partial<RegistrySpec>,
"id"> & { readonly id: string }`, so an extension that does not choose an
identity is a compile error, not a runtime footgun. `RegistrySpec.id` /
`ModelRegistry.id` thread that identity from `buildRegistry` through the whole
registry, and the DAL stamps it on every stored change.

ADR 0010 explicitly deferred the *policy* — when an extension must bump `id`
versus when it may reuse the base's — "to the first real extension that needs
to answer it." This ADR answers it. It is the last open question from ADR
0010; the columns and the type are already in place.

The forces:

- An **additive** extension — one that only *adds* kinds and changes no
  existing kind's schema — leaves the vocabulary a strict superset of the
  base. Every definition valid against the base is still valid, so a stored
  change that pins the base id can still be re-validated against the extended
  registry. Reusing the base id arguably tells no lie *for that batch*.
- But `registryId` exists to answer a question years after the write:
  *against which vocabulary was this change validated, so it can be
  re-validated deterministically?* "Superset" is a property of *the extension
  itself*, not of the *id*. A reader holding only a stored `registryId` and a
  registry that now bears that id cannot tell whether the two are the same
  vocabulary or a superset that quietly reused the name.
- A future extension that changes an existing kind's schema is observably a
  *different* vocabulary and MUST rebrand — no one disputes that case. But one
  policy has to cover both, because the writer of the second extension is not
  the reader of the first. The wrong policy is not a crash; it is a silent
  audit failure — a stored change re-validating "green" against a registry it
  was never validated against.

## Decision

**Any extension mints a new `id` — additive or not.** There is no
"additive extensions may reuse the base id" carve-out. The rule is
mechanical and needs no judgment at the call site: if you call
`extendRegistry`, you choose a new id, full stop.

The reasoning is that additivity is not observable after the fact from the id
alone. `registryId` is a *pinned re-validation key*, and a key must identify
exactly one vocabulary. The moment two distinct vocabularies (base, and
base-plus-kinds) can both answer to `chess/1`, "re-validate this change
against the registry named by its `registryId`" stops being deterministic —
which registry? The superset property that made reuse look safe is invisible
to the reader who most needs it. Minting a new id on every extension keeps
the invariant ADR 0010 bought — *the id names one vocabulary* — total,
rather than true-in-the-additive-case-and-you-had-better-hope-you-can-tell.

## Consequences

- **Re-validation stays deterministic and auditable.** A stored change's
  `registryId` names exactly one vocabulary; there is never a base/superset
  ambiguity to resolve. This is the whole point of pinning the id, now
  preserved without exception.
- **The option not taken: additive reuse under stated conditions.** The
  rejected alternative was to let an additive extension keep `base.id`,
  guarded by a documented "kinds-only-added, no existing schema touched"
  condition. Its appeal is fewer id churns for the common safe case. Its cost
  is the failure mode above: the condition is checkable only by whoever
  *builds* the extension, never by whoever *reads* a change years later, so a
  mistake (an extension that reused the id but did tighten a schema) surfaces
  as a change that silently re-validates against the wrong vocabulary — the
  exact class of silent audit failure ADR 0010's per-row pinning exists to
  prevent. A policy whose correctness cannot be verified from the persisted
  record is the wrong policy for a persistence key.
- **The cost is deliberate and small.** More id bumps, each cheap: one
  `extendRegistry` argument. It buys the guarantee that the id is never a
  lie, which is worth more than the churn it saves.
- **Dependent nit — brand `RegistryId` when a second comparing call site
  appears.** `RegistrySpec.id` / `ModelRegistry.id` are unbranded `string`
  today. Nothing yet *compares* two registry ids, so a nominal brand would be
  ceremony without a bug to catch. The trigger — not a now-action — is the
  first call site that compares a stored `registryId` against a live
  `registry.id` (e.g. a replay path that refuses a change whose pinned id does
  not match the registry it is being replayed against). At that point brand
  `RegistryId` once, at the boundary, so the comparison cannot silently accept
  a bare `string` from the wrong provenance.

See ADR 0010 (`0010-registry-identity-and-schema-evolution.md`) for the
mechanism this policy completes — the per-row `registryId`, `schemaRev`, and
the upcaster seam.
