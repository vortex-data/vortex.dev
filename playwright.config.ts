import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  // Browser specs only. tests/unit holds node:test files that `bun test` runs.
  testMatch: "*.spec.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // The retry classifies a failure for diagnosis: a test that fails and then
  // passes is flaky, and a flaky test still fails CI.
  retries: process.env.CI ? 1 : 0,
  failOnFlakyTests: !!process.env.CI,
  workers: 1,
  // The JSON report keeps each attempt and its duration. CI uploads it on
  // success too, and a failed test keeps its trace in test-results/.
  reporter: process.env.CI
    ? [["github"], ["json", { outputFile: "test-results/results.json" }]]
    : [["list"], ["json", { outputFile: "test-results/results.json" }]],
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure"
  },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 720 }
      }
    },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"] }
    }
  ]
});
