import type { InvariantReport, StepResult } from '@physforge/sim-sdk';

export type RelativityQuantumMode = 'tdse-tunneling' | 'minkowski-relativity';
export type PotentialShape = 'single-barrier' | 'double-barrier' | 'potential-well';

export const TDSE_GRID_N = 512;
export const TDSE_X_MIN = -50;
export const TDSE_X_MAX = 50;
export const TDSE_DX = (TDSE_X_MAX - TDSE_X_MIN) / (TDSE_GRID_N - 1);

export type RelativityQuantumParams = {
  mode: RelativityQuantumMode;
  potentialShape: PotentialShape;
  barrierHeightV0: number;
  barrierWidth: number;
  waveMomentumK0: number;
  packetSigma: number;
  lorentzBeta: number;
  eventX: number;
  eventCt: number;
};

export interface RelativityQuantumState {
  readonly t: number;
  readonly psiRe: Float64Array;
  readonly psiIm: Float64Array;
  readonly potential: Float64Array;
  readonly totalNorm: number;
  readonly normDrift: number;
  readonly reflectionProb: number;
  readonly transmissionProb: number;
  readonly gammaFactor: number;
  readonly intervalS2: number;
  readonly intervalPrimeS2: number;
  readonly intervalError: number;
  readonly twinStayProperTime: number;
  readonly twinTravelerProperTime: number;
}

function buildPotentialArray(params: RelativityQuantumParams): Float64Array {
  const V = new Float64Array(TDSE_GRID_N);
  const v0 = params.barrierHeightV0;
  const w = Math.max(0.4, params.barrierWidth);
  for (let j = 0; j < TDSE_GRID_N; j++) {
    const x = TDSE_X_MIN + j * TDSE_DX;
    if (params.potentialShape === 'single-barrier') {
      if (Math.abs(x) <= 0.5 * w) V[j] = v0;
    } else if (params.potentialShape === 'double-barrier') {
      if (Math.abs(x + 2.5) <= 0.4 * w || Math.abs(x - 2.5) <= 0.4 * w) V[j] = v0;
    } else {
      if (Math.abs(x) <= 0.8 * w) V[j] = -Math.abs(v0);
    }
  }
  return V;
}

export function solveLorentzInterval(betaRaw: number, x: number, ct: number): {
  gamma: number;
  xPrime: number;
  ctPrime: number;
  s2: number;
  s2Prime: number;
  err: number;
} {
  const beta = Math.max(-0.98, Math.min(0.98, betaRaw));
  const gamma = 1 / Math.sqrt(1 - beta * beta);
  const xPrime = gamma * (x - beta * ct);
  const ctPrime = gamma * (ct - beta * x);
  const s2 = ct * ct - x * x;
  const s2Prime = ctPrime * ctPrime - xPrime * xPrime;
  return {
    gamma,
    xPrime,
    ctPrime,
    s2,
    s2Prime,
    err: Math.abs(s2Prime - s2)
  };
}

export function createInitialState(params: RelativityQuantumParams): RelativityQuantumState {
  const psiRe = new Float64Array(TDSE_GRID_N);
  const psiIm = new Float64Array(TDSE_GRID_N);
  const sig = Math.max(1.2, params.packetSigma);
  const k0 = params.waveMomentumK0;
  const x0 = -18;

  let normSum = 0;
  for (let j = 0; j < TDSE_GRID_N; j++) {
    const x = TDSE_X_MIN + j * TDSE_DX;
    const env = Math.exp(-((x - x0) * (x - x0)) / (4 * sig * sig));
    const re = env * Math.cos(k0 * x);
    const im = env * Math.sin(k0 * x);
    psiRe[j] = re;
    psiIm[j] = im;
    normSum += (re * re + im * im) * TDSE_DX;
  }
  const invSqrt = 1 / Math.sqrt(Math.max(1e-18, normSum));
  let normAfter = 0;
  let refP = 0;
  let transP = 0;
  for (let j = 0; j < TDSE_GRID_N; j++) {
    psiRe[j] = psiRe[j]! * invSqrt;
    psiIm[j] = psiIm[j]! * invSqrt;
    const prob = (psiRe[j]! * psiRe[j]! + psiIm[j]! * psiIm[j]!) * TDSE_DX;
    normAfter += prob;
    const x = TDSE_X_MIN + j * TDSE_DX;
    if (x < -params.barrierWidth * 0.6) refP += prob;
    else if (x > params.barrierWidth * 0.6) transP += prob;
  }

  const lor = solveLorentzInterval(params.lorentzBeta, params.eventX, params.eventCt);
  const stayTau = 10;
  const travelTau = stayTau / lor.gamma;

  return {
    t: 0,
    psiRe,
    psiIm,
    potential: buildPotentialArray(params),
    totalNorm: normAfter,
    normDrift: Math.abs(normAfter - 1),
    reflectionProb: refP,
    transmissionProb: transP,
    gammaFactor: lor.gamma,
    intervalS2: lor.s2,
    intervalPrimeS2: lor.s2Prime,
    intervalError: lor.err,
    twinStayProperTime: stayTau,
    twinTravelerProperTime: travelTau
  };
}

