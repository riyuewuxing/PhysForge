import { bisectEvent, CLASSROOM_GRAVITY, degToRad, stepRK4 } from '@physforge/physics-core';
import type { InvariantReport, PhysicsEvent, StepResult } from '@physforge/sim-sdk';

export type SpringSepParams = {
  mass1: number;
  mass2: number;
  springK: number;
  inclineDeg: number;
  initialComp: number;
  externalForce: number;
};

export interface SpringSepState {
  readonly t: number;
  readonly s1: number;
  readonly v1: number;
  readonly s2: number;
  readonly v2: number;
  readonly normalForceN: number;
  readonly separated: boolean;
  readonly separationPosS: number | null;
  readonly separationTime: number | null;
  readonly initialEnergy: number;
  readonly externalWork: number;
  readonly events: readonly PhysicsEvent[];
}

function computeCoupledForceAndNormal(
  s: number,
  params: SpringSepParams
): { accel: number; normalForce: number } {
  const m1 = Math.max(0.1, params.mass1);
  const m2 = Math.max(0.1, params.mass2);
  const gSin = CLASSROOM_GRAVITY * Math.sin(degToRad(params.inclineDeg));
  const fSpring = -params.springK * s;
  const accel = (fSpring + params.externalForce) / (m1 + m2) - gSin;
  // m2*accel = F_N + F_ext - m2*gSin => F_N = (m2*fSpring - m1*F_ext)/(m1+m2)
  const normalForce = (m2 * fSpring - m1 * params.externalForce) / (m1 + m2);
  return { accel, normalForce };
}

export function createInitialState(params: SpringSepParams): SpringSepState {
  const s0 = -Math.abs(params.initialComp);
  const { normalForce } = computeCoupledForceAndNormal(s0, params);
  const gSin = CLASSROOM_GRAVITY * Math.sin(degToRad(params.inclineDeg));
  const peSpring = 0.5 * params.springK * s0 * s0;
  const peGrav = (params.mass1 + params.mass2) * gSin * s0;
  return {
    t: 0,
    s1: s0,
    v1: 0,
    s2: s0,
    v2: 0,
    normalForceN: Math.max(0, normalForce),
    separated: normalForce <= 0,
    separationPosS: normalForce <= 0 ? s0 : null,
    separationTime: normalForce <= 0 ? 0 : null,
    initialEnergy: peSpring + peGrav,
    externalWork: 0,
    events: []
  };
}

function advanceCoupled(
  st: { t: number; s: number; v: number },
  params: SpringSepParams,
  dt: number
): { t: number; s: number; v: number } {
  const next = stepRK4([st.s, st.v], st.t, dt, (_t, yv) => [
    yv[1]!,
    computeCoupledForceAndNormal(yv[0]!, params).accel
  ]);
  return { t: st.t + dt, s: next[0]!, v: next[1]! };
}

function advanceSingleSpring(
  s: number,
  v: number,
  t: number,
  dt: number,
  springK: number,
  m1: number,
  gSin: number
): { s: number; v: number } {
  const next = stepRK4([s, v], t, dt, (_t, yv) => [
    yv[1]!,
    (-springK * yv[0]!) / m1 - gSin
  ]);
  return { s: next[0]!, v: next[1]! };
}

