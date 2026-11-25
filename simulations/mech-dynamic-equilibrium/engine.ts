import { CLASSROOM_GRAVITY, degToRad } from '@physforge/physics-core';
import type { InvariantReport, PhysicsEvent, StepResult } from '@physforge/sim-sdk';

export type EquilibriumMode = 'active-pulley-knot' | 'dead-knot-rotate' | 'hemisphere-similar' | 'hemisphere-suspension';
export type EquilibriumParams = {
  mode: EquilibriumMode;
  mass: number;
  baseAngleDeg: number;
  sweepAngleDeg: number;
  autoSweep: boolean;
  radiusM?: number;
  anchorHeightM?: number;
};
export type Point = { x: number; y: number };
export type Force = Point & { mag: number };
export type EquilibriumStatus = 'balanced' | 'infeasible' | 'singular' | 'ill-conditioned';
export interface SphereGeometry {
  readonly radius: number;
  readonly height: number;
  readonly anchor: Point;
  readonly ropeLength: number;
}
export interface EquilibriumState {
  readonly t: number;
  readonly mode: EquilibriumMode;
  readonly activeAngleDeg: number;
  readonly requestedAngleDeg: number;
  readonly direction1: Point;
  readonly direction2: Point;
  readonly point: Point;
  readonly sphere?: SphereGeometry;
  readonly force1: Force;
  readonly force2: Force;
  readonly gravity: Force;
  readonly status: EquilibriumStatus;
  readonly netResidualN: number;
  readonly minPullForceN: number;
  readonly events: readonly PhysicsEvent[];
}
type Solution = Omit<EquilibriumState, 't' | 'events'>;
const finite = (x: number | undefined, fallback: number): number =>
  typeof x === 'number' && Number.isFinite(x) ? x : fallback;
