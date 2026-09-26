import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/browser",
  workers: 1,
  fullyParallel: false,
  timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:4178",
    viewport: { width: 1440, height: 1000 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command:
      ".runtime/node_modules/node/bin/node --import tsx tests/browser-server.ts",
    url: "http://127.0.0.1:4178/health",
    reuseExistingServer: false,
    timeout: 30000,
  },
  reporter: "list",
});
