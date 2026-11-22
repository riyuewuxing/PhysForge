import {
  createScaleContext,
  extractIsolines,
  integrateAdaptiveRK45,
  stepRK4,
  type IsolineContour
} from '@physforge/physics-core';
import type { InvariantReport, PhysicsEvent, StepResult } from '@physforge/sim-sdk';

export type ElectrostaticMode =
  | 'dipole-point-charges'
  | 'uniform-three-point'
  | 'deflection-tube';

export type ElectrostaticParams = {
  mode: ElectrostaticMode;
  q1MicroC: number;
  q2MicroC: number;
  x1: number;
  x2: number;
  testChargeRatio: number;
  v0x: number;
  v0y: number;
  startY: number;
  uAccelV: number;
  uDeflectV: number;
  phiA: number;
  phiB: number;
  phiC: number;
};

export interface ElectrostaticState {
  readonly t: number;
  readonly px: number;
  readonly py: number;
  readonly vx: number;
  readonly vy: number;
  readonly trail: readonly { x: number; y: number }[];
  readonly initialEnergy: number;
  readonly events: readonly PhysicsEvent[];
}

export const ELECTROSTATIC_SCALE = createScaleContext({
  lengthUnit: 1.0,
  timeUnit: 1.0,
  massUnit: 1.0,
  chargeUnit: 1e-6
});

const SOFTENING_SQ = 1e-4;

export function evalPointChargePotentialAndField(
  x: number,
  y: number,
  params: ElectrostaticParams
): { phi: number; Ex: number; Ey: number } {
  const charges = [
    { q: params.q1MicroC, cx: params.x1, cy: 0 },
    { q: params.q2MicroC, cx: params.x2, cy: 0 }
  ];
  let phi = 0;
  let Ex = 0;
  let Ey = 0;
  for (const c of charges) {
    const dx = x - c.cx;
    const dy = y - c.cy;
    const r2 = dx * dx + dy * dy + SOFTENING_SQ;
    const r = Math.sqrt(r2);
    phi += c.q / r;
    const invR3 = c.q / (r2 * r);
    Ex += invR3 * dx;
    Ey += invR3 * dy;
  }
  return { phi, Ex, Ey };
}

export function solveThreePointUniformField(params: ElectrostaticParams): {
  Ex: number;
  Ey: number;
  A: { x: number; y: number; phi: number };
  B: { x: number; y: number; phi: number };
  C: { x: number; y: number; phi: number };
  equalPointOnAC: { x: number; y: number };
} {
  const A = { x: -1.4, y: -0.9, phi: params.phiA };
  const B = { x: 0.2, y: 1.1, phi: params.phiB };
  const C = { x: 1.5, y: -0.7, phi: params.phiC };

  // Solve grad(phi) . (B - A) = phiB - phiA and grad(phi) . (C - A) = phiC - phiA
  const ax = B.x - A.x;
  const ay = B.y - A.y;
  const bx = C.x - A.x;
  const by = C.y - A.y;
  const det = ax * by - ay * bx;
  const dPhiB = B.phi - A.phi;
  const dPhiC = C.phi - A.phi;

  const gx = (dPhiB * by - ay * dPhiC) / det;
  const gy = (ax * dPhiC - dPhiB * bx) / det;

  const tAC =
    Math.abs(C.phi - A.phi) > 1e-9
      ? Math.max(0, Math.min(1, (B.phi - A.phi) / (C.phi - A.phi)))
      : 0.5;
  const equalPointOnAC = {
    x: A.x + tAC * (C.x - A.x),
    y: A.y + tAC * (C.y - A.y)
  };
  return { Ex: -gx, Ey: -gy, A, B, C, equalPointOnAC };
}

