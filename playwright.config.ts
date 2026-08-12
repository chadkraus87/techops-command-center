import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests.
 *
 * The Vitest suite covers the simulation engine exhaustively, so these tests
 * deliberately do *not* re-assert simulation behaviour. They cover the one thing
 * unit tests cannot: that a person can actually click through an incident in a
 * browser — routing, state wiring, dialogs, forms and session restore.
 *
 * They run against a production build, because that is what gets deployed and
 * because dev-only React behaviour has masked real bugs here before.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  // The simulation is time-based; a run needs room to breathe even at 4x.
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",

  use: {
    baseURL: "http://localhost:3211",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    colorScheme: "dark",
    /**
     * The application honours prefers-reduced-motion, and entrance animations
     * otherwise leave elements "not stable" long enough for Playwright to time
     * out waiting to click them. This tests the same DOM, deterministically.
     */
    contextOptions: { reducedMotion: "reduce" },
  },

  /**
   * The two projects test different things on purpose.
   *
   * Replaying the desktop journeys on a phone would mostly assert that
   * desktop-only chrome is missing, which is noise. Mobile gets its own spec
   * covering what actually differs there: the nav drawer, stacked table
   * layouts, and the absence of horizontal overflow.
   */
  projects: [
    {
      name: "desktop",
      testMatch: /incident-flow\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "mobile",
      testMatch: /responsive\.spec\.ts/,
      use: { ...devices["Pixel 7"] },
    },
  ],

  webServer: {
    command: "npm run build && npx next start -p 3211",
    url: "http://localhost:3211",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
