import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts"],
    setupFiles: ["src/__tests__/setup.ts"],
    testTimeout: 60000,
    hookTimeout: 90000,
    fileParallelism: false,
    pool: "forks",
  },
});
