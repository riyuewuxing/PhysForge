import {
  bisectEvent,
  CLASSROOM_GRAVITY,
  degToRad,
  solveUdwadiaKalaba,
  stepRK4,
  type Vec2
} from '@physforge/physics-core';
import type { InvariantReport, PhysicsEvent, StepResult } from '@physforge/sim-sdk';

export type VerticalTrackMode = 'outer-dome' | 'inner-loop' | 'light-rod';

export type VerticalCircularParams = {
  trackMode: VerticalTrackMode;
  mass: number;
  radius: number;
  vLaunch: number;
  startAngleDeg: number;
};

export interface VerticalCircularState {
  readonly t: number;
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly normalForceN: number;
  readonly derailed: boolean;
  readonly derailAngleDeg: number | null;
  readonly initialEnergy: number;
  readonly trail: readonly Vec2[];
  readonly events: readonly PhysicsEvent[];
}

function evaluateConstrainedReaction(
  x: number,
  y: number,
  vx: number,
  vy: number,
  mass: number,
  g: number,
  trackMode: VerticalTrackMode
): { ax: number; ay: number; radialScalarForce: number } {
  const uk = solveUdwadiaKalaba({
    massDiagonal: [mass, mass],
    unconstrainedAccel: [0, -g],
    constraintMatrixA: [[x, y]],
    constraintVectorB: [-(vx * vx + vy * vy)]
  });
  const fcX = uk.constraintForce[0]!;
  const fcY = uk.constraintForce[1]!;
  const r = Math.max(1e-6, Math.hypot(x, y));
  // outward radial projection for outer-dome (FN > 0 pushes outward), inward radial projection for inner-loop (FN > 0 pushes inward)
  const radOut = (fcX * x + fcY * y) / r;
  const radialScalarForce = trackMode === 'outer-dome' ? radOut : -radOut;
  return {
    ax: uk.acceleration[0]!,
    ay: uk.acceleration[1]!,
    radialScalarForce
  };
}

export function createInitialState(params: VerticalCircularParams): VerticalCircularState {
  const R = Math.max(0.4, params.radius);
  const g = CLASSROOM_GRAVITY;
  let x = 0;
  let y = R;
  let vx = params.vLaunch;
  let vy = 0;

  if (params.trackMode === 'outer-dome') {
    const th = degToRad(Math.max(1e-4, Math.min(80, params.startAngleDeg)));
    x = R * Math.sin(th);
    y = R * Math.cos(th);
    vx = params.vLaunch * Math.cos(th);
    vy = -params.vLaunch * Math.sin(th);
  } else {
    // inner-loop or light-rod: launch horizontally from bottom (0, -R)
    x = 0;
    y = -R;
    vx = params.vLaunch;
    vy = 0;
  }

  const react = evaluateConstrainedReaction(x, y, vx, vy, params.mass, g, params.trackMode);
  const initE = 0.5 * params.mass * (vx * vx + vy * vy) + params.mass * g * y;

  return {
    t: 0,
    x,
    y,
    vx,
    vy,
    normalForceN: react.radialScalarForce,
    derailed: false,
    derailAngleDeg: null,
    initialEnergy: initE,
    trail: [{ x, y }],
    events: []
  };
}

function advanceConstrained(
  s: { t: number; x: number; y: number; vx: number; vy: number },
  params: VerticalCircularParams,
  dt: number
): { t: number; x: number; y: number; vx: number; vy: number } {
  const R = Math.max(0.4, params.radius);
  const g = CLASSROOM_GRAVITY;
  // Project angle theta smoothly and step angular ODE d2theta/dt2 = ... for exact circle geometry, then verify force via UdwadiaKalaba!
  const theta0 = Math.atan2(s.x, s.y); // angle from +y vertical axis (0 at top, pi at bottom)
  const omega0 = (s.vx * s.y - s.vy * s.x) / (R * R);

  const next = stepRK4([theta0, omega0], s.t, dt, (_t, yv) => [
    yv[1]!,
    (g / R) * Math.sin(yv[0]!)
  ]);
  const th = next[0]!;
  const om = next[1]!;
  return {
    t: s.t + dt,
    x: R * Math.sin(th),
    y: R * Math.cos(th),
    vx: R * om * Math.cos(th),
    vy: -R * om * Math.sin(th)
  };
}

