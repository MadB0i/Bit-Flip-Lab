/**
 * The analysis layer.
 *
 * One interface, two implementations: a worker and a direct main-thread call.
 * Both run the identical engine, so the fallback cannot change a result — only
 * where it was computed. The fallback exists because a worker is an
 * optimisation, and an optimisation must never be a dependency.
 */

import { runExperiment } from "../core/experiment";
import {
  runButterfly,
  type ButterflyBudget,
  type ButterflyResult,
  type SweepProgress,
} from "../core/butterfly";
import type { DataSource, ExperimentRun } from "../core/pipeline";
import type { WorkerRequest, WorkerResponse } from "../worker/protocol";

export interface AnalysisLayer {
  analyse(source: DataSource, bitOffsets: readonly number[]): Promise<ExperimentRun>;
  butterfly(
    source: DataSource,
    budget: ButterflyBudget,
    onProgress?: (progress: SweepProgress) => void,
  ): Promise<ButterflyResult>;
  /** True when analysis runs off the main thread. */
  readonly offMainThread: boolean;
  dispose(): void;
}

/* ── Direct (main-thread) execution ─────────────────────────────────────── */

const direct: AnalysisLayer = {
  offMainThread: false,
  analyse: (source, bitOffsets) => runExperiment(source, bitOffsets),
  butterfly: (source, budget, onProgress) => runButterfly(source, budget, onProgress),
  dispose() {},
};

/* ── Worker execution ───────────────────────────────────────────────────── */

/** A worker request body, before its correlation id is attached. */
type RequestBody = { analyse: AnalyseBody; butterfly: ButterflyBody };

interface AnalyseBody {
  kind: "analyse";
  source: DataSource;
  bitOffsets: readonly number[];
}

interface ButterflyBody {
  kind: "butterfly";
  source: DataSource;
  budget: ButterflyBudget;
}

interface Pending {
  resolve: (response: WorkerResponse) => void;
  reject: (error: Error) => void;
  onProgress?: (progress: SweepProgress) => void;
}

class WorkerAnalysisLayer implements AnalysisLayer {
  readonly offMainThread = true;

  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  /** Set when the worker fails at runtime; the store then uses direct execution. */
  private failed = false;

  constructor(private readonly worker: Worker) {
    worker.addEventListener("message", this.onMessage);
    worker.addEventListener("error", this.onFail);
    worker.addEventListener("messageerror", this.onFail);
  }

  static create(): WorkerAnalysisLayer | null {
    if (typeof Worker === "undefined") return null;
    try {
      const worker = new Worker(new URL("../worker/analysis.worker.ts", import.meta.url), {
        type: "module",
        name: "bit-flip-lab-analysis",
      });
      return new WorkerAnalysisLayer(worker);
    } catch {
      return null;
    }
  }

  get available(): boolean {
    return !this.failed;
  }

  private onMessage = (event: MessageEvent<WorkerResponse>) => {
    const message = event.data;
    const entry = this.pending.get(message.id);
    if (!entry) return;

    if (message.kind === "butterfly-progress") {
      entry.onProgress?.(message.progress);
      return;
    }

    this.pending.delete(message.id);
    if (message.kind === "error") {
      entry.reject(new AnalysisFailure(message.message, message.code));
      return;
    }
    entry.resolve(message);
  };

  private onFail = () => {
    this.failed = true;
    for (const [, entry] of this.pending) {
      entry.reject(new AnalysisFailure("The analysis worker stopped unexpectedly.", "WORKER_FAILED"));
    }
    this.pending.clear();
  };

  private request(
    body: RequestBody["analyse"] | RequestBody["butterfly"],
    onProgress?: (progress: SweepProgress) => void,
  ): Promise<WorkerResponse> {
    if (this.failed) return Promise.reject(new AnalysisFailure("Analysis worker unavailable.", "WORKER_FAILED"));
    const id = this.nextId++;
    return new Promise<WorkerResponse>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress });
      this.worker.postMessage({ ...body, id } as WorkerRequest);
    });
  }

  async analyse(source: DataSource, bitOffsets: readonly number[]): Promise<ExperimentRun> {
    const response = await this.request({ kind: "analyse", source, bitOffsets });
    return (response as Extract<WorkerResponse, { kind: "result" }>).run;
  }

  async butterfly(
    source: DataSource,
    budget: ButterflyBudget,
    onProgress?: (progress: SweepProgress) => void,
  ): Promise<ButterflyResult> {
    const response = await this.request({ kind: "butterfly", source, budget }, onProgress);
    return (response as Extract<WorkerResponse, { kind: "butterfly-result" }>).result;
  }

  dispose(): void {
    for (const [, entry] of this.pending) {
      entry.reject(new AnalysisFailure("Lab closed.", "WORKER_FAILED"));
    }
    this.pending.clear();
    this.worker.removeEventListener("message", this.onMessage);
    this.worker.removeEventListener("error", this.onFail);
    this.worker.removeEventListener("messageerror", this.onFail);
    this.worker.terminate();
  }
}

/**
 * A failure of the *infrastructure*, never of the experiment. Distinguished
 * from an engine error so the store knows to fall back rather than report a
 * scientific result.
 */
export class AnalysisFailure extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "AnalysisFailure";
    this.code = code;
  }
}

/* ── Selection ──────────────────────────────────────────────────────────── */

/** The layer in use, with automatic demotion to direct execution on failure. */
export interface ResilientAnalysis {
  readonly offMainThread: boolean;
  analyse(source: DataSource, bitOffsets: readonly number[]): Promise<ExperimentRun>;
  butterfly(
    source: DataSource,
    budget: ButterflyBudget,
    onProgress?: (progress: SweepProgress) => void,
  ): Promise<ButterflyResult>;
  dispose(): void;
}

export function createAnalysisLayer(): ResilientAnalysis {
  let worker = WorkerAnalysisLayer.create();

  return {
    get offMainThread() {
      return worker !== null && worker.available;
    },
    async analyse(source, bitOffsets) {
      if (worker?.available) {
        try {
          return await worker.analyse(source, bitOffsets);
        } catch (error) {
          if (!(error instanceof AnalysisFailure)) throw error;
          worker.dispose();
          worker = null;
        }
      }
      return direct.analyse(source, bitOffsets);
    },
    async butterfly(source, budget, onProgress) {
      if (worker?.available) {
        try {
          return await worker.butterfly(source, budget, onProgress);
        } catch (error) {
          if (!(error instanceof AnalysisFailure)) throw error;
          worker.dispose();
          worker = null;
        }
      }
      return direct.butterfly(source, budget, onProgress);
    },
    dispose() {
      worker?.dispose();
      worker = null;
    },
  };
}