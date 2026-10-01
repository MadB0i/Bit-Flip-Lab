import { describe, expect, it } from "vitest";
import { MutationError, countDifferingBytes, flipBit, flipBits } from "@/core/mutate";

describe("flipBit — 0 → 1", () => {
  it("sets a zero bit", () => {
    const source = new Uint8Array([0x00]);
    const result = flipBit(source, 7);
    expect(result.mutatedBit).toBe(1);
    expect(result.data[0]).toBe(0x01);
  });

  it("sets a zero bit in the middle of a byte", () => {
    const source = new Uint8Array([0b0100_1101]);
    const result = flipBit(source, 2); // in-byte index 5, value 0
    expect(result.originalBit).toBe(0);
    expect(result.mutatedBit).toBe(1);
    expect(result.data[0]).toBe(0b0110_1101);
  });
});

describe("flipBit — 1 → 0", () => {
  it("clears a set bit", () => {
    const source = new Uint8Array([0xff]);
    const result = flipBit(source, 7); // least significant bit
    expect(result.mutatedBit).toBe(0);
    expect(result.data[0]).toBe(0xfe);
  });

  it("clears the middle bit without touching neighbours", () => {
    const source = new Uint8Array([0b0100_1101]);
    const result = flipBit(source, 1); // in-byte index 6, value 1
    expect(result.data[0]).toBe(0b0000_1101);
  });
});

describe("flipBit — boundaries", () => {
  it("flips the first bit of the buffer", () => {
    const source = new Uint8Array([0x00, 0xff]);
    const result = flipBit(source, 0);
    expect(result.byteIndex).toBe(0);
    expect(result.bitInByte).toBe(7);
    expect(result.data[0]).toBe(0x80);
    expect(result.data[1]).toBe(0xff);
  });

  it("flips the last bit of the buffer", () => {
    const source = new Uint8Array([0xff, 0x00]);
    const result = flipBit(source, 15);
    expect(result.byteIndex).toBe(1);
    expect(result.bitInByte).toBe(0);
    expect(result.data[0]).toBe(0xff);
    expect(result.data[1]).toBe(0x01);
  });

  it("flips the last bit of a one-byte buffer", () => {
    const result = flipBit(new Uint8Array([0x00]), 7);
    expect(result.data).toEqual(new Uint8Array([0x01]));
  });

  it("crosses a byte boundary correctly", () => {
    // Bit 8 is the first bit of byte 1.
    const source = new Uint8Array([0xaa, 0x00]);
    const result = flipBit(source, 8);
    expect(result.byteIndex).toBe(1);
    expect(result.data[0]).toBe(0xaa);
    expect(result.data[1]).toBe(0x80);
  });
});

describe("flipBit — invalid input", () => {
  it("rejects an empty buffer", () => {
    expect(() => flipBit(new Uint8Array(0), 0)).toThrow(MutationError);
    expect(() => flipBit(new Uint8Array(0), 0)).toThrow(/empty buffer/i);
  });

  it("rejects a negative position", () => {
    expect(() => flipBit(new Uint8Array([1]), -1)).toThrow(/outside the addressable range/);
  });

  it("rejects one past the last bit", () => {
    expect(() => flipBit(new Uint8Array([1]), 8)).toThrow(/outside the addressable range/);
  });

  it("rejects a fractional position", () => {
    expect(() => flipBit(new Uint8Array([1]), 1.5)).toThrow(MutationError);
  });

  it("reports EMPTY_INPUT separately from OUT_OF_RANGE", () => {
    try {
      flipBit(new Uint8Array(0), 0);
    } catch (e) {
      expect((e as MutationError).code).toBe("EMPTY_INPUT");
    }
    try {
      flipBit(new Uint8Array([1]), 99);
    } catch (e) {
      expect((e as MutationError).code).toBe("OUT_OF_RANGE");
    }
  });
});

describe("flipBit — purity and determinism", () => {
  it("never mutates the source buffer", () => {
    const source = new Uint8Array([0b1010_1010]);
    const copy = new Uint8Array(source);
    flipBit(source, 0);
    expect(source).toEqual(copy);
  });

  it("returns a new buffer object", () => {
    const source = new Uint8Array([1]);
    expect(flipBit(source, 0).data).not.toBe(source);
  });

  it("is deterministic across repeated runs", () => {
    const source = new Uint8Array(64).map((_, i) => (i * 37) & 0xff);
    const a = flipBit(source, 100).data;
    const b = flipBit(source, 100).data;
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it("is deterministic on a large input", () => {
    const source = new Uint8Array(1 << 20);
    source[524287] = 0x5a;
    const a = flipBit(source, 4_194_296 - 1).data;
    const b = flipBit(source, 4_194_296 - 1).data;
    expect(a.length).toBe(source.length);
    expect(countDifferingBytes(a, b)).toBe(0);
  });
});

describe("repeated mutation", () => {
  it("is its own inverse", () => {
    const source = new Uint8Array([0x4d]);
    const once = flipBit(source, 3);
    const twice = flipBit(once.data, 3);
    expect(twice.data).toEqual(source);
  });

  it("returns to the original after flipping every bit twice", () => {
    const source = new Uint8Array([0x4d, 0x6f]);
    const all = Array.from({ length: 16 }, (_, i) => i);
    const once = flipBits(source, all);
    // Flipping every bit once yields the complement, not the original.
    expect(once.data[0]).toBe(0x4d ^ 0xff);
    expect(flipBits(once.data, all).data).toEqual(source);
  });

  it("records every change", () => {
    const source = new Uint8Array([0x00, 0x00]);
    const result = flipBits(source, [0, 9, 15]);
    expect(result.changes).toHaveLength(3);
    expect(result.data[0]).toBe(0x80);
    expect(result.data[1]).toBe(0x41);
  });

  it("is order independent", () => {
    const source = new Uint8Array([0xaa, 0x55]);
    const a = flipBits(source, [0, 5, 12]);
    const b = flipBits(source, [12, 0, 5]);
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
  });

  it("rejects duplicate offsets", () => {
    expect(() => flipBits(new Uint8Array([0]), [0, 0])).toThrow(/more than once/);
  });

  it("rejects an empty offset list only when the buffer is empty", () => {
    expect(() => flipBits(new Uint8Array(0), [])).toThrow(MutationError);
    expect(flipBits(new Uint8Array([0]), []).data).toEqual(new Uint8Array([0]));
  });

  it("rejects out-of-range offsets inside a multi-flip", () => {
    expect(() => flipBits(new Uint8Array([0]), [0, 64])).toThrow(/outside the addressable range/);
  });
});

describe("countDifferingBytes", () => {
  it("counts differing bytes", () => {
    expect(countDifferingBytes(new Uint8Array([0, 1, 2]), new Uint8Array([9, 1, 2]))).toBe(1);
  });

  it("reports -1 for different lengths", () => {
    expect(countDifferingBytes(new Uint8Array([0]), new Uint8Array([0, 0]))).toBe(-1);
  });

  it("reports zero for identical buffers", () => {
    expect(countDifferingBytes(new Uint8Array([0, 1]), new Uint8Array([0, 1]))).toBe(0);
  });
});