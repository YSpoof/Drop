import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  timeout: 60_000,
  expect: {
    timeout: 15_000,
  },
  reporter: "html",
  use: {
    baseURL: "http://localhost:4321",
    trace: "on-first-retry",
    permissions: ["notifications"],
  },
  projects: [
    {
      name: "chromium",
      testIgnore: "**/connections/**",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "chromium-connections",
      testMatch: "**/connections/**",
      fullyParallel: false,
      timeout: 90_000,
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:4321",
    reuseExistingServer: !process.env.CI,
  },
});
