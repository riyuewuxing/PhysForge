import { CLASSROOM_GRAVITY, degToRad, radToDeg, stepRK4 } from '@physforge/physics-core';
import type { InvariantReport, PhysicsEvent, StepResult } from '@physforge/sim-sdk';

export type EddyMode = 'betatron-vortex' | 'eddy-damping-compare';

export type EddyVortexParams = {
  mode: EddyMode;
  cylinderRadiusR: number;
  bDotRate: number;
  bField0: number;
  particleChargeRatio: number;
  particleInitRadius: number;
  pendulumLengthL: number;
  solidDampingGamma: number;
  slottedDampingGamma: number;
  initialAngleDeg: number;
};

export interface EddyVortexState {
  readonly t: number;
  readonly bCurrent: number;
  readonly px: number;
  readonly py: number;
  readonly vx: number;
  readonly vy: number;
  readonly trail: readonly { x: number; y: number }[];
  readonly solidTheta: number;
  readonly solidOmega: number;
  readonly slottedTheta: number;
  readonly slottedOmega: number;
  readonly events: readonly PhysicsEvent[];
}

export function evalVortexField(
  x: number,
  y: number,
  Rc: number,
  bDot: number
): { Ex: number; Ey: number } {
  const r2 = x * x + y * y;
  if (r2 < 1e-18) return { Ex: 0, Ey: 0 };
  const r = Math.sqrt(r2);
  // Lenz: +dB/dt (out of page +z) induces clockwise E: e_phi = (y/r, -x/r) => e_theta_cw = (y/r, -x/r)
  // Wait: +z into/out: curl E = -dB/dt zhat. Standard CCW loop tangent t = (-y/r, x/r).
  // oint E.dl = 2*pi*r * E_ccw = -pi*r_eff^2 * Bdot => E_ccw = -(r_eff^2 / (2r)) * Bdot
  const effSq = r <= Rc ? r2 : Rc * Rc;
  const eCcw = (-effSq / (2 * r)) * bDot;
  return {
    Ex: eCcw * (-y / r),
    Ey: eCcw * (x / r)
  };
}

/**
 * Evaluates closed-loop circulation integral \oint E . dl via composite Simpson quadrature
 * and compares against analytical -dPhi_B/dt.
 */
export function computeClosedLoopCirculation(
  loopRadius: number,
  Rc: number,
  bDot: number,
  centerOffsetX = 0
): { lineIntegral: number; negDPhiDt: number } {
  const n = 200; // even for Simpson
  const dTh = (2 * Math.PI) / n;
  let integral = 0;

  for (let i = 0; i <= n; i++) {
    const th = i * dTh;
    const x = centerOffsetX + loopRadius * Math.cos(th);
    const y = loopRadius * Math.sin(th);
    const tx = -loopRadius * Math.sin(th);
    const ty = loopRadius * Math.cos(th);
    const { Ex, Ey } = evalVortexField(x, y, Rc, bDot);
    const integrand = Ex * tx + Ey * ty;
    const w = i === 0 || i === n ? 1 : i % 2 === 1 ? 4 : 2;
    integral += (w * integrand * dTh) / 3;
  }

  // Exact overlap area between loop circle (offset, loopRadius) and field disk (0, Rc)
  let overlapArea = 0;
  const d = Math.abs(centerOffsetX);
  if (d + loopRadius <= Rc) {
    overlapArea = Math.PI * loopRadius * loopRadius;
  } else if (d === 0 && loopRadius > Rc) {
    overlapArea = Math.PI * Rc * Rc;
  } else if (d >= loopRadius + Rc) {
    overlapArea = 0;
  } else if (d + Rc <= loopRadius) {
    overlapArea = Math.PI * Rc * Rc;
  } else {
    const r1Sq = loopRadius * loopRadius;
    const r2Sq = Rc * Rc;
    const part1 = r1Sq * Math.acos((d * d + r1Sq - r2Sq) / (2 * d * loopRadius));
    const part2 = r2Sq * Math.acos((d * d + r2Sq - r1Sq) / (2 * d * Rc));
    const part3 = 0.5 * Math.sqrt((-d + loopRadius + Rc) * (d + loopRadius - Rc) * (d - loopRadius + Rc) * (d + loopRadius + Rc));
    overlapArea = part1 + part2 - part3;
  }

  return {
    lineIntegral: integral,
    negDPhiDt: -bDot * overlapArea
  };
}

export function createInitialState(params: EddyVortexParams): EddyVortexState {
  const r0 = Math.max(0.2, params.particleInitRadius);
  const th0 = degToRad(params.initialAngleDeg);
  return {
    t: 0,
    bCurrent: params.bField0,
    px: r0,
    py: 0,
    vx: 0,
    vy: -0.6,
    trail: [{ x: r0, y: 0 }],
    solidTheta: th0,
    solidOmega: 0,
    slottedTheta: th0,
    slottedOmega: 0,
    events: []
  };
}

