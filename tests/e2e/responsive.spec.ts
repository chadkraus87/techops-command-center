import { expect, test, type Page } from "@playwright/test";

/**
 * Mobile behaviour.
 *
 * Scoped to what genuinely differs on a phone rather than replaying the desktop
 * journeys: navigation moves into a drawer, dense tables restack, and the page
 * must never scroll sideways. Horizontal overflow is the regression this file
 * exists to catch — it has already been introduced twice, both times invisibly
 * on desktop.
 */

const ROUTES = [
  "/",
  "/infrastructure",
  "/services",
  "/metrics",
  "/api-monitor",
  "/incidents",
  "/alerts",
  "/logs",
  "/network",
  "/support",
  "/qa-lab",
  "/simulation",
  "/about",
];

async function dismissOnboarding(page: Page) {
  const explore = page.getByRole("button", { name: "Explore the dashboard" });
  if (await explore.isVisible().catch(() => false)) await explore.click();
}

test.describe("mobile layout", () => {
  test("no route scrolls horizontally", async ({ page }) => {
    await page.goto("/");
    await dismissOnboarding(page);

    for (const route of ROUTES) {
      await page.goto(route);
      // Let charts and any deferred layout settle before measuring.
      await page.waitForTimeout(400);

      const overflow = await page.evaluate(() => {
        const de = document.documentElement;
        if (de.scrollWidth <= de.clientWidth + 1) return null;
        const worst = [...document.querySelectorAll("body *")]
          .map((el) => ({ el, right: el.getBoundingClientRect().right }))
          .filter((x) => x.right > de.clientWidth + 1)
          .sort((a, b) => b.right - a.right)[0];
        return {
          scrollWidth: de.scrollWidth,
          clientWidth: de.clientWidth,
          culprit: worst ? `${worst.el.tagName}.${String(worst.el.className).slice(0, 60)}` : "?",
        };
      });

      expect(overflow, `${route} overflows horizontally`).toBeNull();
    }
  });

  test("navigation drawer opens and routes", async ({ page }) => {
    await page.goto("/");
    await dismissOnboarding(page);

    // The sidebar is off-canvas until the menu button is pressed.
    await page.getByRole("button", { name: "Open navigation" }).click();
    const nav = page.getByRole("navigation", { name: "Primary" });
    await expect(nav).toBeVisible();

    await nav.getByRole("link", { name: "Logs" }).click();
    await expect(page.getByRole("heading", { name: /Log Explorer/i })).toBeVisible();
  });

  test("dense tables restack instead of scrolling sideways", async ({ page }) => {
    await page.goto("/services");
    await dismissOnboarding(page);

    // Every service is still reachable, just in a stacked layout.
    await expect(page.getByRole("button", { name: /API Gateway/i }).first()).toBeVisible();

    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewport = page.viewportSize();
    expect(bodyWidth).toBeLessThanOrEqual((viewport?.width ?? 0) + 1);
  });

  test("an incident can be triggered and ended on a phone", async ({ page }) => {
    await page.goto("/simulation");
    await dismissOnboarding(page);

    const card = page.locator("button[aria-expanded]").filter({ hasText: "DNS Resolution Failure" });
    if ((await card.getAttribute("aria-expanded")) !== "true") await card.click();
    await page.locator("button").filter({ hasText: /^Start simulation$/ }).first().click();

    await expect(page.getByText(/DNS Resolution Failure/).first()).toBeVisible();

    await page.getByRole("button", { name: /End incident/i }).click();
    await page.getByRole("dialog").getByRole("button", { name: /End incident/i }).click();
    await expect(page.getByRole("heading", { name: /Simulation Center/i })).toBeVisible();
  });
});

test.describe("header fits its viewport", () => {
  test("status, clock and controls never collide", async ({ page }) => {
    await page.goto("/");
    await dismissOnboarding(page);

    // Check both the healthy state and mid-incident, since the status label
    // changes width and the incident adds a button.
    for (const setup of ["healthy", "incident"] as const) {
      if (setup === "incident") {
        await page.goto("/simulation");
        const card = page
          .locator("button[aria-expanded]")
          .filter({ hasText: "DNS Resolution Failure" });
        if ((await card.getAttribute("aria-expanded")) !== "true") await card.click();
        await page.locator("button").filter({ hasText: /^Start simulation$/ }).first().click();
        await page.waitForTimeout(2000);
      }

      const collision = await page.evaluate(() => {
        const header = document.querySelector("header");
        if (!header) return null;
        const boxes = [...header.querySelectorAll("*")]
          .filter((el) => el.children.length === 0 && (el.textContent ?? "").trim().length > 0)
          .map((el) => ({
            text: (el.textContent ?? "").trim().slice(0, 24),
            rect: el.getBoundingClientRect(),
          }))
          .filter((b) => b.rect.width > 0);

        for (let i = 0; i < boxes.length; i++) {
          for (let j = i + 1; j < boxes.length; j++) {
            const a = boxes[i].rect;
            const b = boxes[j].rect;
            const overlapX = a.right > b.left + 1 && a.left < b.right - 1;
            const overlapY = a.bottom > b.top + 1 && a.top < b.bottom - 1;
            if (overlapX && overlapY) return `${boxes[i].text} ↔ ${boxes[j].text}`;
          }
        }
        return null;
      });

      expect(collision, `header text collides (${setup})`).toBeNull();
    }
  });
});
