import {
  CLASSROOM_GRAVITY,
  degToRad,
  stepHybridAutomaton,
  type HybridGuard
} from '@physforge/physics-core';
import type { InvariantReport, PhysicsEvent, StepResult } from '@physforge/sim-sdk';

export type RigidBodyShape = 'solid-sphere' | 'hollow-sphere' | 'solid-cylinder' | 'thin-ring';
export type RigidRollingScenario = 'flat-bowling-slip' | 'incline-race';

export const SHAPE_INERTIA_COEFF: Record<RigidBodyShape, number> = {
  'solid-sphere': 0.4,
  'hollow-sphere': 2 / 3,
  'solid-cylinder': 0.5,
  'thin-ring': 1.0
};

export type RigidRollingParams = {
  scenario: RigidRollingScenario;
  shape: RigidBodyShape;
  massKg: number;
  radiusM: number;
  v0Mps: number;
  omega0Radps: number;
  muK: number;
  inclineDeg: number;
};

export interface RigidRollingState {
  readonly t: number;
  readonly mode: 'slipping' | 'pure-rolling';
  readonly x: number;
  readonly v: number;
  readonly omega: number;
  readonly theta: number;
  readonly transitionTimeS: number | null;
  readonly transitionSpeedMps: number | null;
  readonly initialEnergyJ: number;
  readonly currentEnergyJ: number;
  readonly inclinePositions: Readonly<Record<RigidBodyShape, number>>;
  readonly events: readonly PhysicsEvent[];
}

function computeTotalEnergyJ(x: number, v: number, omega: number, params: RigidRollingParams): number {
  const m = Math.max(0.2, params.massKg);
  const R = Math.max(0.05, params.radiusM);
  const I = SHAPE_INERTIA_COEFF[params.shape] * m * R * R;
  const ke = 0.5 * m * v * v + 0.5 * I * omega * omega;
  const pe =
    params.scenario === 'incline-race'
      ? -m * CLASSROOM_GRAVITY * x * Math.sin(degToRad(params.inclineDeg))
      : 0;
  return ke + pe;
}

export function createInitialState(params: RigidRollingParams): RigidRollingState {
  const R = Math.max(0.05, params.radiusM);
  const v0 = params.scenario === 'incline-race' ? 0 : params.v0Mps;
  const w0 = params.scenario === 'incline-race' ? 0 : params.omega0Radps;
  const isRolling = params.scenario === 'incline-race' || Math.abs(v0 - w0 * R) < 1e-9;
  const e0 = computeTotalEnergyJ(0, v0, w0, params);

  return {
    t: 0,
    mode: isRolling ? 'pure-rolling' : 'slipping',
    x: 0,
    v: v0,
    omega: w0,
    theta: 0,
    transitionTimeS: isRolling ? 0 : null,
    transitionSpeedMps: isRolling ? v0 : null,
    initialEnergyJ: e0,
    currentEnergyJ: e0,
    inclinePositions: {
      'solid-sphere': 0,
      'hollow-sphere': 0,
      'solid-cylinder': 0,
      'thin-ring': 0
    },
    events: []
  };
}

