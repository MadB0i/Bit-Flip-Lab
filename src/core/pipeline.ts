/**
 * The experiment pipeline.
 *
 * Every experiment traverses the same eight stages:
 *
 *   SOURCE → INSPECTOR → BIT SELECTOR → MUTATION ENGINE
 *          → EXECUTOR → MEASUREMENT → COMPARISON → EXPERIMENT RECORD
 *
 * The types below are the contract for that traversal. They are deliberately
 * adapter-agnostic so that a new source format (a model weight file, a
 * columnar dataset) only has to supply a SourceAdapter — not rewrite the
 * application. See `core/adapters.ts`.
 */

import type { GlyphAtlas } from "./bitmap";
import type { FlipResult } from "./mutate";
import type { RgbaImage } from "./pixels";

/* ── 1. SOURCE ──────────────────────────────────────────────────────────── */

export type SourceKind = "structured" | "image" | "bitmap" | "raw";

/** How a source is permitted to be treated. This gate is not advisory. */
export type ExecutionPolicy = "INSPECT" | "DECODE";

export interface DataSource {
  readonly id: string;
  readonly name: string;
  readonly kind: SourceKind;
  readonly bytes: Uint8Array;
  readonly mediaType: string;
  /** One line describing what this sample is designed to demonstrate. */
  readonly synopsis: string;
  /** Whether user-uploaded content of this type may be decoded, never run. */
  readonly policy: ExecutionPolicy;
}

/* ── 2. INSPECTOR ───────────────────────────────────────────────────────── */

export interface Inspection {
  /** Human-readable structural facts, each one an observation not an inference. */
  readonly facts: readonly InspectionFact[];
  /** Region map: named byte ranges with a meaning. Drives the structure map. */
  readonly regions: readonly StructureRegion[];
}

export interface InspectionFact {
  readonly label: string;
  readonly value: string;
}

export interface StructureRegion {
  readonly name: string;
  readonly startByte: number;
  readonly lengthBytes: number;
  readonly role: RegionRole;
}

export type RegionRole =
  | "magic"
  | "structure"
  | "length"
  | "payload"
  | "integrity"
  | "pixels"
  | "opaque";

/* ── 3. BIT SELECTOR ────────────────────────────────────────────────────── */

/* ── 4. MUTATION ENGINE ─────────────────────────────────────────────────── */

/** The output of the pure mutation stage. */
export type Mutation = FlipResult;

/* ── 5. EXECUTOR / DECODER ──────────────────────────────────────────────── */

export type DecodeVerdict = "ok" | "failed" | "not-applicable";

export interface RenderResult {
  /** Decoded pixels. Present whenever a renderer exists for the format. */
  readonly image: RgbaImage;
  /** Format-specific render parameters (the 1bpp atlas header), when applicable. */
  readonly atlas: GlyphAtlas | null;
}

export interface Execution {
  readonly verdict: DecodeVerdict;
  /** Structure validation result, when the adapter can actually validate it. */
  readonly structureVerdict: "valid" | "invalid" | "unknown";
  /** Which parts of the structure failed validation. Empty when valid. */
  readonly structureFailures: readonly string[];
  readonly message: string;
  /** Adapter-produced rendering of the decoded result, when meaningful. */
  readonly render: RenderResult | null;
  /**
   * True when the executor would have run attacker-controlled code to obtain
   * this result. BIT FLIP LAB never sets this to true; it exists so the
   * refusal is recorded rather than merely implied by absence.
   */
  readonly requiredCodeExecution: boolean;
}

/* ── 6. MEASUREMENT ─────────────────────────────────────────────────────── */

export interface RenderMeasurement {
  /** Pixels whose colour differs between original and mutated render. */
  readonly pixelsChanged: number;
  readonly pixelsTotal: number;
  /** Inclusive pixel bounds of the changed region, or null when nothing changed. */
  readonly changedBounds: PixelBounds | null;
  /** Mean absolute per-channel difference across the whole image, 0–255. */
  readonly meanAbsoluteError: number;
  /** Largest per-channel difference observed, 0–255. */
  readonly maxAbsoluteError: number;
}

export interface PixelBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface SemanticMeasurement {
  readonly label: string;
  readonly before: string;
  readonly after: string;
  /** True when the field's decoded value actually changed. */
  readonly changed: boolean;
}

export interface Measurement {
  readonly bytesChanged: number;
  readonly changedByteOffsets: readonly number[];
  readonly bitCountDelta: number;
  readonly integrityBefore: string;
  readonly integrityAfter: string;
  readonly render: RenderMeasurement | null;
  readonly semantics: readonly SemanticMeasurement[];
}

/* ── 7. COMPARISON ──────────────────────────────────────────────────────── */

/**
 * Severity is derived from measured facts, never asserted.
 *
 *   critical    the mutated artifact can no longer be decoded or validated
 *   major       it still decodes, but a structural integrity check fails
 *   minor       structure valid, at least one decoded field value changed
 *   negligible  structure valid, no decoded field changed, raw bytes differ
 *   unclassified  no adapter claims this format, so nothing can be validated
 */
export type Severity = "critical" | "major" | "minor" | "negligible" | "unclassified";

export interface Comparison {
  readonly severity: Severity;
  /** The rule that produced this severity, stated explicitly. */
  readonly rationale: string;
  /** 0–1 normalized consequence score used for the sensitivity map. */
  readonly consequenceScore: number;
}

/* ── 8. EXPERIMENT RECORD ───────────────────────────────────────────────── */

export interface ExperimentRecord {
  readonly id: string;
  readonly sourceId: string;
  readonly sourceName: string;
  readonly sourceKind: SourceKind;
  readonly byteLength: number;
  readonly bitOffsets: readonly number[];
  readonly byteOffset: number;
  readonly bitInByte: number;
  readonly originalByte: number;
  readonly mutatedByte: number;
  readonly originalBit: 0 | 1;
  readonly mutatedBit: 0 | 1;
  readonly integrityBefore: string;
  readonly integrityAfter: string;
  readonly measurement: Measurement;
  readonly comparison: Comparison;
  /** ISO-8601. Assigned when the record is committed, not during mutation. */
  readonly timestamp: string;
}

/* ── Adapter contract ───────────────────────────────────────────────────── */

export interface SourceAdapter {
  readonly kind: SourceKind;
  readonly label: string;
  /** Does this adapter claim the buffer? Must be conservative — never guess. */
  matches(source: DataSource): boolean;
  inspect(source: DataSource): Inspection;
  /**
   * Decode or validate the buffer. Never executes content. Implementations
   * must be pure functions of their input bytes.
   *
   * Asynchronous because image decoding is (`createImageBitmap`); adapters
   * with no browser dependency resolve immediately.
   */
  execute(source: DataSource, bytes: Uint8Array): Promise<Execution>;
  measure(
    source: DataSource,
    originalBytes: Uint8Array,
    mutatedBytes: Uint8Array,
    originalExecution: Execution,
    mutatedExecution: Execution,
  ): Measurement;
}

/* ── Full pipeline result ───────────────────────────────────────────────── */

export interface ExperimentRun {
  readonly source: DataSource;
  readonly mutation: Mutation;
  readonly originalExecution: Execution;
  readonly mutatedExecution: Execution;
  readonly measurement: Measurement;
  readonly comparison: Comparison;
}