export function stepSpringSeparation(
  state: SpringSepState,
  params: SpringSepParams,
  dt: number
): StepResult<SpringSepState> {
  if (!Number.isFinite(dt) || dt < 0) throw new Error(`Invalid dt: ${dt}`);
  if (dt === 0) return { nextState: state, events: [] };

  const m1 = Math.max(0.1, params.mass1);
  const m2 = Math.max(0.1, params.mass2);
  const gSin = CLASSROOM_GRAVITY * Math.sin(degToRad(params.inclineDeg));

  if (state.separated) {
    const res1 = advanceSingleSpring(state.s1, state.v1, state.t, dt, params.springK, m1, gSin);
    const a2 = params.externalForce / m2 - gSin;
    const nextV2 = state.v2 + a2 * dt;
    const nextS2 = state.s2 + 0.5 * (state.v2 + nextV2) * dt;
    const dWork = params.externalForce * (nextS2 - state.s2);
    return {
      nextState: {
        ...state,
        t: state.t + dt,
        s1: res1.s,
        v1: res1.v,
        s2: nextS2,
        v2: nextV2,
        normalForceN: 0,
        externalWork: state.externalWork + dWork
      },
      events: []
    };
  }

  const cur = { t: state.t, s: state.s1, v: state.v1 };
  const cand = advanceCoupled(cur, params, dt);
  const nEnd = computeCoupledForceAndNormal(cand.s, params).normalForce;

  if (state.normalForceN > 0 && nEnd <= 0) {
    const hit = bisectEvent(
      cur,
      cur.t,
      dt,
      (s, subDt) => advanceCoupled(s, params, subDt),
      (s) => computeCoupledForceAndNormal(s.s, params).normalForce,
      { timeTolerance: 1e-8, biasEndpoint: 'midpoint' }
    );
    if (hit) {
      const rem = dt - hit.timeOffset;
      const b = hit.state;
      const res1 = advanceSingleSpring(b.s, b.v, b.t, rem, params.springK, m1, gSin);
      const a2 = params.externalForce / m2 - gSin;
      const nextV2 = b.v + a2 * rem;
      const nextS2 = b.s + 0.5 * (b.v + nextV2) * rem;
      const dWork = params.externalForce * (nextS2 - state.s1);
      const ev: PhysicsEvent = {
        id: `sep-${hit.time.toFixed(6)}`,
        time: hit.time,
        label: `物块临界分离 (FN=0, s=${b.s.toFixed(3)}m)`,
        position: { x: b.s, y: 0 },
        metrics: { separationS: b.s, normalForceAtSep: computeCoupledForceAndNormal(b.s, params).normalForce }
      };
      return {
        nextState: {
          ...state,
          t: state.t + dt,
          s1: res1.s,
          v1: res1.v,
          s2: nextS2,
          v2: nextV2,
          normalForceN: 0,
          separated: true,
          separationPosS: b.s,
          separationTime: hit.time,
          externalWork: state.externalWork + dWork,
          events: [...state.events, ev]
        },
        events: [ev]
      };
    }
  }

  const dWork = params.externalForce * (cand.s - state.s1);
  return {
    nextState: {
      ...state,
      t: state.t + dt,
      s1: cand.s,
      v1: cand.v,
      s2: cand.s,
      v2: cand.v,
      normalForceN: Math.max(0, nEnd),
      externalWork: state.externalWork + dWork
    },
    events: []
  };
}

export function computeObservables(state: SpringSepState, params: SpringSepParams): Record<string, number> {
  const gSin = CLASSROOM_GRAVITY * Math.sin(degToRad(params.inclineDeg));
  const ke = 0.5 * params.mass1 * state.v1 * state.v1 + 0.5 * params.mass2 * state.v2 * state.v2;
  const pe = 0.5 * params.springK * state.s1 * state.s1 + (params.mass1 * state.s1 + params.mass2 * state.s2) * gSin;
  return {
    s1: state.s1,
    s2: state.s2,
    v1: state.v1,
    v2: state.v2,
    normalForceN: state.normalForceN,
    mechanicalEnergy: ke + pe - state.externalWork
  };
}

export function checkInvariants(state: SpringSepState, _init: SpringSepState, params: SpringSepParams): InvariantReport[] {
  const obs = computeObservables(state, params);
  const err = Math.abs(obs.mechanicalEnergy! - state.initialEnergy) / Math.max(Math.abs(state.initialEnergy), 1e-6);
  return [{ name: '弹簧系统机械能与外力功核算守恒', measuredError: err, tolerance: 1e-6, passed: err < 1e-6 }];
}
