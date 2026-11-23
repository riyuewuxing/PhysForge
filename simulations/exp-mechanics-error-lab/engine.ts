import { CLASSROOM_GRAVITY, createSeededPrng, degToRad } from '@physforge/physics-core';
import type { InvariantReport, StepResult } from '@physforge/sim-sdk';

export type MechanicsErrorScenario =
  | 'ideal-compensated'
  | 'under-compensated'
  | 'over-compensated'
  | 'heavy-hanger-bend';

export type MechanicsErrorParams = {
  scenario: MechanicsErrorScenario;
  cartMassKg: number;
  hangerMassKg: number;
  trackTiltDeg: number;
  frictionForceN: number;
  readingNoiseMm: number;
  seed: number;
  phyphoxOverlayCsv: string;
  rulerOffsetCm?: number;
};

export interface TapePoint {
  readonly index: number;
  readonly timeS: number;
  readonly posCm: number;
}

export interface AfSweepPoint {
  readonly fAppN: number;
  readonly aMeasured: number;
  readonly aAnalytic: number;
}

export interface MechanicsErrorState {
  readonly t: number;
  readonly aTrueMps2: number;
  readonly aDiffMeasuredMps2: number;
  readonly diffErrorMps2: number;
  readonly slopeFit: number;
  readonly interceptFitA: number;
  readonly interceptFitF: number;
  readonly analyticInterceptA: number;
  readonly analyticInterceptF: number;
  readonly rSquared: number;
  readonly tapeDots: readonly TapePoint[];
  readonly afCurve: readonly AfSweepPoint[];
  readonly csvOverlayPoints: readonly { fAppN: number; a: number }[];
}

export function computeTrueCartAcceleration(
  cartM: number,
  hangerM: number,
  tiltDeg: number,
  frictionN: number
): number {
  const M = Math.max(0.05, cartM);
  const m = Math.max(0.001, hangerM);
  const sinTh = Math.sin(degToRad(tiltDeg));
  const net = m * CLASSROOM_GRAVITY + M * CLASSROOM_GRAVITY * sinTh - frictionN;
  return Math.max(0, net / (M + m));
}

export function generateTickerAndDiffAccel(
  aTrue: number,
  noiseMm: number,
  seed: number
): { dots: TapePoint[]; aDiff: number } {
  const T = 0.1; // 5-tick interval at 50 Hz
  const rng = createSeededPrng((Math.round(seed) || 1) >>> 0);
  const dots: TapePoint[] = [];
  const v0 = 0.15;
  for (let i = 0; i <= 6; i++) {
    const ti = i * T;
    const xM = v0 * ti + 0.5 * aTrue * ti * ti;
    const noiseM = noiseMm > 0 ? rng.gaussian(0, noiseMm * 1e-3) : 0;
    dots.push({ index: i, timeS: ti, posCm: (xM + noiseM) * 100 });
  }
  // s1..s6 in meters
  const s = [1, 2, 3, 4, 5, 6].map((k) => (dots[k]!.posCm - dots[k - 1]!.posCm) * 0.01);
  const aDiff = ((s[3]! + s[4]! + s[5]!) - (s[0]! + s[1]! + s[2]!)) / (9 * T * T);
  return { dots, aDiff };
}

function parseOverlayCsv(csvText = ''): { fAppN: number; a: number }[] {
  if (!csvText) return [];
  const out: { fAppN: number; a: number }[] = [];
  for (const line of csvText.split(/\r?\n/)) {
    const cleaned = line.trim();
    if (!cleaned || cleaned.startsWith('#') || /^[a-zA-Z]/.test(cleaned)) continue;
    const parts = cleaned.split(/[;\t,]+/).map((s) => Number(s.trim()));
    if (parts.length >= 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1])) {
      out.push({ fAppN: parts[0]!, a: parts[1]! });
    }
  }
  return out;
}