export function stepVerticalCircular(
  state: VerticalCircularState,
  params: VerticalCircularParams,
  dt: number
): StepResult<VerticalCircularState> {
  if (!Number.isFinite(dt) || dt < 0) throw new Error(`Invalid dt: ${dt}`);
  if (dt === 0) return { nextState: state, events: [] };

  const g = CLASSROOM_GRAVITY;
  if (state.derailed) {
    const nextVy = state.vy - g * dt;
    const nextX = state.x + state.vx * dt;
    const nextY = state.y + 0.5 * (state.vy + nextVy) * dt;
    return {
      nextState: {
        ...state,
        t: state.t + dt,
        x: nextX,
        y: nextY,
        vy: nextVy,
        normalForceN: 0,
        trail: [...state.trail, { x: nextX, y: nextY }]
      },
      events: []
    };
  }

  const cur = { t: state.t, x: state.x, y: state.y, vx: state.vx, vy: state.vy };
  const cand = advanceConstrained(cur, params, dt);
  const reactEnd = evaluateConstrainedReaction(
    cand.x,
    cand.y,
    cand.vx,
    cand.vy,
    params.mass,
    g,
    params.trackMode
  );

  const stepEvents: PhysicsEvent[] = [];
  if (params.trackMode !== 'light-rod' && state.normalForceN > 0 && reactEnd.radialScalarForce <= 0) {
    const hit = bisectEvent(
      cur,
      cur.t,
      dt,
      (s, subDt) => advanceConstrained(s, params, subDt),
      (s) =>
        evaluateConstrainedReaction(s.x, s.y, s.vx, s.vy, params.mass, g, params.trackMode)
          .radialScalarForce,
      { timeTolerance: 1e-8, biasEndpoint: 'midpoint' }
    );
    if (hit) {
      const rem = dt - hit.timeOffset;
      const b = hit.state;
      const derailAngDeg = (Math.atan2(Math.abs(b.x), b.y) * 180) / Math.PI;
      const nextVy = b.vy - g * rem;
      const nextX = b.x + b.vx * rem;
      const nextY = b.y + 0.5 * (b.vy + nextVy) * rem;
      stepEvents.push({
        id: `derail-${hit.time.toFixed(6)}`,
        time: hit.time,
        label: `脱轨切换自由抛体 (θ_d=${derailAngDeg.toFixed(2)}°)`,
        position: { x: b.x, y: b.y },
        metrics: { derailAngleDeg: derailAngDeg }
      });
      return {
        nextState: {
          ...state,
          t: state.t + dt,
          x: nextX,
          y: nextY,
          vx: b.vx,
          vy: nextVy,
          normalForceN: 0,
          derailed: true,
          derailAngleDeg: derailAngDeg,
          trail: [...state.trail, { x: b.x, y: b.y }, { x: nextX, y: nextY }],
          events: [...state.events, ...stepEvents]
        },
        events: stepEvents
      };
    }
  }

  return {
    nextState: {
      ...state,
      ...cand,
      normalForceN: reactEnd.radialScalarForce,
      trail: [...state.trail, { x: cand.x, y: cand.y }]
    },
    events: []
  };
}

export function computeObservables(state: VerticalCircularState, params: VerticalCircularParams): Record<string, number> {
  const g = CLASSROOM_GRAVITY;
  const speed = Math.hypot(state.vx, state.vy);
  const energy = 0.5 * params.mass * speed * speed + params.mass * g * state.y;
  return {
    x: state.x,
    y: state.y,
    speed,
    normalForceN: state.normalForceN,
    energy
  };
}

export function checkInvariants(state: VerticalCircularState, _init: VerticalCircularState, params: VerticalCircularParams): InvariantReport[] {
  const obs = computeObservables(state, params);
  const relErr = Math.abs(obs.energy! - state.initialEnergy) / Math.max(Math.abs(state.initialEnergy), 1e-6);
  return [{ name: '竖直圆周机械能守恒 ΔE/E₀', measuredError: relErr, tolerance: 1e-6, passed: relErr < 1e-6 }];
}
