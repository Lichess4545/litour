// appendChanges is the only write path — fold + safeParseEventDef gate every
// batch before createMany; version conflicts surface as typed errors, not thrown.
// design/adr/0004-change-store-dal-boundary.md

import { z } from "zod";
import { defChangeSchema } from "@/chess/changes";
import { chessRegistry, safeParseEventDef } from "@/chess/registry";
import {
  type DefinitionChange,
  Prisma,
  type PrismaClient,
} from "@/generated/prisma/client";
import { type FoldError, foldDefinition } from "@/tournament/changes/fold";
import type { DefChange } from "@/tournament/changes/types";
import type { ParsedEventDef } from "@/tournament/registry";

export type NewChange = DefChange;

export const CURRENT_SCHEMA_REV = 1;

// Narrow structural type: only the four delegate methods the DAL actually calls.
// The real PrismaClient satisfies this structurally; test wrappers can too.
export type ChangeStoreClient = {
  readonly definitionChange: Pick<
    PrismaClient["definitionChange"],
    "findMany" | "findFirst" | "createMany" | "count"
  >;
};

export type StoredChange = {
  readonly seq: number;
  readonly streamId: string;
  readonly version: number;
  readonly recordedAt: Date;
  readonly change: DefChange;
  readonly schemaRev: number;
  readonly registryId: string;
  readonly actorId: string | null;
};

export type AppendOk = {
  readonly ok: true;
  readonly version: number;
  readonly seqs: readonly number[];
};

export type AppendError =
  | {
      readonly kind: "versionConflict";
      readonly expected: number;
      readonly actual: number;
    }
  | { readonly kind: "notFound" }
  | { readonly kind: "alreadyExists" }
  | { readonly kind: "emptyBatch" }
  | { readonly kind: "invalidBatch"; readonly error: FoldError }
  | {
      readonly kind: "invalidDefinition";
      readonly issues: readonly z.core.$ZodIssue[];
    }
  | {
      readonly kind: "malformedChange";
      readonly index: number;
      readonly issues: readonly z.core.$ZodIssue[];
    };

export type AppendResult =
  | AppendOk
  | { readonly ok: false; readonly error: AppendError };

// NOTE: z.json() validates JSON purity at runtime; v !== null excludes bare null
// to satisfy Prisma.InputJsonValue — no type assertion needed.
const jsonPayload: z.ZodType<Prisma.InputJsonValue> =
  z.custom<Prisma.InputJsonValue>(
    (v) => z.json().safeParse(v).success && v !== null,
  );
const MAX_P2034_RETRIES = 3;

// NOTE: unknownSchemaRev's schemaRev reports the rev at which the upcast chain
// broke (upcastPayload's missingRev), not necessarily the row's own stored
// schemaRev — a multi-hop gap surfaces the later, missing rev in the chain.
export type PayloadError =
  | {
      readonly kind: "corruptPayload";
      readonly streamId: string;
      readonly seq: number;
      readonly version: number;
      readonly issues: readonly z.core.$ZodIssue[];
    }
  | {
      readonly kind: "unknownSchemaRev";
      readonly streamId: string;
      readonly seq: number;
      readonly version: number;
      readonly schemaRev: number;
    };

// NOTE: one entry per rev bump, each a pure unknown -> unknown mapping rev N's
// payload shape to rev N+1's; upcastPayload chains them up to CURRENT_SCHEMA_REV.
// Never touches the DB — old rows are read forward, never rewritten (ADR 0010).
// Empty today: rev 1 is current, so nothing has ever needed upcasting yet.
const UPCASTERS: ReadonlyMap<number, (payload: unknown) => unknown> = new Map();

export type UpcastResult =
  | { readonly ok: true; readonly payload: unknown }
  | { readonly ok: false; readonly missingRev: number };

export const upcastPayload = (
  payload: unknown,
  fromRev: number,
  upcasters: ReadonlyMap<number, (payload: unknown) => unknown>,
): UpcastResult => {
  if (fromRev > CURRENT_SCHEMA_REV) {
    return { ok: false, missingRev: fromRev };
  }
  let current = payload;
  for (let rev = fromRev; rev < CURRENT_SCHEMA_REV; rev += 1) {
    const upcaster = upcasters.get(rev);
    if (upcaster === undefined) {
      return { ok: false, missingRev: rev };
    }
    current = upcaster(current);
  }
  return { ok: true, payload: current };
};

