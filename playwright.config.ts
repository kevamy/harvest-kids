import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PORT ?? 3000);
const baseURL = `http://localhost:${port}`;

// Server output copied here by scripts/serveur-e2e.mjs (secret leak checks).
process.env.HK_JOURNAL_SERVEUR ??= join(tmpdir(), `harvest-kids-e2e-serveur-${port}.log`);

// Target device: 10–11 inch Android tablet, landscape and portrait (cahier §16).
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    locale: "fr-FR",
    timezoneId: "Africa/Porto-Novo",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "tablette-paysage",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 }, hasTouch: true },
    },
    {
      name: "tablette-portrait",
      use: { ...devices["Desktop Chrome"], viewport: { width: 800, height: 1280 }, hasTouch: true },
    },
  ],
  webServer: {
    // CI tests the production build; locally the dev server is reused if running.
    command: `node scripts/serveur-e2e.mjs pnpm ${process.env.CI ? "start" : "dev"} --port ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
