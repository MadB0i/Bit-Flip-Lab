/**
 * Built-in sample experiments.
 *
 * Every sample is generated deterministically from a constant, so the bytes
 * are byte-identical on every machine and every run. That is what makes a
 * sample experiment reproducible from a README line alone.
 *
 * The four samples are chosen to expose four different regions of bit
 * sensitivity, not to look impressive:
 *
 *   BLAB record   magic / length / integrity / payload, each with a distinct consequence
 *   BF11 atlas    pixel payload — one bit, one pixel
 *   PNG plate     structure vs compressed payload, the classic fault-injection split
 *   raw block     no decoder at all, so nothing can honestly be claimed
 */

import { encodeGlyphText } from "./bitmap";
import { encodeBlab } from "./labRecord";
import { TEST_PLATE, encodeGrayscalePng, generateTestPlate, mulberry32 } from "./png";
import type { DataSource } from "./pipeline";

export const SAMPLE_IDS = {
  blab: "sample.blab",
  glyph: "sample.bf11",
  png: "sample.png",
  raw: "sample.raw",
} as const;

/** The BLAB record: a genuine structure with a genuine integrity check. */
export function buildBlabSample(): Uint8Array {
  return encodeBlab({
    version: 1,
    sampleRateHz: 48_000,
    label: "CH-1 CAPTURE",
    sampleCount: 16,
    // A decaying waveform — adjacent samples differ, so a single-bit flip is
    // visible in the decoded value rather than hidden by a constant field.
    samples: Array.from({ length: 16 }, (_, i) => {
      const envelope = Math.round(32767 * Math.exp(-i / 7));
      return Math.max(0, Math.min(0xffff, envelope));
    }),
  });
}

/** The 1-bit atlas: eight glyphs, one bit per pixel. */
export function buildGlyphSample(): Uint8Array {
  return encodeGlyphText("BIT FLIP", 8 * 8, 232);
}

/** The PNG plate: structure in IHDR, compressed payload in IDAT. */
export function buildPngSample(): Uint8Array {
  return encodeGrayscalePng(
    TEST_PLATE.width,
    TEST_PLATE.height,
    generateTestPlate(),
  );
}

/** A raw block with no format. Inspection only. */
export function buildRawSample(): Uint8Array {
  const out = new Uint8Array(192);
  const rand = mulberry32(0x1a2b3c4d);
  for (let i = 0; i < out.length; i++) out[i] = Math.floor(rand() * 256);
  return out;
}

export function buildAllSamples(): readonly DataSource[] {
  return [
    {
      id: SAMPLE_IDS.blab,
      name: "BLAB record",
      kind: "structured",
      bytes: buildBlabSample(),
      mediaType: "application/x-blab",
      synopsis:
        "A 76-byte structured record with named fields and a CRC-32. Bits land in magic, length, payload, or integrity — four different consequences.",
      policy: "INSPECT",
    },
    {
      id: SAMPLE_IDS.glyph,
      name: "BF11 atlas",
      kind: "bitmap",
      bytes: buildGlyphSample(),
      mediaType: "application/x-bf11",
      synopsis:
        "One bit per pixel, eight glyphs wide. The cleanest possible mapping: flip one bit, exactly one pixel changes.",
      policy: "DECODE",
    },
    {
      id: SAMPLE_IDS.png,
      name: "PNG plate",
      kind: "image",
      bytes: buildPngSample(),
      mediaType: "image/png",
      synopsis:
        "A generated 128×80 greyscale plate. Flips in IHDR change the image's structure; flips in IDAT fight DEFLATE.",
      policy: "DECODE",
    },
    {
      id: SAMPLE_IDS.raw,
      name: "Raw block",
      kind: "raw",
      bytes: buildRawSample(),
      mediaType: "application/octet-stream",
      synopsis:
        "192 bytes with no format. Bit flips are measurable at the byte level and unclassifiable beyond that — stated, not faked.",
      policy: "INSPECT",
    },
  ];
}

/** Fetch a sample by id, or the first sample when the id is unknown. */
export function sampleById(id: string): DataSource | undefined {
  return buildAllSamples().find((s) => s.id === id);
}