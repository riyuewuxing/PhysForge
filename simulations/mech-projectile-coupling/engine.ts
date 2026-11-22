import { bisectEvent, CLASSROOM_GRAVITY, degToRad, stepRK4, type Vec2 } from '@physforge/physics-core';
import type { InvariantReport, PhysicsEvent, StepResult } from '@physforge/sim-sdk';

export type ProjectileCouplingMode = 'incline-flat' | 'semicircle-trough' | 'safety-envelope';

export type ProjectileCouplingParams = {
  mode: ProjectileCouplingMode;
  v0: number;
  launchAngleDeg: number;
  inclineDeg: number;
  troughRadius: number;
  dragCoeff: number;
  mass: number;
};

export interface ProjectileCouplingState {
  readonly t: number;
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly landed: boolean;
  readonly impactTime: number | null;
  readonly initialEnergy: number;
  readonly trail: readonly Vec2[];
  readonly vacuumTrail: readonly Vec2[];
  readonly events: readonly PhysicsEvent[];
}

function surfaceSignedDistance(x: number, y: number, params: ProjectileCouplingParams): number {
  if (params.mode === 'incline-flat') {
    const theta = degToRad(params.inclineDeg);
    return y + x * Math.tan(theta);
  }
  if (params.mode === 'semicircle-trough') {
    const R = Math.max(0.5, params.troughRadius);
    return R * R - ((x - R) * (x - R) + y * y);
  }
  return y;
}

export function createInitialState(params: ProjectileCouplingParams): ProjectileCouplingState {
  const ang = params.mode === 'incline-flat' ? 0 : degToRad(params.launchAngleDeg);
  const vx = params.v0 * Math.cos(ang);
  const vy = params.v0 * Math.sin(ang);
  return {
    t: 0,
    x: 0,
    y: 0,
    vx,
    vy,
    landed: false,
    impactTime: null,
    initialEnergy: 0.5 * params.mass * (vx * vx + vy * vy),
    trail: [{ x: 0, y: 0 }],
    vacuumTrail: [{ x: 0, y: 0 }],
    events: []
  };
}

function advanceProjectile(
  s: { t: number; x: number; y: number; vx: number; vy: number },
  params: ProjectileCouplingParams,
  dt: number
): { t: number; x: number; y: number; vx: number; vy: number } {
  if (dt <= 0) return s;
  const g = CLASSROOM_GRAVITY;
  const m = Math.max(0.1, params.mass);
  const c = Math.max(0, params.dragCoeff);
  const nextVec = stepRK4([s.x, s.y, s.vx, s.vy], s.t, dt, (_t, yv) => {
    const vx = yv[2]!;
    const vy = yv[3]!;
    const spd = Math.hypot(vx, vy);
    const dragFactor = (c * spd) / m;
    return [vx, vy, -dragFactor * vx, -g - dragFactor * vy];
  });
  return { t: s.t + dt, x: nextVec[0]!, y: nextVec[1]!, vx: nextVec[2]!, vy: nextVec[3]! };
}

export function stepProjectileCoupling(
  state: ProjectileCouplingState,
  params: ProjectileCouplingParams,
  dt: number
): StepResult<ProjectileCouplingState> {
  if (!Number.isFinite(dt) || dt < 0) throw new Error(`Invalid dt: ${dt}`);
  if (dt === 0 || state.landed) return { nextState: state, events: [] };

  const curKin = { t: state.t, x: state.x, y: state.y, vx: state.vx, vy: state.vy };
  const candEnd = advanceProjectile(curKin, params, dt);
  const gEnd = surfaceSignedDistance(candEnd.x, candEnd.y, params);

  const stepEvents: PhysicsEvent[] = [];
  let landed = false;
  let impactTime = state.impactTime;
  let finalKin = candEnd;

  if (state.t > 1e-4 && gEnd <= 0) {
    const hit = bisectEvent(
      curKin,
      curKin.t,
      dt,
      (s, subDt) => advanceProjectile(s, params, subDt),
      (s) => surfaceSignedDistance(s.x, s.y, params),
      { timeTolerance: 1e-8, biasEndpoint: 'midpoint' }
    );
    if (hit) {
      finalKin = hit.state;
      landed = true;
      impactTime = hit.time;
      stepEvents.push({
        id: `impact-${hit.time.toFixed(6)}`,
        time: hit.time,
        label: '撞击斜面/曲面临界点',
        position: { x: hit.state.x, y: hit.state.y },
        metrics: { speed: Math.hypot(hit.state.vx, hit.state.vy) }
      });
    }
  }

  const trail = [...state.trail, { x: finalKin.x, y: finalKin.y }];
  const g = CLASSROOM_GRAVITY;
  const ang = params.mode === 'incline-flat' ? 0 : degToRad(params.launchAngleDeg);
  const vacX = params.v0 * Math.cos(ang) * finalKin.t;
  const vacY = params.v0 * Math.sin(ang) * finalKin.t - 0.5 * g * finalKin.t * finalKin.t;

  return {
    nextState: {
      ...state,
      ...finalKin,
      landed,
      impactTime,
      trail,
      vacuumTrail: [...state.vacuumTrail, { x: vacX, y: vacY }],
      events: [...state.events, ...stepEvents]
    },
    events: stepEvents
  };
}

export function computeObservables(state: ProjectileCouplingState, params: ProjectileCouplingParams): Record<string, number> {
  const m = Math.max(0.1, params.mass);
  const ke = 0.5 * m * (state.vx * state.vx + state.vy * state.vy);
  const pe = m * CLASSROOM_GRAVITY * state.y;
  return {
    x: state.x,
    y: state.y,
    vx: state.vx,
    vy: state.vy,
    kineticEnergy: ke,
    totalMechanicalEnergy: ke + pe
  };
}

export function checkInvariants(state: ProjectileCouplingState, _init: ProjectileCouplingState, params: ProjectileCouplingParams): InvariantReport[] {
  if (params.dragCoeff === 0) {
    const m = Math.max(0.1, params.mass);
    const eNow = 0.5 * m * (state.vx * state.vx + state.vy * state.vy) + m * CLASSROOM_GRAVITY * state.y;
    const err = Math.abs(eNow - state.initialEnergy) / Math.max(state.initialEnergy, 1e-9);
    return [{ name: '无阻力抛体机械能守恒', measuredError: err, tolerance: 1e-6, passed: err < 1e-6 }];
  }
  return [];
}
