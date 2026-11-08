// Plain Node unit tests for pure logic (no Workers runtime needed).
// The Workers integration tests in test/*.test.ts use vitest.config.ts.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/unit/**/*.test.ts"],
    environment: "node",
  },
});
