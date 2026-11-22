import { CLASSROOM_GRAVITY } from '@physforge/physics-core';
import type { InvariantReport, PhysicsEvent, StepResult } from '@physforge/sim-sdk';

export type TurntableMode = 'turntable-dual' | 'conical-pendulum';

export type ConicalTurntableParams = {
  mode: TurntableMode;
  omega: number;
  massA: number;
  massB: number;
  radiusA: number;
  radiusB: number;
  mu: number;
  pendulumLength: number;
};

export interface ConicalTurntableState {
  readonly t: number;
  readonly angleRad: number;
  readonly rA: number;
  readonly rB: number;
  readonly tensionN: number;
  readonly frictionAN: number;
  readonly frictionBN: number;
  readonly omega1: number;
  readonly omega2: number;
  readonly omega3: number;
  readonly slippingOut: boolean;
  readonly coneAngleDeg: number;
  readonly events: readonly PhysicsEvent[];
}

export function computeCriticalOmegas(params: ConicalTurntableParams): {
  omega1: number;
  omega2: number;
  omega3: number;
} {
  const g = CLASSROOM_GRAVITY;
  const mu = Math.max(0, params.mu);
  const mA = Math.max(0.1, params.massA);
  const mB = Math.max(0.1, params.massB);
  const rA = Math.max(0.1, params.radiusA);
  const rB = Math.max(rA + 0.1, params.radiusB);
  const denom = Math.max(1e-6, mB * rB - mA * rA);

  const omega1 = Math.sqrt((mu * g) / rB);
  const omega2 = Math.sqrt((mu * mB * g) / denom);
  const omega3 = Math.sqrt((mu * (mA + mB) * g) / denom);
  return { omega1, omega2, omega3 };
}

function solveStatics(params: ConicalTurntableParams): Omit<
  ConicalTurntableState,
  't' | 'angleRad' | 'rA' | 'rB' | 'events'
> {
  const g = CLASSROOM_GRAVITY;
  const { omega1, omega2, omega3 } = computeCriticalOmegas(params);

  if (params.mode === 'conical-pendulum') {
    const L = Math.max(0.5, params.pendulumLength);
    const omegaCrit = Math.sqrt(g / L);
    const cosTheta = params.omega > omegaCrit ? (g / (params.omega * params.omega * L)) : 1;
    const coneAngleDeg = (Math.acos(Math.min(1, Math.max(0, cosTheta))) * 180) / Math.PI;
    const T = params.massA * params.omega * params.omega * L;
    return {
      tensionN: params.omega > omegaCrit ? T : params.massA * g,
      frictionAN: 0,
      frictionBN: 0,
      omega1: omegaCrit,
      omega2: omegaCrit,
      omega3: omegaCrit,
      slippingOut: false,
      coneAngleDeg
    };
  }

  const w = params.omega;
  const wSq = w * w;
  const fAMax = params.mu * params.massA * g;
  const fBMax = params.mu * params.massB * g;
  const slippingOut = w > omega3;

  let tensionN = 0;
  let frictionAN = params.massA * wSq * params.radiusA;
  let frictionBN = params.massB * wSq * params.radiusB;

  if (w > omega1) {
    frictionBN = fBMax;
    tensionN = Math.max(0, params.massB * wSq * params.radiusB - fBMax);
    frictionAN = Math.max(-fAMax, params.massA * wSq * params.radiusA - tensionN);
  }

  return {
    tensionN,
    frictionAN,
    frictionBN,
    omega1,
    omega2,
    omega3,
    slippingOut,
    coneAngleDeg: 0
  };
}

export function createInitialState(params: ConicalTurntableParams): ConicalTurntableState {
  const s = solveStatics(params);
  return {
    t: 0,
    angleRad: 0,
    rA: params.radiusA,
    rB: params.radiusB,
    ...s,
    events: []
  };
}

export function stepConicalTurntable(
  state: ConicalTurntableState,
  params: ConicalTurntableParams,
  dt: number
): StepResult<ConicalTurntableState> {
  if (!Number.isFinite(dt) || dt < 0) throw new Error(`Invalid dt: ${dt}`);
  if (dt === 0) return { nextState: state, events: [] };

  const s = solveStatics(params);
  let rA = state.rA;
  let rB = state.rB;
  if (params.mode === 'turntable-dual' && s.slippingOut) {
    const excessAccel = Math.max(0.2, (params.omega * params.omega - s.omega3 * s.omega3) * 0.5);
    rA += excessAccel * (state.t + dt) * dt;
    rB += excessAccel * (state.t + dt) * dt;
  } else {
    rA = params.radiusA;
    rB = params.radiusB;
  }

  return {
    nextState: {
      t: state.t + dt,
      angleRad: state.angleRad + params.omega * dt,
      rA,
      rB,
      ...s,
      events: state.events
    },
    events: []
  };
}

export function computeObservables(state: ConicalTurntableState): Record<string, number> {
  return {
    tensionN: state.tensionN,
    frictionAN: state.frictionAN,
    frictionBN: state.frictionBN,
    rB: state.rB,
    coneAngleDeg: state.coneAngleDeg
  };
}

export function checkInvariants(state: ConicalTurntableState, _init: ConicalTurntableState, params: ConicalTurntableParams): InvariantReport[] {
  if (params.mode === 'turntable-dual' && !state.slippingOut) {
    const req = params.massA * params.omega * params.omega * state.rA + params.massB * params.omega * params.omega * state.rB;
    const sumF = state.frictionAN + state.frictionBN + 2 * state.tensionN;
    const err = Math.abs(req - sumF);
    return [{ name: '双物块总向心力平衡 mAω²rA + mBω²rB = fA + fB + 2T', measuredError: err, tolerance: 1e-8, passed: err < 1e-8 }];
  }
  return [];
}
