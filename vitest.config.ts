import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // Real Git startup is slow on Windows; bound contention and allow complete assertions.
    maxWorkers: 3,
    testTimeout: 60000,
  },
});
