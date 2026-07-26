import type { Hook, z } from "@hono/zod-openapi";
import type { Env } from "hono";
import type {
  AppendError,
  ReadDefinitionError,
} from "@/server/tournament/change-store";

export type ApiError = ReadDefinitionError | AppendError;

export const apiErrorCodes = [
  "invalid_request",
  "not_found",
  "invalid_stream",
  "version_conflict",
  "already_exists",
  "empty_batch",
  "invalid_batch",
  "invalid_definition",
  "malformed_change",
  "internal",
] as const;

export type ApiErrorCode = (typeof apiErrorCodes)[number];

export type ApiErrorStatus = 400 | 404 | 409 | 422 | 500;

export type ErrorEnvelope = {
  readonly error: {
    readonly code: ApiErrorCode;
    readonly message: string;
    readonly details?: unknown;
  };
};

export type ErrorResponse = {
  readonly status: ApiErrorStatus;
  readonly body: ErrorEnvelope;
};

export type ReadErrorResponse = {
  readonly status: 404 | 500;
  readonly body: ErrorEnvelope;
};

export type AppendErrorResponse = {
  readonly status: 404 | 409 | 422;
  readonly body: ErrorEnvelope;
};

export type ValidationErrorResponse = {
  readonly status: 400;
  readonly body: ErrorEnvelope;
};

function envelope(
  status: ApiErrorStatus,
  code: ApiErrorCode,
  message: string,
  details?: unknown,
): ErrorResponse {
  return details === undefined
    ? { status, body: { error: { code, message } } }
    : { status, body: { error: { code, message, details } } };
}

// Forces a new ReadDefinitionError/AppendError variant to fail compilation at the
// switch below instead of silently falling through to a wrong HTTP status.
function assertNever(value: never): never {
  throw new Error(
    `toErrorResponse: unhandled error kind ${JSON.stringify(value)}`,
  );
}

// One switch, two overloads: @hono/zod-openapi's createRoute responses are keyed by
// literal status codes, so a read route's handler needs a 404/500 return type and an
// append route's a 404/409/422 one. A single signature returning the full ApiErrorStatus
// union would make every call site's status too wide to satisfy either route's typed
// response map.
export function toErrorResponse(error: ReadDefinitionError): ReadErrorResponse;
export function toErrorResponse(error: AppendError): AppendErrorResponse;
export function toErrorResponse(error: ApiError): ErrorResponse {
  switch (error.kind) {
    case "notFound":
      return envelope(
        404,
        "not_found",
        "No definition stream exists with this id.",
      );
    case "invalidPrefix":
      return envelope(
        500,
        "invalid_stream",
        `The changelog for this stream failed to ${
          error.reason === "fold"
            ? "fold into a definition"
            : "pass definition validation"
        } as of version ${error.version}.`,
        error,
      );
    case "corruptPayload":
      return envelope(
        500,
        "invalid_stream",
        `Stream ${error.streamId} has a change at version ${error.version} (seq ${error.seq}) whose stored payload no longer parses.`,
        error,
      );
    case "unknownSchemaRev":
      return envelope(
        500,
        "invalid_stream",
        `Stream ${error.streamId} has a change at version ${error.version} (seq ${error.seq}) written at schema revision ${error.schemaRev}, which this server has no upcaster for.`,
        error,
      );
    case "versionConflict":
      return envelope(
        409,
        "version_conflict",
        `Expected the stream to be at version ${error.expected} but it is at ${error.actual}.`,
        error,
      );
    case "alreadyExists":
      return envelope(
        409,
        "already_exists",
        "A stream already exists at this id.",
      );
    case "emptyBatch":
      return envelope(422, "empty_batch", "The change batch was empty.");
    case "invalidBatch":
      return envelope(
        422,
        "invalid_batch",
        `The change batch failed to fold: ${error.error.kind}.`,
        error,
      );
    case "invalidDefinition":
      return envelope(
        422,
        "invalid_definition",
        "Applying this batch would produce a definition that fails validation.",
        error,
      );
    case "malformedChange":
      return envelope(
        422,
        "malformed_change",
        `The change at index ${error.index} of the batch failed schema validation.`,
        error,
      );
    default:
      return assertNever(error);
  }
}

export function toUnexpectedErrorResponse(): ErrorResponse {
  return envelope(
    500,
    "internal",
    "An unexpected error occurred while handling this request.",
  );
}

export function toValidationErrorResponse(
  error: z.ZodError,
): ValidationErrorResponse {
  return {
    status: 400,
    body: {
      error: {
        code: "invalid_request",
        message: "The request failed schema validation.",
        details: error.issues.map((issue) => ({
          path: issue.path.map(String),
          code: issue.code,
          message: issue.message,
        })),
      },
    },
  };
}

// NOTE: returning undefined on success (not a Response) matters: @hono/zod-validator
// only short-circuits past the handler when the hook returns something truthy: falling
// through to `undefined` is what lets its own `return result.data` run and the request
// reach the route handler. Wiring this into a sub-router's `new OpenAPIHono({defaultHook})`
// is not optional per-app: `OpenAPIHono#openapi` reads `this.defaultHook` as the fallback
// hook argument at route-registration time, so only the router the route was actually
// registered on needs it — passing it to the top-level `api` and forgetting a sub-router
// (vocabularyRouter, definitionsReadRouter) would leave that sub-router's routes
// validating with no hook at all, falling back to zod-validator's raw `c.json(result, 400)`
// instead of the standard error envelope.
export const apiDefaultHook: Hook<
  unknown,
  Env,
  string,
  Response | undefined
> = (result, c) => {
  if (result.success) return undefined;
  const mapped = toValidationErrorResponse(result.error);
  return c.json(mapped.body, mapped.status);
};