const toStored = (
  row: DefinitionChange,
):
  | { readonly ok: true; readonly change: StoredChange }
  | { readonly ok: false; readonly error: PayloadError } => {
  const upcasted = upcastPayload(row.payload, row.schemaRev, UPCASTERS);
  if (!upcasted.ok) {
    return {
      ok: false,
      error: {
        kind: "unknownSchemaRev",
        streamId: row.streamId,
        seq: row.seq,
        version: row.version,
        schemaRev: upcasted.missingRev,
      },
    };
  }
  const parsed = defChangeSchema.safeParse(upcasted.payload);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        kind: "corruptPayload",
        streamId: row.streamId,
        seq: row.seq,
        version: row.version,
        issues: parsed.error.issues,
      },
    };
  }
  return {
    ok: true,
    change: {
      seq: row.seq,
      streamId: row.streamId,
      version: row.version,
      recordedAt: row.recordedAt,
      change: parsed.data,
      schemaRev: row.schemaRev,
      registryId: row.registryId,
      actorId: row.actorId,
    },
  };
};

const isKnownRequestError = (
  e: unknown,
  code: string,
): e is InstanceType<typeof Prisma.PrismaClientKnownRequestError> =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === code;

export async function appendChanges(
  db: ChangeStoreClient,
  streamId: string,
  expectedVersion: number,
  batch: readonly NewChange[],
  opts?: { readonly actorId?: string },
): Promise<AppendResult> {
  if (batch.length === 0) {
    return { ok: false, error: { kind: "emptyBatch" } };
  }
  for (let i = 0; i < batch.length; i += 1) {
    const validation = defChangeSchema.safeParse(batch[i]);
    if (!validation.success) {
      return {
        ok: false,
        error: {
          kind: "malformedChange",
          index: i,
          issues: validation.error.issues,
        },
      };
    }
  }
  for (let attempt = 0; ; attempt += 1) {
    const rows = await db.definitionChange.findMany({
      where: { streamId },
      orderBy: { version: "asc" },
    });
    const actual = rows[rows.length - 1]?.version ?? 0;
    if (expectedVersion === 0 && actual > 0) {
      return { ok: false, error: { kind: "alreadyExists" } };
    }
    if (expectedVersion > 0 && actual === 0) {
      return { ok: false, error: { kind: "notFound" } };
    }
    if (expectedVersion !== actual) {
      return {
        ok: false,
        error: {
          kind: "versionConflict",
          expected: expectedVersion,
          actual,
        },
      };
    }

    const existing: DefChange[] = [];
    for (const row of rows) {
      const stored = toStored(row);
      if (!stored.ok) {
        throw new Error(
          `unreadable existing DefinitionChange payload (stream=${streamId} seq=${row.seq} version=${row.version}): ${stored.error.kind}: ${JSON.stringify(stored.error)}`,
        );
      }
      existing.push(stored.change.change);
    }
    const folded = foldDefinition(streamId, [...existing, ...batch]);
    if (!folded.ok) {
      return {
        ok: false,
        error: { kind: "invalidBatch", error: folded.error },
      };
    }
    const gated = safeParseEventDef(folded.candidate);
    if (!gated.success) {
      return {
        ok: false,
        error: { kind: "invalidDefinition", issues: gated.error.issues },
      };
    }

    try {
      await db.definitionChange.createMany({
        data: batch.map((change, i) => ({
          streamId,
          version: expectedVersion + 1 + i,
          type: change.type,
          payload: jsonPayload.parse(change),
          // NOTE: schemaRev/registryId always stamp the currently-loaded registry and
          // schema revision, never a value from the caller — see
          // design/adr/0010-registry-identity-and-schema-evolution.md
          schemaRev: CURRENT_SCHEMA_REV,
          registryId: chessRegistry.id,
          actorId: opts?.actorId ?? null,
          // NOTE: Explicit over DB @default(now()) — SQLite's CURRENT_TIMESTAMP is
          // second-granular (ADR 0001); timestamp ordering is unreliable regardless (ADR 0003).
          recordedAt: new Date(),
        })),
      });
    } catch (e) {
      if (isKnownRequestError(e, "P2002")) {
        const head = await db.definitionChange.findFirst({
          where: { streamId },
          orderBy: { version: "desc" },
        });
        return {
          ok: false,
          error: {
            kind: "versionConflict",
            expected: expectedVersion,
            actual: head?.version ?? 0,
          },
        };
      }
      if (isKnownRequestError(e, "P2034") && attempt < MAX_P2034_RETRIES) {
        continue;
      }
      throw e;
    }

    const written = await db.definitionChange.findMany({
      where: {
        streamId,
        version: { gt: expectedVersion, lte: expectedVersion + batch.length },
      },
      orderBy: { version: "asc" },
    });
    return {
      ok: true,
      version: expectedVersion + batch.length,
      seqs: written.map((row) => row.seq),
    };
  }
}

export type ReadChangesResult =
  | { readonly ok: true; readonly changes: readonly StoredChange[] }
  | {
      readonly ok: false;
      readonly error: { readonly kind: "notFound" } | PayloadError;
    };

