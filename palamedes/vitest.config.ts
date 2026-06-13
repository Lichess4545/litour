import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    // Load .env into process.env so src/env.ts validates in tests.
    env: loadEnv(mode, process.cwd(), ""),
    coverage: {
      provider: "v8",
      // `all` reports every source file, not only the ones a test imported,
      // so untested code shows as 0% instead of vanishing from the report.
      all: true,
      reporter: ["text", "json", "json-summary", "html"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/test/**", // test setup + helpers
        "src/generated/**", // generated Prisma client
        "src/components/ui/**", // generated shadcn primitives
        "src/env.ts", // build-time env validation
        "**/*.d.ts",
      ],
    },
  },
}));
