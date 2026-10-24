import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // Integration fixtures launch real Git processes; bound Windows worker contention.
    testTimeout: 15000,
  },
});