export function extractElectrostaticIsolines(params: ElectrostaticParams): IsolineContour[] {
  const nx = 121;
  const ny = 89;
  const bounds = { xMin: -3.2, xMax: 3.2, yMin: -2.2, yMax: 2.2 };
  const grid = new Float64Array(nx * ny);

  for (let j = 0; j < ny; j++) {
    const y = bounds.yMin + (j / (ny - 1)) * (bounds.yMax - bounds.yMin);
    for (let i = 0; i < nx; i++) {
      const x = bounds.xMin + (i / (nx - 1)) * (bounds.xMax - bounds.xMin);
      const val =
        params.mode === 'uniform-three-point'
          ? (() => {
              const sol = solveThreePointUniformField(params);
              return sol.A.phi - sol.Ex * (x - sol.A.x) - sol.Ey * (y - sol.A.y);
            })()
          : evalPointChargePotentialAndField(x, y, params).phi;
      grid[j * nx + i] = Math.max(-12, Math.min(12, val));
    }
  }

  const levels =
    params.mode === 'uniform-three-point'
      ? [0, 2, 4, 6, 8, 10, 12]
      : [-4, -2.5, -1.2, -0.5, 0, 0.5, 1.2, 2.5, 4];
  return extractIsolines(grid, nx, ny, bounds, levels);
}

export function traceFieldLines(params: ElectrostaticParams): { x: number; y: number }[][] {
  if (params.mode !== 'dipole-point-charges') return [];
  const seeds: { x: number; y: number; dir: number }[] = [];
  const list = [
    { q: params.q1MicroC, cx: params.x1 },
    { q: params.q2MicroC, cx: params.x2 }
  ];
  for (const ch of list) {
    if (Math.abs(ch.q) < 0.05) continue;
    const count = 10;
    const dir = ch.q > 0 ? 1 : -1;
    for (let k = 0; k < count; k++) {
      const ang = (k / count) * Math.PI * 2 + 0.12;
      seeds.push({
        x: ch.cx + 0.18 * Math.cos(ang),
        y: 0.18 * Math.sin(ang),
        dir
      });
    }
  }

  const lines: { x: number; y: number }[][] = [];
  for (const s of seeds) {
    const pts: { x: number; y: number }[] = [{ x: s.x, y: s.y }];
    let cx = s.x;
    let cy = s.y;
    for (let step = 0; step < 90; step++) {
      const next = stepRK4([cx, cy], 0, 0.06, (_t, xy) => {
        const { Ex, Ey } = evalPointChargePotentialAndField(xy[0]!, xy[1]!, params);
        const mag = Math.hypot(Ex, Ey);
        return mag > 1e-8 ? [(s.dir * Ex) / mag, (s.dir * Ey) / mag] : [0, 0];
      });
      cx = next[0]!;
      cy = next[1]!;
      pts.push({ x: cx, y: cy });
      if (Math.abs(cx) > 3.3 || Math.abs(cy) > 2.3) break;
      const nearCharge =
        Math.hypot(cx - params.x1, cy) < 0.12 || Math.hypot(cx - params.x2, cy) < 0.12;
      if (nearCharge) break;
    }
    lines.push(pts);
  }
  return lines;
}

function getFieldAt(x: number, y: number, params: ElectrostaticParams): { phi: number; Ex: number; Ey: number } {
  if (params.mode === 'uniform-three-point') {
    const sol = solveThreePointUniformField(params);
    return {
      phi: sol.A.phi - sol.Ex * (x - sol.A.x) - sol.Ey * (y - sol.A.y),
      Ex: sol.Ex,
      Ey: sol.Ey
    };
  }
  if (params.mode === 'deflection-tube') {
    // Deflection plates occupy x in [-1.0, 1.0], plate separation d = 2.0, U2 = uDeflectV
    const d = 2.0;
    const inPlates = x >= -1.0 && x <= 1.0 && Math.abs(y) <= 1.0;
    const Ey = inPlates ? params.uDeflectV / d : 0;
    return { phi: -Ey * y, Ex: 0, Ey };
  }
  return evalPointChargePotentialAndField(x, y, params);
}

