/**
 * Capture the README screenshots.
 *
 * These are driven through a real incident rather than posed on a healthy
 * environment: a dashboard full of green tells a reader nothing about what the
 * project does. The script triggers a DNS failure, waits for the symptoms to
 * propagate, and captures each view mid-incident.
 *
 * Usage:
 *   npm run build && npm start        # in one terminal
 *   node scripts/screenshots.mjs      # in another
 *
 * Pass a URL to capture from a deployment instead of localhost:
 *   node scripts/screenshots.mjs https://techops-command-center.vercel.app
 */

import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const BASE = process.argv[2] ?? "http://localhost:3000";
const OUT = "docs/screenshots";

/** Desktop capture size — wide enough to show the full three-column layouts. */
const VIEWPORT = { width: 1600, height: 1000 };

/** Dismiss onboarding and start a scenario, all through the real UI. */
async function startIncident(page, scenarioTitle) {
  await page.goto(`${BASE}/simulation`, { waitUntil: "networkidle" });

  const explore = page.getByRole("button", { name: "Explore the dashboard" });
  if (await explore.isVisible().catch(() => false)) await explore.click();

  // Run at 4x so the capture script does not sit for minutes. Targeted by
  // title, because the button's accessible name is its visible label ("4×").
  await page.locator('button[title="Quadruple speed"]').click();

  // The first scenario card renders already expanded, so toggle only when
  // it is actually collapsed — clicking blindly would close it.
  const card = page.locator("button[aria-expanded]").filter({ hasText: scenarioTitle });
  if ((await card.getAttribute("aria-expanded")) !== "true") await card.click();

  await page
    .locator("button")
    .filter({ hasText: /^Start simulation$/ })
    .first()
    .click();
}

async function shot(page, name, path, waitMs = 1200) {
  if (path) await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  // Let charts settle and entrance animations finish before capturing.
  await page.waitForTimeout(waitMs);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`captured ${name}.png`);
}

async function main() {
  await mkdir(OUT, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    colorScheme: "dark",
    reducedMotion: "reduce",
  });

  // --- Healthy overview, before anything breaks -------------------------
  await page.goto(BASE, { waitUntil: "networkidle" });
  const explore = page.getByRole("button", { name: "Explore the dashboard" });
  if (await explore.isVisible().catch(() => false)) await explore.click();
  await shot(page, "overview", null, 3000);

  // --- Trigger a DNS failure and let the symptoms spread ----------------
  await startIncident(page, "DNS Resolution Failure");
  await page.waitForTimeout(18000);

  await shot(page, "topology", "/infrastructure", 2500);
  await shot(page, "simulation", "/simulation", 1500);

  // --- Network diagnostics showing the DNS contradiction ----------------
  await page.goto(`${BASE}/network`, { waitUntil: "networkidle" });
  for (const command of ["ping api.internal", "dig api.internal", "ping 10.20.12.44"]) {
    await page.fill("#terminal-input", command);
    await page.getByRole("button", { name: "Run" }).click();
    await page.waitForTimeout(400);
  }
  await shot(page, "network", null, 800);

  // --- Solve it, so the report screenshot is a real result --------------
  await page.goto(`${BASE}/simulation`, { waitUntil: "networkidle" });
  await page.getByRole("radio", { name: /DNS resolution failure/i }).click();
  await page.getByRole("button", { name: "Submit diagnosis" }).click();
  await page.waitForTimeout(600);

  for (const action of ["Restore DNS zone configuration", "Flush resolver caches"]) {
    await page.getByRole("button", { name: new RegExp(action, "i") }).click();
    // Each remediation takes simulated seconds to complete.
    await page.waitForTimeout(9000);
  }

  // Wait for recovery to finish and the report to render.
  await page.waitForSelector("text=Incident resolved", { timeout: 90000 });
  await shot(page, "report", null, 1500);

  await browser.close();
  console.log(`\nDone — 5 screenshots in ${OUT}/`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
