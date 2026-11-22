import { stepRK4, stepVelocityVerlet, type Vec2 } from '@physforge/physics-core';
import type { InvariantReport, PhysicsEvent, StepResult } from '@physforge/sim-sdk';
import { compileSafeFormula, type CompiledSafeFormula } from './safeAstCompiler.js';

export type OdeTemplateMode =
  | 'harmonic-custom'
  | 'lagrangian-pendulum'
  | 'kepler-2d'
  | 'custom-expr';

export type CustomOdeParams = {
  template: OdeTemplateMode;
  exprText: string;
  mass: number;
  stiffness: number;
  damping: number;
  driveAmp: number;
  driveOmega: number;
  initialPos: number;
  initialVel: number;
};

export interface CustomOdeState {
  readonly t: number;
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly initialEnergy: number;
  readonly initialAngularMom: number;
  readonly formulaError: string | null;
  readonly trail: readonly Vec2[];
  readonly events: readonly PhysicsEvent[];
}

const formulaCache = new Map<string, CompiledSafeFormula>();

function getCompiledFormula(exprText: string): { compiled: CompiledSafeFormula | null; error: string | null } {
  const key = exprText.trim();
  const hit = formulaCache.get(key);
  if (hit) return { compiled: hit, error: null };
  try {
    const compiled = compileSafeFormula(key);
    formulaCache.set(key, compiled);
    return { compiled, error: null };
  } catch (err) {
    return { compiled: null, error: err instanceof Error ? err.message : String(err) };
  }
}

function computeKeplerEnergy(x: number, y: number, vx: number, vy: number, mu: number): number {
  const r = Math.max(0.05, Math.hypot(x, y));
  return 0.5 * (vx * vx + vy * vy) - mu / r;
}

export function createInitialState(params: CustomOdeParams): CustomOdeState {
  if (params.template === 'kepler-2d') {
    const r0 = Math.max(0.4, Math.abs(params.initialPos) || 1.2);
    const mu = Math.max(0.5, params.stiffness);
    const vy0 = Math.abs(params.initialVel) > 1e-6 ? params.initialVel : Math.sqrt(mu / r0) * 0.85;
    return {
      t: 0,
      x: r0,
      y: 0,
      vx: 0,
      vy: vy0,
      initialEnergy: computeKeplerEnergy(r0, 0, 0, vy0, mu),
      initialAngularMom: r0 * vy0,
      formulaError: null,
      trail: [{ x: r0, y: 0 }],
      events: []
    };
  }

  let formulaError: string | null = null;
  if (params.template === 'custom-expr') {
    formulaError = getCompiledFormula(params.exprText).error;
  }

  const m = Math.max(0.1, params.mass);
  const k = params.stiffness;
  const x0 = params.initialPos;
  const v0 = params.initialVel;
  const initE =
    params.template === 'lagrangian-pendulum'
      ? 0.5 * m * v0 * v0 + m * 9.8 * (1 - Math.cos(x0))
      : 0.5 * m * v0 * v0 + 0.5 * k * x0 * x0;

  return {
    t: 0,
    x: x0,
    y: v0,
    vx: v0,
    vy: 0,
    initialEnergy: initE,
    initialAngularMom: 0,
    formulaError,
    trail: [{ x: x0, y: v0 }],
    events: []
  };
}