/**
 * 1D TDSE Crank-Nicolson single-step solver with complex Thomas tridiagonal elimination (m=1, hbar=1).
 * Cayley operator (I + i*dt/2*H)^{-1}(I - i*dt/2*H) guarantees exact unitary norm conservation (< 1e-10).
 */
function advanceCrankNicolsonStep(
  psiReIn: Float64Array,
  psiImIn: Float64Array,
  V: Float64Array,
  dt: number
): { nextRe: Float64Array; nextIm: Float64Array } {
  const N = TDSE_GRID_N;
  // alphaIm = dt / (4 * dx^2), off-diag A = -i * alphaIm
  const alphaIm = dt / (4 * TDSE_DX * TDSE_DX);
  const halfDt = 0.5 * dt;

  // Build RHS d = (I - i*halfDt*H) psi and solve tridiagonal A * next = d
  const cPrimeRe = new Float64Array(N);
  const cPrimeIm = new Float64Array(N);
  const dPrimeRe = new Float64Array(N);
  const dPrimeIm = new Float64Array(N);

  for (let j = 0; j < N; j++) {
    const pRe = psiReIn[j]!;
    const pIm = psiImIn[j]!;
    const pmRe = j > 0 ? psiReIn[j - 1]! : 0;
    const pmIm = j > 0 ? psiImIn[j - 1]! : 0;
    const ppRe = j + 1 < N ? psiReIn[j + 1]! : 0;
    const ppIm = j + 1 < N ? psiImIn[j + 1]! : 0;

    // B_diag = 1 - i*(2*alphaIm + halfDt*V[j])
    const bDiagIm = -(2 * alphaIm + halfDt * V[j]!);
    // d_j = (1 + i*bDiagIm)*p + (i*alphaIm)*(pm + pp)
    const sumSideRe = pmRe + ppRe;
    const sumSideIm = pmIm + ppIm;
    const rhsRe = pRe - bDiagIm * pIm - alphaIm * sumSideIm;
    const rhsIm = pIm + bDiagIm * pRe + alphaIm * sumSideRe;

    // A_j diagonal: 1 + i*(2*alphaIm + halfDt*V[j]) = (1, diagIm)
    // lower off-diag a = (0, -alphaIm), upper off-diag c = (0, -alphaIm)
    const diagIm = 2 * alphaIm + halfDt * V[j]!;
    let denomRe = 1;
    let denomIm = diagIm;
    if (j > 0) {
      // denom -= a * cPrime[j-1], where a = (0, -alphaIm)
      // (0, -alphaIm) * (cpRe, cpIm) = (alphaIm*cpIm, -alphaIm*cpRe)
      denomRe -= alphaIm * cPrimeIm[j - 1]!;
      denomIm -= -alphaIm * cPrimeRe[j - 1]!;
    }
    const denMag2 = denomRe * denomRe + denomIm * denomIm;

    if (j + 1 < N) {
      // cPrime[j] = (0, -alphaIm) / (denomRe + i*denomIm)
      const cRe = 0;
      const cIm = -alphaIm;
      cPrimeRe[j] = (cRe * denomRe + cIm * denomIm) / denMag2;
      cPrimeIm[j] = (cIm * denomRe - cRe * denomIm) / denMag2;
    }

    let numRe = rhsRe;
    let numIm = rhsIm;
    if (j > 0) {
      // num -= a * dPrime[j-1], a = (0, -alphaIm)
      numRe -= alphaIm * dPrimeIm[j - 1]!;
      numIm -= -alphaIm * dPrimeRe[j - 1]!;
    }
    dPrimeRe[j] = (numRe * denomRe + numIm * denomIm) / denMag2;
    dPrimeIm[j] = (numIm * denomRe - numRe * denomIm) / denMag2;
  }

  const nextRe = new Float64Array(N);
  const nextIm = new Float64Array(N);
  nextRe[N - 1] = dPrimeRe[N - 1]!;
  nextIm[N - 1] = dPrimeIm[N - 1]!;
  for (let j = N - 2; j >= 0; j--) {
    const xNextRe = nextRe[j + 1]!;
    const xNextIm = nextIm[j + 1]!;
    const cpRe = cPrimeRe[j]!;
    const cpIm = cPrimeIm[j]!;
    nextRe[j] = dPrimeRe[j]! - (cpRe * xNextRe - cpIm * xNextIm);
    nextIm[j] = dPrimeIm[j]! - (cpRe * xNextIm + cpIm * xNextRe);
  }
  return { nextRe, nextIm };
}

