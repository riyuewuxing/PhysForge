import {
  resolvePluginParams,
  type ParamRecord,
  type SimulationPlugin
} from '@physforge/sim-sdk';

export interface ParameterSweepSpec<TParams extends ParamRecord> {
  readonly paramKey: keyof TParams & string;
  readonly values: readonly number[];
  readonly baseParams?: Partial<TParams>;
  readonly steps: number;
  readonly dt: number;
  readonly metricKeys?: readonly string[];
}

export interface SweepPointResult {
  readonly paramValue: number;
  readonly finalTime: number;
  readonly finalObservables: Readonly<Record<string, number>>;
  readonly maxObservables: Readonly<Record<string, number>>;
  readonly minObservables: Readonly<Record<string, number>>;
  readonly eventCount: number;
}

export interface ParameterSweepResult {
  readonly modelId: string;
  readonly paramKey: string;
  readonly points: readonly SweepPointResult[];
  readonly durationMs: number;
}

/**
 * 无头参数扫描执行器（供单测与 Web Worker 共用，纯内存演进、零 DOM 依赖）
 */
export function runParameterSweep<TParams extends ParamRecord, TState>(
  plugin: SimulationPlugin<TParams, TState>,
  spec: ParameterSweepSpec<TParams>
): ParameterSweepResult {
  const startMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const points: SweepPointResult[] = [];

  for (const val of spec.values) {
    const overrides = {
      ...(spec.baseParams ?? {}),
      [spec.paramKey]: val
    } as Partial<TParams>;
    const params = resolvePluginParams(plugin.paramSchema, overrides);
    let state = plugin.engine.createInitialState(params);
    let eventCount = 0;

    const initObs = plugin.engine.computeObservables(state, params);
    const maxObs: Record<string, number> = { ...initObs };
    const minObs: Record<string, number> = { ...initObs };

    for (let s = 0; s < spec.steps; s++) {
      const stepRes = plugin.engine.step(state, params, spec.dt);
      state = stepRes.nextState;
      eventCount += stepRes.events.length;
      const obs = plugin.engine.computeObservables(state, params);
      for (const [k, v] of Object.entries(obs)) {
        if (spec.metricKeys && !spec.metricKeys.includes(k)) continue;
        if (!Number.isFinite(v)) continue;
        if (maxObs[k] === undefined || v > maxObs[k]!) maxObs[k] = v;
        if (minObs[k] === undefined || v < minObs[k]!) minObs[k] = v;
      }
    }

    const finalObs = plugin.engine.computeObservables(state, params);
    const tVal = (state as { t?: number }).t ?? spec.steps * spec.dt;
    points.push({
      paramValue: val,
      finalTime: tVal,
      finalObservables: finalObs,
      maxObservables: maxObs,
      minObservables: minObs,
      eventCount
    });
  }

  const endMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return {
    modelId: plugin.meta.id,
    paramKey: spec.paramKey,
    points,
    durationMs: Math.max(0, endMs - startMs)
  };
}
