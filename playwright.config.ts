import { defineConfig } from "@playwright/test";
import { prepareE2ELocalData } from "./tests/e2e/helpers/local-data";

const localData = prepareE2ELocalData();

export default defineConfig({
  testDir: "./tests/e2e",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  maxFailures: process.env.CI ? 5 : undefined,
  globalTimeout: 20 * 60_000,
  reporter: process.env.CI ? [["list"], ["github"], ["html", { open: "never" }]] : "list",
  fullyParallel: false,
  workers: 1,
  // Playwright's API cookie jar accepts production Secure cookies on localhost.
  use: { baseURL: "http://localhost:3127", browserName: "chromium", trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: {
    command: process.env.CI ? "npm run start -- --hostname localhost --port 3127" : "npm run dev -- --hostname localhost --port 3127",
    url: "http://localhost:3127/api/session",
    reuseExistingServer: false,
    timeout: 120000,
    env: {
      STORAGE_DRIVER: "local",
      LOCAL_DATA_DIR: localData.directory,
      APP_DIRECTION_PASSWORD: "test-direction",
      APP_EMPLOYEE_PASSWORD: "test-employee",
    },
  },
});
