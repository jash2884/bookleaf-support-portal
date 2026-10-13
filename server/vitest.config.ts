import { defineConfig } from "vitest/config";

// Tests never read server/.env: the environment is pinned here so they can't hit
// the dev database or a real AI key by accident.
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://bookleaf:bookleaf@localhost:5432/bookleaf_test?schema=public";

export default defineConfig({
  test: {
    env: {
      NODE_ENV: "test",
      DATABASE_URL: TEST_DATABASE_URL,
      JWT_SECRET: "test-secret-test-secret-test-secret-123",
      ANTHROPIC_API_KEY: "", // integration tests exercise the offline fallbacks
      UPLOAD_DIR: "tmp-test-uploads",
    },
    projects: [
      { extends: true, test: { name: "unit", include: ["tests/unit/**/*.test.ts"] } },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          globalSetup: ["tests/integration/globalSetup.ts"],
          fileParallelism: false,
        },
      },
    ],
  },
});
