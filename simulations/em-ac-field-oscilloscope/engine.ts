import { bisectEvent, CLASSROOM_GRAVITY, degToRad, stepRK4 } from '@physforge/physics-core';
import type { InvariantReport, PhysicsEvent, StepResult } from '@physforge/sim-sdk';

export type AcScopeMode =
  | 'ac-square-wave'
  | 'ac-sine-wave'
  | 'oscilloscope-lissajous'
  | 'equivalent-gravity';

export type AcScopeParams = {
  mode: AcScopeMode;
  periodT: number;
  accelA0: number;
  uAccelV: number;
  uXMaxV: number;
  uYMaxV: number;
  freqRatioYOverX: number;
  phaseDeltaDeg: number;
  eqFieldAccelX: number;
  eqFieldAccelY: number;
  pendulumLengthL: number;
  initialAngleDeg: number;
};

export interface GroupParticle {
  readonly t0Frac: number;
  readonly releaseT: number;
  readonly x: number;
  readonly v: number;
  readonly active: boolean;
}

export interface AcScopeState {
  readonly t: number;
  readonly particles: readonly GroupParticle[];
  readonly scopeTrail: readonly { x: number; y: number }[];
  readonly screenX: number;
  readonly screenY: number;
  readonly theta: number;
  readonly omega: number;
  readonly initialEqEnergy: number;
  readonly events: readonly PhysicsEvent[];
}

const RELEASE_FRACS = [0, 0.125, 0.25, 0.375] as const;

export function createInitialState(params: AcScopeParams): AcScopeState {
  const T = Math.max(0.2, params.periodT);
  const particles: GroupParticle[] = RELEASE_FRACS.map((frac) => ({
    t0Frac: frac,
    releaseT: frac * T,
    x: 0,
    v: 0,
    active: frac === 0
  }));

  const gEffX = params.eqFieldAccelX;
  const gEffY = -CLASSROOM_GRAVITY + params.eqFieldAccelY;
  const th0 = degToRad(params.initialAngleDeg);
  const L = Math.max(0.4, params.pendulumLengthL);
  const rx0 = L * Math.sin(th0);
  const ry0 = -L * Math.cos(th0);
  const eqPe0 = -(gEffX * rx0 + gEffY * ry0);

  return {
    t: 0,
    particles,
    scopeTrail: [],
    screenX: 0,
    screenY: 0,
    theta: th0,
    omega: 0,
    initialEqEnergy: eqPe0,
    events: []
  };
}

/**
 * Computes deflection on CRT screen using both analytical & numerical RK4 verification helper.
 */
export function integrateDeflectionTrajectory(
  uAccelV: number,
  uDeflectV: number,
  plateLenL1 = 0.08,
  plateDistD = 0.02,
  driftDistL2 = 0.16,
  eta = 1.75882001076e11
): { numericY: number; analyticalY: number } {
  const v0 = Math.sqrt(Math.max(1e-6, 2 * eta * uAccelV));
  const ay = (eta * uDeflectV) / plateDistD;
  const dtPlate = plateLenL1 / v0;
  let yv = [0, 0];
  const nSteps = 40;
  const h = dtPlate / nSteps;
  for (let i = 0; i < nSteps; i++) {
    yv = stepRK4(yv, i * h, h, (_t, s) => [s[1]!, ay]);
  }
  const dtDrift = driftDistL2 / v0;
  const numericY = yv[0]! + yv[1]! * dtDrift;
  const analyticalY = ((uDeflectV * plateLenL1) / (2 * plateDistD * uAccelV)) * (0.5 * plateLenL1 + driftDistL2);
  return { numericY, analyticalY };
}

function advanceAcSegment(
  particles: readonly GroupParticle[],
  t0: number,
  dt: number,
  accelVal: number,
  isSine: boolean,
  omegaAc: number,
  a0: number
): GroupParticle[] {
  return particles.map((p) => {
    if (!p.active) {
      // Check if particle activates during this segment
      const tEnd = t0 + dt;
      if (tEnd <= p.releaseT) return p;
      const activeDt = tEnd - p.releaseT;
      if (!isSine) {
        return {
          ...p,
          active: true,
          x: 0.5 * accelVal * activeDt * activeDt,
          v: accelVal * activeDt
        };
      }
      const res = stepRK4([p.x, p.v], p.releaseT, activeDt, (tau, s) => [
        s[1]!,
        a0 * Math.sin(omegaAc * tau)
      ]);
      return { ...p, active: true, x: res[0]!, v: res[1]! };
    }

    if (!isSine) {
      return {
        ...p,
        x: p.x + p.v * dt + 0.5 * accelVal * dt * dt,
        v: p.v + accelVal * dt
      };
    }

    const res = stepRK4([p.x, p.v], t0, dt, (tau, s) => [s[1]!, a0 * Math.sin(omegaAc * tau)]);
    return { ...p, x: res[0]!, v: res[1]! };
  });
}

function squareSignAt(t: number, halfT: number): number {
  const idx = Math.floor((t + 1e-12) / halfT);
  return idx % 2 === 0 ? 1 : -1;
}

