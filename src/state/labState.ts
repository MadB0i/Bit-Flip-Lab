/**
 * Lab state.
 *
 * A reducer plus one async action creator. All state transitions are
 * explicit so that every panel's state — including the empty, loading, error
 * and unsupported cases — is reachable and testable rather than incidental.
 */

import { createContext, useContext } from "react";
import { MutationError } from "../core/mutate";
import { toRecord } from "../core/experiment";
import { sampleById } from "../core/samples";
import type { ButterflyBudget, ButterflyResult } from "../core/butterfly";
import type { DataSource, ExperimentRecord, ExperimentRun } from "../core/pipeline";
import { createAnalysisLayer, type ResilientAnalysis } from "../engine/labEngine";

export type View = "lab" | "butterfly" | "experiments" | "about";
export type CompareMode = "original" | "mutated" | "difference";

export interface LabError {
  readonly title: string;
  readonly detail: string;
  /** A concrete next step, or null when the user cannot act. */
  readonly recovery: string | null;
  readonly code: string;
}

export interface ButterflyState {
  readonly status: "idle" | "running" | "ready" | "error";
  readonly budget: ButterflyBudget;
  readonly result: ButterflyResult | null;
  readonly completed: number;
  readonly total: number;
  readonly error: LabError | null;
}

export interface LabState {
  readonly view: View;
  readonly source: DataSource | null;
  readonly sourceStatus: "empty" | "loading" | "ready" | "error";
  readonly selectedBit: number | null;
  readonly run: ExperimentRun | null;
  readonly runStatus: "idle" | "measuring" | "ready" | "error";
  readonly error: LabError | null;
  readonly records: readonly ExperimentRecord[];
  readonly compareMode: CompareMode;
  readonly butterfly: ButterflyState;
  readonly announcement: string;
  readonly offMainThread: boolean;
}

export const initialState: LabState = {
  view: "lab",
  source: null,
  sourceStatus: "empty",
  selectedBit: null,
  run: null,
  runStatus: "idle",
  error: null,
  records: [],
  compareMode: "original",
  butterfly: {
    status: "idle",
    budget: 16,
    result: null,
    completed: 0,
    total: 0,
    error: null,
  },
  announcement: "",
  offMainThread: true,
};

export type Action =
  | { type: "view/set"; view: View }
  | { type: "source/loading" }
  | { type: "source/loaded"; source: DataSource }
  | { type: "source/failed"; error: LabError }
  | { type: "select/bit"; bitOffset: number }
  | { type: "run/measuring"; bitOffset: number }
  | { type: "run/measured"; run: ExperimentRun }
  | { type: "run/failed"; error: LabError; bitOffset: number | null }
  | { type: "run/reset" }
  | { type: "compare/mode"; mode: CompareMode }
  | { type: "record/commit"; record: ExperimentRecord }
  | { type: "record/clear" }
  | { type: "announce"; message: string }
  | { type: "butterfly/budget"; budget: ButterflyBudget }
  | { type: "butterfly/running"; total: number }
  | { type: "butterfly/progress"; completed: number }
  | { type: "butterfly/done"; result: ButterflyResult }
  | { type: "butterfly/failed"; error: LabError }
  | { type: "butterfly/reset" };

/** Description of the mutation just performed, used for the live region. */
export function describeRun(run: ExperimentRun): string {
  const m = run.mutation;
  const changed = run.measurement.bytesChanged;
  return (
    `Bit ${m.bitOffset} flipped from ${m.originalBit} to ${m.mutatedBit} at byte ${m.byteIndex}. ` +
    `${changed} byte${changed === 1 ? "" : "s"} differ. ` +
    `Severity ${run.comparison.severity}.`
  );
}