export function stepRigidRollingSlip(
  state: RigidRollingState,
  params: RigidRollingParams,
  dt: number
): StepResult<RigidRollingState> {
  if (!Number.isFinite(dt) || dt < 0) throw new Error(`Invalid dt: ${dt}`);
  if (dt === 0) return { nextState: state, events: [] };

  const R = Math.max(0.05, params.radiusM);
  const c = SHAPE_INERTIA_COEFF[params.shape];
  const muK = Math.max(0.01, params.muK);

  if (params.scenario === 'incline-race') {
    const sinTh = Math.sin(degToRad(Math.max(2, params.inclineDeg)));
    const aSel = (CLASSROOM_GRAVITY * sinTh) / (1 + c);
    const nextT = state.t + dt;
    const nextV = state.v + aSel * dt;
    const nextX = state.x + state.v * dt + 0.5 * aSel * dt * dt;
    const nextOmega = nextV / R;
    const nextTheta = nextX / R;
    const inclinePositions: Record<RigidBodyShape, number> = {
      'solid-sphere': 0.5 * ((CLASSROOM_GRAVITY * sinTh) / (1 + 0.4)) * nextT * nextT,
      'solid-cylinder': 0.5 * ((CLASSROOM_GRAVITY * sinTh) / (1 + 0.5)) * nextT * nextT,
      'hollow-sphere': 0.5 * ((CLASSROOM_GRAVITY * sinTh) / (1 + 2 / 3)) * nextT * nextT,
      'thin-ring': 0.5 * ((CLASSROOM_GRAVITY * sinTh) / (1 + 1.0)) * nextT * nextT
    };
    return {
      nextState: {
        ...state,
        t: nextT,
        mode: 'pure-rolling',
        x: nextX,
        v: nextV,
        omega: nextOmega,
        theta: nextTheta,
        initialEnergyJ: state.initialEnergyJ,
        currentEnergyJ: computeTotalEnergyJ(nextX, nextV, nextOmega, params),
        inclinePositions
      },
      events: []
    };
  }

  // Flat bowling slip -> pure rolling via HybridAutomaton
  const initialSlipSign = Math.sign(state.v - state.omega * R) || 1;
  const advanceContinuous = (s: RigidRollingState, h: number): RigidRollingState => {
    if (s.mode === 'pure-rolling') {
      const nextX = s.x + s.v * h;
      const nextTh = s.theta + s.omega * h;
      return {
        ...s,
        t: s.t + h,
        x: nextX,
        theta: nextTh,
        currentEnergyJ: computeTotalEnergyJ(nextX, s.v, s.omega, params)
      };
    }
    const slipNow = s.v - s.omega * R;
    const sgn = Math.sign(slipNow) || initialSlipSign;
    const a = -sgn * muK * CLASSROOM_GRAVITY;
    const alpha = (sgn * muK * CLASSROOM_GRAVITY) / (c * R);
    const nextV = s.v + a * h;
    const nextOmega = s.omega + alpha * h;
    const nextX = s.x + s.v * h + 0.5 * a * h * h;
    const nextTh = s.theta + s.omega * h + 0.5 * alpha * h * h;
    return {
      ...s,
      t: s.t + h,
      x: nextX,
      v: nextV,
      omega: nextOmega,
      theta: nextTh,
      currentEnergyJ: computeTotalEnergyJ(nextX, nextV, nextOmega, params)
    };
  };

  const guards: HybridGuard<'slipping' | 'pure-rolling', RigidRollingState>[] = [
    {
      id: 'pure-rolling-lock',
      label: '进入 v = ωR 纯滚动模态',
      fromModes: ['slipping'],
      biasEndpoint: 'positive',
      eventFn: (s) => -initialSlipSign * (s.v - s.omega * R),
      reset: (boundaryState, evTime) => {
        const vMatched = 0.5 * (boundaryState.v + boundaryState.omega * R);
        return {
          nextState: {
            ...boundaryState,
            mode: 'pure-rolling',
            v: vMatched,
            omega: vMatched / R,
            transitionTimeS: evTime,
            transitionSpeedMps: vMatched
          },
          metrics: { transitionTimeS: evTime, transitionSpeedMps: vMatched }
        };
      }
    }
  ];

  const out = stepHybridAutomaton<'slipping' | 'pure-rolling', RigidRollingState>(
    { advanceContinuous, guards, timeTolerance: 1e-9 },
    state,
    dt
  );
  const newEvs: PhysicsEvent[] = out.events.map((e) => ({
    id: e.id,
    time: e.time,
    label: e.label,
    metrics: e.metrics
  }));
  return {
    nextState: {
      ...out.nextState,
      events: newEvs.length ? [...out.nextState.events, ...newEvs] : out.nextState.events
    },
    events: newEvs
  };
}

export function computeObservables(state: RigidRollingState, params: RigidRollingParams): Record<string, number> {
  return {
    t: state.t,
    x: state.x,
    v: state.v,
    omegaR: state.omega * params.radiusM,
    slipSpeed: state.v - state.omega * params.radiusM,
    currentEnergyJ: state.currentEnergyJ
  };
}

export function checkInvariants(state: RigidRollingState, _i: RigidRollingState, params: RigidRollingParams): InvariantReport[] {
  const eDrift =
    params.scenario === 'incline-race'
      ? Math.abs(state.currentEnergyJ - state.initialEnergyJ) / Math.max(1e-6, Math.abs(state.initialEnergyJ) + 1)
      : state.mode === 'pure-rolling'
        ? Math.abs(state.v - state.omega * params.radiusM)
        : 0;
  return [
    {
      name: params.scenario === 'incline-race' ? '纯滚斜面机械能相对漂移' : '纯滚动后滑移残差 |v - ωR|',
      measuredError: eDrift,
      tolerance: 1e-6,
      passed: eDrift < 1e-6
    }
  ];
}
