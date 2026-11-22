import { bisectEvent, degToRad, radToDeg, stepRK4 } from '@physforge/physics-core';
import type { InvariantReport, PhysicsEvent, StepResult } from '@physforge/sim-sdk';

export type ShmMode = 'pendulum-compare' | 'damped-free' | 'forced-resonance';

export type ShmResonanceParams = {
  mode: ShmMode;
  lengthL: number;
  gravityG: number;
  massM: number;
  initialAngleDeg: number;
  dampingGamma: number;
  driveAccelAmp: number;
  driveOmega: number;
};

export interface ShmResonanceState {
  readonly t: number;
  readonly theta: number;
  readonly omega: number;
  readonly thetaLinear: number;
  readonly omegaLinear: number;
  readonly maxSteadyTheta: number;
  readonly measuredPeriod: number | null;
  readonly lastUpwardCrossT: number | null;
  readonly initialEnergy: number;
  readonly events: readonly PhysicsEvent[];
}

export function computeNaturalOmega(params: ShmResonanceParams): number {
  return Math.sqrt(Math.max(0.1, params.gravityG) / Math.max(0.1, params.lengthL));
}

export function computeTheoreticalResonanceOmega(params: ShmResonanceParams): number {
  const w0Sq = params.gravityG / Math.max(0.1, params.lengthL);
  const gSq = params.dampingGamma * params.dampingGamma;
  return w0Sq > 2 * gSq ? Math.sqrt(w0Sq - 2 * gSq) : 0;
}

export function createInitialState(params: ShmResonanceParams): ShmResonanceState {
  const theta0 = degToRad(params.initialAngleDeg);
  const L = Math.max(0.1, params.lengthL);
  const m = Math.max(0.05, params.massM);
  const e0 = m * params.gravityG * L * (1 - Math.cos(theta0));
  return {
    t: 0,
    theta: theta0,
    omega: 0,
    thetaLinear: theta0,
    omegaLinear: 0,
    maxSteadyTheta: Math.abs(theta0),
    measuredPeriod: null,
    lastUpwardCrossT: null,
    initialEnergy: e0,
    events: []
  };
}

interface PendulumSubState {
  readonly t: number;
  readonly vec: readonly number[];
}

function advancePendulumSubstep(
  s: PendulumSubState,
  h: number,
  params: ShmResonanceParams
): PendulumSubState {
  const L = Math.max(0.1, params.lengthL);
  const gOverL = params.gravityG / L;
  const gamma = params.mode === 'pendulum-compare' ? 0 : Math.max(0, params.dampingGamma);
  const fDrive = params.mode === 'forced-resonance' ? params.driveAccelAmp : 0;
  const wd = params.driveOmega;

  const nextVec = stepRK4(s.vec, s.t, h, (tau, y) => {
    const th = y[0]!;
    const om = y[1]!;
    const thLin = y[2]!;
    const omLin = y[3]!;
    const drive = fDrive * Math.cos(wd * tau);
    return [
      om,
      -gOverL * Math.sin(th) - 2 * gamma * om + drive,
      omLin,
      -gOverL * thLin - 2 * gamma * omLin + drive
    ];
  });
  return { t: s.t + h, vec: nextVec };
}

export function stepShmResonance(
  state: ShmResonanceState,
  params: ShmResonanceParams,
  dt: number
): StepResult<ShmResonanceState> {
  if (!Number.isFinite(dt) || dt < 0) throw new Error(`Invalid dt: ${dt}`);
  if (dt === 0) return { nextState: state, events: [] };

  const maxSub = 0.004;
  const nSub = Math.max(1, Math.ceil(dt / maxSub));
  const subH = dt / nSub;

  let cur: PendulumSubState = {
    t: state.t,
    vec: [state.theta, state.omega, state.thetaLinear, state.omegaLinear]
  };
  let lastUpCross = state.lastUpwardCrossT;
  let measuredPeriod = state.measuredPeriod;
  let maxSteady = cur.t < 1 ? 0 : state.maxSteadyTheta;
  const events: PhysicsEvent[] = [];

  const advFn = (s: PendulumSubState, h: number) => advancePendulumSubstep(s, h, params);
  const thetaFn = (s: PendulumSubState) => s.vec[0]!;

  for (let i = 0; i < nSub; i++) {
    const prevTheta = cur.vec[0]!;
    const next = advFn(cur, subH);
    const nextTheta = next.vec[0]!;

    if (prevTheta < 0 && nextTheta >= 0 && next.vec[1]! > 0) {
      const hit = bisectEvent(cur, cur.t, subH, advFn, thetaFn, {
        timeTolerance: 1e-10,
        biasEndpoint: 'midpoint'
      });
      if (hit) {
        const tCross = hit.time;
        if (lastUpCross !== null && tCross - lastUpCross > 0.05) {
          measuredPeriod = tCross - lastUpCross;
          const ev: PhysicsEvent = {
            id: `period-${state.events.length + events.length}`,
            time: tCross,
            label: '完成一个全振动周期 (θ=0↑)',
            position: { x: 0, y: -params.lengthL },
            metrics: { measuredPeriod }
          };
          events.push(ev);
        }
        lastUpCross = tCross;
      }
    }

    cur = next;
    if (cur.t > 2) {
      maxSteady = Math.max(maxSteady, Math.abs(cur.vec[0]!));
    }
  }

  return {
    nextState: {
      ...state,
      t: cur.t,
      theta: cur.vec[0]!,
      omega: cur.vec[1]!,
      thetaLinear: cur.vec[2]!,
      omegaLinear: cur.vec[3]!,
      maxSteadyTheta: maxSteady,
      measuredPeriod,
      lastUpwardCrossT: lastUpCross,
      events: events.length > 0 ? [...state.events, ...events] : state.events
    },
    events
  };
}

export function computeObservables(
  state: ShmResonanceState,
  params: ShmResonanceParams
): Record<string, number> {
  const L = Math.max(0.1, params.lengthL);
  const m = Math.max(0.05, params.massM);
  const ek = 0.5 * m * L * L * state.omega * state.omega;
  const ep = m * params.gravityG * L * (1 - Math.cos(state.theta));
  const tension = m * params.gravityG * Math.cos(state.theta) + m * L * state.omega * state.omega;
  return {
    t: state.t,
    thetaRad: state.theta,
    thetaDeg: radToDeg(state.theta),
    omega: state.omega,
    thetaLinearRad: state.thetaLinear,
    thetaLinearDeg: radToDeg(state.thetaLinear),
    kineticEnergy: ek,
    potentialEnergy: ep,
    mechanicalEnergy: ek + ep,
    tensionN: tension,
    measuredPeriod: state.measuredPeriod ?? 0,
    w0: computeNaturalOmega(params)
  };
}

export function checkInvariants(
  state: ShmResonanceState,
  _initial: ShmResonanceState,
  params: ShmResonanceParams
): InvariantReport[] {
  const obs = computeObservables(state, params);
  const conservative =
    params.mode === 'pendulum-compare' ||
    (params.mode === 'damped-free' && params.dampingGamma === 0);

  const relEnergyErr =
    conservative && state.initialEnergy > 1e-12
      ? Math.abs(obs.mechanicalEnergy! - state.initialEnergy) / state.initialEnergy
      : 0;

  return [
    {
      name: conservative ? '非线性单摆机械能守恒' : '数值稳定性检验',
      measuredError: relEnergyErr,
      tolerance: 1e-6,
      passed: Number.isFinite(obs.mechanicalEnergy) && (!conservative || relEnergyErr < 1e-6)
    }
  ];
}