export function reducer(state: LabState, action: Action): LabState {
  switch (action.type) {
    case "view/set":
      return { ...state, view: action.view };

    case "source/loading":
      return {
        ...state,
        sourceStatus: "loading",
        source: null,
        selectedBit: null,
        run: null,
        runStatus: "idle",
        error: null,
        butterfly: { ...initialState.butterfly, budget: state.butterfly.budget },
        announcement: "Reading the source.",
      };

    case "source/loaded":
      return {
        ...state,
        source: action.source,
        sourceStatus: "ready",
        selectedBit: null,
        run: null,
        runStatus: "idle",
        error: null,
        butterfly: { ...initialState.butterfly, budget: state.butterfly.budget },
        announcement: `${action.source.name} loaded. ${action.source.bytes.length} bytes. Select a bit in the inspector.`,
      };

    case "source/failed":
      return {
        ...state,
        sourceStatus: "error",
        error: action.error,
        run: null,
        runStatus: "error",
        announcement: `${action.error.title}. ${action.error.detail}`,
      };

    case "select/bit":
      return { ...state, selectedBit: action.bitOffset };

    case "run/measuring":
      return { ...state, selectedBit: action.bitOffset, runStatus: "measuring", error: null };

    case "run/measured": {
      const next = commitRecord(state, action.run, new Date());
      return {
        ...state,
        run: action.run,
        runStatus: "ready",
        selectedBit: action.run.mutation.bitOffset,
        records: next.records,
        compareMode: state.run === null ? "difference" : state.compareMode,
        announcement: describeRun(action.run),
      };
    }

    case "run/failed":
      return {
        ...state,
        runStatus: "error",
        run: null,
        selectedBit: action.bitOffset,
        error: action.error,
        announcement: `${action.error.title}. ${action.error.detail}`,
      };

    case "run/reset":
      return {
        ...state,
        run: null,
        runStatus: "idle",
        selectedBit: null,
        error: null,
        compareMode: "original",
        announcement: "Experiment reset. The original bytes are unchanged.",
      };

    case "compare/mode":
      return { ...state, compareMode: action.mode };

    case "record/commit":
      return { ...state, records: [action.record, ...state.records].slice(0, 200) };

    case "record/clear":
      return { ...state, records: [], announcement: "Experiment log cleared." };

    case "announce":
      return { ...state, announcement: action.message };

    case "butterfly/budget":
      return { ...state, butterfly: { ...state.butterfly, budget: action.budget } };

    case "butterfly/running":
      return {
        ...state,
        butterfly: {
          ...state.butterfly,
          status: "running",
          result: null,
          completed: 0,
          total: action.total,
          error: null,
        },
        announcement: `Sweeping ${action.total} bit positions.`,
      };

    case "butterfly/progress":
      return { ...state, butterfly: { ...state.butterfly, completed: action.completed } };

    case "butterfly/done":
      return {
        ...state,
        butterfly: {
          ...state.butterfly,
          status: "ready",
          result: action.result,
          completed: action.result.cells.length,
          total: action.result.bitOffsets.length,
        },
        announcement: `Sweep complete. ${action.result.cells.length} bit positions measured in ${action.result.elapsedMs} milliseconds.`,
      };

    case "butterfly/failed":
      return {
        ...state,
        butterfly: { ...state.butterfly, status: "error", error: action.error, result: null },
        announcement: `${action.error.title}. ${action.error.detail}`,
      };

    case "butterfly/reset":
      return {
        ...state,
        butterfly: { ...initialState.butterfly, budget: state.butterfly.budget },
      };

    default: {
      const exhaustive: never = action;
      return exhaustive;
    }
  }
}

export const LabStateContext = createContext<LabState>(initialState);

export function useLabState(): LabState {
  return useContext(LabStateContext);
}

/** Turn any thrown value into a reportable error with a stated recovery. */
export function describeError(error: unknown): LabError {
  if (error instanceof MutationError) {
    switch (error.code) {
      case "EMPTY_INPUT":
        return {
          title: "There are no bits to flip",
          detail: "This source contains zero bytes, so it has no addressable bit positions.",
          recovery: "Choose a sample that contains data, or load a file.",
          code: error.code,
        };
      case "OUT_OF_RANGE":
        return {
          title: "That bit is outside this source",
          detail: error.message,
          recovery: "Select a bit inside the inspector, or reset to clear the selection.",
          code: error.code,
        };
      case "DUPLICATE_BIT":
        return {
          title: "A bit was listed twice",
          detail: error.message,
          recovery: "Each bit may only be flipped once per mutation.",
          code: error.code,
        };
      default:
        return {
          title: "The mutation could not be applied",
          detail: error.message,
          recovery: "Reset and select a different bit.",
          code: error.code,
        };
    }
  }
  return {
    title: "Measurement could not be completed",
    detail: error instanceof Error ? error.message : String(error),
    recovery: "Reset the experiment and try the same bit again.",
    code: "UNKNOWN",
  };
}

export function loadSample(id: string): DataSource | null {
  return sampleById(id) ?? null;
}

export function commitRecord(state: LabState, run: ExperimentRun, now: Date): LabState {
  const record = toRecord(run, now.toISOString());
  const existing = state.records.findIndex((r) => r.id === record.id);
  if (existing >= 0) {
    const records = [...state.records];
    records[existing] = record;
    return { ...state, records };
  }
  return { ...state, records: [record, ...state.records].slice(0, 200) };
}

export { createAnalysisLayer };
export type { ResilientAnalysis };