/**
 * Source adapters.
 *
 * An adapter is the only place that knows what a format means. Adding a new
 * one — a model weight container, a columnar dataset — means implementing
 * this interface and adding it to `ADAPTERS`. No UI or pipeline code changes.
 *
 * Two adapters here are browser-dependent (`imageAdapter`), because decoding
 * an image genuinely requires the platform. The rest are pure and run
 * identically in Node, a worker, and the main thread.
 */

import {
  bitmapPixel,
  parseBitmap,
  renderBitmap,
  type GlyphAtlas,
} from "./bitmap";
import { countDifferingBytes } from "./mutate";
import {
  OFF_CRC,
  OFF_LABEL,
  OFF_MAGIC,
  OFF_RECORD_LENGTH,
  OFF_SAMPLE_COUNT,
  OFF_SAMPLE_RATE,
  OFF_SAMPLES,
  OFF_VERSION,
  SAMPLE_CAPACITY,
  decodeBlab,
  hasBlabMagic,
} from "./labRecord";
import { parsePngStructure } from "./png";
import { diffRgba, type RgbaImage } from "./pixels";
import { hashHex } from "./sha256";
import type {
  DataSource,
  Execution,
  Measurement,
  SemanticMeasurement,
  SourceAdapter,
  StructureRegion,
} from "./pipeline";
import { decodeImageBuffer, isImageDecodingAvailable } from "./imageCodec";

/* ── Raw / unknown bytes ────────────────────────────────────────────────── */

export const rawAdapter: SourceAdapter = {
  kind: "raw",
  label: "Raw bytes",
  matches: () => true, // last resort

  inspect(source: DataSource) {
    return {
      facts: [
        { label: "Bytes", value: source.bytes.length.toLocaleString("en-US") },
        { label: "Addressable bits", value: (source.bytes.length * 8).toLocaleString("en-US") },
        { label: "Decoder", value: "none registered for this format" },
      ],
      regions: [],
    };
  },

  async execute() {
    return {
      verdict: "not-applicable",
      structureVerdict: "unknown",
      structureFailures: [],
      message:
        "No decoder is registered for this format. Bytes can be inspected and flipped, but structure cannot be validated.",
      render: null,
      requiredCodeExecution: false,
    };
  },

  measure(_source, originalBytes, mutatedBytes) {
    return baseMeasurement(originalBytes, mutatedBytes, []);
  },
};

/* ── BLAB structured record ─────────────────────────────────────────────── */

