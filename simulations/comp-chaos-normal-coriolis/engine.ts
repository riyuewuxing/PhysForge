import {
  CLASSROOM_GRAVITY,
  degToRad,
  integrateAdaptiveRK45,
  stepVelocityVerlet,
  type VerletState
} from '@physforge/physics-core';
import type { InvariantReport, StepResult } from '@physforge/sim-sdk';

export type CompAdvancedMode = 'double-pendulum' | 'normal-modes' | 'coriolis-disk';
export type NormalModeExcite = 'symmetric' | 'antisymmetric' | 'single-beat';

export type ChaosNormalCoriolisParams = {
  mode: CompAdvancedMode;
  m1Kg: number;
  m2Kg: number;
  l1M: number;
  l2M: number;
  theta1Deg: number;
  theta2Deg: number;
  springKw: number;
  springKc: number;
  normalExcite: NormalModeExcite;
  diskOmegaRadps: number;
  puckSpeedMps: number;
};

export interface ChaosNormalCoriolisState {
  readonly t: number;
  // Double pendulum primary & perturbed
  readonly dpState: readonly [number, number, number, number];
  readonly dpShadow: readonly [number, number, number, number];
  readonly dpInitialEnergy: number;
  readonly dpCurrentEnergy: number;
  readonly dpMaxRelDrift: number;
  readonly poincarePts: readonly { th2: number; w2: number }[];
  // Normal modes
  readonly nmVerlet: VerletState;
  readonly nmPrevX1: number;
  readonly nmCrossingTimes: readonly number[];
  readonly nmTrail: readonly { t: number; x1: number; x2: number }[];
  // Coriolis disk (lab trajectory vs direct rotating-frame ODE)
  readonly labPos: { x: number; y: number };
  readonly labVel: { x: number; y: number };
  readonly rotDirectState: readonly [number, number, number, number];
  readonly coriolisDeviation: number;
  readonly coriolisTrail: readonly { lx: number; ly: number; rx: number; ry: number }[];
}

function doublePendulumEnergy(y: readonly [number, number, number, number], p: ChaosNormalCoriolisParams): number {
  const [th1, th2, w1, w2] = y;
  const m1 = p.m1Kg;
  const m2 = p.m2Kg;
  const L1 = p.l1M;
  const L2 = p.l2M;
  const g = CLASSROOM_GRAVITY;
  const ke =
    0.5 * (m1 + m2) * L1 * L1 * w1 * w1 +
    0.5 * m2 * L2 * L2 * w2 * w2 +
    m2 * L1 * L2 * w1 * w2 * Math.cos(th1 - th2);
  const pe = -(m1 + m2) * g * L1 * Math.cos(th1) - m2 * g * L2 * Math.cos(th2);
  return ke + pe;
}

function makeDoublePendulumDeriv(p: ChaosNormalCoriolisParams) {
  const m1 = p.m1Kg;
  const m2 = p.m2Kg;
  const L1 = p.l1M;
  const L2 = p.l2M;
  const g = CLASSROOM_GRAVITY;
  return (_t: number, y: readonly number[]): number[] => {
    const th1 = y[0]!;
    const th2 = y[1]!;
    const w1 = y[2]!;
    const w2 = y[3]!;
    const delta = th1 - th2;
    const sinD = Math.sin(delta);
    const cosD = Math.cos(delta);
    const denom1 = (2 * m1 + m2 - m2 * Math.cos(2 * delta));
    const a1 =
      (-g * (2 * m1 + m2) * Math.sin(th1) -
        m2 * g * Math.sin(th1 - 2 * th2) -
        2 * sinD * m2 * (w2 * w2 * L2 + w1 * w1 * L1 * cosD)) /
      (L1 * denom1);
    const a2 =
      (2 *
        sinD *
        (w1 * w1 * L1 * (m1 + m2) +
          g * (m1 + m2) * Math.cos(th1) +
          w2 * w2 * L2 * m2 * cosD)) /
      (L2 * denom1);
    return [w1, w2, a1, a2];
  };
}

