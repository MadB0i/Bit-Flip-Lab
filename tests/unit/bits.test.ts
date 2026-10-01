import { describe, expect, it } from "vitest";
import {
  binaryToByte,
  bitCapacity,
  byteToBinary,
  byteToHex,
  composeBit,
  decomposeBit,
  formatAddress,
  hexAddressDigits,
  readBit,
  writeBit,
} from "@/core/bits";

describe("bit decomposition", () => {
  it("maps the first bit to byte 0, bit 7", () => {
    expect(decomposeBit(0)).toEqual({ byteIndex: 0, bitInByte: 7 });
  });

  it("maps bit 7 to byte 0, bit 0", () => {
    expect(decomposeBit(7)).toEqual({ byteIndex: 0, bitInByte: 0 });
  });

  it("maps bit 8 to byte 1, bit 7", () => {
    expect(decomposeBit(8)).toEqual({ byteIndex: 1, bitInByte: 7 });
  });

  it("round-trips across a byte boundary", () => {
    for (let offset = 0; offset < 64; offset++) {
      const { byteIndex, bitInByte } = decomposeBit(offset);
      expect(composeBit(byteIndex, bitInByte)).toBe(offset);
    }
  });

  it("reports capacity as eight bits per byte", () => {
    expect(bitCapacity(0)).toBe(0);
    expect(bitCapacity(1)).toBe(8);
    expect(bitCapacity(76)).toBe(608);
  });
});

describe("readBit", () => {
  const bytes = new Uint8Array([0b0100_1101]);

  it("reads MSB first", () => {
    expect(readBit(bytes, 0)).toBe(0);
    expect(readBit(bytes, 1)).toBe(1);
    expect(readBit(bytes, 2)).toBe(0);
    expect(readBit(bytes, 3)).toBe(0);
    expect(readBit(bytes, 4)).toBe(1);
    expect(readBit(bytes, 5)).toBe(1);
    expect(readBit(bytes, 6)).toBe(0);
    expect(readBit(bytes, 7)).toBe(1);
  });

  it("throws past the end of the buffer", () => {
    expect(() => readBit(bytes, 8)).toThrow(RangeError);
  });
});

describe("writeBit", () => {
  it("sets a zero bit to one without touching neighbours", () => {
    const b = new Uint8Array([0x4d]);
    writeBit(b, 2, 1);
    expect(b[0]).toBe(0b0100_1101 | 0b0010_0000);
    expect(b[0]! & 0b0010_0000).toBe(0b0010_0000);
  });

  it("clears a one bit without touching neighbours", () => {
    const b = new Uint8Array([0x4d]);
    writeBit(b, 1, 0);
    expect(b[0]).toBe(0b0100_1101 & ~0b0100_0000);
    expect(b[0]).toBe(0x0d);
  });

  it("never produces a negative byte", () => {
    const b = new Uint8Array([0xff]);
    writeBit(b, 3, 0); // in-byte index 4
    expect(b[0]).toBe(0xef);
    expect(b[0]).toBeGreaterThanOrEqual(0);
  });
});

describe("formatting", () => {
  it("renders bytes as eight MSB-first digits", () => {
    expect(byteToBinary(0x4d)).toBe("01001101");
    expect(byteToBinary(0x00)).toBe("00000000");
    expect(byteToBinary(0xff)).toBe("11111111");
  });

  it("parses binary back to a byte", () => {
    expect(binaryToByte("01001101")).toBe(0x4d);
  });

  it("rejects malformed binary", () => {
    expect(() => binaryToByte("0100110")).toThrow();
    expect(() => binaryToByte("01001102")).toThrow();
  });

  it("renders uppercase two-digit hex", () => {
    expect(byteToHex(0x4d)).toBe("4D");
    expect(byteToHex(0x0f)).toBe("0F");
  });

  it("pads addresses to a width that fits the buffer", () => {
    expect(hexAddressDigits(76)).toBe(4);
    expect(hexAddressDigits(0xffff)).toBe(4);
    expect(hexAddressDigits(0x1a24)).toBe(4);
    expect(hexAddressDigits(0x10000)).toBe(5);
    expect(formatAddress(0x1a20, 0x1a24)).toBe("0x1A20");
    expect(formatAddress(5, 76)).toBe("0x0005");
  });
});