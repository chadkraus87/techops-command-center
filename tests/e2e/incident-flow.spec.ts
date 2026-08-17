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

test.describe("sharing a result", () => {
  test("a finished run produces a link that renders for someone else", async ({
    page,
    context,
  }) => {
    // The share button writes to the clipboard, which needs explicit permission.
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);

    await startScenario(page, "Third-Party Payment Provider Outage");
    await page.getByRole("radio", { name: /Third-party provider outage/i }).click();
    await page.getByRole("button", { name: "Submit diagnosis" }).click();
    await page.getByRole("button", { name: /Fail over to the secondary payment provider/i }).click();
    await expect(page.getByText("Incident resolved", { exact: true })).toBeVisible({
      timeout: 90_000,
    });

    const score = await page.getByText("/100").first().textContent();

    await page.getByRole("button", { name: /Share result/i }).click();
    await expect(page.getByRole("button", { name: /Link copied/i })).toBeVisible();

    const shareUrl = await page.evaluate(() => navigator.clipboard.readText());
    expect(shareUrl).toContain("/result?r=");

    // Arrive as a stranger would: the result must render from the URL alone.
    await page.goto(shareUrl);
    await expect(page.getByRole("heading", { name: "Shared Result", level: 2 })).toBeVisible();
    await expect(page.getByText("Third-Party Payment Provider Outage").first()).toBeVisible();
    if (score) await expect(page.getByText(score.trim()).first()).toBeVisible();

    // And it must convert — one click to run the same scenario.
    await expect(page.getByRole("link", { name: /Beat this score|Go to Simulation/i })).toBeVisible();
  });

  test("a tampered link fails gracefully instead of crashing", async ({ page }) => {
    // An unknown scenario id would throw deep in the engine if it got that far.
    await page.goto("/result?r=" + Buffer.from("1~not-a-real-scenario~100~40~20~15~25~0~1~5~0~40~120").toString("base64url"));
    await expect(page.getByText(/could not be read/i)).toBeVisible();
    await expect(page.getByRole("link", { name: /Open Simulation Center/i })).toBeVisible();
  });

  test("a missing parameter fails gracefully", async ({ page }) => {
    await page.goto("/result");
    await expect(page.getByText(/could not be read/i)).toBeVisible();
  });

  test("a first-time visitor sees the result, not the welcome dialog", async ({ page }) => {
    // This is a fresh context, so onboarding would normally appear — and would
    // bury the very thing the link exists to show.
    const token = Buffer.from("1~redis-failure~92~40~20~15~25~8~1~4~1~52~168").toString("base64url");
    await page.goto(`/result?r=${token}`);

    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(page.getByText("92")).toBeVisible();
    await expect(page.getByText("Incident Commander").first()).toBeVisible();
    // And the page must not mislabel itself in the top bar.
    await expect(page.getByRole("heading", { name: "Shared Result", level: 1 })).toBeVisible();
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

test.describe("guided mode", () => {
  test("is off by default and reveals hints one at a time when enabled", async ({ page }) => {
    await startScenario(page, "Database Connection Exhaustion");

    // Off by default — an experienced visitor is not handed the answer.
    const toggle = page.getByRole("switch");
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await expect(page.getByRole("button", { name: /Give me a hint/i })).toBeHidden();

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");

    await page.getByRole("button", { name: /Give me a hint/i }).click();
    await expect(page.getByText("1/3")).toBeVisible();
    await expect(page.getByRole("button", { name: /Next hint \(2 left\)/i })).toBeVisible();

    // A hint must never contain the answer. Scoped to the revealed hint itself —
    // a looser locator matches the whole page, where the diagnosis options
    // legitimately list that text.
    // .first(): the hint title also appears in the incident timeline.
    const hintText =
      (await page.getByText(/Follow the slowness downwards/i).first().textContent()) ?? "";
    const hintBody = (await page.getByText(/walk down the stack/i).first().textContent()) ?? "";
    expect(`${hintText} ${hintBody}`.toLowerCase()).not.toContain(
      "database connection exhaustion",
    );
  });
});

test.describe("theme", () => {
  test("toggles to light, persists, and keeps the terminal dark", async ({ page }) => {
    await page.goto("/");
    await dismissOnboarding(page);

    // Dark is the default and needs no attribute.
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", "light");

    await page.getByRole("button", { name: /Switch to light theme/i }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    // Survives a reload.
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    // A console that turns white stops reading as a console.
    await page.goto("/network");
    const terminalBg = await page
      .locator(".terminal-surface")
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    const [r, g, b] = terminalBg.match(/\d+/g)!.slice(0, 3).map(Number);
    expect(r + g + b, "terminal should stay dark in light mode").toBeLessThan(120);
  });
});

test.describe("replay", () => {
  test("scrubs a resolved incident from healthy to failing to recovered", async ({ page }) => {
    await startScenario(page, "Third-Party Payment Provider Outage");
    await page.getByRole("radio", { name: /Third-party provider outage/i }).click();
    await page.getByRole("button", { name: "Submit diagnosis" }).click();
    await page.getByRole("button", { name: /Fail over to the secondary payment provider/i }).click();
    await expect(page.getByText("Incident resolved", { exact: true })).toBeVisible({
      timeout: 90_000,
    });

    await page.goto("/incidents");
    const slider = page.locator('input[type="range"][id^="replay-"]');
    await expect(slider).toBeVisible();

    /**
     * Count topology nodes not labelled Healthy at the current position.
     * Polled, because the slider change and React's re-render are not the same
     * tick — reading immediately after `fill` races the reconstruction.
     */
    const countUnhealthy = () =>
      page.evaluate(() => {
        const panel = document
          .querySelector('input[type="range"][id^="replay-"]')!
          .closest(".panel")!;
        // Scoped to the topology's list items — the panel's own controls
        // ("Back to start", "Jump to end") also carry aria-labels.
        return [...panel.querySelectorAll("ul li button[aria-label]")].filter(
          (n) => !/Healthy$/.test(n.getAttribute("aria-label") ?? ""),
        ).length;
      });

    const max = await slider.getAttribute("max");

    await slider.fill("0");
    await expect.poll(countUnhealthy).toBe(0);

    await slider.fill("40");
    await expect.poll(countUnhealthy).toBeGreaterThan(0);

    await slider.fill(max!);
    await expect.poll(countUnhealthy).toBe(0);
  });
});
