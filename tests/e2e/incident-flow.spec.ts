import { expect, test, type Page } from "@playwright/test";

/**
 * The journeys a visitor actually takes.
 *
 * These assert wiring, not simulation maths — the engine has 105 unit tests for
 * that. What is verified here is that the pieces are connected: routes resolve,
 * state reaches the screen, dialogs behave, and a full incident can be worked
 * from trigger to score without touching the console.
 */

/** Dismiss onboarding if this is a fresh browser profile. */
async function dismissOnboarding(page: Page) {
  const explore = page.getByRole("button", { name: "Explore the dashboard" });
  if (await explore.isVisible().catch(() => false)) await explore.click();
  await expect(page.getByRole("dialog")).toBeHidden();
}

async function setSpeed4x(page: Page) {
  const fast = page.locator('button[title="Quadruple speed"]');
  if (await fast.isVisible().catch(() => false)) await fast.click();
}

async function startScenario(page: Page, title: string) {
  await page.goto("/simulation");
  await dismissOnboarding(page);
  await setSpeed4x(page);

  const card = page.locator("button[aria-expanded]").filter({ hasText: title });
  if ((await card.getAttribute("aria-expanded")) !== "true") await card.click();

  await page.locator("button").filter({ hasText: /^Start simulation$/ }).first().click();
  await expect(page.getByText(title, { exact: false }).first()).toBeVisible();
}

test.describe("first impression", () => {
  test("overview loads with live telemetry", async ({ page }) => {
    await page.goto("/");
    await dismissOnboarding(page);

    await expect(page.getByRole("heading", { name: /All Systems Operational/i })).toBeVisible();
    await expect(page.getByText("Service health")).toBeVisible();

    // The clock proves the simulation is actually ticking.
    const clock = page.locator("header").getByText(/^\d{2}:\d{2}:\d{2}$/);
    const first = await clock.textContent();
    await page.waitForTimeout(2500);
    expect(await clock.textContent()).not.toBe(first);
  });

  test("onboarding appears once, then stays dismissed", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "Explore the dashboard" }).click();

    await page.reload();
    await expect(page.getByRole("dialog")).toBeHidden();
  });

  test("every section is reachable and renders", async ({ page }) => {
    await page.goto("/");
    await dismissOnboarding(page);

    const sections: Array<[string, RegExp]> = [
      ["/infrastructure", /Infrastructure Topology/i],
      ["/services", /Service Catalogue/i],
      ["/metrics", /^Metrics$/],
      ["/api-monitor", /API Monitor/i],
      ["/incidents", /Incident Management/i],
      ["/alerts", /Alert Center/i],
      ["/logs", /Log Explorer/i],
      ["/network", /Network Center/i],
      ["/support", /Support Queue/i],
      ["/qa-lab", /QA Lab/i],
      ["/simulation", /Simulation Center/i],
      ["/about", /About This Project/i],
    ];

    for (const [href, heading] of sections) {
      await page.goto(href);
      await expect(page.getByRole("heading", { name: heading }).first()).toBeVisible();
    }
  });
});