export async function readChanges(
  db: ChangeStoreClient,
  streamId: string,
  opts?: { readonly toVersion?: number },
): Promise<ReadChangesResult> {
  const toVersion = opts?.toVersion;
  const rows = await db.definitionChange.findMany({
    where: {
      streamId,
      ...(toVersion === undefined ? {} : { version: { lte: toVersion } }),
    },
    orderBy: { version: "asc" },
  });
  if (rows.length === 0) {
    const exists = await db.definitionChange.count({ where: { streamId } });
    if (exists === 0) {
      return { ok: false, error: { kind: "notFound" } };
    }
  }
  const changes: StoredChange[] = [];
  for (const row of rows) {
    const stored = toStored(row);
    if (!stored.ok) {
      return { ok: false, error: stored.error };
    }
    changes.push(stored.change);
  }
  return { ok: true, changes };
}

export type ReadDefinitionError =
  | { readonly kind: "notFound" }
  | {
      readonly kind: "invalidPrefix";
      readonly version: number;
      readonly reason: "fold" | "definition";
    }
  | PayloadError;

export type ReadDefinitionResult =
  | {
      readonly ok: true;
      readonly def: ParsedEventDef;
      readonly version: number;
    }
  | { readonly ok: false; readonly error: ReadDefinitionError };

export async function readDefinition(
  db: ChangeStoreClient,
  streamId: string,
  opts?: { readonly toVersion?: number },
): Promise<ReadDefinitionResult> {
  const read = await readChanges(db, streamId, opts);
  if (!read.ok) return read;
  const last = read.changes[read.changes.length - 1];
  if (last === undefined) {
    return {
      ok: false,
      error: { kind: "invalidPrefix", version: 0, reason: "fold" },
    };
  }
  const folded = foldDefinition(
    streamId,
    read.changes.map((c) => c.change),
  );
  if (!folded.ok) {
    return {
      ok: false,
      error: { kind: "invalidPrefix", version: last.version, reason: "fold" },
    };
  }
  const gated = safeParseEventDef(folded.candidate);
  if (!gated.success) {
    return {
      ok: false,
      error: {
        kind: "invalidPrefix",
        version: last.version,
        reason: "definition",
      },
    };
  }
  return { ok: true, def: gated.data, version: last.version };
}

export type SubmitState = {
  readonly def: ParsedEventDef | null;
  readonly version: number;
};

export type Decision<R> = readonly NewChange[] | { readonly reject: R };

export type SubmitResult<R> =
  | AppendOk
  | {
      readonly ok: false;
      readonly error:
        | AppendError
        | { readonly kind: "rejected"; readonly reason: R }
        | { readonly kind: "retriesExhausted"; readonly attempts: number };
    };

// NOTE: decide must be deterministic over its input — the loop re-invokes it on versionConflict;
// non-deterministic decide silently breaks replay equality (ADR 0003). Empty [] = no-op success.
export async function submit<R>(
  db: ChangeStoreClient,
  streamId: string,
  decide: (state: SubmitState) => Decision<R>,
  opts?: { readonly retries?: number; readonly actorId?: string },
): Promise<SubmitResult<R>> {
  const retries = opts?.retries ?? 3;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const current = await readDefinition(db, streamId);
    let state: SubmitState;
    if (current.ok) {
      state = { def: current.def, version: current.version };
    } else if (current.error.kind === "notFound") {
      state = { def: null, version: 0 };
    } else {
      const seqPart = "seq" in current.error ? ` seq=${current.error.seq}` : "";
      throw new Error(
        `stream ${streamId} unreadable (${current.error.kind} at version ${current.error.version}${seqPart})`,
      );
    }

    const decision = decide(state);
    if ("reject" in decision) {
      return {
        ok: false,
        error: { kind: "rejected", reason: decision.reject },
      };
    }
    if (decision.length === 0) {
      return { ok: true, version: state.version, seqs: [] };
    }

    const result = await appendChanges(
      db,
      streamId,
      state.version,
      decision,
      opts,
    );
    if (result.ok) return result;
    if (result.error.kind === "versionConflict") continue;
    return result;
  }
  return {
    ok: false,
    error: { kind: "retriesExhausted", attempts: retries + 1 },
  };
}

export type ReadAllChangesResult =
  | { readonly ok: true; readonly changes: readonly StoredChange[] }
  | { readonly ok: false; readonly error: PayloadError };

// NOTE: seq is commit-order-skewed — insertions commit out of seq order;
// afterSeq pagination can miss late-committing rows. ADR 0003; ADR 0007 will address it.
export async function readAllChanges(
  db: ChangeStoreClient,
  opts?: { readonly afterSeq?: number; readonly limit?: number },
): Promise<ReadAllChangesResult> {
  const rows = await db.definitionChange.findMany({
    where: opts?.afterSeq === undefined ? {} : { seq: { gt: opts.afterSeq } },
    orderBy: { seq: "asc" },
    ...(opts?.limit === undefined ? {} : { take: opts.limit }),
  });
  const changes: StoredChange[] = [];
  for (const row of rows) {
    const stored = toStored(row);
    if (!stored.ok) {
      return { ok: false, error: stored.error };
    }
    changes.push(stored.change);
  }
  return { ok: true, changes };
}
