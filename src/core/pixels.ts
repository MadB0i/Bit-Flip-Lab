/**
 * Pure pixel comparison.
 *
 * Kept free of any browser dependency so the measurement that drives the
 * difference view and the sensitivity map can be unit-tested in Node against
 * hand-computed expectations.
 */

import type { PixelBounds, RenderMeasurement } from "./pipeline";

export interface RgbaImage {
  readonly width: number;
  readonly height: number;
  /** RGBA, 4 bytes per pixel, row-major. */
  readonly data: Uint8ClampedArray;
}

export function createRgba(width: number, height: number): RgbaImage {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

/**
 * Compare two equally sized RGBA images.
 *
 * `pixelsChanged` counts pixels whose RGBA tuple differs in any channel.
 * Errors are computed on the premultiplication-agnostic channel values, which
 * is what a viewer actually sees.
 */
export function diffRgba(a: RgbaImage, b: RgbaImage): RenderMeasurement {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(
      `diffRgba: dimension mismatch ${a.width}×${a.height} vs ${b.width}×${b.height}`,
    );
  }

  const total = a.width * a.height;
  let pixelsChanged = 0;
  let sumAbs = 0;
  let maxAbs = 0;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < total; i++) {
    const o = i * 4;
    const dr = Math.abs(a.data[o]! - b.data[o]!);
    const dg = Math.abs(a.data[o + 1]! - b.data[o + 1]!);
    const db = Math.abs(a.data[o + 2]! - b.data[o + 2]!);
    const da = Math.abs(a.data[o + 3]! - b.data[o + 3]!);
    const pixelDiff = dr + dg + db + da;

    if (pixelDiff === 0) continue;

    pixelsChanged++;
    sumAbs += pixelDiff;
    const worst = Math.max(dr, dg, db, da);
    if (worst > maxAbs) maxAbs = worst;

    const x = i % a.width;
    const y = (i - x) / a.width;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  const bounds: PixelBounds | null =
    pixelsChanged === 0
      ? null
      : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };

  return {
    pixelsChanged,
    pixelsTotal: total,
    changedBounds: bounds,
    meanAbsoluteError: total === 0 ? 0 : sumAbs / (total * 4),
    maxAbsoluteError: maxAbs,
  };
}

/** Amplify a difference image for display. `gain` of 1 is the true difference. */
export function amplifiedDifference(a: RgbaImage, b: RgbaImage, gain: number): RgbaImage {
  const out = createRgba(a.width, a.height);
  for (let i = 0; i < a.data.length; i += 4) {
    const diff =
      (Math.abs(a.data[i]! - b.data[i]!) +
        Math.abs(a.data[i + 1]! - b.data[i + 1]!) +
        Math.abs(a.data[i + 2]! - b.data[i + 2]!)) /
      3;
    const v = Math.min(255, Math.round(diff * gain));
    out.data[i] = v;
    out.data[i + 1] = v;
    out.data[i + 2] = v;
    out.data[i + 3] = 255;
  }
  return out;
}

/**
 * Mark a changed region with brackets drawn just outside its bounds.
 *
 * A plain outline is useless for the case that matters most: a one-pixel
 * change has no interior, and any outline clamped to the image edge collapses
 * into the image border. Brackets set one pixel outside the region stay
 * legible for a region of any size, and stay inside the image.
 */
export function markChangedRegion(
  img: RgbaImage,
  bounds: PixelBounds,
  rgba: readonly [number, number, number, number],
): void {
  const OFFSET = 2;
  const left = bounds.x - OFFSET;
  const right = bounds.x + bounds.width - 1 + OFFSET;
  const top = bounds.y - OFFSET;
  const bottom = bounds.y + bounds.height - 1 + OFFSET;

  const x0 = Math.max(0, left);
  const x1 = Math.min(img.width - 1, right);
  const y0 = Math.max(0, top);
  const y1 = Math.min(img.height - 1, bottom);
  if (x1 < x0 || y1 < y0) return;

  hLine(img, x0, y0, x1, rgba);
  hLine(img, x0, y1, x1, rgba);
  vLine(img, x0, y0, y1, rgba);
  vLine(img, x1, y0, y1, rgba);
}

function hLine(img: RgbaImage, x0: number, y: number, x1: number, rgba: readonly [number, number, number, number]): void {
  for (let x = x0; x <= x1; x++) put(img, x, y, rgba);
}

function vLine(img: RgbaImage, x: number, y0: number, y1: number, rgba: readonly [number, number, number, number]): void {
  for (let y = y0; y <= y1; y++) put(img, x, y, rgba);
}

function put(img: RgbaImage, x: number, y: number, rgba: readonly [number, number, number, number]): void {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const o = (y * img.width + x) * 4;
  img.data[o] = rgba[0];
  img.data[o + 1] = rgba[1];
  img.data[o + 2] = rgba[2];
  img.data[o + 3] = rgba[3];
}