export function stepRelativityQuantum(
  state: RelativityQuantumState,
  params: RelativityQuantumParams,
  dt: number
): StepResult<RelativityQuantumState> {
  if (!Number.isFinite(dt) || dt < 0) throw new Error(`Invalid dt: ${dt}`);
  if (dt === 0) return { nextState: state, events: [] };

  const V = buildPotentialArray(params);
  let re = state.psiRe;
  let im = state.psiIm;
  if (params.mode === 'tdse-tunneling') {
    const substeps = Math.max(1, Math.round(dt / 0.05));
    const h = dt / substeps;
    for (let s = 0; s < substeps; s++) {
      const res = advanceCrankNicolsonStep(re, im, V, h);
      re = res.nextRe;
      im = res.nextIm;
    }
  }

  let norm = 0;
  let refP = 0;
  let transP = 0;
  const edge = params.potentialShape === 'double-barrier' ? 2.5 + 0.5 * params.barrierWidth : 0.6 * params.barrierWidth;
  for (let j = 0; j < TDSE_GRID_N; j++) {
    const p = (re[j]! * re[j]! + im[j]! * im[j]!) * TDSE_DX;
    norm += p;
    const x = TDSE_X_MIN + j * TDSE_DX;
    if (x < -edge) refP += p;
    else if (x > edge) transP += p;
  }

  const lor = solveLorentzInterval(params.lorentzBeta, params.eventX, params.eventCt);
  return {
    nextState: {
      t: state.t + dt,
      psiRe: re,
      psiIm: im,
      potential: V,
      totalNorm: norm,
      normDrift: Math.abs(norm - 1),
      reflectionProb: refP,
      transmissionProb: transP,
      gammaFactor: lor.gamma,
      intervalS2: lor.s2,
      intervalPrimeS2: lor.s2Prime,
      intervalError: lor.err,
      twinStayProperTime: 10,
      twinTravelerProperTime: 10 / lor.gamma
    },
    events: []
  };
}

export function computeObservables(state: RelativityQuantumState): Record<string, number> {
  return {
    t: state.t,
    totalNorm: state.totalNorm,
    normDrift: state.normDrift,
    reflectionProb: state.reflectionProb,
    transmissionProb: state.transmissionProb,
    gammaFactor: state.gammaFactor,
    intervalError: state.intervalError
  };
}

export function checkInvariants(
  state: RelativityQuantumState,
  _i: RelativityQuantumState,
  params: RelativityQuantumParams
): InvariantReport[] {
  const err = params.mode === 'tdse-tunneling' ? state.normDrift : state.intervalError;
  return [
    {
      name: params.mode === 'tdse-tunneling' ? 'Crank-Nicolson TDSE 概率归一化漂移' : '洛伦兹变换 Δs² 跨系不变量误差',
      measuredError: err,
      tolerance: 1e-10,
      passed: err < 1e-10
    }
  ];
}