export function createInitialState(params: ElectrostaticParams): ElectrostaticState {
  const px0 =
    params.mode === 'deflection-tube' ? -1.4 : params.mode === 'uniform-three-point' ? -1.2 : -2.2;
  const py0 = params.mode === 'deflection-tube' ? 0 : params.startY;
  const vx0 =
    params.mode === 'deflection-tube'
      ? Math.sqrt(Math.max(0.1, 2 * Math.abs(params.testChargeRatio) * params.uAccelV))
      : params.v0x;
  const vy0 = params.mode === 'deflection-tube' ? 0 : params.v0y;

  const pxDim = ELECTROSTATIC_SCALE.toDimless(px0, 'length');
  const pyDim = ELECTROSTATIC_SCALE.toDimless(py0, 'length');
  const { phi } = getFieldAt(pxDim, pyDim, params);
  const ek = 0.5 * (vx0 * vx0 + vy0 * vy0);
  const e0 = ek + params.testChargeRatio * phi;

  return {
    t: 0,
    px: pxDim,
    py: pyDim,
    vx: vx0,
    vy: vy0,
    trail: [{ x: pxDim, y: pyDim }],
    initialEnergy: e0,
    events: []
  };
}

export function stepElectrostatic(
  state: ElectrostaticState,
  params: ElectrostaticParams,
  dt: number
): StepResult<ElectrostaticState> {
  if (!Number.isFinite(dt) || dt < 0) throw new Error(`Invalid dt: ${dt}`);
  if (dt === 0) return { nextState: state, events: [] };

  const eta = params.testChargeRatio;
  const res = integrateAdaptiveRK45(
    [state.px, state.py, state.vx, state.vy],
    state.t,
    dt,
    (_t, y) => {
      const { Ex, Ey } = getFieldAt(y[0]!, y[1]!, params);
      return [y[2]!, y[3]!, eta * Ex, eta * Ey];
    },
    { absTol: 1e-10, relTol: 1e-9 }
  );

  const nx = res.state[0]!;
  const ny = res.state[1]!;
  const nvx = res.state[2]!;
  const nvy = res.state[3]!;
  const last = state.trail[state.trail.length - 1];
  const append = !last || Math.hypot(nx - last.x, ny - last.y) > 0.03;
  const trail = append ? [...state.trail.slice(-300), { x: nx, y: ny }] : state.trail;

  const events: PhysicsEvent[] = [];
  if (params.mode === 'deflection-tube' && state.px <= 1.0 && nx > 1.0) {
    events.push({
      id: `exit-plate-${state.events.length}`,
      time: state.t + dt,
      label: `粒子离开偏转极板 (y=${ny.toFixed(3)}m)`,
      position: { x: nx, y: ny },
      metrics: { yExit: ny }
    });
  }

  return {
    nextState: {
      ...state,
      t: state.t + dt,
      px: nx,
      py: ny,
      vx: nvx,
      vy: nvy,
      trail,
      events: events.length > 0 ? [...state.events, ...events] : state.events
    },
    events
  };
}

export function computeObservables(
  state: ElectrostaticState,
  params: ElectrostaticParams
): Record<string, number> {
  const { phi, Ex, Ey } = getFieldAt(state.px, state.py, params);
  const ek = 0.5 * (state.vx * state.vx + state.vy * state.vy);
  const ep = params.testChargeRatio * phi;
  return {
    t: state.t,
    px: state.px,
    py: state.py,
    Ex,
    Ey,
    eMag: Math.hypot(Ex, Ey),
    phi,
    ek,
    totalEnergy: ek + ep
  };
}

export function checkInvariants(
  state: ElectrostaticState,
  _initial: ElectrostaticState,
  params: ElectrostaticParams
): InvariantReport[] {
  const obs = computeObservables(state, params);
  const conservative = params.mode !== 'deflection-tube';
  const err =
    conservative && Math.abs(state.initialEnergy) > 1e-9
      ? Math.abs(obs.totalEnergy! - state.initialEnergy) / Math.abs(state.initialEnergy)
      : conservative
        ? Math.abs(obs.totalEnergy! - state.initialEnergy)
        : 0;

  return [
    {
      name: conservative ? '静电场机械能与电势能守恒 (Ek+qφ)' : '数值有限性检定',
      measuredError: err,
      tolerance: 1e-5,
      passed: Number.isFinite(obs.totalEnergy) && err < 1e-5
    }
  ];
}