test.describe("working an incident", () => {
  test("trigger, diagnose, remediate, score", async ({ page }) => {
    await startScenario(page, "DNS Resolution Failure");

    // Symptoms must reach the rest of the product, not just this page.
    await expect(page.getByText(/Major Incident/i).first()).toBeVisible({ timeout: 60_000 });

    await page.goto("/infrastructure");
    await expect(page.getByText("Needs attention")).toBeVisible();

    // A wrong diagnosis teaches rather than just rejecting. Scoped to the
    // feedback panel — the same words also appear in the timeline and a toast.
    await page.goto("/simulation");
    await page.getByRole("radio", { name: /Database connection exhaustion/i }).click();
    await page.getByRole("button", { name: "Submit diagnosis" }).click();
    await expect(page.getByText("Ruled out", { exact: true })).toBeVisible();
    // The coaching must be this scenario's, pointing at the healthy data tier.
    await expect(page.getByText(/a saturated database looks very different/i)).toBeVisible();

    // The correct one reveals the root cause and unlocks remediation.
    await page.getByRole("radio", { name: /DNS resolution failure/i }).click();
    await page.getByRole("button", { name: "Submit diagnosis" }).click();
    await expect(page.getByText(/Root cause confirmed/i)).toBeVisible();

    for (const action of [/Restore DNS zone configuration/i, /Flush resolver caches/i]) {
      await page.getByRole("button", { name: action }).click();
      // Wait for the action to finish before starting the next one.
      await expect(page.getByText(/in progress/i).first()).toBeHidden({ timeout: 60_000 });
    }

    // Exact match: the report badge. The same phrase also appears in a toast
    // and in the screen-reader live region.
    await expect(page.getByText("Incident resolved", { exact: true })).toBeVisible({
      timeout: 90_000,
    });
    await expect(page.getByText("/100")).toBeVisible();
    await expect(page.getByText(/Diagnosis accuracy/i)).toBeVisible();
    // This run deliberately guessed wrong once, so the report must say so —
    // scoring that reflects what actually happened is the point of the feature.
    await expect(page.getByText(/2 attempts before the correct cause/i)).toBeVisible();
    await expect(page.getByText(/2 required steps completed/i)).toBeVisible();
  });

  test("an incident survives a page reload", async ({ page }) => {
    await startScenario(page, "Redis Cache Failure");
    await expect(page.getByText(/Redis Cache Failure/).first()).toBeVisible();

    // Give the store time to write its first snapshot.
    await page.waitForTimeout(6000);
    await page.reload();

    await expect(page.getByText(/Redis Cache Failure/).first()).toBeVisible();
    await expect(page.getByText(/INC-\d+/).first()).toBeVisible();
  });

  test("ending an incident restores baseline", async ({ page }) => {
    await startScenario(page, "Expired TLS Certificate");
    await expect(page.getByText(/Major Incident/i).first()).toBeVisible({ timeout: 60_000 });

    await page.getByRole("button", { name: /End incident/i }).click();
    await page.getByRole("dialog").getByRole("button", { name: /End incident/i }).click();

    // Back to the scenario picker, environment healthy.
    await expect(page.getByRole("heading", { name: /Simulation Center/i })).toBeVisible();
    await expect(page.getByText(/All Systems Operational/i).first()).toBeVisible({ timeout: 60_000 });
  });
});

test.describe("diagnostic tools", () => {
  test("network terminal contradicts itself usefully during a DNS incident", async ({ page }) => {
    await startScenario(page, "DNS Resolution Failure");
    await page.waitForTimeout(12_000);

    await page.goto("/network");

    // Name resolution fails...
    await page.fill("#terminal-input", "ping api.internal");
    await page.getByRole("button", { name: "Run" }).click();
    await expect(page.getByText(/cannot resolve/i).first()).toBeVisible();

    // ...but the host is up when addressed by IP. That is the whole puzzle.
    await page.fill("#terminal-input", "ping 10.20.12.44");
    await page.getByRole("button", { name: "Run" }).click();
    await expect(page.getByText(/bytes from 10\.20\.12\.44/).first()).toBeVisible();

    await page.fill("#terminal-input", "dig api.internal");
    await page.getByRole("button", { name: "Run" }).click();
    await expect(page.getByText(/SERVFAIL/).first()).toBeVisible();
  });

  test("log explorer filters and pauses", async ({ page }) => {
    await page.goto("/logs");
    await dismissOnboarding(page);

    await expect(page.getByText(/Streaming/)).toBeVisible();
    await page.getByRole("button", { name: /^Pause$/ }).click();
    await expect(page.getByText(/Paused/)).toBeVisible();

    // Filtering to CRITICAL should not error even when nothing matches.
    await page.getByRole("button", { name: "CRITICAL", exact: true }).click();
    await expect(page.getByRole("heading", { name: /Log Explorer/i })).toBeVisible();
  });

  test("command palette navigates", async ({ page }) => {
    await page.goto("/");
    await dismissOnboarding(page);

    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByRole("dialog", { name: /Command palette/i })).toBeVisible();

    await page.getByRole("combobox").fill("topology");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: /Infrastructure Topology/i })).toBeVisible();
  });
});

test.describe("resilience", () => {
  test("reset returns everything to baseline", async ({ page }) => {
    await startScenario(page, "Database Connection Exhaustion");
    await page.waitForTimeout(4000);

    await page.getByRole("button", { name: "Reset environment" }).click();
    await page.getByRole("dialog").getByRole("button", { name: /Reset environment/i }).click();

    await page.goto("/incidents");
    await expect(page.getByText(/No incidents recorded/i)).toBeVisible();
  });

  test("no console errors during a full page tour", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));

    await page.goto("/");
    await dismissOnboarding(page);
    for (const href of ["/infrastructure", "/services", "/metrics", "/logs", "/network", "/about"]) {
      await page.goto(href);
      await page.waitForTimeout(500);
    }

    expect(errors).toEqual([]);
  });
});
