/**
 * Butterfly mode — a bounded systematic sweep.
 *
 * Instead of choosing one bit by hand, the sweep walks a bounded set of bit
 * positions, applies the identical single-bit mutation to each, and records
 * the *measured* consequence. The sensitivity map is a direct plot of those
 * measurements. Nothing in the map is modelled, extrapolated, or weighted by
 * hand.
 *
 * Bounded by construction: the caller supplies the bit positions. The sweep
 * refuses to run without a budget, and reports what it did not cover.
 */

import { resolveAdapter } from "./adapters";
import { runExperiment } from "./experiment";
import type { DataSource, Severity } from "./pipeline";

export const BUTTERFLY_BUDGETS = [1, 2, 4, 8, 16, 32, 64, 128] as const;
export type ButterflyBudget = (typeof BUTTERFLY_BUDGETS)[number];

export interface ButterflyCell {
  readonly bitOffset: number;
  readonly severity: Severity;
  readonly consequenceScore: number;
  readonly bytesChanged: number;
  readonly pixelsChanged: number | null;
  readonly decodeFailed: boolean;
  readonly rationale: string;
}

export interface ButterflyResult {
  readonly sourceId: string;
  readonly requested: number;
  /** The bit positions actually tested — evenly spaced across the buffer. */
  readonly bitOffsets: readonly number[];
  readonly cells: readonly ButterflyCell[];
  readonly counts: Readonly<Record<Severity, number>>;
  readonly elapsedMs: number;
  /** Bits in the buffer that this sweep did not test. */
  readonly coverage: {
    readonly testedBits: number;
    readonly totalBits: number;
    readonly fraction: number;
  };
  readonly cancelled: boolean;
}

export interface SweepProgress {
  readonly completed: number;
  readonly total: number;
  readonly bitOffset: number;
}

/**
 * Choose `budget` bit positions spread evenly across the buffer.
 * Always includes bit 0 and the final bit, because the ends of a buffer are
 * where length and terminator fields usually live.
 */
export function sampleBitOffsets(totalBits: number, budget: number): number[] {
  if (totalBits <= 0 || budget <= 0) return [];
  const n = Math.min(budget, totalBits);
  if (n === totalBits) return Array.from({ length: totalBits }, (_, i) => i);

  const offsets = new Set<number>();
  for (let i = 0; i < n; i++) {
    offsets.add(Math.min(totalBits - 1, Math.floor((i * (totalBits - 1)) / (n - 1 || 1))));
  }
  // Round out to exactly n distinct positions when collisions occurred.
  for (let i = 0; offsets.size < n && i < totalBits; i++) offsets.add(i);
  return [...offsets].sort((a, b) => a - b);
}

export async function runButterfly(
  source: DataSource,
  budget: ButterflyBudget,
  onProgress?: (p: SweepProgress) => void,
  shouldCancel?: () => boolean,
): Promise<ButterflyResult> {
  const startedAt = Date.now();
  const adapter = resolveAdapter(source);
  const totalBits = source.bytes.length * 8;
  const bitOffsets = sampleBitOffsets(totalBits, budget);

  const counts: Record<Severity, number> = {
    critical: 0,
    major: 0,
    minor: 0,
    negligible: 0,
    unclassified: 0,
  };
  const cells: ButterflyCell[] = [];
  let cancelled = false;

  for (let i = 0; i < bitOffsets.length; i++) {
    if (shouldCancel?.()) {
      cancelled = true;
      break;
    }
    const bitOffset = bitOffsets[i]!;
    // runExperiment is used rather than re-deriving the mutation here, so a
    // swept cell and a manual experiment are provably the same operation.
    const run = await runExperiment(source, [bitOffset], { adapter });
    const { measurement, mutatedExecution, comparison } = run;
    counts[comparison.severity]++;
    cells.push({
      bitOffset,
      severity: comparison.severity,
      consequenceScore: comparison.consequenceScore,
      bytesChanged: measurement.bytesChanged,
      pixelsChanged: measurement.render ? measurement.render.pixelsChanged : null,
      decodeFailed: mutatedExecution.verdict === "failed",
      rationale: comparison.rationale,
    });
    onProgress?.({ completed: i + 1, total: bitOffsets.length, bitOffset });
  }

  return {
    sourceId: source.id,
    requested: budget,
    bitOffsets,
    cells,
    counts,
    elapsedMs: Date.now() - startedAt,
    coverage: {
      testedBits: cells.length,
      totalBits,
      fraction: totalBits === 0 ? 0 : cells.length / totalBits,
    },
    cancelled,
  };
}
