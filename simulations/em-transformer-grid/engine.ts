import type { InvariantReport, PhysicsEvent, StepResult } from '@physforge/sim-sdk';

export type TransformerGridMode = 'multi-tap-transformer' | 'long-distance-grid';

export type TransformerGridParams = {
  mode: TransformerGridMode;
  sourceU0: number;
  primaryR0: number;
  n1Ratio: number;
  n2Ratio: number;
  n3Ratio: number;
  loadR2: number;
  loadR3: number;
  branch3Closed: boolean;
  baselineParallelUsers: number;
  parallelUsersCount: number;
  genPowerKw: number;
  stepUpRatioK1: number;
  lineResistanceR: number;
};

export interface TransformerMetrics {
  readonly u1: number;
  readonly i1: number;
  readonly u2: number;
  readonly i2: number;
  readonly u3: number;
  readonly i3: number;
  readonly pInW: number;
  readonly pOutW: number;
  readonly pLineLossW: number;
  readonly pUserW: number;
  readonly lineVoltageV: number;
  readonly lineCurrentA: number;
  readonly efficiency: number;
}

export interface TransformerGridState {
  readonly t: number;
  readonly phase: number;
  readonly current: TransformerMetrics;
  readonly baseline: TransformerMetrics;
  readonly events: readonly PhysicsEvent[];
}

export function solveTransformerMetrics(params: TransformerGridParams): TransformerMetrics {
  const n1 = Math.max(0.1, params.n1Ratio);
  const n2 = Math.max(0.1, params.n2Ratio);
  const n3 = Math.max(0.1, params.n3Ratio);

  if (params.mode === 'multi-tap-transformer') {
    const r0 = Math.max(0, params.primaryR0);
    const invR2 = params.loadR2 > 0 ? 1 / (params.loadR2 / Math.max(1, params.parallelUsersCount)) : 0;
    const invR3 = params.branch3Closed && params.loadR3 > 0 ? 1 / params.loadR3 : 0;

    // Input conductance seen by ideal primary: G_in = (n2/n1)^2 * G2 + (n3/n1)^2 * G3
    const gIn = Math.pow(n2 / n1, 2) * invR2 + Math.pow(n3 / n1, 2) * invR3;
    // U1 = U0 / (1 + R0 * G_in)
    const u1 = params.sourceU0 / (1 + r0 * gIn);
    const i1 = u1 * gIn;
    const u2 = (n2 / n1) * u1;
    const u3 = (n3 / n1) * u1;
    const i2 = u2 * invR2;
    const i3 = u3 * invR3;
    const pInW = u1 * i1;
    const pOutW = u2 * i2 + u3 * i3;
    return {
      u1,
      i1,
      u2,
      i2,
      u3,
      i3,
      pInW,
      pOutW,
      pLineLossW: i1 * i1 * r0,
      pUserW: pOutW,
      lineVoltageV: u2,
      lineCurrentA: i2,
      efficiency: pInW > 1e-12 ? pOutW / pInW : 1
    };
  }

  // Long-distance transmission grid (constant generator power P_gen at generator voltage U0)
  const pGenW = Math.max(0, params.genPowerKw * 1000);
  const uGen = Math.max(1, params.sourceU0);
  const k1 = Math.max(0.5, params.stepUpRatioK1);
  const rLine = Math.max(0, params.lineResistanceR);

  const lineVoltageV = k1 * uGen;
  const lineCurrentA = pGenW / lineVoltageV;
  const rawLoss = lineCurrentA * lineCurrentA * rLine;
  const pLineLossW = Math.min(pGenW, rawLoss);
  const pUserW = Math.max(0, pGenW - pLineLossW);
  const uRecv = Math.max(0, lineVoltageV - lineCurrentA * rLine);
  const efficiency = pGenW > 1e-12 ? pUserW / pGenW : 1;

  return {
    u1: uGen,
    i1: pGenW / uGen,
    u2: uRecv,
    i2: lineCurrentA,
    u3: uRecv > 0 ? 220 : 0,
    i3: uRecv > 0 ? pUserW / 220 : 0,
    pInW: pGenW,
    pOutW: pUserW,
    pLineLossW,
    pUserW,
    lineVoltageV,
    lineCurrentA,
    efficiency
  };
}

export function trendSymbol(now: number, ref: number, tol = 1e-6): '↑' | '↓' | '—' {
  if (now > ref + tol) return '↑';
  if (now < ref - tol) return '↓';
  return '—';
}

export function createInitialState(params: TransformerGridParams): TransformerGridState {
  const baselineParams: TransformerGridParams = {
    ...params,
    branch3Closed: false,
    parallelUsersCount: params.baselineParallelUsers,
    stepUpRatioK1: 10
  };
  return {
    t: 0,
    phase: 0,
    current: solveTransformerMetrics(params),
    baseline: solveTransformerMetrics(baselineParams),
    events: []
  };
}

export function stepTransformerGrid(
  state: TransformerGridState,
  params: TransformerGridParams,
  dt: number
): StepResult<TransformerGridState> {
  if (!Number.isFinite(dt) || dt < 0) throw new Error(`Invalid dt: ${dt}`);
  const current = solveTransformerMetrics(params);
  return {
    nextState: {
      ...state,
      t: state.t + dt,
      phase: (state.phase + dt * 2.5) % 1,
      current
    },
    events: []
  };
}

export function computeObservables(state: TransformerGridState): Record<string, number> {
  return {
    t: state.t,
    u1: state.current.u1,
    i1: state.current.i1,
    u2: state.current.u2,
    i2: state.current.i2,
    pInW: state.current.pInW,
    pLineLossW: state.current.pLineLossW,
    pUserW: state.current.pUserW,
    efficiencyPct: state.current.efficiency * 100
  };
}

export function checkInvariants(
  _state: TransformerGridState,
  _initial: TransformerGridState,
  params: TransformerGridParams
): InvariantReport[] {
  const m = solveTransformerMetrics(params);
  if (params.mode === 'multi-tap-transformer') {
    const err = Math.abs(m.pInW - m.pOutW) / Math.max(1e-9, Math.abs(m.pInW));
    return [
      {
        name: '理想变压器输入输出瞬时功率平衡 U₁I₁ = ΣUₖIₖ',
        measuredError: err,
        tolerance: 1e-10,
        passed: Number.isFinite(err) && err < 1e-10
      }
    ];
  }
  const err = Math.abs(m.pInW - (m.pUserW + m.pLineLossW)) / Math.max(1e-9, m.pInW);
  return [
    {
      name: '高压输电能量流平衡 P发 = ΔP线 + P用',
      measuredError: err,
      tolerance: 1e-10,
      passed: Number.isFinite(err) && err < 1e-10
    }
  ];
}
