import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Reads the real tokens from the stylesheet, so a palette change can't quietly break contrast.
const css = readFileSync("app/globals.css", "utf8");
const dark = css.slice(css.indexOf("@theme {"), css.indexOf(":root[data-theme=\"light\"] {"));
const light = css.slice(css.indexOf(":root[data-theme=\"light\"] {"));
const token = (block: string, name: string) => {
  const m = block.match(new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!m) throw new Error(`token --color-${name} not found`);
  return m[1];
};

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// Body-size text on every panel surface: WCAG AA needs 4.5:1.
const TEXT = ["ink", "ink-2", "ink-3", "ink-4", "ok", "warn", "crit", "info", "idle", "accent"];
const SURFACES = ["void", "surface", "surface-2", "surface-3"];

describe("dark console palette contrast (WCAG AA, 4.5:1)", () => {
  for (const fg of TEXT)
    for (const bg of SURFACES)
      it(`${fg} on ${bg}`, () => expect(contrast(token(dark, fg), token(dark, bg))).toBeGreaterThanOrEqual(4.5));
  it("text on an accent fill", () =>
    expect(contrast(token(dark, "accent-ink"), token(dark, "accent"))).toBeGreaterThanOrEqual(4.5));
});

describe("light theme contrast (WCAG AA, 4.5:1)", () => {
  for (const fg of ["ink", "ink-2", "ink-3", "ink-4", "accent"])
    for (const bg of ["void", "surface", "surface-3"])
      it(`${fg} on ${bg}`, () => expect(contrast(token(light, fg), token(light, bg))).toBeGreaterThanOrEqual(4.5));
  it("text on an accent fill", () =>
    expect(contrast(token(light, "accent-ink"), token(light, "accent"))).toBeGreaterThanOrEqual(4.5));
});
