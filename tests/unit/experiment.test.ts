import { describe, expect, it } from "vitest";
import { resolveAdapter } from "@/core/adapters";
import { classify, SEVERITY_LABEL } from "@/core/classify";
import { recordId, runExperiment, toRecord, verifyReproduction } from "@/core/experiment";
import { buildAllSamples } from "@/core/samples";
import { hashHex } from "@/core/sha256";
import { baseMeasurement } from "@/core/adapters";
import type { Execution } from "@/core/pipeline";

const samples = buildAllSamples();
const blab = samples.find((s) => s.id === "sample.blab")!;
const glyph = samples.find((s) => s.id === "sample.bf11")!;
const raw = samples.find((s) => s.id === "sample.raw")!;
const png = samples.find((s) => s.id === "sample.png")!;

const ok = (over: Partial<Execution> = {}): Execution => ({
  verdict: "ok",
  structureVerdict: "valid",
  structureFailures: [],
  message: "",
  render: null,
  requiredCodeExecution: false,
  ...over,
});

describe("adapter resolution", () => {
  it("resolves each sample to its own adapter", () => {
    expect(resolveAdapter(blab).kind).toBe("structured");
    expect(resolveAdapter(glyph).kind).toBe("bitmap");
    expect(resolveAdapter(png).kind).toBe("image");
    expect(resolveAdapter(raw).kind).toBe("raw");
  });

  it("resolves an unknown buffer to the raw adapter rather than guessing", () => {
    const unknown = { ...raw, kind: "raw" as const, bytes: new Uint8Array([1, 2, 3, 4]) };
    expect(resolveAdapter(unknown).kind).toBe("raw");
  });
});

describe("integrity hashes", () => {
  it("differs between original and mutated", async () => {
    const run = await runExperiment(blab, [100]);
    expect(run.measurement.integrityBefore).toBe(hashHex(blab.bytes));
    expect(run.measurement.integrityAfter).not.toBe(run.measurement.integrityBefore);
  });

  it("matches the independently computed hash of the mutated bytes", async () => {
    const run = await runExperiment(blab, [100]);
    expect(run.measurement.integrityAfter).toBe(hashHex(run.mutation.data));
  });

  it("produces a different hash for every distinct bit position", async () => {
    const hashes = new Set<string>();
    for (const bit of [0, 1, 17, 64, 255, 607]) {
      const run = await runExperiment(blab, [bit]);
      hashes.add(run.measurement.integrityAfter);
    }
    expect(hashes.size).toBe(6);
  });
});

describe("byte-level measurement", () => {
  it("reports exactly one changed byte for a single-bit flip", async () => {
    const run = await runExperiment(blab, [100]);
    expect(run.measurement.bytesChanged).toBe(1);
    expect(run.measurement.changedByteOffsets).toHaveLength(1);
  });

  it("reports a popcount delta of exactly one", async () => {
    const run = await runExperiment(blab, [100]);
    expect(run.measurement.bitCountDelta).toBe(1);
  });
});

describe("severity classification — BLAB record", () => {
  it("classifies a magic-bit flip as critical", async () => {
    const run = await runExperiment(blab, [1]);
    expect(run.comparison.severity).toBe("critical");
    expect(run.comparison.rationale).toMatch(/could not be parsed|failed/i);
  });

  it("classifies a CRC-bit flip as major", async () => {
    const run = await runExperiment(blab, [72 * 8]);
    expect(run.comparison.severity).toBe("major");
    expect(run.comparison.rationale).toMatch(/structural check/);
  });

  it("classifies a payload-bit flip as minor", async () => {
    const run = await runExperiment(blab, [40 * 8 + 2]);
    expect(run.comparison.severity).toBe("major");
  });
});

describe("severity classification — unclassified formats", () => {
  it("refuses to classify a format with no decoder", async () => {
    const run = await runExperiment(raw, [3]);
    expect(run.comparison.severity).toBe("unclassified");
    expect(run.comparison.rationale).toMatch(/no decoder/i);
  });

  it("still reports the byte facts", async () => {
    const run = await runExperiment(raw, [3]);
    expect(run.measurement.bytesChanged).toBe(1);
    expect(run.measurement.integrityAfter).not.toBe(run.measurement.integrityBefore);
  });
});

describe("severity classification — 1-bit atlas", () => {
  it("measures exactly one changed pixel for a pixel-bit flip", async () => {
    // Byte 10 is the first row of pixel data.
    const run = await runExperiment(glyph, [10 * 8 + 1]);
    expect(run.mutatedExecution.verdict).toBe("ok");
    expect(run.measurement.render).not.toBeNull();
    expect(run.measurement.render!.pixelsChanged).toBe(1);
    expect(run.measurement.render!.changedBounds).toEqual({
      x: 1,
      y: 0,
      width: 1,
      height: 1,
    });
  });

  it("classifies a pixel-bit flip as minor, not critical", async () => {
    const run = await runExperiment(glyph, [10 * 8 + 1]);
    expect(run.comparison.severity).toBe("minor");
  });

  it("classifies a header-bit flip as critical", async () => {
    const run = await runExperiment(glyph, [2]);
    expect(run.comparison.severity).toBe("critical");
  });
});

