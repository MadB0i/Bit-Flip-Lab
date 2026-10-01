import { describe, expect, it } from "vitest";
import { BUTTERFLY_BUDGETS, runButterfly, sampleBitOffsets } from "@/core/butterfly";
import { buildAllSamples } from "@/core/samples";
import { runExperiment } from "@/core/experiment";
import type { Severity } from "@/core/pipeline";

const samples = buildAllSamples();
const blab = samples.find((s) => s.id === "sample.blab")!;
const glyph = samples.find((s) => s.id === "sample.bf11")!;
const raw = samples.find((s) => s.id === "sample.raw")!;

describe("bit offset sampling", () => {
  it("returns nothing for an empty buffer", () => {
    expect(sampleBitOffsets(0, 8)).toEqual([]);
  });

  it("returns nothing for a zero budget", () => {
    expect(sampleBitOffsets(608, 0)).toEqual([]);
  });

  it("returns every bit when the budget exceeds the total", () => {
    expect(sampleBitOffsets(16, 64)).toHaveLength(16);
  });

  it("spreads the budget across the buffer and includes both ends", () => {
    const offsets = sampleBitOffsets(608, 8);
    expect(offsets).toHaveLength(8);
    expect(offsets[0]).toBe(0);
    expect(offsets.at(-1)).toBe(607);
    expect([...offsets]).toEqual([...offsets].sort((a, b) => a - b));
  });

  it("never repeats an offset", () => {
    for (const budget of BUTTERFLY_BUDGETS) {
      const offsets = sampleBitOffsets(608, budget);
      expect(new Set(offsets).size).toBe(offsets.length);
    }
  });

  it("stays inside the addressable range", () => {
    for (const budget of BUTTERFLY_BUDGETS) {
      for (const o of sampleBitOffsets(608, budget)) {
        expect(o).toBeGreaterThanOrEqual(0);
        expect(o).toBeLessThan(608);
      }
    }
  });
});

describe("butterfly sweep", () => {
  it("measures one cell per requested position", async () => {
    const result = await runButterfly(blab, 8);
    expect(result.cells).toHaveLength(8);
    expect(result.bitOffsets).toHaveLength(8);
    expect(result.cancelled).toBe(false);
  });

  it("reports coverage honestly", async () => {
    const result = await runButterfly(blab, 8);
    expect(result.coverage.testedBits).toBe(8);
    expect(result.coverage.totalBits).toBe(blab.bytes.length * 8);
    expect(result.coverage.fraction).toBeCloseTo(8 / 608, 6);
  });

  it("produces a cell for every severity it found", async () => {
    const result = await runButterfly(blab, 64);
    const total = (Object.values(result.counts) as number[]).reduce((a, b) => a + b, 0);
    expect(total).toBe(64);
  });

  it("finds genuinely different severities across the BLAB record", async () => {
    const result = await runButterfly(blab, 64);
    const seen = new Set<Severity>(result.cells.map((c) => c.severity));
    // A record with magic, a length field, payload and a CRC cannot have a
    // uniform consequence across its 608 bits.
    expect(seen.size).toBeGreaterThan(1);
  });

  it("gives every cell a rationale", async () => {
    const result = await runButterfly(blab, 8);
    for (const cell of result.cells) expect(cell.rationale.length).toBeGreaterThan(10);
  });

  it("produces identical results on a repeated run", async () => {
    const a = await runButterfly(glyph, 8);
    const b = await runButterfly(glyph, 8);
    expect(a.cells.map((c) => `${c.bitOffset}:${c.severity}`)).toEqual(
      b.cells.map((c) => `${c.bitOffset}:${c.severity}`),
    );
  });

  it("agrees with a manual experiment on every swept cell", async () => {
    const swept = await runButterfly(blab, 8);
    for (const cell of swept.cells) {
      const manual = await runExperiment(blab, [cell.bitOffset]);
      expect(cell.severity).toBe(manual.comparison.severity);
      expect(cell.bytesChanged).toBe(manual.measurement.bytesChanged);
    }
  });

  it("reports progress for every completed cell", async () => {
    const seen: number[] = [];
    await runButterfly(raw, 8, (p) => seen.push(p.completed));
    expect(seen).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("stops and reports partial coverage when cancelled", async () => {
    let calls = 0;
    const result = await runButterfly(blab, 16, undefined, () => calls++ >= 3);
    expect(result.cancelled).toBe(true);
    expect(result.cells.length).toBeLessThan(16);
    expect(result.coverage.testedBits).toBe(result.cells.length);
  });

  it("classifies every cell of an undecodable format as unclassified", async () => {
    const result = await runButterfly(raw, 8);
    expect(result.counts.unclassified).toBe(8);
    expect(result.counts.critical).toBe(0);
  });

  it("exposes the documented budgets", () => {
    expect([...BUTTERFLY_BUDGETS]).toEqual([1, 2, 4, 8, 16, 32, 64, 128]);
  });
});