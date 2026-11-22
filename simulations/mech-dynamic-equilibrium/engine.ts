import { CLASSROOM_GRAVITY, degToRad } from '@physforge/physics-core';
import type { InvariantReport, PhysicsEvent, StepResult } from '@physforge/sim-sdk';

export type EquilibriumMode =
  | 'active-pulley-knot'
  | 'dead-knot-rotate'
  | 'hemisphere-similar';

export type EquilibriumParams = {
  mode: EquilibriumMode;
  mass: number;
  baseAngleDeg: number;
  sweepAngleDeg: number;
  autoSweep: boolean;
};

export interface EquilibriumState {
  readonly t: number;
  readonly activeAngleDeg: number;
  readonly force1: { x: number; y: number; mag: number };
  readonly force2: { x: number; y: number; mag: number };
  readonly gravity: { x: number; y: number; mag: number };
  readonly netResidualN: number;
  readonly minPullForceN: number;
  readonly events: readonly PhysicsEvent[];
}

export function solveEquilibriumAtAngle(
  params: EquilibriumParams,
  angleDeg: number
): Omit<EquilibriumState, 't' | 'events'> {
  const m = Math.max(0.1, params.mass);
  const g = CLASSROOM_GRAVITY;
  const mg = m * g;
  const gravity = { x: 0, y: -mg, mag: mg };

  if (params.mode === 'active-pulley-knot') {
    // 对称轻滑轮活结：两段绳对称与水平方向成 theta 角，T1 = T2 = mg / (2 sin(theta))
    const theta = degToRad(Math.max(10, Math.min(85, angleDeg)));
    const T = mg / (2 * Math.sin(theta));
    const f1 = { x: -T * Math.cos(theta), y: T * Math.sin(theta), mag: T };
    const f2 = { x: T * Math.cos(theta), y: T * Math.sin(theta), mag: T };
    const netX = f1.x + f2.x + gravity.x;
    const netY = f1.y + f2.y + gravity.y;
    return {
      activeAngleDeg: angleDeg,
      force1: f1,
      force2: f2,
      gravity,
      netResidualN: Math.hypot(netX, netY),
      minPullForceN: mg / 2
    };
  }

  if (params.mode === 'dead-knot-rotate') {
    // 死结：F1 固定在左上方（与竖直方向成 alpha），F2 方向在右半侧以与水平成 beta 逆时针旋转
    // 方向单位矢量 u1 = (-sin alpha, cos alpha), u2 = (cos beta, sin beta)
    const alpha = degToRad(Math.max(15, Math.min(75, params.baseAngleDeg)));
    const beta = degToRad(Math.max(-30, Math.min(75, angleDeg)));
    const u1x = -Math.sin(alpha);
    const u1y = Math.cos(alpha);
    const u2x = Math.cos(beta);
    const u2y = Math.sin(beta);
    // 求解 [u1x u2x; u1y u2y] [T1; F2] = [0; mg]
    const det = u1x * u2y - u2x * u1y;
    const safeDet = Math.abs(det) > 1e-6 ? det : 1e-6;
    const T1 = (-u2x * mg) / safeDet;
    const F2 = (u1x * mg) / safeDet;
    const f1 = { x: T1 * u1x, y: T1 * u1y, mag: Math.abs(T1) };
    const f2 = { x: F2 * u2x, y: F2 * u2y, mag: Math.abs(F2) };
    const netX = f1.x + f2.x + gravity.x;
    const netY = f1.y + f2.y + gravity.y;
    return {
      activeAngleDeg: angleDeg,
      force1: f1,
      force2: f2,
      gravity,
      netResidualN: Math.hypot(netX, netY),
      // 当 F2 垂直于 F1（即 beta = alpha）时取得理论最小拉力 mg * sin(alpha)
      minPullForceN: mg * Math.sin(alpha)
    };
  }

  // hemisphere-similar：光滑半径 R 球面上物块，绳长 L 从顶悬点 h 拉住（简化按角度呈现相似三角形关系）
  const theta = degToRad(Math.max(15, Math.min(75, angleDeg)));
  const FN = mg / Math.cos(theta);
  const T = mg * Math.tan(theta);
  const f1 = { x: FN * Math.sin(theta) * -1, y: FN * Math.cos(theta), mag: FN };
  const f2 = { x: T, y: 0, mag: T };
  const netX = f1.x + f2.x + gravity.x;
  const netY = f1.y + f2.y + gravity.y;
  return {
    activeAngleDeg: angleDeg,
    force1: f1,
    force2: f2,
    gravity,
    netResidualN: Math.hypot(netX, netY),
    minPullForceN: 0
  };
}

export function createInitialState(params: EquilibriumParams): EquilibriumState {
  const solved = solveEquilibriumAtAngle(params, params.sweepAngleDeg);
  return { t: 0, ...solved, events: [] };
}

export function stepEquilibrium(
  state: EquilibriumState,
  params: EquilibriumParams,
  dt: number
): StepResult<EquilibriumState> {
  if (!Number.isFinite(dt) || dt < 0) throw new Error(`Invalid dt: ${dt}`);
  if (dt === 0) return { nextState: state, events: [] };
  const nextT = state.t + dt;
  const angle = params.autoSweep ? 40 + 25 * Math.sin(nextT * 0.9) : params.sweepAngleDeg;
  const solved = solveEquilibriumAtAngle(params, angle);
  return {
    nextState: { t: nextT, ...solved, events: state.events },
    events: []
  };
}

export function computeObservables(state: EquilibriumState): Record<string, number> {
  return {
    force1: state.force1.mag,
    force2: state.force2.mag,
    angleDeg: state.activeAngleDeg,
    netResidualN: state.netResidualN,
    minPullForceN: state.minPullForceN
  };
}

export function checkInvariants(state: EquilibriumState): InvariantReport[] {
  return [
    {
      name: '矢量闭合静力平衡残差 ||ΣF||',
      measuredError: state.netResidualN,
      tolerance: 1e-10,
      passed: state.netResidualN < 1e-10
    }
  ];
}