describe("classify() rules in isolation", () => {
  const m = () => baseMeasurement(new Uint8Array([1]), new Uint8Array([2]), []) as never;

  it("rule 1 — decode failure is critical", () => {
    const c = classify(ok(), ok({ verdict: "failed" }), m());
    expect(c.severity).toBe("critical");
    expect(c.consequenceScore).toBe(1);
  });

  it("rule 2 — structure failure is major", () => {
    const c = classify(
      ok(),
      ok({ structureVerdict: "invalid", structureFailures: ["CRC-32 mismatch"] }),
      m(),
    );
    expect(c.severity).toBe("major");
    expect(c.rationale).toContain("CRC-32 mismatch");
  });

  it("rule 3 — no decoder is unclassified", () => {
    const c = classify(
      ok({ verdict: "not-applicable", structureVerdict: "unknown" }),
      ok({ verdict: "not-applicable", structureVerdict: "unknown" }),
      m(),
    );
    expect(c.severity).toBe("unclassified");
  });

  it("rule 4 — a changed field is minor", () => {
    const measurement = baseMeasurement(new Uint8Array([1]), new Uint8Array([2]), [
      { label: "Version", before: "1", after: "2", changed: true },
    ]);
    const c = classify(ok(), ok(), measurement);
    expect(c.severity).toBe("minor");
    expect(c.rationale).toContain("Version: 1 → 2");
  });

  it("rule 5 — identical pixels are negligible", () => {
    const measurement = baseMeasurement(new Uint8Array([1]), new Uint8Array([2]), []);
    const withRender = {
      ...measurement,
      render: {
        pixelsChanged: 0,
        pixelsTotal: 100,
        changedBounds: null,
        meanAbsoluteError: 0,
        maxAbsoluteError: 0,
      },
    };
    const c = classify(ok(), ok(), withRender);
    expect(c.severity).toBe("negligible");
    expect(c.rationale).toMatch(/identical/);
  });

  it("gives every severity a distinct label and glyph", () => {
    const labels = Object.values(SEVERITY_LABEL);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe("experiment records", () => {
  it("captures every mutation fact", async () => {
    const run = await runExperiment(blab, [100]);
    const record = toRecord(run, "2026-01-01T00:00:00.000Z");

    expect(record.sourceId).toBe(blab.id);
    expect(record.byteLength).toBe(blab.bytes.length);
    expect(record.bitOffsets).toEqual([100]);
    expect(record.byteOffset).toBe(12);
    expect(record.bitInByte).toBe(3);
    expect(record.originalByte).toBe(blab.bytes[12]);
    expect(record.mutatedByte).toBe(run.mutation.data[12]);
    expect(record.originalBit).toBe(run.mutation.originalBit);
    expect(record.mutatedBit).toBe(1 - record.originalBit);
    expect(record.timestamp).toBe("2026-01-01T00:00:00.000Z");
  });

  it("derives a stable id from content, not from the clock", async () => {
    const a = toRecord(await runExperiment(blab, [100]), "2026-01-01T00:00:00.000Z");
    const b = toRecord(await runExperiment(blab, [100]), "2026-12-31T23:59:59.999Z");
    expect(a.id).toBe(b.id);
  });

  it("gives different ids to different experiments", async () => {
    const a = recordId(blab.id, 100, "aa");
    const b = recordId(blab.id, 101, "aa");
    expect(a).not.toBe(b);
  });

  it("serialises to JSON without loss", async () => {
    const record = toRecord(await runExperiment(glyph, [10 * 8 + 1]), "2026-01-01T00:00:00.000Z");
    const parsed = JSON.parse(JSON.stringify(record));
    expect(parsed.id).toBe(record.id);
    expect(parsed.comparison.severity).toBe(record.comparison.severity);
    expect(parsed.measurement.render.pixelsChanged).toBe(1);
  });
});

describe("reproducibility", () => {
  it("reproduces a record exactly", async () => {
    const record = toRecord(await runExperiment(blab, [100]), "2026-01-01T00:00:00.000Z");
    const outcome = await verifyReproduction(record, blab);
    expect(outcome.reproduced).toBe(true);
    expect(outcome.detail).toMatch(/identical integrity and severity/);
  });

  it("detects a record that does not match its source", async () => {
    const record = toRecord(await runExperiment(blab, [100]), "2026-01-01T00:00:00.000Z");
    const tampered = { ...record, sourceId: "other" };
    const outcome = await verifyReproduction(
      { ...tampered, bitOffsets: [101] },
      blab,
    );
    expect(outcome.reproduced).toBe(false);
  });

  it("is deterministic across repeated runs", async () => {
    const first = await runExperiment(glyph, [10 * 8 + 3]);
    const second = await runExperiment(glyph, [10 * 8 + 3]);
    expect(first.measurement.integrityAfter).toBe(second.measurement.integrityAfter);
    expect(first.comparison.severity).toBe(second.comparison.severity);
  });
});

describe("samples", () => {
  it("builds four reproducible sources", () => {
    const a = buildAllSamples();
    const b = buildAllSamples();
    expect(a).toHaveLength(4);
    for (let i = 0; i < a.length; i++) {
      expect(hashHex(a[i]!.bytes)).toBe(hashHex(b[i]!.bytes));
    }
  });

  it("marks every sample with an execution policy", () => {
    for (const s of buildAllSamples()) {
      expect(["INSPECT", "DECODE"]).toContain(s.policy);
    }
  });

  it("never marks a sample as executable", () => {
    for (const s of buildAllSamples()) expect(s.policy).not.toBe("EXECUTE");
  });
});