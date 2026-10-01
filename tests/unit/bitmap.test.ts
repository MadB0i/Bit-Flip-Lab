import { describe, expect, it } from "vitest";
import { bitmapPixel, encodeGlyphText, parseBitmap, renderBitmap } from "@/core/bitmap";
import { flipBit } from "@/core/mutate";
import { createRgba, amplifiedDifference, diffRgba, markChangedRegion, type RgbaImage } from "@/core/pixels";

describe("glyph atlas", () => {
  const bytes = encodeGlyphText("BIT FLIP", 64, 232);

  it("emits a valid BF11 header", () => {
    const parse = parseBitmap(bytes);
    expect(parse.parsed).toBe(true);
    expect(parse.structurallyValid).toBe(true);
    expect(parse.atlas).not.toBeNull();
    expect(parse.atlas!.width).toBe(64);
    expect(parse.atlas!.height).toBe(7); // one row of eight 8px cells
    expect(parse.atlas!.foreground).toBe(232);
  });

  it("rejects a bad magic", () => {
    const mutated = flipBit(bytes, 1).data;
    const parse = parseBitmap(mutated);
    expect(parse.parsed).toBe(false);
    expect(parse.failures.join(" ")).toMatch(/Magic/);
  });

  it("rejects a non-zero padding byte", () => {
    const mutated = flipBit(bytes, 9 * 8).data;
    const parse = parseBitmap(mutated);
    expect(parse.structurallyValid).toBe(false);
    expect(parse.failures.join(" ")).toMatch(/Padding byte/);
  });

  it("rejects a declared length that disagrees with the pixel data", () => {
    const mutated = flipBit(bytes, 7 * 8).data; // height high byte
    const parse = parseBitmap(mutated);
    expect(parse.structurallyValid).toBe(false);
  });

  it("renders set bits as ink and clear bits as paper", () => {
    const atlas = parseBitmap(bytes).atlas!;
    const img = renderBitmap(bytes, atlas);
    expect(img.width).toBe(64);
    expect(img.height).toBe(7);
    let lit = 0;
    for (let y = 0; y < atlas.height; y++) {
      for (let x = 0; x < atlas.width; x++) if (bitmapPixel(bytes, atlas, x, y) === 1) lit++;
    }
    expect(lit).toBeGreaterThan(0);
    // 'B' occupies cell 0: row 0 is "####.", so pixel (0,0) is ink at level 232.
    expect(Array.from(img.data.subarray(0, 4))).toEqual([232, 232, 232, 255]);
    // A clear bit renders as the bench colour, fully opaque.
    expect(bitmapPixel(bytes, atlas, 5, 0)).toBe(0);
    expect(Array.from(img.data.subarray(5 * 4, 5 * 4 + 4))).toEqual([11, 13, 16, 255]);
  });

  it("changes exactly one rendered pixel when one pixel bit flips", () => {
    const atlas = parseBitmap(bytes).atlas!;
    // Find a lit pixel.
    let target = -1;
    for (let y = 0; y < atlas.height && target < 0; y++) {
      for (let x = 0; x < atlas.width; x++) {
        if (bitmapPixel(bytes, atlas, x, y) === 1) {
          target = y * atlas.width + x;
          break;
        }
      }
    }
    expect(target).toBeGreaterThanOrEqual(0);
    const { x, y } = { x: target % atlas.width, y: Math.floor(target / atlas.width) };
    const bitOffset = 10 * 8 + y * atlas.stride * 8 + x;

    const mutated = flipBit(bytes, bitOffset).data;
    const before = renderBitmap(bytes, atlas);
    const after = renderBitmap(mutated, parseBitmap(mutated).atlas!);
    const d = diffRgba(before, after);
    expect(d.pixelsChanged).toBe(1);
    expect(d.changedBounds).toEqual({ x, y, width: 1, height: 1 });
    expect(d.pixelsTotal).toBe(64 * 7);
  });

  it("changes the whole image when the foreground byte flips", () => {
    const mutated = flipBit(bytes, 8 * 8).data; // foreground level
    const before = renderBitmap(bytes, parseBitmap(bytes).atlas!);
    const after = renderBitmap(mutated, parseBitmap(mutated).atlas!);
    const d = diffRgba(before, after);
    expect(d.pixelsChanged).toBeGreaterThan(0);
  });
});