export function createInitialState(params: ChaosNormalCoriolisParams): ChaosNormalCoriolisState {
  const th1 = degToRad(params.theta1Deg);
  const th2 = degToRad(params.theta2Deg);
  const dpState: [number, number, number, number] = [th1, th2, 0, 0];
  const dpShadow: [number, number, number, number] = [th1 + 1e-4, th2, 0, 0];
  const e0 = doublePendulumEnergy(dpState, params);

  const nmPos =
    params.normalExcite === 'symmetric'
      ? [0.6, 0.6]
      : params.normalExcite === 'antisymmetric'
        ? [0.6, -0.6]
        : [0.8, 0];

  const labPos = { x: 0, y: 0 };
  const labVel = { x: Math.max(0.2, params.puckSpeedMps), y: 0 };

  return {
    t: 0,
    dpState,
    dpShadow,
    dpInitialEnergy: e0,
    dpCurrentEnergy: e0,
    dpMaxRelDrift: 0,
    poincarePts: [],
    nmVerlet: { positions: nmPos, velocities: [0, 0], t: 0 },
    nmPrevX1: nmPos[0]!,
    nmCrossingTimes: [],
    nmTrail: [{ t: 0, x1: nmPos[0]!, x2: nmPos[1]! }],
    labPos,
    labVel,
    rotDirectState: [labPos.x, labPos.y, labVel.x, labVel.y],
    coriolisDeviation: 0,
    coriolisTrail: [{ lx: labPos.x, ly: labPos.y, rx: labPos.x, ry: labPos.y }]
  };
}

