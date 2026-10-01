/**
 * Lab provider.
 *
 * Owns the analysis layer and every asynchronous action. Components call
 * `actions`; the provider owns the sequencing, so no component has to
 * coordinate a measurement itself.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  describeError,
  initialState,
  LabStateContext,
  loadSample,
  reducer,
  type LabState,
} from "./labState";
import { createAnalysisLayer, type ResilientAnalysis } from "../engine/labEngine";
import type { ButterflyBudget } from "../core/butterfly";

export interface LabActions {
  setView(view: LabState["view"]): void;
  loadSample(id: string): Promise<void>;
  loadSource(source: NonNullable<LabState["source"]>): void;
  reportSourceError(error: LabState["error"]): void;
  selectBit(bitOffset: number): Promise<void>;
  reset(): void;
  setCompareMode(mode: LabState["compareMode"]): void;
  clearRecords(): void;
  runButterfly(budget: ButterflyBudget): Promise<void>;
  setButterflyBudget(budget: ButterflyBudget): void;
  resetButterfly(): void;
}

export const LabActionsContext = createContext<LabActions | null>(null);

export function useLabActions(): LabActions {
  const actions = useContext(LabActionsContext);
  if (!actions) throw new Error("useLabActions must be used inside <LabProvider>");
  return actions;
}

/** Re-exported so the UI imports state and actions from one module. */
export { useLabState, LabStateContext } from "./labState";

export function LabProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [offMainThread, setOffMainThread] = useState(true);

  // The analysis layer is created once and never re-created, so a re-render
  // cannot silently move work back onto the main thread.
  const layerRef = useRef<ResilientAnalysis | null>(null);
  if (layerRef.current === null) layerRef.current = createAnalysisLayer();

  /** Monotonic token: only the newest measurement may write to state. */
  const latestRequest = useRef(0);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const layer = layerRef.current;
    setOffMainThread(layer?.offMainThread ?? false);
    return () => layer?.dispose();
  }, []);

  const setView = useCallback((view: LabState["view"]) => {
    dispatch({ type: "view/set", view });
  }, []);

  const loadSampleById = useCallback(async (id: string) => {
    const sample = loadSample(id);
    if (!sample) return;
    dispatch({ type: "source/loading" });
    // Yield a frame so the loading state paints before the first measurement.
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    dispatch({ type: "source/loaded", source: sample });
  }, []);

  const loadSource = useCallback((source: NonNullable<LabState["source"]>) => {
    dispatch({ type: "source/loaded", source });
  }, []);

  const reportSourceError = useCallback((error: NonNullable<LabState["error"]>) => {
    dispatch({ type: "source/failed", error });
  }, []);

  const selectBit = useCallback(async (bitOffset: number) => {
    const source = stateRef.current.source;
    if (!source) return;

    const token = ++latestRequest.current;
    dispatch({ type: "run/measuring", bitOffset });

    try {
      const layer = layerRef.current;
      if (!layer) throw new Error("The analysis layer is unavailable.");
      const run = await layer.analyse(source, [bitOffset]);
      if (token !== latestRequest.current) return;
      setOffMainThread(layer.offMainThread);
      dispatch({ type: "run/measured", run });
    } catch (error) {
      if (token !== latestRequest.current) return;
      dispatch({ type: "run/failed", error: describeError(error), bitOffset });
    }
  }, []);

  const reset = useCallback(() => {
    latestRequest.current++;
    dispatch({ type: "run/reset" });
  }, []);

  const setCompareMode = useCallback((mode: LabState["compareMode"]) => {
    dispatch({ type: "compare/mode", mode });
  }, []);

  const clearRecords = useCallback(() => dispatch({ type: "record/clear" }), []);

  const runButterfly = useCallback(async (budget: ButterflyBudget) => {
    const source = stateRef.current.source;
    if (!source) return;
    const total = Math.min(budget, source.bytes.length * 8);
    dispatch({ type: "butterfly/running", total });
    try {
      const layer = layerRef.current;
      if (!layer) throw new Error("The analysis layer is unavailable.");
      const result = await layer.butterfly(source, budget, (progress) =>
        dispatch({ type: "butterfly/progress", completed: progress.completed }),
      );
      dispatch({ type: "butterfly/done", result });
    } catch (error) {
      dispatch({ type: "butterfly/failed", error: describeError(error) });
    }
  }, []);

  const resetButterfly = useCallback(() => dispatch({ type: "butterfly/reset" }), []);

  const setButterflyBudget = useCallback((budget: ButterflyBudget) => {
    dispatch({ type: "butterfly/budget", budget });
  }, []);

  const actions = useMemo<LabActions>(
    () => ({
      setView,
      loadSample: loadSampleById,
      loadSource,
      reportSourceError,
      selectBit,
      reset,
      setCompareMode,
      clearRecords,
      runButterfly,
      setButterflyBudget,
      resetButterfly,
    }),
    [
      setView,
      loadSampleById,
      loadSource,
      reportSourceError,
      selectBit,
      reset,
      setCompareMode,
      clearRecords,
      runButterfly,
      setButterflyBudget,
      resetButterfly,
    ],
  );

  const value = useMemo<LabState>(() => ({ ...state, offMainThread }), [state, offMainThread]);

  return (
    <LabStateContext.Provider value={value}>
      <LabActionsContext.Provider value={actions}>{children}</LabActionsContext.Provider>
    </LabStateContext.Provider>
  );
}