export const structuredAdapter: SourceAdapter = {
  kind: "structured",
  label: "BLAB record",
  matches: (s) => s.kind === "structured" || looksLikeBlab(s.bytes),

  inspect(source) {
    const parse = decodeBlab(source.bytes);
    const regions: StructureRegion[] = [
      { name: "magic", startByte: OFF_MAGIC, lengthBytes: 4, role: "magic" },
      { name: "version", startByte: OFF_VERSION, lengthBytes: 2, role: "structure" },
      { name: "recordLength", startByte: OFF_RECORD_LENGTH, lengthBytes: 4, role: "length" },
      { name: "sampleRateHz", startByte: OFF_SAMPLE_RATE, lengthBytes: 4, role: "payload" },
      { name: "label", startByte: OFF_LABEL, lengthBytes: 24, role: "payload" },
      { name: "sampleCount", startByte: OFF_SAMPLE_COUNT, lengthBytes: 2, role: "length" },
      {
        name: "samples[16]",
        startByte: OFF_SAMPLES,
        lengthBytes: SAMPLE_CAPACITY * 2,
        role: "payload",
      },
      { name: "crc32", startByte: OFF_CRC, lengthBytes: 4, role: "integrity" },
    ];
    const facts: { label: string; value: string }[] = [
      { label: "Fields", value: `${regions.length} named regions` },
      { label: "Integrity", value: "CRC-32 over bytes 0x00–0x47" },
      { label: "Structure", value: parse.structurallyValid ? "valid" : "invalid" },
    ];
    if (parse.record) {
      facts.push(
        { label: "Version", value: String(parse.record.version) },
        { label: "Label", value: parse.record.label || "(empty)" },
        { label: "Sample rate", value: `${parse.record.sampleRateHz.toLocaleString("en-US")} Hz` },
        { label: "Samples", value: String(parse.record.sampleCount) },
      );
    }
    return { facts, regions };
  },

  async execute(_source, bytes) {
    const parse = decodeBlab(bytes);
    if (!parse.parsed) {
      return {
        verdict: "failed",
        structureVerdict: "invalid",
        structureFailures: parse.failures,
        message: `The record could not be parsed. ${parse.failures.join("; ")}`,
        render: null,
        requiredCodeExecution: false,
      };
    }
    const ok = parse.structurallyValid;
    return {
      verdict: "ok",
      structureVerdict: ok ? "valid" : "invalid",
      structureFailures: parse.failures,
      message: ok
        ? `Record parsed. CRC-32 matches over ${76 - 4} bytes.`
        : `Record parsed, but ${parse.failures.length} structural check(s) failed: ${parse.failures.join("; ")}`,
      render: null,
      requiredCodeExecution: false,
    };
  },

  measure(_source, originalBytes, mutatedBytes, originalExecution, mutatedExecution) {
    const beforeParse = decodeBlab(originalBytes);
    const afterParse = decodeBlab(mutatedBytes);
    const before = beforeParse.record;
    const after = afterParse.record;

    // When a record cannot be parsed, every field is unreadable. Eight rows of
    // dashes would be noise; the located parse failure is the honest report.
    if (before === null || after === null) {
      const side = before === null ? "original" : "mutated";
      const semantics: SemanticMeasurement[] = [
        {
          label: "Named fields",
          before: before === null ? "unreadable" : "8 readable",
          after: after === null ? "unreadable" : "8 readable",
          changed: (before === null) !== (after === null),
        },
        {
          label: `${side} parse failure`,
          before: beforeParse.failures.join("; ") || "none",
          after: afterParse.failures.join("; ") || "none",
          changed: beforeParse.failures.join("; ") !== afterParse.failures.join("; "),
        },
      ];
      void originalExecution;
      void mutatedExecution;
      return baseMeasurement(originalBytes, mutatedBytes, semantics);
    }

    const semantics: SemanticMeasurement[] = [];
    const push = (label: string, b: string, a: string) =>
      semantics.push({ label, before: b, after: a, changed: b !== a });

    push("Magic", "BLAB", "BLAB");
    push("Version", String(before.version), String(after.version));
    push("Declared length", `${before.recordLength} bytes`, `${after.recordLength} bytes`);
    push(
      "Sample rate",
      `${before.sampleRateHz.toLocaleString("en-US")} Hz`,
      `${after.sampleRateHz.toLocaleString("en-US")} Hz`,
    );
    push("Label", before.label || "(empty)", after.label || "(empty)");
    push("Sample count", String(before.sampleCount), String(after.sampleCount));
    push("Samples", before.samples.join(" "), after.samples.join(" "));
    push("CRC-32", hex32(before.crc32), hex32(after.crc32));

    return baseMeasurement(originalBytes, mutatedBytes, semantics);
  },
};

function hex32(n: number): string {
  return `0x${(n >>> 0).toString(16).toUpperCase().padStart(8, "0")}`;
}

function looksLikeBlab(b: Uint8Array): boolean {
  return hasBlabMagic(b);
}

/* ── BF11 1-bit glyph atlas ─────────────────────────────────────────────── */

export const bitmapAdapter: SourceAdapter = {
  kind: "bitmap",
  label: "BF11 1-bit glyph atlas",
  matches: (s) => s.kind === "bitmap" || looksLikeBitmap(s.bytes),

  inspect(source) {
    const parse = parseBitmap(source.bytes);
    const regions: StructureRegion[] = [
      { name: "magic", startByte: 0, lengthBytes: 4, role: "magic" },
      { name: "width", startByte: 4, lengthBytes: 2, role: "length" },
      { name: "height", startByte: 6, lengthBytes: 2, role: "length" },
      { name: "foreground", startByte: 8, lengthBytes: 1, role: "structure" },
      { name: "padding", startByte: 9, lengthBytes: 1, role: "structure" },
    ];
    if (parse.atlas) {
      regions.push({
        name: `pixels (${parse.atlas.width}×${parse.atlas.height})`,
        startByte: 10,
        lengthBytes: parse.atlas.stride * parse.atlas.height,
        role: "pixels",
      });
    }
    const facts = [
      { label: "Depth", value: "1 bit per pixel, MSB first" },
      { label: "Structure", value: parse.structurallyValid ? "valid" : "invalid" },
    ];
    if (parse.atlas) {
      facts.push(
        { label: "Dimensions", value: `${parse.atlas.width} × ${parse.atlas.height} px` },
        { label: "Row stride", value: `${parse.atlas.stride} bytes` },
        { label: "Foreground level", value: String(parse.atlas.foreground) },
      );
    }
    return { facts, regions };
  },

  async execute(_source, bytes) {
    const parse = parseBitmap(bytes);
    if (!parse.parsed || !parse.atlas) {
      return {
        verdict: "failed",
        structureVerdict: "invalid",
        structureFailures: parse.failures,
        message: `The atlas header could not be read. ${parse.failures.join("; ")}`,
        render: null,
        requiredCodeExecution: false,
      };
    }
    const atlas = parse.atlas;
    const render = renderBitmap(bytes, atlas);
    const ok = parse.structurallyValid;
    return {
      verdict: "ok",
      structureVerdict: ok ? "valid" : "invalid",
      structureFailures: parse.failures,
      message: ok
        ? `Atlas decoded: ${atlas.width} × ${atlas.height} pixels, ${atlas.stride} bytes per row.`
        : `Atlas decoded, but structural checks failed: ${parse.failures.join("; ")}`,
      render: { image: render, atlas },
      requiredCodeExecution: false,
    };
  },

  measure(_source, originalBytes, mutatedBytes, originalExecution, mutatedExecution) {
    const before = originalExecution.render?.atlas;
    const after = mutatedExecution.render?.atlas;
    const semantics: SemanticMeasurement[] = [];

    if (before && after) {
      semantics.push({ label: "Width", before: `${before.width} px`, after: `${after.width} px`, changed: before.width !== after.width });
      semantics.push({ label: "Height", before: `${before.height} px`, after: `${after.height} px`, changed: before.height !== after.height });
      semantics.push({
        label: "Foreground level",
        before: String(before.foreground),
        after: String(after.foreground),
        changed: before.foreground !== after.foreground,
      });
      semantics.push({
        label: "Pixel population",
        before: `${countSetBits(originalBytes, before)}`,
        after: `${countSetBits(mutatedBytes, after)}`,
        changed: countSetBits(originalBytes, before) !== countSetBits(mutatedBytes, after),
      });
    }

    return baseMeasurement(originalBytes, mutatedBytes, semantics);
  },
};

