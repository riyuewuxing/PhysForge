import { WaveFDTD2D } from '@physforge/physics-core';
import type { InvariantReport, StepResult } from '@physforge/sim-sdk';

export type FdtdRippleMode =
  | 'double-slit'
  | 'single-slit'
  | 'obstacle-diffraction'
  | 'refraction-prism';

export type WaveFdtdParams = {
  mode: FdtdRippleMode;
  wavelengthCells: number; // wavelength measured in grid cells
  waveSpeed: number;
  amplitude: number;
  slitSepCells: number;
  slitWidthCells: number;
  refractiveIndexN: number;
};

export interface WaveFdtdState {
  readonly t: number;
  readonly stepsRun: number;
  readonly courantNumber: number;
  readonly nx: number;
  readonly ny: number;
  readonly wallI: number;
  readonly screenI: number;
  readonly fieldSnapshot: Float32Array;
  readonly speedSnapshot: Float32Array;
  readonly screenIntensity: Float32Array; // time-averaged <u^2(j)>
  readonly maxAmplitude: number;
  readonly fdtdRef: WaveFDTD2D;
}

const GRID_NX = 200;
const GRID_NY = 150;
const DX = 0.05;
const SPONGE_CELLS = 16;

function buildFdtdSolver(params: WaveFdtdParams): {
  solver: WaveFDTD2D;
  wallI: number;
  screenI: number;
} {
  const c0 = Math.max(0.2, params.waveSpeed);
  // Rigid CFL clamp r <= 0.45 (< 0.5 < 1/sqrt(2))
  const dt = (0.45 * DX) / c0;
  const solver = new WaveFDTD2D({
    nx: GRID_NX,
    ny: GRID_NY,
    dx: DX,
    dt,
    maxWaveSpeed: c0,
    spongeWidth: SPONGE_CELLS,
    spongeStrength: 0.1
  });

  const wallI = Math.round(GRID_NX * 0.34);
  const screenI = GRID_NX - SPONGE_CELLS - 6;
  const cy = Math.floor(GRID_NY / 2);
  const halfW = Math.max(2, Math.round(params.slitWidthCells / 2));
  const halfSep = Math.max(halfW + 3, Math.round(params.slitSepCells / 2));

  if (params.mode === 'double-slit') {
    solver.setObstacleMask((i, j) => {
      if (i < wallI - 1 || i > wallI + 1) return false;
      const inUpperSlit = Math.abs(j - (cy - halfSep)) <= halfW;
      const inLowerSlit = Math.abs(j - (cy + halfSep)) <= halfW;
      return !(inUpperSlit || inLowerSlit);
    });
  } else if (params.mode === 'single-slit') {
    solver.setObstacleMask((i, j) => {
      if (i < wallI - 1 || i > wallI + 1) return false;
      return Math.abs(j - cy) > halfW;
    });
  } else if (params.mode === 'obstacle-diffraction') {
    const obsHalf = Math.max(3, Math.round(params.slitWidthCells));
    solver.setObstacleMask((i, j) => i >= wallI - 1 && i <= wallI + 1 && Math.abs(j - cy) <= obsHalf);
  } else {
    // Tilted prism / higher-index slab c(x,y) = c0 / n
    const nIdx = Math.max(1.0, params.refractiveIndexN);
    for (let j = 0; j < GRID_NY; j++) {
      for (let i = 0; i < GRID_NX; i++) {
        const boundaryI = wallI + Math.round((j - cy) * 0.35);
        if (i >= boundaryI) {
          solver.speedGrid[j * GRID_NX + i] = c0 / nIdx;
        }
      }
    }
  }

  return { solver, wallI, screenI };
}

export function createInitialState(params: WaveFdtdParams): WaveFdtdState {
  const { solver, wallI, screenI } = buildFdtdSolver(params);
  return {
    t: 0,
    stepsRun: 0,
    courantNumber: solver.courantNumber,
    nx: GRID_NX,
    ny: GRID_NY,
    wallI,
    screenI,
    fieldSnapshot: new Float32Array(solver.uCurr),
    speedSnapshot: new Float32Array(solver.speedGrid),
    screenIntensity: new Float32Array(GRID_NY),
    maxAmplitude: 0,
    fdtdRef: solver
  };
}

export function stepWaveFdtd(
  state: WaveFdtdState,
  params: WaveFdtdParams,
  dt: number
): StepResult<WaveFdtdState> {
  if (!Number.isFinite(dt) || dt < 0) throw new Error(`Invalid dt: ${dt}`);
  if (dt === 0) return { nextState: state, events: [] };

  const solver = state.fdtdRef;
  const c0 = Math.max(0.2, params.waveSpeed);
  const lambdaPhys = Math.max(4, params.wavelengthCells) * DX;
  const freq = c0 / lambdaPhys;
  const omega = 2 * Math.PI * freq;

  const targetSub = Math.max(1, Math.min(20, Math.round(dt / solver.dt)));
  const srcI = SPONGE_CELLS + 6;
  const intensity = new Float32Array(state.screenIntensity);
  const cy = Math.floor(GRID_NY / 2);

  let curT = state.t;
  let stepsRun = state.stepsRun;
  for (let s = 0; s < targetSub; s++) {
    curT += solver.dt;
    stepsRun++;
    const val = params.amplitude * Math.sin(omega * curT);
    if (params.mode === 'refraction-prism') {
      for (let j = cy - 30; j <= cy + 30; j++) {
        solver.injectSource(srcI, j, val);
      }
    } else {
      // Plane wave incident from left across full active aperture
      for (let j = SPONGE_CELLS + 2; j < GRID_NY - SPONGE_CELLS - 2; j++) {
        solver.injectSource(srcI, j, val);
      }
    }
    solver.step();

    // Update running time-averaged intensity <u^2> after wavefront passes sponge startup
    if (stepsRun > 120) {
      const nAvg = stepsRun - 120;
      for (let j = 0; j < GRID_NY; j++) {
        const u = solver.uCurr[j * GRID_NX + state.screenI]!;
        intensity[j] = intensity[j]! + (u * u - intensity[j]!) / nAvg;
      }
    }
  }

  let maxAmp = 0;
  for (let idx = 0; idx < solver.uCurr.length; idx++) {
    const a = Math.abs(solver.uCurr[idx]!);
    if (a > maxAmp) maxAmp = a;
  }

  return {
    nextState: {
      ...state,
      t: curT,
      stepsRun,
      fieldSnapshot: new Float32Array(solver.uCurr),
      screenIntensity: intensity,
      maxAmplitude: maxAmp
    },
    events: []
  };
}

export function computeObservables(state: WaveFdtdState): Record<string, number> {
  const cy = Math.floor(state.ny / 2);
  return {
    t: state.t,
    stepsRun: state.stepsRun,
    courantNumber: state.courantNumber,
    maxAmplitude: state.maxAmplitude,
    centerScreenIntensity: state.screenIntensity[cy] ?? 0
  };
}

export function checkInvariants(state: WaveFdtdState): InvariantReport[] {
  let allFinite = Number.isFinite(state.maxAmplitude);
  if (allFinite) {
    for (let i = 0; i < state.fieldSnapshot.length; i++) {
      if (!Number.isFinite(state.fieldSnapshot[i]!)) {
        allFinite = false;
        break;
      }
    }
  }
  return [
    {
      name: 'FDTD 2D CFL < 0.5 稳定性与无散度检查',
      measuredError: state.courantNumber,
      tolerance: 0.5,
      passed: allFinite && state.courantNumber < 0.5 && state.maxAmplitude < 20
    }
  ];
}