export function stepChaosNormalCoriolis(
  state: ChaosNormalCoriolisState,
  params: ChaosNormalCoriolisParams,
  dt: number
): StepResult<ChaosNormalCoriolisState> {
  if (!Number.isFinite(dt) || dt < 0) throw new Error(`Invalid dt: ${dt}`);
  if (dt === 0) return { nextState: state, events: [] };

  // 1. Double pendulum RK45
  let dpState = state.dpState;
  let dpShadow = state.dpShadow;
  let dpCurE = state.dpCurrentEnergy;
  let dpMaxRelDrift = state.dpMaxRelDrift;
  let poincarePts = state.poincarePts;
  if (params.mode === 'double-pendulum') {
    const deriv = makeDoublePendulumDeriv(params);
    const r1 = integrateAdaptiveRK45(state.dpState, state.t, dt, deriv, { absTol: 1e-11, relTol: 1e-10, maxSubsteps: 4000 });
    const r2 = integrateAdaptiveRK45(state.dpShadow, state.t, dt, deriv, { absTol: 1e-11, relTol: 1e-10, maxSubsteps: 4000 });
    dpState = [r1.state[0]!, r1.state[1]!, r1.state[2]!, r1.state[3]!];
    dpShadow = [r2.state[0]!, r2.state[1]!, r2.state[2]!, r2.state[3]!];
    dpCurE = doublePendulumEnergy(dpState, params);
    const scaleE = Math.abs(state.dpInitialEnergy) + 10;
    const relDrift = Math.abs(dpCurE - state.dpInitialEnergy) / scaleE;
    if (relDrift > dpMaxRelDrift) dpMaxRelDrift = relDrift;
    if (state.dpState[0]! < 0 && dpState[0]! >= 0 && dpState[2]! > 0) {
      poincarePts = [...poincarePts.slice(-120), { th2: dpState[1]!, w2: dpState[3]! }];
    }
  }

  // 2. Normal modes Verlet
  let nmVerlet = state.nmVerlet;
  let nmCrossings = state.nmCrossingTimes;
  let nmPrev = state.nmPrevX1;
  let nmTrail = state.nmTrail;
  if (params.mode === 'normal-modes') {
    const m = Math.max(0.2, params.m1Kg);
    const kw = Math.max(1, params.springKw);
    const kc = Math.max(0.1, params.springKc);
    const sub = Math.max(8, Math.ceil(dt / 0.002));
    const h = dt / sub;
    const accel = (pos: readonly number[]): number[] => {
      const x1 = pos[0]!;
      const x2 = pos[1]!;
      return [(-kw * x1 - kc * (x1 - x2)) / m, (-kw * x2 - kc * (x2 - x1)) / m];
    };
    for (let i = 0; i < sub; i++) {
      const prevT = nmVerlet.t;
      const prevX1 = nmVerlet.positions[0]!;
      nmVerlet = stepVelocityVerlet(nmVerlet, h, accel);
      const curX1 = nmVerlet.positions[0]!;
      if (prevX1 < 0 && curX1 >= 0) {
        const frac = -prevX1 / (curX1 - prevX1);
        nmCrossings = [...nmCrossings.slice(-20), prevT + frac * h];
      }
      nmPrev = curX1;
    }
    nmTrail = [...nmTrail.slice(-160), { t: nmVerlet.t, x1: nmVerlet.positions[0]!, x2: nmVerlet.positions[1]! }];
  }

  // 3. Coriolis disk
  let labPos = state.labPos;
  let rotDirect = state.rotDirectState;
  let corDev = state.coriolisDeviation;
  let corTrail = state.coriolisTrail;
  if (params.mode === 'coriolis-disk') {
    const Om = params.diskOmegaRadps;
    const nextT = state.t + dt;
    labPos = {
      x: state.labPos.x + state.labVel.x * dt,
      y: state.labPos.y + state.labVel.y * dt
    };
    const rotDeriv = (_t: number, y: readonly number[]): number[] => {
      const rx = y[0]!;
      const ry = y[1]!;
      const vx = y[2]!;
      const vy = y[3]!;
      // -2*(Omega x v) - Omega x (Omega x r) for Omega = (0, 0, Om)
      const ax = 2 * Om * vy + Om * Om * rx;
      const ay = -2 * Om * vx + Om * Om * ry;
      return [vx, vy, ax, ay];
    };
    const resRot = integrateAdaptiveRK45(state.rotDirectState, state.t, dt, rotDeriv, {
      absTol: 1e-11,
      relTol: 1e-10,
      maxSubsteps: 2000
    });
    rotDirect = [resRot.state[0]!, resRot.state[1]!, resRot.state[2]!, resRot.state[3]!];
    const cosOt = Math.cos(-Om * nextT);
    const sinOt = Math.sin(-Om * nextT);
    const rxFromLab = labPos.x * cosOt - labPos.y * sinOt;
    const ryFromLab = labPos.x * sinOt + labPos.y * cosOt;
    corDev = Math.hypot(rotDirect[0]! - rxFromLab, rotDirect[1]! - ryFromLab);
    corTrail = [...corTrail.slice(-180), { lx: labPos.x, ly: labPos.y, rx: rotDirect[0]!, ry: rotDirect[1]! }];
  }

  return {
    nextState: {
      t: state.t + dt,
      dpState,
      dpShadow,
      dpInitialEnergy: state.dpInitialEnergy,
      dpCurrentEnergy: dpCurE,
      dpMaxRelDrift,
      poincarePts,
      nmVerlet,
      nmPrevX1: nmPrev,
      nmCrossingTimes: nmCrossings,
      nmTrail,
      labPos,
      labVel: state.labVel,
      rotDirectState: rotDirect,
      coriolisDeviation: corDev,
      coriolisTrail: corTrail
    },
    events: []
  };
}

export function computeObservables(state: ChaosNormalCoriolisState): Record<string, number> {
  return {
    t: state.t,
    dpEnergyDriftRel: state.dpMaxRelDrift,
    dpDivergenceRad: Math.hypot(state.dpState[0]! - state.dpShadow[0]!, state.dpState[1]! - state.dpShadow[1]!),
    x1Nm: state.nmVerlet.positions[0]!,
    x2Nm: state.nmVerlet.positions[1]!,
    coriolisDeviation: state.coriolisDeviation
  };
}

export function checkInvariants(state: ChaosNormalCoriolisState, _i: ChaosNormalCoriolisState, params: ChaosNormalCoriolisParams): InvariantReport[] {
  const err = params.mode === 'coriolis-disk' ? state.coriolisDeviation : state.dpMaxRelDrift;
  return [
    {
      name: params.mode === 'coriolis-disk' ? '旋转系直积与实验室系坐标变换偏差' : '双摆 30s 长时 RK45 机械能相对漂移',
      measuredError: err,
      tolerance: 1e-6,
      passed: err < 1e-6
    }
  ];
}