function countSetBits(bytes: Uint8Array, atlas: GlyphAtlas): number {
  let n = 0;
  for (let y = 0; y < atlas.height; y++) {
    for (let x = 0; x < atlas.width; x++) n += bitmapPixel(bytes, atlas, x, y);
  }
  return n;
}

function looksLikeBitmap(b: Uint8Array): boolean {
  return b.length >= 4 && b[0] === 0x42 && b[1] === 0x46 && b[2] === 0x31 && b[3] === 0x31;
}

/* ── PNG ────────────────────────────────────────────────────────────────── */

export const imageAdapter: SourceAdapter = {
  kind: "image",
  label: "PNG image",
  matches: (s) => s.kind === "image" || isPngBytes(s.bytes),

  inspect(source) {
    const structure = parsePngStructure(source.bytes);
    const regions: StructureRegion[] = structure.chunks.map((c) => ({
      name: c.type,
      startByte: c.offset,
      lengthBytes: c.length + 12,
      role: c.type === "IHDR" ? ("structure" as const) : c.type === "IDAT" ? ("pixels" as const) : ("opaque" as const),
    }));
    const facts = [
      { label: "Signature", value: "89 50 4E 47 0D 0A 1A 0A" },
      { label: "Chunks", value: String(structure.chunks.length) },
      { label: "Structure", value: structure.structurallyValid ? "valid" : "invalid" },
    ];
    if (structure.width !== null && structure.height !== null) {
      facts.push({ label: "Dimensions", value: `${structure.width} × ${structure.height} px` });
      facts.push({ label: "Bit depth", value: `${structure.bitDepth}-bit` });
      facts.push({ label: "Colour type", value: colourTypeName(structure.colourType) });
      facts.push({ label: "Interlace", value: structure.interlace === 0 ? "none" : String(structure.interlace) });
    }
    facts.push({ label: "Compressed pixels", value: `${structure.idatLength.toLocaleString("en-US")} bytes` });
    return { facts, regions };
  },

  async execute(_source, bytes) {
    const structure = parsePngStructure(bytes);
    if (!structure.structurallyValid) {
      return {
        verdict: "failed",
        structureVerdict: "invalid",
        structureFailures: structure.failures,
        message: `The PNG chunk stream failed validation. ${structure.failures.join("; ")}`,
        render: null,
        requiredCodeExecution: false,
      };
    }

    if (!isImageDecodingAvailable()) {
      // Report the limitation rather than manufacturing a decode failure.
      return {
        verdict: "not-applicable",
        structureVerdict: "valid",
        structureFailures: [],
        message:
          "Every chunk CRC is valid, but pixel decoding is unavailable in this environment, so no pixel measurement is claimed.",
        render: null,
        requiredCodeExecution: false,
      };
    }

    const decoded = await decodeImageBuffer(bytes);
    if (!decoded.ok) {
      return {
        verdict: "failed",
        structureVerdict: "invalid",
        structureFailures: structure.failures,
        message: `The chunk stream validated but the browser image decoder rejected the file: ${decoded.reason}`,
        render: null,
        requiredCodeExecution: false,
      };
    }

    return {
      verdict: "ok",
      structureVerdict: "valid",
      structureFailures: [],
      message: `Decoded ${decoded.width} × ${decoded.height} px. All chunk CRCs valid.`,
      render: { image: decoded.image, atlas: null },
      requiredCodeExecution: false,
    };
  },

  measure(_source, originalBytes, mutatedBytes, _originalExecution, _mutatedExecution) {
    const semantics: SemanticMeasurement[] = [];
    const before = parsePngStructure(originalBytes);
    const after = parsePngStructure(mutatedBytes);

    const dim = (s: ReturnType<typeof parsePngStructure>) =>
      s.width === null || s.height === null ? "unreadable" : `${s.width} × ${s.height} px`;

    semantics.push({ label: "Dimensions", before: dim(before), after: dim(after), changed: dim(before) !== dim(after) });
    semantics.push({
      label: "Bit depth",
      before: before.bitDepth === null ? "unreadable" : String(before.bitDepth),
      after: after.bitDepth === null ? "unreadable" : String(after.bitDepth),
      changed: before.bitDepth !== after.bitDepth,
    });
    semantics.push({
      label: "Chunk CRCs",
      before: before.structurallyValid ? "all valid" : `${before.failures.length} invalid`,
      after: after.structurallyValid ? "all valid" : `${after.failures.length} invalid`,
      changed: before.structurallyValid !== after.structurallyValid,
    });
    semantics.push({
      label: "IDAT length",
      before: before.idatLength === 0 ? "absent" : `${before.idatLength} bytes`,
      after: after.idatLength === 0 ? "absent" : `${after.idatLength} bytes`,
      changed: before.idatLength !== after.idatLength,
    });

    return baseMeasurement(originalBytes, mutatedBytes, semantics);
  },
};