describe("pixel difference", () => {
  const a: RgbaImage = createRgba(4, 4);
  const b: RgbaImage = createRgba(4, 4);
  b.data[0] = 255; // pixel (0,0) red channel = 255

  it("counts changed pixels", () => {
    const d = diffRgba(a, b);
    expect(d.pixelsChanged).toBe(1);
    expect(d.pixelsTotal).toBe(16);
  });

  it("reports the changed bounds", () => {
    const d = diffRgba(a, b);
    expect(d.changedBounds).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });

  it("reports zero for identical images", () => {
    const d = diffRgba(a, a);
    expect(d.pixelsChanged).toBe(0);
    expect(d.changedBounds).toBeNull();
    expect(d.maxAbsoluteError).toBe(0);
  });

  it("computes maximum absolute error", () => {
    const d = diffRgba(a, b);
    expect(d.maxAbsoluteError).toBe(255);
    expect(d.meanAbsoluteError).toBeCloseTo(255 / 64, 6);
  });

  it("rejects mismatched dimensions", () => {
    expect(() => diffRgba(createRgba(2, 2), createRgba(3, 3))).toThrow(/dimension mismatch/);
  });

  it("amplifies without exceeding the byte range", () => {
    const amplified = amplifiedDifference(a, b, 8);
    expect(amplified.data[0]).toBe(255); // 255 * 8 clamped
    expect(amplified.data[4]).toBe(0);
  });

  it("brackets a one-pixel changed region legibly", () => {
    const img = createRgba(16, 8);
    const amber = [255, 176, 32, 255] as const;
    // Region at x10 y0, 1x1. Brackets sit 2px outside: x8..x12, y0..y2 once
    // clamped to the image, so a one-pixel change is still findable.
    markChangedRegion(img, { x: 10, y: 0, width: 1, height: 1 }, amber);
    const at = (x: number, y: number) => Array.from(img.data.subarray((y * 16 + x) * 4, (y * 16 + x) * 4 + 3));
    expect(at(10, 0)).toEqual([255, 176, 32]); // top bracket crosses the region
    expect(at(8, 0)).toEqual([255, 176, 32]); // top-left corner
    expect(at(12, 0)).toEqual([255, 176, 32]); // top-right corner
    expect(at(8, 2)).toEqual([255, 176, 32]); // bottom-left corner
    expect(at(12, 2)).toEqual([255, 176, 32]); // bottom-right corner
    expect(at(13, 2)).toEqual([0, 0, 0]); // one pixel beyond the bracket
    expect(at(11, 1)).toEqual([0, 0, 0]); // bracket interior untouched
  });

  it("brackets a multi-pixel region two pixels outside its bounds", () => {
    const img = createRgba(16, 8);
    const amber = [255, 176, 32, 255] as const;
    // Region x4..x6, y2..y3. Brackets at x2 and x8, y0 and y5.
    markChangedRegion(img, { x: 4, y: 2, width: 3, height: 2 }, amber);
    const at = (x: number, y: number) => img.data[(y * 16 + x) * 4 + 3];
    expect(at(4, 0)).toBe(255); // top bracket spans the region
    expect(at(4, 1)).toBe(0); // between bracket and region
    expect(at(2, 3)).toBe(255); // left bracket
    expect(at(8, 3)).toBe(255); // right bracket, 2px beyond x6
    expect(at(9, 3)).toBe(0); // outside
    expect(at(4, 5)).toBe(255); // bottom bracket
    expect(at(5, 3)).toBe(0); // region interior untouched
  });

  it("does nothing when the region lies entirely outside the image", () => {
    const img = createRgba(4, 4);
    const before = Array.from(img.data);
    markChangedRegion(img, { x: 40, y: 40, width: 1, height: 1 }, [255, 176, 32, 255]);
    expect(Array.from(img.data)).toEqual(before);
  });
});