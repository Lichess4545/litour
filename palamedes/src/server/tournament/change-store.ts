// appendChanges is the only write path — fold + safeParseEventDef gate every
// batch before createMany; version conflicts surface as typed errors, not thrown.
// design/adr/0004-change-store-dal-boundary.md

import { z } from "zod";
import { chessRegistry, safeParseEventDef } from "@/chess/registry";
import {
  type DefinitionChange,
  Prisma,
  type PrismaClient,
} from "@/generated/prisma/client";
import { type FoldError, foldDefinition } from "@/tournament/changes/fold";
import { buildDefChangeSchema } from "@/tournament/changes/schema";
import type { DefChange } from "@/tournament/changes/types";
import type { ParsedEventDef } from "@/tournament/registry";

export type NewChange = DefChange;

export type StoredChange = {
  readonly seq: number;
  readonly streamId: string;
  readonly version: number;
  readonly recordedAt: Date;
  readonly change: DefChange;
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
    };

export type AppendResult =
  | AppendOk
  | { readonly ok: false; readonly error: AppendError };

const changeSchema = buildDefChangeSchema(chessRegistry);
// NOTE: z.json() validates JSON purity at runtime; v !== null excludes bare null
// to satisfy Prisma.InputJsonValue — no type assertion needed.
const jsonPayload: z.ZodType<Prisma.InputJsonValue> =
  z.custom<Prisma.InputJsonValue>(
    (v) => z.json().safeParse(v).success && v !== null,
  );
const MAX_P2034_RETRIES = 3;

const toStored = (row: DefinitionChange): StoredChange => {
  const parsed = changeSchema.safeParse(row.payload);
  if (!parsed.success) {
    throw new Error(
      `corrupt DefinitionChange payload (stream=${row.streamId} seq=${row.seq} version=${row.version}): ${parsed.error.message}`,
    );
  }
  return {
    seq: row.seq,
    streamId: row.streamId,
    version: row.version,
    recordedAt: row.recordedAt,
    change: parsed.data,
  };
};

const isKnownRequestError = (
  e: unknown,
  code: string,
): e is InstanceType<typeof Prisma.PrismaClientKnownRequestError> =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === code;

export async function appendChanges(
  db: PrismaClient,
  streamId: string,
  expectedVersion: number,
  batch: readonly NewChange[],
): Promise<AppendResult> {
  if (batch.length === 0) {
    return { ok: false, error: { kind: "emptyBatch" } };
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

    const existing = rows.map((row) => toStored(row).change);
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
  | { readonly ok: false; readonly error: { readonly kind: "notFound" } };

export async function readChanges(
  db: PrismaClient,
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
  return { ok: true, changes: rows.map(toStored) };
}

export type ReadDefinitionError =
  | { readonly kind: "notFound" }
  | {
      readonly kind: "invalidPrefix";
      readonly version: number;
      readonly reason: "fold" | "definition";
    };

export type ReadDefinitionResult =
  | {
      readonly ok: true;
      readonly def: ParsedEventDef;
      readonly version: number;
    }
  | { readonly ok: false; readonly error: ReadDefinitionError };

export async function readDefinition(
  db: PrismaClient,
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

// NOTE: seq is commit-order-skewed — insertions commit out of seq order;
// afterSeq pagination can miss late-committing rows. ADR 0003; ADR 0007 will address it.
export async function readAllChanges(
  db: PrismaClient,
  opts?: { readonly afterSeq?: number; readonly limit?: number },
): Promise<readonly StoredChange[]> {
  const rows = await db.definitionChange.findMany({
    where: opts?.afterSeq === undefined ? {} : { seq: { gt: opts.afterSeq } },
    orderBy: { seq: "asc" },
    ...(opts?.limit === undefined ? {} : { take: opts.limit }),
  });
  return rows.map(toStored);
}