const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));
const scaled = (v: Point, mag: number): Force => ({ x: v.x * mag, y: v.y * mag, mag });
const zero = (): Force => ({ x: 0, y: 0, mag: 0 });
const RESIDUAL_TOLERANCE = 1e-10;
export function angleRange(mode: EquilibriumMode): readonly [number, number] {
  if (mode === 'dead-knot-rotate') return [-30, 75];
  if (mode === 'active-pulley-knot') return [10, 85];
  if (mode === 'hemisphere-suspension') return [0, 75];
  return [10, 75];
}
export function boundedAngle(mode: EquilibriumMode, angle: number): number {
  const [lo, hi] = angleRange(mode);
  return clamp(finite(angle, 37), lo, hi);
}
export function solveEquilibriumAtAngle(params: EquilibriumParams, angleDeg: number): Solution {
  const mg = Math.max(0.1, finite(params.mass, 2)) * CLASSROOM_GRAVITY;
  const gravity: Force = { x: 0, y: -mg, mag: mg };
  const actual = boundedAngle(params.mode, angleDeg);
  const theta = degToRad(actual);
  const c = Math.cos(theta), sn = Math.sin(theta);
  const base = { mode: params.mode, activeAngleDeg: actual, requestedAngleDeg: finite(angleDeg, actual), gravity };
  let direction1: Point, direction2: Point, minPullForceN: number;
  let point: Point = { x: 0, y: 0 };
  let sphere: SphereGeometry | undefined;
  let mag1: number, mag2: number;
  let status: EquilibriumStatus = 'balanced';
  if (params.mode === 'active-pulley-knot') {
    direction1 = { x: -c, y: sn }; direction2 = { x: c, y: sn };
    mag1 = mag2 = mg / (2 * sn); minPullForceN = mg / 2;
  } else if (params.mode === 'dead-knot-rotate') {
    const alpha = degToRad(clamp(finite(params.baseAngleDeg, 37), 15, 75));
    direction1 = { x: -Math.sin(alpha), y: Math.cos(alpha) }; direction2 = { x: c, y: sn };
    minPullForceN = mg * Math.sin(alpha);
    const cosine = Math.cos(alpha - theta);
    if (Math.abs(cosine) <= 1e-12) { status = 'singular'; mag1 = mag2 = 0; }
    else if (cosine < 0) { status = 'infeasible'; mag1 = mag2 = 0; }
    else { mag1 = mg * c / cosine; mag2 = minPullForceN / cosine; }
  } else if (params.mode === 'hemisphere-suspension') {
    const radius = clamp(finite(params.radiusM, 1), 0.5, 1.5);
    const height = clamp(finite(params.anchorHeightM, 0.6), 0.2, 1.2);
    point = { x: -radius * sn, y: radius * c };
    const anchor = { x: 0, y: radius + height };
    const rope = { x: anchor.x - point.x, y: anchor.y - point.y };
    const ropeLength = Math.hypot(rope.x, rope.y);
    direction1 = { x: -sn, y: c }; direction2 = { x: rope.x / ropeLength, y: rope.y / ropeLength };
    mag1 = mg * radius / (radius + height); mag2 = mg * ropeLength / (radius + height);
    minPullForceN = mg * height / (radius + height);
    sphere = { radius, height, anchor, ropeLength };
  } else {
    direction1 = { x: -sn, y: c }; direction2 = { x: 1, y: 0 };
    mag1 = mg / c; mag2 = mg * Math.tan(theta); minPullForceN = 0;
  }
  let force1 = scaled(direction1, mag1), force2 = scaled(direction2, mag2);
  let netResidualN = Math.hypot(force1.x + force2.x, force1.y + force2.y - mg);
  if (status === 'balanced' && (!Number.isFinite(netResidualN) || netResidualN >= RESIDUAL_TOLERANCE || mag1 < 0 || mag2 < 0)) {
    status = 'ill-conditioned';
  }
  if (status !== 'balanced') {
    force1 = zero(); force2 = zero();
    // Residual of the available vectors only, NOT a predicted acceleration.
    netResidualN = mg;
  }
  return { ...base, point, ...(sphere ? { sphere } : {}), direction1, direction2, force1, force2, status, netResidualN, minPullForceN };
}
export function createInitialState(params: EquilibriumParams): EquilibriumState {
  return { t: 0, ...solveEquilibriumAtAngle(params, params.sweepAngleDeg), events: [] };
}
export function stepEquilibrium(state: EquilibriumState, params: EquilibriumParams, dt: number): StepResult<EquilibriumState> {
  if (!Number.isFinite(dt) || dt < 0) throw new Error('Invalid dt: ' + dt);
  if (dt === 0) return { nextState: state, events: [] };
  const nextT = state.t + dt;
  const [lo, hi] = angleRange(params.mode);
  const mid = (lo + hi) / 2, amplitude = (hi - lo) / 2;
  const initial = boundedAngle(params.mode, params.sweepAngleDeg);
  const phase = Math.asin(clamp((initial - mid) / amplitude, -1, 1));
  const angle = params.autoSweep ? mid + amplitude * Math.sin(nextT * 0.9 + phase) : params.sweepAngleDeg;
  return { nextState: { t: nextT, ...solveEquilibriumAtAngle(params, angle), events: state.events }, events: [] };
}
export function computeObservables(state: EquilibriumState): Record<string, number> {
  return {
    angleDeg: state.activeAngleDeg,
    solutionDefined: state.status === 'balanced' ? 1 : 0,
    minPullForceN: state.minPullForceN,
    ...(state.status === 'balanced' ? { force1: state.force1.mag, force2: state.force2.mag, netResidualN: state.netResidualN } : {}),
    ...(state.sphere ? { ropeLengthM: state.sphere.ropeLength } : {})
  };
}
export function checkInvariants(state: EquilibriumState): InvariantReport[] {
  return [{ name: '矢量闭合静力平衡残差 ||ΣF||', measuredError: state.netResidualN,
    tolerance: RESIDUAL_TOLERANCE, passed: state.status === 'balanced' && state.netResidualN < RESIDUAL_TOLERANCE }];
}