export function stepAcScope(
  state: AcScopeState,
  params: AcScopeParams,
  dt: number
): StepResult<AcScopeState> {
  if (!Number.isFinite(dt) || dt < 0) throw new Error(`Invalid dt: ${dt}`);
  if (dt === 0) return { nextState: state, events: [] };

  const T = Math.max(0.2, params.periodT);
  const halfT = 0.5 * T;
  const omegaAc = (2 * Math.PI) / T;
  const events: PhysicsEvent[] = [];

  if (params.mode === 'ac-square-wave' || params.mode === 'ac-sine-wave') {
    let curT = state.t;
    let curP = state.particles;
    let rem = dt;
    const isSine = params.mode === 'ac-sine-wave';

    // Exactly localize every square-wave half-period flip via bisectEvent on triangle switch function
    let guard = 0;
    while (rem > 1e-13 && guard < 16) {
      guard++;
      const curHalfIdx = Math.floor((curT + 1e-12) / halfT);
      const nextFlipT = (curHalfIdx + 1) * halfT;
      if (!isSine && curT + rem > nextFlipT) {
        const hit = bisectEvent(
          { t: curT },
          curT,
          rem,
          (s, sub) => ({ t: s.t + sub }),
          (s) => nextFlipT - s.t,
          { timeTolerance: 1e-10, biasEndpoint: 'midpoint' }
        );
        const subDt = hit ? hit.timeOffset : nextFlipT - curT;
        const aVal = squareSignAt(curT, halfT) * params.accelA0;
        curP = advanceAcSegment(curP, curT, subDt, aVal, false, omegaAc, params.accelA0);
        curT += subDt;
        rem -= subDt;
        events.push({
          id: `ac-flip-${curHalfIdx}`,
          time: curT,
          label: '方波交变电场换向',
          metrics: { polarity: -aVal }
        });
      } else {
        const aVal = squareSignAt(curT, halfT) * params.accelA0;
        curP = advanceAcSegment(curP, curT, rem, aVal, isSine, omegaAc, params.accelA0);
        curT += rem;
        rem = 0;
      }
    }

    return {
      nextState: {
        ...state,
        t: state.t + dt,
        particles: curP,
        events: events.length > 0 ? [...state.events, ...events] : state.events
      },
      events
    };
  }

  if (params.mode === 'oscilloscope-lissajous') {
    const nt = state.t + dt;
    const wx = (2 * Math.PI) / T;
    const wy = wx * params.freqRatioYOverX;
    const delta = degToRad(params.phaseDeltaDeg);
    const ux = params.uXMaxV * Math.sin(wx * nt);
    const uy = params.uYMaxV * Math.sin(wy * nt + delta);
    const screenX = integrateDeflectionTrajectory(params.uAccelV, ux).analyticalY * 100;
    const screenY = integrateDeflectionTrajectory(params.uAccelV, uy).analyticalY * 100;
    const scopeTrail = [...state.scopeTrail.slice(-260), { x: screenX, y: screenY }];
    return {
      nextState: { ...state, t: nt, screenX, screenY, scopeTrail },
      events
    };
  }

  // Equivalent gravity pendulum mode
  const L = Math.max(0.4, params.pendulumLengthL);
  const gx = params.eqFieldAccelX;
  const gy = -CLASSROOM_GRAVITY + params.eqFieldAccelY;
  const gEff = Math.hypot(gx, gy);
  const thEq = Math.atan2(gx, -gy);

  const subN = Math.max(1, Math.ceil(dt / 0.004));
  const subH = dt / subN;
  let thOm = [state.theta, state.omega];
  for (let i = 0; i < subN; i++) {
    thOm = stepRK4(thOm, state.t + i * subH, subH, (_tau, y) => [
      y[1]!,
      -(gEff / L) * Math.sin(y[0]! - thEq)
    ]);
  }
  return {
    nextState: { ...state, t: state.t + dt, theta: thOm[0]!, omega: thOm[1]! },
    events
  };
}

export function computeObservables(state: AcScopeState, params: AcScopeParams): Record<string, number> {
  const gEffX = params.eqFieldAccelX;
  const gEffY = -CLASSROOM_GRAVITY + params.eqFieldAccelY;
  const L = Math.max(0.4, params.pendulumLengthL);
  const rx = L * Math.sin(state.theta);
  const ry = -L * Math.cos(state.theta);
  const eqTotalEnergy = 0.5 * L * L * state.omega * state.omega - (gEffX * rx + gEffY * ry);

  return {
    t: state.t,
    x0: state.particles[0]?.x ?? 0,
    xQuarter: state.particles[2]?.x ?? 0,
    screenXCm: state.screenX,
    screenYCm: state.screenY,
    eqTotalEnergy,
    gEffMag: Math.hypot(gEffX, gEffY)
  };
}

export function checkInvariants(
  state: AcScopeState,
  _initial: AcScopeState,
  params: AcScopeParams
): InvariantReport[] {
  const obs = computeObservables(state, params);
  if (params.mode === 'equivalent-gravity') {
    const err = Math.abs(obs.eqTotalEnergy! - state.initialEqEnergy) / Math.max(1, Math.abs(state.initialEqEnergy));
    return [
      {
        name: '等效重力场机械能与电势能守恒',
        measuredError: err,
        tolerance: 1e-5,
        passed: Number.isFinite(err) && err < 1e-5
      }
    ];
  }
  return [
    {
      name: '数值稳定性检定',
      measuredError: 0,
      tolerance: 1e-6,
      passed: Number.isFinite(obs.x0) && Number.isFinite(obs.screenXCm)
    }
  ];
}