export function solveMechanicsErrorAnalysis(params: MechanicsErrorParams): Omit<MechanicsErrorState, 't'> {
  const M = Math.max(0.05, params.cartMassKg);
  const mActive = Math.max(0.005, params.hangerMassKg);
  const aTrue = computeTrueCartAcceleration(M, mActive, params.trackTiltDeg, params.frictionForceN);
  const { dots, aDiff } = generateTickerAndDiffAccel(aTrue, Math.max(0, params.readingNoiseMm), params.seed);

  const masses =
    params.scenario === 'heavy-hanger-bend'
      ? [0.02, 0.05, 0.1, 0.2, 0.35, 0.5]
      : [0.01, 0.02, 0.03, 0.04, 0.05, 0.06];

  const afCurve: AfSweepPoint[] = masses.map((mi, idx) => {
    const fApp = mi * CLASSROOM_GRAVITY;
    const aAna =
      params.scenario === 'heavy-hanger-bend'
        ? fApp / (M + fApp / CLASSROOM_GRAVITY)
        : computeTrueCartAcceleration(M, mi, params.trackTiltDeg, params.frictionForceN);
    const { aDiff: aMeas } = generateTickerAndDiffAccel(aAna, Math.max(0, params.readingNoiseMm), params.seed + idx * 17);
    return { fAppN: fApp, aMeasured: aMeas, aAnalytic: aAna };
  });

  // OLS fit a = slope * F + interceptA (over first points or all points)
  const n = afCurve.length;
  let sumX = 0;
  let sumY = 0;
  for (const pt of afCurve) {
    sumX += pt.fAppN;
    sumY += pt.aMeasured;
  }
  const meanX = sumX / n;
  const meanY = sumY / n;
  let sxx = 0;
  let sxy = 0;
  let sst = 0;
  for (const pt of afCurve) {
    sxx += (pt.fAppN - meanX) * (pt.fAppN - meanX);
    sxy += (pt.fAppN - meanX) * (pt.aMeasured - meanY);
    sst += (pt.aMeasured - meanY) * (pt.aMeasured - meanY);
  }
  const slopeFit = sxx > 1e-12 ? sxy / sxx : 0;
  const interceptFitA = meanY - slopeFit * meanX;
  const interceptFitF = Math.abs(slopeFit) > 1e-12 ? -interceptFitA / slopeFit : 0;

  let sse = 0;
  for (const pt of afCurve) {
    const pred = slopeFit * pt.fAppN + interceptFitA;
    sse += (pt.aMeasured - pred) * (pt.aMeasured - pred);
  }
  const rSquared = sst > 1e-12 ? 1 - sse / sst : 1;

  // Linearized small-mass theory (F << Mg): a ~ (F + Mg sinθ - f)/M => a0 = (Mg sinθ - f)/M
  const sinTh = Math.sin(degToRad(params.trackTiltDeg));
  const netBias = M * CLASSROOM_GRAVITY * sinTh - params.frictionForceN;
  const analyticInterceptA = netBias / M;
  const analyticInterceptF = -netBias;

  return {
    aTrueMps2: aTrue,
    aDiffMeasuredMps2: aDiff,
    diffErrorMps2: Math.abs(aDiff - aTrue),
    slopeFit,
    interceptFitA,
    interceptFitF,
    analyticInterceptA,
    analyticInterceptF,
    rSquared,
    tapeDots: dots,
    afCurve,
    csvOverlayPoints: parseOverlayCsv(params.phyphoxOverlayCsv)
  };
}

export function createInitialState(params: MechanicsErrorParams): MechanicsErrorState {
  return { t: 0, ...solveMechanicsErrorAnalysis(params) };
}

export function stepMechanicsErrorLab(
  state: MechanicsErrorState,
  params: MechanicsErrorParams,
  dt: number
): StepResult<MechanicsErrorState> {
  if (!Number.isFinite(dt) || dt < 0) throw new Error(`Invalid dt: ${dt}`);
  if (dt === 0) return { nextState: state, events: [] };
  return {
    nextState: { t: state.t + dt, ...solveMechanicsErrorAnalysis(params) },
    events: []
  };
}

export function computeObservables(state: MechanicsErrorState): Record<string, number> {
  return {
    t: state.t,
    aTrueMps2: state.aTrueMps2,
    aDiffMeasuredMps2: state.aDiffMeasuredMps2,
    diffErrorMps2: state.diffErrorMps2,
    interceptFitA: state.interceptFitA,
    interceptFitF: state.interceptFitF,
    rSquared: state.rSquared
  };
}

export function checkInvariants(state: MechanicsErrorState, _i: MechanicsErrorState, params: MechanicsErrorParams): InvariantReport[] {
  const err = params.readingNoiseMm === 0 ? state.diffErrorMps2 : 0;
  return [
    {
      name: '零噪声 50Hz 纸带逐差法绝对误差 (m/s²)',
      measuredError: err,
      tolerance: 1e-10,
      passed: err < 1e-10,
      unit: 'm/s²'
    }
  ];
}
