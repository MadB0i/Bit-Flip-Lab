/**
 * PNG encoder and structural parser.
 *
 * The encoder emits spec-compliant PNG (signature, IHDR, IDAT, IEND) using
 * DEFLATE *stored* blocks — no compression, no dependency on `CompressionStream`,
 * and byte-for-byte identical output on every engine. That determinism is
 * what lets a sample experiment be reproduced exactly from a seed.
 *
 * The parser performs real structural validation: it walks the chunk stream,
 * verifies each chunk's CRC-32 and the IHDR field ranges, and reports which
 * specific fields failed. This is what lets the sensitivity map distinguish
 * "the image still decodes" from "the image is structurally intact".
 */

import { crc32 } from "./crc32";
import { toHex } from "./sha256";

export const PNG_SIGNATURE = Object.freeze([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
] as const);

export function isPng(bytes: Uint8Array): boolean {
  if (bytes.length < PNG_SIGNATURE.length) return false;
  for (let i = 0; i < PNG_SIGNATURE.length; i++) if (bytes[i] !== PNG_SIGNATURE[i]) return false;
  return true;
}

/* ── Adler-32 (zlib trailer) ─────────────────────────────────────────────── */

function adler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]!) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/**
 * Wrap `data` in a zlib stream using DEFLATE stored (uncompressed) blocks.
 * Maximum stored block payload is 65535 bytes per RFC 1951.
 */
export function zlibStored(data: Uint8Array): Uint8Array {
  const blockCount = Math.max(1, Math.ceil(data.length / 65535));
  const out = new Uint8Array(2 + blockCount * 5 + data.length + 4);
  out[0] = 0x78; // CM=8, CINFO=7 (32 KiB window)
  out[1] = 0x01; // FCHECK such that (0x78 << 8 | 0x01) % 31 === 0
  let at = 2;
  for (let b = 0; b < blockCount; b++) {
    const start = b * 65535;
    const len = Math.min(65535, data.length - start);
    const final = b === blockCount - 1 ? 1 : 0;
    out[at++] = final; // BFINAL, BTYPE=00 (stored)
    out[at++] = len & 0xff;
    out[at++] = (len >>> 8) & 0xff;
    out[at++] = ~len & 0xff;
    out[at++] = (~len >>> 8) & 0xff;
    out.set(data.subarray(start, start + len), at);
    at += len;
  }
  const sum = adler32(data);
  out[at++] = (sum >>> 24) & 0xff;
  out[at++] = (sum >>> 16) & 0xff;
  out[at++] = (sum >>> 8) & 0xff;
  out[at++] = sum & 0xff;
  return out;
}

/* ── Chunk writing ──────────────────────────────────────────────────────── */

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/**
 * Encode an 8-bit greyscale PNG from a single-channel sample buffer.
 * `samples.length` must equal `width * height`.
 */
export function encodeGrayscalePng(width: number, height: number, samples: Uint8Array): Uint8Array {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error(`encodeGrayscalePng: invalid dimensions ${width}×${height}`);
  }
  if (width > 0x7fffffff || height > 0x7fffffff) {
    throw new Error("encodeGrayscalePng: dimensions exceed the PNG 31-bit limit");
  }
  if (samples.length !== width * height) {
    throw new Error(
      `encodeGrayscalePng: expected ${width * height} samples, received ${samples.length}`,
    );
  }

  // Each scanline is prefixed with filter type 0 (None).
  const stride = width + 1;
  const raw = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0;
    raw.set(samples.subarray(y * width, (y + 1) * width), y * stride + 1);
  }

  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // colour type: greyscale
  ihdr[10] = 0; // compression: deflate
  ihdr[11] = 0; // filter method: adaptive
  ihdr[12] = 0; // interlace: none

  const idat = zlibStored(raw);
  const parts = [PNG_SIGNATURE, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", new Uint8Array(0))];

  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/* ── Structural parsing ─────────────────────────────────────────────────── */

export interface PngChunk {
  readonly type: string;
  readonly offset: number;
  readonly length: number;
  readonly data: Uint8Array;
  readonly crcDeclared: number;
  readonly crcComputed: number;
  readonly crcValid: boolean;
}

export interface PngStructure {
  readonly chunks: readonly PngChunk[];
  readonly width: number | null;
  readonly height: number | null;
  readonly bitDepth: number | null;
  readonly colourType: number | null;
  readonly interlace: number | null;
  /** Specific, located validation failures. Empty when the file is intact. */
  readonly failures: readonly string[];
  readonly structurallyValid: boolean;
  /** Byte length of the concatenated IDAT payloads, when any exist. */
  readonly idatLength: number;
}

/** Walk the PNG chunk stream and validate it. Never throws on malformed input. */
export function parsePngStructure(bytes: Uint8Array): PngStructure {
  const failures: string[] = [];
  const chunks: PngChunk[] = [];

  if (!isPng(bytes)) {
    return {
      chunks: [],
      width: null,
      height: null,
      bitDepth: null,
      colourType: null,
      interlace: null,
      failures: ["PNG signature does not match 89 50 4E 47 0D 0A 1A 0A"],
      structurallyValid: false,
      idatLength: 0,
    };
  }

  let width: number | null = null;
  let height: number | null = null;
  let bitDepth: number | null = null;
  let colourType: number | null = null;
  let interlace: number | null = null;
  let idatLength = 0;

  let at = PNG_SIGNATURE.length;
  let sawIhdr = false;
  let sawIend = false;

  while (at + 8 <= bytes.length) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + at, Math.min(8, bytes.length - at));
    const length = view.getUint32(0);
    const type = String.fromCharCode(bytes[at + 4]!, bytes[at + 5]!, bytes[at + 6]!, bytes[at + 7]!);
    const dataStart = at + 8;
    const dataEnd = dataStart + length;

    if (dataEnd + 4 > bytes.length) {
      failures.push(`Chunk ${type} declares ${length} bytes but only ${bytes.length - dataStart} remain`);
      break;
    }

    const data = bytes.subarray(dataStart, dataEnd);
    const crcDeclared =
      ((bytes[dataEnd]! << 24) |
        (bytes[dataEnd + 1]! << 16) |
        (bytes[dataEnd + 2]! << 8) |
        bytes[dataEnd + 3]!) >>>
      0;
    const crcComputed = crc32(bytes.subarray(at + 4, dataEnd));
    const crcValid = crcDeclared === crcComputed;

    chunks.push({ type, offset: at, length, data, crcDeclared, crcComputed, crcValid });
    if (!crcValid) {
      failures.push(
        `Chunk ${type} at byte ${at}: CRC-32 is 0x${toHex(u32(crcDeclared))}, computed 0x${toHex(u32(crcComputed))}`,
      );
    }

    if (type === "IHDR") {
      if (length !== 13) {
        failures.push(`IHDR declares ${length} bytes; PNG requires exactly 13`);
      } else {
        const dv = new DataView(data.buffer, data.byteOffset, 13);
        width = dv.getUint32(0);
        height = dv.getUint32(4);
        bitDepth = data[8]!;
        colourType = data[9]!;
        interlace = data[12]!;
        if (width === 0) failures.push("IHDR width is 0");
        if (height === 0) failures.push("IHDR height is 0");
        if (bitDepth !== 1 && bitDepth !== 2 && bitDepth !== 4 && bitDepth !== 8 && bitDepth !== 16) {
          failures.push(`IHDR bit depth ${bitDepth} is not a permitted value`);
        }
        if (data[10] !== 0) failures.push("IHDR compression method is not 0");
        if (data[11] !== 0) failures.push("IHDR filter method is not 0");
        if (interlace !== 0) failures.push("IHDR interlace method is not 0");
      }
      sawIhdr = true;
    } else if (type === "IDAT") {
      idatLength += length;
    } else if (type === "IEND") {
      sawIend = true;
      break;
    }

    at = dataEnd + 4;
  }

  if (!sawIhdr) failures.push("No IHDR chunk found");
  if (!sawIend && failures.length === 0) failures.push("No IEND chunk found");

  return {
    chunks,
    width,
    height,
    bitDepth,
    colourType,
    interlace,
    failures,
    structurallyValid: failures.length === 0,
    idatLength,
  };
}

