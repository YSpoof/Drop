import { defineConfig } from "vitest/config";

// `#lib/*` resolves through the package.json `imports` field, as in the app.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
