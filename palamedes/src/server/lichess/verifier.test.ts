// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";

const globalForLichessVerifier: typeof globalThis & {
  lichessTokenVerifierGlobal?: unknown;
} = globalThis;

afterEach(() => {
  vi.unstubAllEnvs();
});

it("two imports of the verifier module, even across a hot-reload-style module reset, yield the identical function object", async () => {
  const { verifyLichessToken: first } = await import(
    "@/server/lichess/verifier"
  );
  vi.resetModules();
  const { verifyLichessToken: second } = await import(
    "@/server/lichess/verifier"
  );

  expect(second).toBe(first);
});

it("pins the singleton in production too, so a second module evaluation in one process reuses the same verifier", async () => {
  const previouslyPinned = globalForLichessVerifier.lichessTokenVerifierGlobal;
  vi.stubEnv("NODE_ENV", "production");
  try {
    globalForLichessVerifier.lichessTokenVerifierGlobal = undefined;
    vi.resetModules();
    const { verifyLichessToken: first } = await import(
      "@/server/lichess/verifier"
    );
    vi.resetModules();
    const { verifyLichessToken: second } = await import(
      "@/server/lichess/verifier"
    );

    expect(second).toBe(first);
  } finally {
    globalForLichessVerifier.lichessTokenVerifierGlobal = previouslyPinned;
  }
});