export function stepCustomOde(
  state: CustomOdeState,
  params: CustomOdeParams,
  dt: number
): StepResult<CustomOdeState> {
  if (!Number.isFinite(dt) || dt < 0) {
    throw new Error(`Time step dt must be non-negative finite, got ${dt}.`);
  }
  if (dt === 0) return { nextState: state, events: [] };

  let nextX = state.x;
  let nextY = state.y;
  let nextVx = state.vx;
  let nextVy = state.vy;
  let formulaError = state.formulaError;

  if (params.template === 'kepler-2d') {
    const mu = Math.max(0.5, params.stiffness);
    const accelFn = (positions: readonly number[]) => {
      const px = positions[0]!;
      const py = positions[1]!;
      const rSq = Math.max(0.04, px * px + py * py);
      const invR3 = -mu / (rSq * Math.sqrt(rSq));
      return [invR3 * px, invR3 * py];
    };
    const next = stepVelocityVerlet(
      { positions: [state.x, state.y], velocities: [state.vx, state.vy], t: state.t },
      dt,
      accelFn
    );
    nextX = next.positions[0]!;
    nextY = next.positions[1]!;
    nextVx = next.velocities[0]!;
    nextVy = next.velocities[1]!;
  } else {
    const m = Math.max(0.1, params.mass);
    const k = params.stiffness;
    const gamma = params.damping;
    let accelScalar: (x: number, v: number, t: number) => number;

    if (params.template === 'lagrangian-pendulum') {
      const L = Math.max(0.3, params.stiffness * 0.1);
      accelScalar = (theta, omega, t) =>
        -(9.8 / L) * Math.sin(theta) - gamma * omega + params.driveAmp * Math.cos(params.driveOmega * t);
    } else if (params.template === 'custom-expr') {
      const { compiled, error } = getCompiledFormula(params.exprText);
      formulaError = error;
      if (!compiled) {
        return {
          nextState: { ...state, formulaError },
          events: []
        };
      }
      accelScalar = (x, v, t) =>
        compiled.evaluate({
          x,
          v,
          theta: x,
          omega: v,
          t,
          k,
          m,
          g: 9.8,
          A: params.driveAmp,
          w: params.driveOmega,
          gamma,
          mu: k
        });
    } else {
      accelScalar = (x, v, t) =>
        (-(k * x) - gamma * v + params.driveAmp * Math.cos(params.driveOmega * t)) / m;
    }

    const nextVec = stepRK4([state.x, state.vx], state.t, dt, (tLocal: number, yVec: readonly number[]) => [
      yVec[1]!,
      accelScalar(yVec[0]!, yVec[1]!, tLocal)
    ]);
    nextX = nextVec[0]!;
    nextVx = nextVec[1]!;
    nextY = nextVx;
  }

  const nextPt = params.template === 'kepler-2d' ? { x: nextX, y: nextY } : { x: nextX, y: nextVx };
  const trail =
    state.trail.length >= 900 ? [...state.trail.slice(state.trail.length - 899), nextPt] : [...state.trail, nextPt];

  return {
    nextState: {
      t: state.t + dt,
      x: nextX,
      y: nextY,
      vx: nextVx,
      vy: nextVy,
      initialEnergy: state.initialEnergy,
      initialAngularMom: state.initialAngularMom,
      formulaError,
      trail,
      events: state.events
    },
    events: []
  };
}

export function computeObservables(state: CustomOdeState, params: CustomOdeParams): Record<string, number> {
  const m = Math.max(0.1, params.mass);
  const energy =
    params.template === 'kepler-2d'
      ? computeKeplerEnergy(state.x, state.y, state.vx, state.vy, Math.max(0.5, params.stiffness))
      : params.template === 'lagrangian-pendulum'
        ? 0.5 * m * state.vx * state.vx + m * 9.8 * (1 - Math.cos(state.x))
        : 0.5 * m * state.vx * state.vx + 0.5 * params.stiffness * state.x * state.x;

  return {
    x: state.x,
    v: state.vx,
    y: state.y,
    energy,
    angularMomentum: state.x * state.vy - state.y * state.vx
  };
}

export function checkInvariants(state: CustomOdeState, _init: CustomOdeState, params: CustomOdeParams): InvariantReport[] {
  if (params.template === 'kepler-2d') {
    const mu = Math.max(0.5, params.stiffness);
    const eNow = computeKeplerEnergy(state.x, state.y, state.vx, state.vy, mu);
    const lNow = state.x * state.vy - state.y * state.vx;
    const eErr = Math.abs(eNow - state.initialEnergy) / Math.max(Math.abs(state.initialEnergy), 1e-9);
    const lErr = Math.abs(lNow - state.initialAngularMom) / Math.max(Math.abs(state.initialAngularMom), 1e-9);
    return [
      { name: '开普勒轨道机械能守恒 (ΔE/|E₀|)', measuredError: eErr, tolerance: 1e-4, passed: eErr < 1e-4 },
      { name: '角动量守恒 (ΔL/|L₀|)', measuredError: lErr, tolerance: 1e-6, passed: lErr < 1e-6 }
    ];
  }
  if (params.damping === 0 && params.driveAmp === 0 && params.template === 'harmonic-custom') {
    const m = Math.max(0.1, params.mass);
    const eNow = 0.5 * m * state.vx * state.vx + 0.5 * params.stiffness * state.x * state.x;
    const err = Math.abs(eNow - state.initialEnergy) / Math.max(Math.abs(state.initialEnergy), 1e-9);
    return [{ name: '无阻尼谐振机械能守恒', measuredError: err, tolerance: 1e-5, passed: err < 1e-5 }];
  }
  return [];
}
