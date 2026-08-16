/**
 * Record the README demo.
 *
 * Drives a real incident and captures frames, then encodes an animated GIF.
 *
 * Why a GIF rather than a video: GitHub renders animated GIFs inline in a
 * README from a repo-relative path, reliably, with no player and no external
 * host. Video does not — which makes a technically nicer MP4 practically
 * useless in the one place this needs to work.
 *
 * The size trade-off is real and drives the settings below. GIF has no
 * inter-frame compression worth the name, so cost scales with
 * width × frames. 700px at 5fps keeps a ~20 second demo inside a few MB, which
 * is about the limit before a README becomes unpleasant to load on a phone.
 *
 * Usage:
 *   npm run build && npx next start -p 3212
 *   node scripts/demo-gif.mjs [baseUrl]
 */

import { chromium } from "@playwright/test";
// gifenc ships CommonJS, so it comes in via the default export.
import gifenc from "gifenc";
const { GIFEncoder, quantize, applyPalette } = gifenc;
import { mkdir, writeFile } from "node:fs/promises";
import pngjs from "pngjs";
const { PNG } = pngjs;

const BASE = process.argv[2] ?? "http://localhost:3212";
const OUT = "docs";

// Above the `md` breakpoint so the demo shows the full desktop header rather
// than the compact one — this is the shot that represents the product.
const WIDTH = 860;
const HEIGHT = 538;
const FPS = 5;
const FRAME_MS = 1000 / FPS;

/** Decode a PNG buffer to the RGBA data gifenc expects. */
function decode(buffer) {
  const png = PNG.sync.read(buffer);
  return { data: new Uint8ClampedArray(png.data), width: png.width, height: png.height };
}

async function main() {
  await mkdir(OUT, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: WIDTH, height: HEIGHT },
    colorScheme: "dark",
    // Entrance animations would otherwise dominate a 5fps capture.
    reducedMotion: "reduce",
  });

  const frames = [];
  let capturing = false;

  /**
   * Capture frames continuously while the scripted beats play out. Started
   * only once `capturing` is true — kicking it off earlier would exit the loop
   * immediately and record nothing.
   */
  const startRecording = async () => {
    while (capturing) {
      const started = Date.now();
      try {
        frames.push(await page.screenshot({ type: "png" }));
      } catch {
        // A navigation mid-screenshot is fine; skip that frame.
      }
      const elapsed = Date.now() - started;
      if (elapsed < FRAME_MS) await page.waitForTimeout(FRAME_MS - elapsed);
    }
  };

  // --- Set up off-camera -------------------------------------------------
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  // Start from a genuinely clean environment: a restored session would open
  // the demo with a "Session resumed" toast that means nothing to a viewer.
  await page.evaluate(() => {
    sessionStorage.clear();
    localStorage.clear();
  });
  await page.goto(`${BASE}/simulation`, { waitUntil: "networkidle" });
  const explore = page.getByRole("button", { name: "Explore the dashboard" });
  if (await explore.isVisible().catch(() => false)) await explore.click();
  await page.locator('button[title="Quadruple speed"]').click();

  const card = page.locator("button[aria-expanded]").filter({ hasText: "DNS Resolution Failure" });
  if ((await card.getAttribute("aria-expanded")) !== "true") await card.click();

  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);

  // --- Roll ---------------------------------------------------------------
  capturing = true;
  const recorder = startRecording();

  // Beat 1: a healthy, live dashboard.
  await page.waitForTimeout(3000);

  // Beat 2: trigger the incident.
  await page.goto(`${BASE}/simulation`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await page.locator("button").filter({ hasText: /^Start simulation$/ }).first().click();
  await page.waitForTimeout(2500);

  // Beat 3: the overview turning red in real time — the money shot.
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(6000);

  // Beat 4: the blast radius, with the healthy data tier still green.
  await page.goto(`${BASE}/infrastructure`, { waitUntil: "networkidle" });
  await page.waitForTimeout(4000);

  // Beat 5: the diagnostic contradiction.
  await page.goto(`${BASE}/network`, { waitUntil: "networkidle" });
  for (const command of ["ping api.internal", "ping 10.20.12.44"]) {
    await page.fill("#terminal-input", command);
    await page.getByRole("button", { name: "Run" }).click();
    await page.waitForTimeout(1600);
  }

  // Beat 6: commit to the diagnosis.
  await page.goto(`${BASE}/simulation`, { waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  await page.getByRole("radio", { name: /DNS resolution failure/i }).click();
  await page.getByRole("button", { name: "Submit diagnosis" }).click();
  await page.waitForTimeout(2500);

  capturing = false;
  await recorder;
  await browser.close();

  // --- Encode -------------------------------------------------------------
  console.log(`captured ${frames.length} frames, encoding…`);
  const encoder = GIFEncoder();
  const delay = Math.round(FRAME_MS);

  for (const [index, buffer] of frames.entries()) {
    const { data, width, height } = decode(buffer);
    // A per-frame palette keeps the dark UI's subtle gradients from banding.
    const palette = quantize(data, 256, { format: "rgb444" });
    const indexed = applyPalette(data, palette, "rgb444");
    encoder.writeFrame(indexed, width, height, { palette, delay });
    if ((index + 1) % 20 === 0) console.log(`  ${index + 1}/${frames.length}`);
  }

  encoder.finish();
  const bytes = encoder.bytes();
  await writeFile(`${OUT}/demo.gif`, bytes);

  const seconds = (frames.length / FPS).toFixed(1);
  const mb = (bytes.length / 1024 / 1024).toFixed(2);
  console.log(`\nwrote ${OUT}/demo.gif — ${seconds}s, ${frames.length} frames, ${mb} MB`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
