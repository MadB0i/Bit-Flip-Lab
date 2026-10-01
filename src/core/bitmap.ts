/**
 * 1-bit-per-pixel glyph atlas.
 *
 * The third sample experiment: a monochrome bitmap whose every bit is one
 * rendered pixel. This is the cleanest demonstration that bit-level
 * perturbation maps directly onto visible output — flip one bit, one pixel
 * changes, and the structural header is untouched.
 *
 * Layout (big-endian fields):
 *   0x00  4 B   magic        'B' 'F' '1' '1'
 *   0x04  2 B   width        u16, in pixels
 *   0x06  2 B   height       u16, in pixels
 *   0x08  1 B   foreground   greyscale level of set bits
 *   0x09  1 B   padding      must be 0
 *   0x0A  …    pixel rows    ceil(width/8) bytes per row, MSB first
 */

import { createRgba, type RgbaImage } from "./pixels";

export const BITMAP_MAGIC = "BF11";
export const BITMAP_HEADER_LENGTH = 10;
export const GLYPH_CELL_W = 8;
export const GLYPH_CELL_H = 7;

/** 5×7 glyph cell, rows of five cells, '#' = lit. */
const FONT: Record<string, string[]> = {
  A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  B: ["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."],
  C: [".###.", "#...#", "#....", "#....", "#....", "#...#", ".###."],
  D: ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
  E: ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
  F: ["#####", "#....", "#....", "####.", "#....", "#....", "#...."],
  G: [".###.", "#...#", "#....", "#.###", "#...#", "#...#", ".###."],
  H: ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  I: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "#####"],
  J: ["..###", "...#.", "...#.", "...#.", "...#.", "#..#.", ".##.."],
  K: ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"],
  L: ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
  M: ["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"],
  N: ["#...#", "##..#", "##..#", "#.#.#", "#..##", "#..##", "#...#"],
  O: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  P: ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
  Q: [".###.", "#...#", "#...#", "#...#", "#.#.#", "#..#.", ".##.#"],
  R: ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
  S: [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
  T: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
  U: ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  V: ["#...#", "#...#", "#...#", "#...#", "#...#", ".#.#.", "..#.."],
  W: ["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "##.##", "#...#"],
  X: ["#...#", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "#...#"],
  Y: ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."],
  Z: ["#####", "....#", "...#.", "..#..", ".#...", "#....", "#####"],
  "0": [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."],
  "1": ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
  "2": [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
  "3": ["#####", "...#.", "..#..", "...#.", "....#", "#...#", ".###."],
  "4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
  "5": ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
  "6": ["..##.", ".#...", "#....", "####.", "#...#", "#...#", ".###."],
  "7": ["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."],
  "8": [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
  "9": [".###.", "#...#", "#...#", ".####", "....#", "...#.", ".##.."],
  " ": [".....", ".....", ".....", ".....", ".....", ".....", "....."],
  "-": [".....", ".....", ".....", "#####", ".....", ".....", "....."],
  ".": [".....", ".....", ".....", ".....", ".....", ".##..", ".##.."],
  ":": [".....", ".##..", ".##..", ".....", ".##..", ".##..", "....."],
  "/": ["....#", "...#.", "...#.", "..#..", ".#...", ".#...", "#...."],
};

export interface GlyphAtlas {
  readonly width: number;
  readonly height: number;
  readonly foreground: number;
  readonly padding: number;
  readonly pixelDataOffset: number;
  readonly stride: number;
}

export interface BitmapParse {
  readonly parsed: boolean;
  readonly atlas: GlyphAtlas | null;
  readonly failures: readonly string[];
  readonly structurallyValid: boolean;
}

/** Read and validate the atlas header. Never throws. */
export function parseBitmap(bytes: Uint8Array): BitmapParse {
  const failures: string[] = [];

  if (bytes.length < BITMAP_HEADER_LENGTH) {
    return {
      parsed: false,
      atlas: null,
      failures: [`File is ${bytes.length} bytes; a BF11 header needs at least ${BITMAP_HEADER_LENGTH}`],
      structurallyValid: false,
    };
  }

  const magic = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!);
  if (magic !== BITMAP_MAGIC) {
    return {
      parsed: false,
      atlas: null,
      failures: [`Magic is '${magic}'; expected '${BITMAP_MAGIC}'`],
      structurallyValid: false,
    };
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint16(4);
  const height = view.getUint16(6);
  const foreground = bytes[8]!;
  const padding = bytes[9]!;

  if (width === 0 || height === 0) failures.push(`Dimensions ${width}×${height}; both must be non-zero`);
  if (padding !== 0) failures.push(`Padding byte at 0x09 is ${padding}; must be 0`);

  const stride = Math.ceil(width / 8);
  const expected = BITMAP_HEADER_LENGTH + stride * height;
  if (bytes.length !== expected) {
    failures.push(`Pixel data is ${bytes.length - BITMAP_HEADER_LENGTH} bytes; ${width}×${height} needs ${stride * height}`);
  }

  return {
    parsed: true,
    atlas: { width, height, foreground, padding, pixelDataOffset: BITMAP_HEADER_LENGTH, stride },
    failures,
    structurallyValid: failures.length === 0,
  };
}

/** Read one pixel from the atlas. Coordinates outside the image read as 0. */
export function bitmapPixel(bytes: Uint8Array, atlas: GlyphAtlas, x: number, y: number): 0 | 1 {
  if (x < 0 || y < 0 || x >= atlas.width || y >= atlas.height) return 0;
  const byte = bytes[atlas.pixelDataOffset + y * atlas.stride + (x >> 3)]!;
  return ((byte >> (7 - (x & 7))) & 1) as 0 | 1;
}

export interface BitmapRenderOptions {
  readonly ink?: readonly [number, number, number];
  readonly paper?: readonly [number, number, number];
}

/**
 * Render the atlas to RGBA.
 *
 * Every set bit becomes ink, every clear bit becomes paper. The renderer
 * consults the atlas's own foreground level, so a mutation to the foreground
 * byte changes the whole image — a measurable, visible consequence of a
 * single bit.
 */
export function renderBitmap(
  bytes: Uint8Array,
  atlas: GlyphAtlas,
  options: BitmapRenderOptions = {},
): RgbaImage {
  const img = createRgba(atlas.width, atlas.height);
  const paper = options.paper ?? [11, 13, 16];
  const inkLevel = atlas.foreground;
  // Luminance-matched so the ink sits at the atlas's declared level.
  const ink: [number, number, number] = [
    Math.round(options.ink?.[0] ?? inkLevel),
    Math.round(options.ink?.[1] ?? inkLevel),
    Math.round(options.ink?.[2] ?? inkLevel),
  ];

  for (let y = 0; y < atlas.height; y++) {
    for (let x = 0; x < atlas.width; x++) {
      const o = (y * atlas.width + x) * 4;
      const lit = bitmapPixel(bytes, atlas, x, y);
      const c = lit === 1 ? ink : (paper as [number, number, number]);
      img.data[o] = c[0];
      img.data[o + 1] = c[1];
      img.data[o + 2] = c[2];
      img.data[o + 3] = 255;
    }
  }
  return img;
}

/** Lay out `text` into a packed 1bpp buffer of the given width. */
export function encodeGlyphText(text: string, width: number, foreground = 232): Uint8Array {
  const cells = Math.max(1, Math.floor((width + 1) / GLYPH_CELL_W));
  const rows = Math.max(1, Math.ceil(text.length / cells));
  const height = rows * GLYPH_CELL_H;
  const stride = Math.ceil(width / 8);
  const out = new Uint8Array(BITMAP_HEADER_LENGTH + stride * height);
  out[0] = 0x42; // B
  out[1] = 0x46; // F
  out[2] = 0x31; // 1
  out[3] = 0x31; // 1
  const view = new DataView(out.buffer);
  view.setUint16(4, width);
  view.setUint16(6, height);
  out[8] = foreground & 0xff;

  for (let i = 0; i < text.length; i++) {
    const glyph = FONT[text[i]!.toUpperCase()] ?? FONT[" "]!;
    const cellX = (i % cells) * GLYPH_CELL_W;
    const cellY = Math.floor(i / cells) * GLYPH_CELL_H;
    for (let gy = 0; gy < GLYPH_CELL_H; gy++) {
      for (let gx = 0; gx < 5; gx++) {
        if (glyph[gy]![gx] !== "#") continue;
        const x = cellX + gx;
        const y = cellY + gy;
        if (x >= width || y >= height) continue;
        out[BITMAP_HEADER_LENGTH + y * stride + (x >> 3)]! |= 1 << (7 - (x & 7));
      }
    }
  }
  return out;
}