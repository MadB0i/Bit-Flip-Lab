import { describe, expect, it } from "vitest";
import {
  PNG_SIGNATURE,
  encodeGrayscalePng,
  generateTestPlate,
  isPng,
  parsePngStructure,
  zlibStored,
} from "@/core/png";
import { flipBit } from "@/core/mutate";
import { sha256 } from "@/core/sha256";

const WIDTH = 8;
const HEIGHT = 8;
const SAMPLES = new Uint8Array(WIDTH * HEIGHT).map((_, i) => (i * 16) & 0xff);
const PNG = encodeGrayscalePng(WIDTH, HEIGHT, SAMPLES);

describe("zlib stored stream", () => {
  it("writes a valid CMF/FLG pair", () => {
    const z = zlibStored(new Uint8Array(4));
    expect(z[0]).toBe(0x78);
    expect(((z[0]! << 8) | z[1]!) % 31).toBe(0);
  });

  it("splits into stored blocks at the 65535-byte limit", () => {
    const big = new Uint8Array(70_000);
    const z = zlibStored(big);
    // 2 header bytes + 2 blocks × 5 + 70000 data + 4 adler
    expect(z).toHaveLength(2 + 10 + 70_000 + 4);
  });

  it("emits exactly one block for small input", () => {
    const z = zlibStored(new Uint8Array(1));
    expect(z).toHaveLength(2 + 5 + 1 + 4);
  });
});

describe("PNG encoding", () => {
  it("starts with the 8-byte signature", () => {
    expect(Array.from(PNG.subarray(0, 8))).toEqual(Array.from(PNG_SIGNATURE));
    expect(isPng(PNG)).toBe(true);
  });

  it("emits IHDR, IDAT and IEND", () => {
    const structure = parsePngStructure(PNG);
    expect(structure.chunks.map((c) => c.type)).toEqual(["IHDR", "IDAT", "IEND"]);
  });

  it("writes the declared dimensions", () => {
    const structure = parsePngStructure(PNG);
    expect(structure.width).toBe(WIDTH);
    expect(structure.height).toBe(HEIGHT);
    expect(structure.bitDepth).toBe(8);
    expect(structure.colourType).toBe(0);
    expect(structure.interlace).toBe(0);
  });

  it("validates every chunk CRC", () => {
    const structure = parsePngStructure(PNG);
    expect(structure.structurallyValid).toBe(true);
    expect(structure.failures).toEqual([]);
    expect(structure.chunks.every((c) => c.crcValid)).toBe(true);
  });

  it("is deterministic", () => {
    const again = encodeGrayscalePng(WIDTH, HEIGHT, SAMPLES);
    expect(sha256(again).hex).toBe(sha256(PNG).hex);
  });

  it("rejects a sample-count mismatch", () => {
    expect(() => encodeGrayscalePng(4, 4, new Uint8Array(15))).toThrow(/expected 16 samples/);
  });

  it("rejects zero dimensions", () => {
    expect(() => encodeGrayscalePng(0, 4, new Uint8Array(0))).toThrow(/invalid dimensions/);
  });
});

describe("PNG structural failure detection", () => {
  it("detects a corrupted signature", () => {
    const mutated = flipBit(PNG, 3).data;
    expect(parsePngStructure(mutated).structurallyValid).toBe(false);
    expect(parsePngStructure(mutated).failures.join(" ")).toMatch(/signature does not match/);
  });

  it("detects a corrupted IHDR and names the chunk", () => {
    // IHDR data begins at byte 16; flip the high bit of the width field.
    const mutated = flipBit(PNG, 16 * 8).data;
    const structure = parsePngStructure(mutated);
    expect(structure.structurallyValid).toBe(false);
    expect(structure.failures.join(" ")).toMatch(/Chunk IHDR at byte 8: CRC-32 is/);
  });

  it("detects a corrupted bit depth and names the field", () => {
    const structure = parsePngStructure(PNG);
    const ihdr = structure.chunks[0]!;
    expect(ihdr.data[8]).toBe(8);
    const mutated = flipBit(PNG, (ihdr.offset + 8 + 8) * 8).data;
    expect(parsePngStructure(mutated).failures.join(" ")).toMatch(/bit depth/);
  });

  it("detects a truncated file", () => {
    const truncated = PNG.subarray(0, PNG.length - 20);
    expect(parsePngStructure(truncated).structurallyValid).toBe(false);
  });

  it("reports the IDAT payload length", () => {
    expect(parsePngStructure(PNG).idatLength).toBeGreaterThan(0);
  });
});

describe("calibration plate", () => {
  it("is the declared size", () => {
    expect(generateTestPlate()).toHaveLength(128 * 80);
  });

  it("is deterministic", () => {
    expect(Array.from(generateTestPlate())).toEqual(Array.from(generateTestPlate()));
  });

  it("encodes to a structurally valid PNG", () => {
    const png = encodeGrayscalePng(128, 80, generateTestPlate());
    const structure = parsePngStructure(png);
    expect(structure.structurallyValid).toBe(true);
    expect(structure.width).toBe(128);
    expect(structure.height).toBe(80);
  });
});