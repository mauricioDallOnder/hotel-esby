import { test as base } from "@playwright/test";
import { prepareE2ELocalData, resetE2ELocalData } from "./helpers/local-data";

export { expect } from "@playwright/test";
export type { Locator, Page, Worker } from "@playwright/test";

export const test = base.extend<{ isolatedLocalData: void }>({
  isolatedLocalData: [async ({ baseURL }, use, testInfo) => {
    const data = prepareE2ELocalData();
    const server = testInfo.config.webServer;
    if (testInfo.config.workers !== 1 || !server || server.reuseExistingServer !== false ||
      server.env?.STORAGE_DRIVER !== "local" || server.env.LOCAL_DATA_DIR !== data.directory)
      throw new Error("E2E isolation requires one worker and the harness-owned local web server.");
    const origin = baseURL && new URL(baseURL);
    if (!origin || !["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname) ||
      !server.url || new URL(server.url).origin !== origin.origin)
      throw new Error("E2E isolation only supports the configured loopback web server.");
    // Auto test fixtures run before hooks and also run again for each retry.
    // Browser contexts are closed by Playwright between these serial attempts.
    resetE2ELocalData(data);
    await use();
  }, { auto: true, box: true }],
});
