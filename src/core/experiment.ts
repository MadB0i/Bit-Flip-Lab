/**
 * Experiment execution and records.
 *
 * `runExperiment` is the whole pipeline in one pure-ish call: mutate, decode
 * both buffers, measure, compare. Nothing here touches React or the DOM, so
 * the exact function the UI calls is the exact function the tests assert on.
 */

import { resolveAdapter, withRenderComparison } from "./adapters";
import { classify } from "./classify";
import { flipBit, flipBits, MutationError, type FlipResultSet } from "./mutate";
import { sha256 } from "./sha256";
import type {
  DataSource,
  ExperimentRecord,
  ExperimentRun,
  Measurement,
  SourceAdapter,
} from "./pipeline";

export interface ExperimentOptions {
  /** Override adapter resolution. Used by the butterfly sweep. */
  readonly adapter?: SourceAdapter;
}

export async function runExperiment(
  source: DataSource,
  bitOffsets: readonly number[],
  options: ExperimentOptions = {},
): Promise<ExperimentRun> {
  const adapter = options.adapter ?? resolveAdapter(source);

  let mutation: FlipResultSet;
  if (bitOffsets.length === 0) {
    throw new MutationError("INVALID_BIT", "At least one bit must be selected.");
  }
  if (bitOffsets.length === 1) {
    const single = flipBit(source.bytes, bitOffsets[0]!);
    mutation = { data: single.data, changes: [single] };
  } else {
    mutation = flipBits(source.bytes, bitOffsets);
  }

  const [originalExecution, mutatedExecution] = await Promise.all([
    adapter.execute(source, source.bytes),
    adapter.execute(source, mutation.data),
  ]);

  let measurement: Measurement = adapter.measure(
    source,
    source.bytes,
    mutation.data,
    originalExecution,
    mutatedExecution,
  );
  measurement = withRenderComparison(measurement, originalExecution, mutatedExecution);

  const comparison = classify(originalExecution, mutatedExecution, measurement);

  return {
    source,
    mutation: mutation.changes[0]!,
    originalExecution,
    mutatedExecution,
    measurement,
    comparison,
  };
}

/**
 * Convert a run into a reproducible record.
 *
 * The id is derived from the content — source id, bit offsets and both
 * integrity hashes — so the same experiment always produces the same id.
 * That makes an experiment independently verifiable rather than merely logged.
 */
export function toRecord(run: ExperimentRun, timestamp: string): ExperimentRecord {
  const first = run.mutation;
  const id = recordId(run.source.id, run.mutation.bitOffset, run.measurement.integrityAfter);
  return {
    id,
    sourceId: run.source.id,
    sourceName: run.source.name,
    sourceKind: run.source.kind,
    byteLength: run.source.bytes.length,
    bitOffsets: [first.bitOffset],
    byteOffset: first.byteIndex,
    bitInByte: first.bitInByte,
    originalByte: first.originalByte,
    mutatedByte: first.mutatedByte,
    originalBit: first.originalBit,
    mutatedBit: first.mutatedBit,
    integrityBefore: run.measurement.integrityBefore,
    integrityAfter: run.measurement.integrityAfter,
    measurement: run.measurement,
    comparison: run.comparison,
    timestamp,
  };
}

/** Deterministic 16-hex-digit identifier, derived from SHA-256 of the content. */
export function fingerprint(parts: readonly string[]): string {
  const bytes = new TextEncoder().encode(parts.join("\0"));
  return sha256(bytes).hex.slice(0, 16).toUpperCase();
}

export function recordId(sourceId: string, bitOffset: number, integrityAfter: string): string {
  return `EXP-${fingerprint([sourceId, String(bitOffset), integrityAfter])}`;
}

/** Serialise a record as the JSON document offered for export. */
export function recordToJson(record: ExperimentRecord): string {
  return JSON.stringify(record, null, 2);
}

/** Reproduce a record from its own metadata — used by the verify control. */
export interface ReproductionOutcome {
  readonly reproduced: boolean;
  readonly detail: string;
}

export async function verifyReproduction(
  record: ExperimentRecord,
  source: DataSource,
): Promise<ReproductionOutcome> {
  const run = await runExperiment(source, record.bitOffsets);
  const actual = run.measurement.integrityAfter;
  if (actual !== record.integrityAfter) {
    return {
      reproduced: false,
      detail: `Re-running bit ${record.bitOffsets.join(", ")} produced integrity ${actual}, but the record states ${record.integrityAfter}.`,
    };
  }
  if (run.measurement.integrityBefore !== record.integrityBefore) {
    return {
      reproduced: false,
      detail: `Source integrity is ${run.measurement.integrityBefore}; the record states ${record.integrityBefore}. The source itself has changed.`,
    };
  }
  if (run.comparison.severity !== record.comparison.severity) {
    return {
      reproduced: false,
      detail: `Integrity matches but severity is now ${run.comparison.severity}; the record states ${record.comparison.severity}.`,
    };
  }
  return {
    reproduced: true,
    detail: `Bit ${record.bitOffsets.join(", ")} re-ran to identical integrity and severity (${run.comparison.severity}).`,
  };
}