function u32(n: number): Uint8Array {
  return new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
}

/* ── Deterministic sample imagery ───────────────────────────────────────── */

/**
 * Mulberry32 — a small, fast, fully deterministic PRNG.
 * Seeded imagery keeps sample experiments reproducible.
 */
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

export const TEST_PLATE = { width: 128, height: 80, seed: 0x5eed1e } as const;

/**
 * A generated calibration plate: a machined border, a corner registration
 * mark, a centred bar ramp, and a seeded noise field. Every element is
 * deterministic, and each occupies a distinct byte region so that bit
 * sensitivity is directly observable by position.
 */
export function generateTestPlate(width = TEST_PLATE.width, height = TEST_PLATE.height): Uint8Array {
  const out = new Uint8Array(width * height);
  const rand = mulberry32(TEST_PLATE.seed);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) out[y * width + x] = Math.floor(rand() * 48) + 8;
  }

  // Machined frame — 2px stroke.
  for (let x = 0; x < width; x++) {
    for (let k = 0; k < 2; k++) {
      out[k * width + x] = 232;
      out[(height - 1 - k) * width + x] = 232;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let k = 0; k < 2; k++) {
      out[y * width + k] = 232;
      out[y * width + width - 1 - k] = 232;
    }
  }

  // Registration mark — top-left, 16×16 cross.
  const markX = 6;
  const markY = 6;
  for (let i = 0; i < 16; i++) {
    if (markX + i < width && markY + 8 < height) out[(markY + 8) * width + markX + i] = 255;
    if (markY + i < height && markX + 8 < width) out[(markY + i) * width + markX + 8] = 255;
  }

  // Eleven-step greyscale ramp — right half.
  const rampX = Math.floor(width * 0.5);
  const rampW = Math.floor(width * 0.42);
  const rampY = Math.floor(height * 0.22);
  const rampH = Math.max(8, Math.floor(height * 0.3));
  const steps = 11;
  for (let s = 0; s < steps; s++) {
    const level = Math.round((s / (steps - 1)) * 255);
    const x0 = rampX + Math.floor((s * rampW) / steps);
    const x1 = rampX + Math.floor(((s + 1) * rampW) / steps);
    for (let y = rampY; y < Math.min(height, rampY + rampH); y++) {
      for (let x = x0; x < Math.min(width, x1); x++) out[y * width + x] = level;
    }
  }

  // Alternating high-frequency patch — demonstrates that a single pixel-bit
  // flip produces a single-pixel difference, and nothing more.
  const patchX = Math.floor(width * 0.52);
  const patchY = Math.floor(height * 0.62);
  for (let y = 0; y < 16 && patchY + y < height; y++) {
    for (let x = 0; x < 24 && patchX + x < width; x++) {
      out[(patchY + y) * width + patchX + x] = (x + y) % 2 === 0 ? 0 : 255;
    }
  }

  return out;
}