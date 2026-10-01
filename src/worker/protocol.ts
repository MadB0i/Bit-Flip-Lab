/**
 * Worker protocol.
 *
 * The analysis layer runs in a worker so that decoding, hashing and butterfly
 * sweeps never block the main thread. Every message is structured-cloneable —
 * typed arrays travel by copy, which is deliberate: the main thread still
 * needs the original buffer to render the inspector.
 */

import type { ExperimentRun } from "../core/pipeline";
import type { ButterflyBudget, ButterflyResult, SweepProgress } from "../core/butterfly";
import type { DataSource } from "../core/pipeline";

export interface AnalyseRequest {
  readonly id: number;
  readonly kind: "analyse";
  readonly source: DataSource;
  readonly bitOffsets: readonly number[];
}

export interface ButterflyRequest {
  readonly id: number;
  readonly kind: "butterfly";
  readonly source: DataSource;
  readonly budget: ButterflyBudget;
}

export type WorkerRequest = AnalyseRequest | ButterflyRequest;

export type WorkerResponse =
  | { readonly id: number; readonly kind: "result"; readonly run: ExperimentRun }
  | { readonly id: number; readonly kind: "butterfly-progress"; readonly progress: SweepProgress }
  | { readonly id: number; readonly kind: "butterfly-result"; readonly result: ButterflyResult }
  | { readonly id: number; readonly kind: "error"; readonly message: string; readonly code: string };