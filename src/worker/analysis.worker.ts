/// <reference lib="webworker" />

/**
 * Analysis worker.
 *
 * Runs the same pure engine the main thread would run, so a worker result and
 * a main-thread result are identical by construction. If the worker cannot be
 * created at all, the engine falls back to running here — the results are the
 * same either way, only the scheduling differs.
 */

import { runExperiment } from "../core/experiment";
import { runButterfly } from "../core/butterfly";
import type { WorkerRequest, WorkerResponse } from "./protocol";

const post = (message: WorkerResponse) => {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(message);
};

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  try {
    if (request.kind === "analyse") {
      const run = await runExperiment(request.source, request.bitOffsets);
      post({ id: request.id, kind: "result", run });
      return;
    }

    const result = await runButterfly(request.source, request.budget, (progress) =>
      post({ id: request.id, kind: "butterfly-progress", progress }),
    );
    post({ id: request.id, kind: "butterfly-result", result });
  } catch (error) {
    post({
      id: request.id,
      kind: "error",
      code: error instanceof Error ? error.name : "Error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
};