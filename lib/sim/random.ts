/**
 * Deterministic pseudo-randomness.
 *
 * The simulation must never use Math.random(): given the same tick number the
 * environment has to produce byte-identical telemetry, otherwise the same
 * scenario would tell a different story on every run and the tests could not
 * assert anything. Every random draw is derived from a string seed plus the
 * current tick, so it is reproducible and independent of evaluation order.
 */

/** 32-bit string hash (FNV-1a). Stable across runs and platforms. */
export function hashString(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Mulberry32 — small, fast, good enough distribution for telemetry noise. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A single reproducible value in [0,1) for a given seed + tick. */
export function noiseAt(seed: string, tick: number): number {
  return mulberry32(hashString(seed) ^ Math.imul(tick, 0x9e3779b1))();
}

/**
 * Smooth value noise in [-1,1]. Interpolates between integer-tick samples so
 * metrics wander like real telemetry instead of jittering frame to frame.
 */
export function smoothNoise(seed: string, tick: number, period = 12): number {
  const t = tick / period;
  const i = Math.floor(t);
  const f = t - i;
  const a = noiseAt(seed, i) * 2 - 1;
  const b = noiseAt(seed, i + 1) * 2 - 1;
  // Smoothstep easing between the two samples.
  const w = f * f * (3 - 2 * f);
  return a + (b - a) * w;
}

/** Deterministically pick an item from a list. */
export function pick<T>(items: readonly T[], seed: string, tick: number): T {
  return items[Math.floor(noiseAt(seed, tick) * items.length) % items.length];
}

/** Weighted deterministic pick. */
export function pickWeighted<T extends { weight: number }>(
  items: readonly T[],
  seed: string,
  tick: number,
): T | undefined {
  if (items.length === 0) return undefined;
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  if (total <= 0) return undefined;
  let r = noiseAt(seed, tick) * total;
  for (const item of items) {
    r -= item.weight;
    if (r <= 0) return item;
  }
  return items[items.length - 1];
}

/** Hex id of the requested length, reproducible from seed + tick. */
export function hexId(seed: string, tick: number, length = 12): string {
  let out = "";
  let n = 0;
  while (out.length < length) {
    out += Math.floor(noiseAt(`${seed}:${n}`, tick) * 0xffffffff)
      .toString(16)
      .padStart(8, "0");
    n++;
  }
  return out.slice(0, length);
}

/** A request id in the shape most tracing systems emit. */
export function requestId(seed: string, tick: number): string {
  return `req_${hexId(seed, tick, 16)}`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * clamp(t, 0, 1);
}

/** Ease-in-out, used to make ramps and recoveries feel physical. */
export function easeInOut(t: number): number {
  const c = clamp(t, 0, 1);
  return c < 0.5 ? 2 * c * c : 1 - Math.pow(-2 * c + 2, 2) / 2;
}