function colourTypeName(type: number | null): string {
  switch (type) {
    case 0:
      return "0 — greyscale";
    case 2:
      return "2 — truecolour";
    case 3:
      return "3 — indexed";
    case 4:
      return "4 — greyscale + alpha";
    case 6:
      return "6 — truecolour + alpha";
    default:
      return "—";
  }
}

function isPngBytes(b: Uint8Array): boolean {
  return (
    b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47
  );
}

/* ── Shared measurement ─────────────────────────────────────────────────── */

/**
 * The measurement every adapter shares: byte-level facts computed directly
 * from the two buffers, plus the adapter's semantic deltas.
 */
export function baseMeasurement(
  originalBytes: Uint8Array,
  mutatedBytes: Uint8Array,
  semantics: readonly SemanticMeasurement[],
): Measurement {
  const changed: number[] = [];
  const limit = Math.min(originalBytes.length, mutatedBytes.length);
  let bitCountDelta = 0;
  for (let i = 0; i < limit; i++) {
    const a = originalBytes[i]!;
    const b = mutatedBytes[i]!;
    if (a !== b) {
      changed.push(i);
      bitCountDelta += popcount(a ^ b);
    }
  }
  if (originalBytes.length !== mutatedBytes.length) {
    bitCountDelta = -1; // length changed; a bit-count delta is not meaningful
  }

  return {
    bytesChanged: countDifferingBytes(originalBytes, mutatedBytes),
    changedByteOffsets: changed,
    bitCountDelta,
    integrityBefore: hashHex(originalBytes),
    integrityAfter: hashHex(mutatedBytes),
    render: null,
    semantics,
  };
}

export function popcount(n: number): number {
  let v = n & 0xff;
  v -= (v >> 1) & 0x55;
  v = (v & 0x33) + ((v >> 2) & 0x33);
  return (((v + (v >> 4)) & 0x0f) + 0) | 0;
}

/** Attach a render measurement produced by the executor's two renders. */
export function withRenderComparison(
  measurement: Measurement,
  originalExecution: Execution,
  mutatedExecution: Execution,
): Measurement {
  const a: RgbaImage | undefined = originalExecution.render?.image;
  const b: RgbaImage | undefined = mutatedExecution.render?.image;
  if (!a || !b) return measurement;
  if (a.width !== b.width || a.height !== b.height) {
    return {
      ...measurement,
      render: {
        pixelsChanged: -1,
        pixelsTotal: b.width * b.height,
        changedBounds: null,
        meanAbsoluteError: -1,
        maxAbsoluteError: -1,
      },
    };
  }
  return { ...measurement, render: diffRgba(a, b) };
}

export const ADAPTERS: readonly SourceAdapter[] = [
  imageAdapter,
  structuredAdapter,
  bitmapAdapter,
  rawAdapter,
];

/** First adapter that claims the source. `rawAdapter` always matches. */
export function resolveAdapter(source: DataSource): SourceAdapter {
  return ADAPTERS.find((a) => a.matches(source)) ?? rawAdapter;
}
