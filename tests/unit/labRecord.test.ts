import { describe, expect, it } from "vitest";
import { crc32 } from "@/core/crc32";
import {
  OFF_CRC,
  OFF_LABEL,
  OFF_MAGIC,
  OFF_RECORD_LENGTH,
  OFF_SAMPLES,
  RECORD_LENGTH,
  SAMPLE_CAPACITY,
  decodeBlab,
  encodeBlab,
} from "@/core/labRecord";
import { flipBit } from "@/core/mutate";

const VALID = encodeBlab({
  version: 1,
  sampleRateHz: 48_000,
  label: "CH-1 CAPTURE",
  sampleCount: 16,
  samples: Array.from({ length: 16 }, (_, i) => 32767 - i * 1000),
});

describe("CRC-32", () => {
  it("matches the IEEE check value for '123456789'", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("returns 0 for an empty buffer", () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
  });

  it("is deterministic", () => {
    expect(crc32(VALID)).toBe(crc32(VALID));
  });
});

describe("BLAB encoding", () => {
  it("emits exactly 76 bytes", () => {
    expect(VALID).toHaveLength(RECORD_LENGTH);
  });

  it("writes the magic at offset 0", () => {
    expect(String.fromCharCode(...VALID.subarray(OFF_MAGIC, OFF_MAGIC + 4))).toBe("BLAB");
  });

  it("round-trips through the decoder", () => {
    const parse = decodeBlab(VALID);
    expect(parse.parsed).toBe(true);
    expect(parse.structurallyValid).toBe(true);
    expect(parse.record).not.toBeNull();
    expect(parse.record!.version).toBe(1);
    expect(parse.record!.sampleRateHz).toBe(48_000);
    expect(parse.record!.label).toBe("CH-1 CAPTURE");
    expect(parse.record!.sampleCount).toBe(16);
    expect(parse.record!.samples).toHaveLength(16);
    expect(parse.failures).toEqual([]);
  });

  it("produces byte-identical output for identical fields", () => {
    const again = encodeBlab({
      version: 1,
      sampleRateHz: 48_000,
      label: "CH-1 CAPTURE",
      sampleCount: 16,
      samples: Array.from({ length: 16 }, (_, i) => 32767 - i * 1000),
    });
    expect(Array.from(again)).toEqual(Array.from(VALID));
  });
});

describe("BLAB structural validation", () => {
  it("rejects a truncated record", () => {
    const parse = decodeBlab(VALID.subarray(0, 40));
    expect(parse.parsed).toBe(false);
    expect(parse.failures[0]).toMatch(/requires exactly 76/);
  });

  it("rejects corrupted magic and says so", () => {
    const mutated = flipBit(VALID, OFF_MAGIC * 8 + 1).data;
    const parse = decodeBlab(mutated);
    expect(parse.parsed).toBe(false);
    expect(parse.failures.join(" ")).toMatch(/Magic/);
  });

  it("detects a corrupted declared length", () => {
    const mutated = flipBit(VALID, OFF_RECORD_LENGTH * 8).data;
    const parse = decodeBlab(mutated);
    expect(parse.parsed).toBe(true);
    expect(parse.structurallyValid).toBe(false);
    expect(parse.failures.join(" ")).toMatch(/declares \d+ bytes; file contains 76/);
  });

  it("detects a corrupted CRC and reports both values", () => {
    const mutated = flipBit(VALID, OFF_CRC * 8 + 3).data;
    const parse = decodeBlab(mutated);
    expect(parse.parsed).toBe(true);
    expect(parse.structurallyValid).toBe(false);
    const crcFailure = parse.failures.find((f) => f.includes("CRC-32"));
    expect(crcFailure).toBeDefined();
    expect(crcFailure).toMatch(/CRC-32 at 0x48 is 0x[0-9A-F]{8}; computed 0x[0-9A-F]{8}/);
  });

  it("rejects a sample count beyond capacity", () => {
    const bytes = new Uint8Array(VALID);
    new DataView(bytes.buffer).setUint16(38, SAMPLE_CAPACITY + 1);
    const parse = decodeBlab(bytes);
    expect(parse.structurallyValid).toBe(false);
    expect(parse.failures.join(" ")).toMatch(/capacity is 16/);
  });
});

describe("BLAB field sensitivity", () => {
  it("changes the decoded value when a payload bit flips", () => {
    const bit = OFF_SAMPLES * 8 + 2; // first bit of samples[0]
    const mutated = flipBit(VALID, bit).data;
    const before = decodeBlab(VALID).record!;
    const after = decodeBlab(mutated).record!;
    expect(after.samples[0]).not.toBe(before.samples[0]);
  });

  it("leaves the structure valid when only a payload bit flips — but breaks the CRC", () => {
    const bit = OFF_SAMPLES * 8 + 2;
    const mutated = flipBit(VALID, bit).data;
    const parse = decodeBlab(mutated);
    // The record still parses; the integrity check is what catches the change.
    expect(parse.parsed).toBe(true);
    expect(parse.failures.join(" ")).toMatch(/CRC-32/);
  });

  it("changes the label when a label bit flips", () => {
    const bit = OFF_LABEL * 8;
    const after = decodeBlab(flipBit(VALID, bit).data).record!;
    expect(after.label).not.toBe("CH-1 CAPTURE");
  });

  it("changes the sample rate when its bit flips", () => {
    const bit = 10 * 8;
    const after = decodeBlab(flipBit(VALID, bit).data).record!;
    expect(after.sampleRateHz).not.toBe(48_000);
  });
});