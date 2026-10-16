import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test/e2e",
  fullyParallel: false,
  workers: 1,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  webServer: [
    {
      command: "npm run dev",
      url: "http://127.0.0.1:3100/health",
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        ...process.env,
        PORT: "3100",
        ACCOUNT_CREATION_RATE_LIMIT_MAX: "100",
        ACCOUNT_CREATION_RATE_LIMIT_WINDOW_MS: "60000",
      },
    },
    {
      command:
        "npm --prefix client run dev -- --host 127.0.0.1 --port 4173 --strictPort",
      url: "http://127.0.0.1:4173",
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        ...process.env,
        API_PROXY_TARGET: "http://127.0.0.1:3100",
      },
    },
  ],
});