export function stepEddyVortex(
  state: EddyVortexState,
  params: EddyVortexParams,
  dt: number
): StepResult<EddyVortexState> {
  if (!Number.isFinite(dt) || dt < 0) throw new Error(`Invalid dt: ${dt}`);
  if (dt === 0) return { nextState: state, events: [] };

  const Rc = Math.max(0.2, params.cylinderRadiusR);
  const eta = params.particleChargeRatio;
  const subN = Math.max(1, Math.ceil(dt / 0.005));
  const subH = dt / subN;

  let vec = [state.px, state.py, state.vx, state.vy, state.solidTheta, state.solidOmega, state.slottedTheta, state.slottedOmega];
  const gOverL = CLASSROOM_GRAVITY / Math.max(0.4, params.pendulumLengthL);

  for (let i = 0; i < subN; i++) {
    const tau0 = state.t + i * subH;
    vec = stepRK4(vec, tau0, subH, (tau, y) => {
      const px = y[0]!;
      const py = y[1]!;
      const vx = y[2]!;
      const vy = y[3]!;
      const bNow = params.bField0 + params.bDotRate * tau;
      const inCore = px * px + py * py <= Rc * Rc;
      const bz = inCore ? bNow : 0;
      const { Ex, Ey } = evalVortexField(px, py, Rc, params.bDotRate);
      // Lorentz force (Ex + vy*Bz, Ey - vx*Bz) * eta
      const ax = eta * (Ex + vy * bz);
      const ay = eta * (Ey - vx * bz);

      const sTh = y[4]!;
      const sOm = y[5]!;
      const slTh = y[6]!;
      const slOm = y[7]!;

      // Eddy damping torque peaks inside pole gap |theta| < 0.38 rad
      const inGapSolid = Math.abs(sTh) < 0.4 ? 1 : 0.05;
      const inGapSlotted = Math.abs(slTh) < 0.4 ? 1 : 0.05;
      const aSolid = -gOverL * Math.sin(sTh) - 2 * params.solidDampingGamma * inGapSolid * sOm;
      const aSlotted = -gOverL * Math.sin(slTh) - 2 * params.slottedDampingGamma * inGapSlotted * slOm;

      return [vx, vy, ax, ay, sOm, aSolid, slOm, aSlotted];
    });
  }

  const nt = state.t + dt;
  const last = state.trail[state.trail.length - 1];
  const nx = vec[0]!;
  const ny = vec[1]!;
  const append = !last || Math.hypot(nx - last.x, ny - last.y) > 0.04;
  const trail = append ? [...state.trail.slice(-260), { x: nx, y: ny }] : state.trail;

  return {
    nextState: {
      ...state,
      t: nt,
      bCurrent: params.bField0 + params.bDotRate * nt,
      px: nx,
      py: ny,
      vx: vec[2]!,
      vy: vec[3]!,
      trail,
      solidTheta: vec[4]!,
      solidOmega: vec[5]!,
      slottedTheta: vec[6]!,
      slottedOmega: vec[7]!
    },
    events: []
  };
}

export function computeObservables(state: EddyVortexState, params: EddyVortexParams): Record<string, number> {
  const Rc = Math.max(0.2, params.cylinderRadiusR);
  const r = Math.hypot(state.px, state.py);
  const { Ex, Ey } = evalVortexField(state.px, state.py, Rc, params.bDotRate);
  return {
    t: state.t,
    bCurrent: state.bCurrent,
    eVortexMag: Math.hypot(Ex, Ey),
    particleSpeed: Math.hypot(state.vx, state.vy),
    particleRadius: r,
    solidAngleDeg: radToDeg(state.solidTheta),
    slottedAngleDeg: radToDeg(state.slottedTheta)
  };
}

export function checkInvariants(
  _state: EddyVortexState,
  _initial: EddyVortexState,
  params: EddyVortexParams
): InvariantReport[] {
  const Rc = Math.max(0.2, params.cylinderRadiusR);
  const { lineIntegral, negDPhiDt } = computeClosedLoopCirculation(Rc * 0.7, Rc, params.bDotRate);
  const err = Math.abs(lineIntegral - negDPhiDt) / Math.max(1e-9, Math.abs(negDPhiDt));
  return [
    {
      name: '涡旋电场闭合环流定律 ∮E·dl = -dΦ/dt',
      measuredError: err,
      tolerance: 1e-8,
      passed: Number.isFinite(err) && err < 1e-8
    }
  ];
}
