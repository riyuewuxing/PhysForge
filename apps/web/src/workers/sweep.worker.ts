import { runParameterSweep, type ParameterSweepSpec } from '@physforge/analysis-lab';
import { getSimulationById } from '@physforge/simulations/registry';
import type { ParamRecord } from '@physforge/sim-sdk';

export interface SweepWorkerRequest {
  readonly requestId: number;
  readonly modelId: string;
  readonly spec: ParameterSweepSpec<ParamRecord>;
}

export interface SweepWorkerResponse {
  readonly requestId: number;
  readonly ok: boolean;
  readonly result?: ReturnType<typeof runParameterSweep>;
  readonly error?: string;
}

self.onmessage = (ev: MessageEvent<SweepWorkerRequest>) => {
  const { requestId, modelId, spec } = ev.data;
  try {
    const plugin = getSimulationById(modelId);
    if (!plugin) {
      throw new Error(`Simulation plugin "${modelId}" not found in worker.`);
    }
    const result = runParameterSweep(plugin, spec);
    const msg: SweepWorkerResponse = { requestId, ok: true, result };
    self.postMessage(msg);
  } catch (err) {
    const msg: SweepWorkerResponse = {
      requestId,
      ok: false,
      error: err instanceof Error ? err.message : String(err)
    };
    self.postMessage(msg);
  }
};
