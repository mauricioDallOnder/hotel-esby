import { defineConfig } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export default defineConfig({
  testDir: "./tests/e2e",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  globalTimeout: 20 * 60_000,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  workers: 1,
  use: { baseURL: "http://127.0.0.1:3127", browserName: "chromium", trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: {
    command: process.env.CI ? "npm run start -- --hostname 127.0.0.1 --port 3127" : "npm run dev -- --hostname 127.0.0.1 --port 3127",
    url: "http://127.0.0.1:3127/api/session",
    reuseExistingServer: false,
    timeout: 120000,
    env: {
      STORAGE_DRIVER: "local",
      LOCAL_DATA_DIR: mkdtempSync(path.join(tmpdir(), "hotel-e2e-")),
      APP_DIRECTION_PASSWORD: "test-direction",
      APP_EMPLOYEE_PASSWORD: "test-employee",
    },
  },
});
