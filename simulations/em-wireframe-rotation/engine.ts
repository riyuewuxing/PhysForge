import { bisectEvent, CLASSROOM_GRAVITY, stepRK4 } from '@physforge/physics-core';
import type { InvariantReport, PhysicsEvent, StepResult } from '@physforge/sim-sdk';

export type WireframeMode = 'wireframe-gravity-fall' | 'rotating-rod' | 'faraday-disk';
export type LoopShape = 'square' | 'triangle' | 'circle';
export type FieldProfile = 'single-zone' | 'dual-opposite' | 'linear-gradient';

export type WireframeParams = {
  mode: WireframeMode;
  loopShape: LoopShape;
  fieldProfile: FieldProfile;
  magneticB: number;
  loopSizeL: number;
  zoneHeightH: number;
  massM: number;
  resistanceR: number;
  initialVy: number;
  omegaRadS: number;
  gravityEnabled: boolean;
};

export interface WireframeState {
  readonly t: number;
  readonly centerY: number;
  readonly vy: number;
  readonly angleRad: number;
  readonly fluxWb: number;
  readonly emfV: number;
  readonly currentA: number;
  readonly ampereForceN: number;
  readonly jouleHeatJ: number;
  readonly initialY: number;
  readonly initialEnergy: number;
  readonly peakEmfV: number;
  readonly events: readonly PhysicsEvent[];
}

export function fieldAtWorldY(y: number, params: WireframeParams): number {
  const H = Math.max(0.4, params.zoneHeightH);
  const B = params.magneticB;
  if (params.fieldProfile === 'single-zone') {
    return y <= 0 && y >= -H ? B : 0;
  }
  if (params.fieldProfile === 'dual-opposite') {
    if (y <= 0 && y >= -H) return B;
    if (y < -H && y >= -2 * H) return -B;
    return 0;
  }
  // linear-gradient inside [0, -2H]
  if (y <= 0 && y >= -2 * H) {
    return B * (1 + 0.5 * (-y / H));
  }
  return 0;
}

function shapeWidthAtLocalU(u: number, params: WireframeParams): number {
  const L = Math.max(0.2, params.loopSizeL);
  const half = 0.5 * L;
  if (Math.abs(u) > half) return 0;
  if (params.loopShape === 'square') return L;
  if (params.loopShape === 'circle') return 2 * Math.sqrt(Math.max(0, half * half - u * u));
  // Equilateral-height triangle: base at bottom u = -half (width = L), apex at top u = +half (width = 0)
  return L * (0.5 - u / L);
}

/**
 * Computes exact magnetic flux Phi(yc) and exact spatial cutting factor dPhi/dyc.
 */
export function computeFluxAndCuttingFactor(
  yc: number,
  params: WireframeParams
): { fluxWb: number; dPhiDy: number } {
  const L = Math.max(0.2, params.loopSizeL);
  const half = 0.5 * L;
  const n = 80;
  const du = L / n;
  let fluxWb = 0;

  for (let i = 0; i < n; i++) {
    const u = -half + (i + 0.5) * du;
    const w = shapeWidthAtLocalU(u, params);
    fluxWb += fieldAtWorldY(yc + u, params) * w * du;
  }

  // Exact boundary-crossing contribution + smooth gradient bulk integral
  const H = Math.max(0.4, params.zoneHeightH);
  const B = params.magneticB;
  let dPhiDy = 0;

  const evalStepCrossing = (yBoundary: number, deltaB: number) => {
    const u = yBoundary - yc;
    if (u >= -half && u <= half) {
      // Wait: moving down means yc decreases; if y_top >= yB and bottom crosses yB:
      // Let Phi = integral_{yc-half}^{yc+half} B(y) w(y - yc) dy
      // Wait: sign: if wire enters from y > 0 moving downward (yc decreases), d(Phi)/dyc < 0 while vy < 0 => dPhi/dt > 0
      dPhiDy += deltaB * shapeWidthAtLocalU(u, params);
    }
  };

  if (params.fieldProfile === 'single-zone') {
    // B jumps from 0 to +B going below 0 => at y=0, step up by +B going down => dPhi/dyc contributes -B*w(0-yc)
    evalStepCrossing(0, -B);
    evalStepCrossing(-H, +B);
  } else if (params.fieldProfile === 'dual-opposite') {
    evalStepCrossing(0, -B);
    evalStepCrossing(-H, 2 * B); // crosses from +B to -B -> flux changes twice as fast!
    evalStepCrossing(-2 * H, -B);
  } else {
    evalStepCrossing(0, -B);
    evalStepCrossing(-2 * H, 2 * B);
    // Bulk gradient contribution: int (-dB/dy) w(u) du where B(y) = B*(1 - 0.5*y/H) => dB/dy = -0.5*B/H
    const grad = -0.5 * (B / H);
    for (let i = 0; i < n; i++) {
      const u = -half + (i + 0.5) * du;
      const y = yc + u;
      if (y < 0 && y > -2 * H) {
        dPhiDy += grad * shapeWidthAtLocalU(u, params) * du;
      }
    }
  }

  return { fluxWb, dPhiDy };
}

export function createInitialState(params: WireframeParams): WireframeState {
  const y0 = params.mode === 'wireframe-gravity-fall' ? 0.5 * params.loopSizeL + 0.25 : 0;
  const g = params.gravityEnabled ? CLASSROOM_GRAVITY : 0;
  const vy0 = params.mode === 'wireframe-gravity-fall' ? -Math.abs(params.initialVy) : 0;
  const { fluxWb, dPhiDy } =
    params.mode === 'wireframe-gravity-fall'
      ? computeFluxAndCuttingFactor(y0, params)
      : { fluxWb: 0, dPhiDy: 0 };

  const R = Math.max(0.05, params.resistanceR);
  const emfV =
    params.mode === 'wireframe-gravity-fall'
      ? -dPhiDy * vy0
      : 0.5 * params.magneticB * params.omegaRadS * params.loopSizeL * params.loopSizeL;
  const currentA = emfV / R;
  const ampereForceN = params.mode === 'wireframe-gravity-fall' ? dPhiDy * currentA : 0;
  const e0 = 0.5 * params.massM * vy0 * vy0 + params.massM * g * y0;

  return {
    t: 0,
    centerY: y0,
    vy: vy0,
    angleRad: 0,
    fluxWb,
    emfV,
    currentA,
    ampereForceN,
    jouleHeatJ: 0,
    initialY: y0,
    initialEnergy: e0,
    peakEmfV: Math.abs(emfV),
    events: []
  };
}

export function stepWireframeRotation(
  state: WireframeState,
  params: WireframeParams,
  dt: number
): StepResult<WireframeState> {
  if (!Number.isFinite(dt) || dt < 0) throw new Error(`Invalid dt: ${dt}`);
  if (dt === 0) return { nextState: state, events: [] };

  const R = Math.max(0.05, params.resistanceR);
  const m = Math.max(0.05, params.massM);

  if (params.mode !== 'wireframe-gravity-fall') {
    const nt = state.t + dt;
    const angleRad = state.angleRad + params.omegaRadS * dt;
    const emfV = 0.5 * params.magneticB * params.omegaRadS * params.loopSizeL * params.loopSizeL;
    const currentA = emfV / R;
    return {
      nextState: {
        ...state,
        t: nt,
        angleRad,
        fluxWb: 0.5 * params.magneticB * params.loopSizeL * params.loopSizeL * angleRad,
        emfV,
        currentA,
        ampereForceN: (emfV * currentA) / Math.max(1e-6, Math.abs(params.omegaRadS * params.loopSizeL)),
        jouleHeatJ: state.jouleHeatJ + currentA * currentA * R * dt,
        peakEmfV: Math.max(state.peakEmfV, Math.abs(emfV))
      },
      events: []
    };
  }

  const g = params.gravityEnabled ? CLASSROOM_GRAVITY : 0;
  const maxSub = 0.002;
  const nSub = Math.max(1, Math.ceil(dt / maxSub));
  const subH = dt / nSub;
  const half = 0.5 * Math.max(0.2, params.loopSizeL);
  const H = Math.max(0.4, params.zoneHeightH);
  const bBounds =
    params.fieldProfile === 'single-zone'
      ? [0, -H]
      : params.fieldProfile === 'dual-opposite'
        ? [0, -H, -2 * H]
        : [0, -2 * H];
  const critYs: number[] = [];
  for (const yb of bBounds) {
    critYs.push(yb + half, yb - half);
  }

  interface FallSubState {
    readonly t: number;
    readonly vec: readonly number[];
  }

  const advFall = (s: FallSubState, h: number): FallSubState => {
    const nextVec = stepRK4(s.vec, s.t, h, (_tau, y) => {
      const yc = y[0]!;
      const vy = y[1]!;
      const { dPhiDy } = computeFluxAndCuttingFactor(yc, params);
      const emf = -dPhiDy * vy;
      const I = emf / R;
      const fAmpY = dPhiDy * I;
      const pJoule = I * I * R;
      return [vy, (fAmpY - m * g) / m, pJoule];
    });
    return { t: s.t + h, vec: nextVec };
  };

  let cur: FallSubState = { t: state.t, vec: [state.centerY, state.vy, state.jouleHeatJ] };
  for (let i = 0; i < nSub; i++) {
    let rem = subH;
    let guard = 0;
    while (rem > 1e-13 && guard < 6) {
      guard++;
      const next = advFall(cur, rem);
      const y0 = cur.vec[0]!;
      const y1 = next.vec[0]!;
      let earliestHit: { timeOffset: number; state: FallSubState } | null = null;
      for (const ycCrit of critYs) {
        if ((y0 - ycCrit) * (y1 - ycCrit) < 0) {
          const hit = bisectEvent(cur, cur.t, rem, advFall, (s) => s.vec[0]! - ycCrit, {
            timeTolerance: 1e-10,
            biasEndpoint: y0 - ycCrit > 0 ? 'positive' : 'negative'
          });
          if (hit && (!earliestHit || hit.timeOffset < earliestHit.timeOffset)) {
            earliestHit = hit;
          }
        }
      }
      if (earliestHit && earliestHit.timeOffset > 1e-12 && earliestHit.timeOffset < rem - 1e-12) {
        // Cross the exact 1e-10 s boundary using exact single-branch kinematics so RK4 never straddles jump
        const bs = earliestHit.state;
        const ycAt = bs.vec[0]!;
        const vyAt = bs.vec[1]!;
        const { dPhiDy: dPhiBefore } = computeFluxAndCuttingFactor(ycAt, params);
        const fAmpBefore = dPhiBefore * ((-dPhiBefore * vyAt) / R);
        const aBefore = (fAmpBefore - m * g) / m;
        const epsT = Math.min(rem - earliestHit.timeOffset, 2e-9);
        const ny = ycAt + vyAt * epsT + 0.5 * aBefore * epsT * epsT;
        const nvy = vyAt + aBefore * epsT;
        const pJ = ((-dPhiBefore * vyAt) ** 2 / R) * epsT;
        cur = { t: bs.t + epsT, vec: [ny, nvy, bs.vec[2]! + pJ] };
        rem -= earliestHit.timeOffset + epsT;
      } else {
        cur = next;
        rem = 0;
      }
    }
  }

  const ny = cur.vec[0]!;
  const nvy = cur.vec[1]!;
  const nHeat = cur.vec[2]!;
  const { fluxWb, dPhiDy } = computeFluxAndCuttingFactor(ny, params);
  const emfV = -dPhiDy * nvy;
  const currentA = emfV / R;
  const ampereForceN = dPhiDy * currentA;

  return {
    nextState: {
      ...state,
      t: state.t + dt,
      centerY: ny,
      vy: nvy,
      fluxWb,
      emfV,
      currentA,
      ampereForceN,
      jouleHeatJ: nHeat,
      peakEmfV: Math.max(state.peakEmfV, Math.abs(emfV))
    },
    events: []
  };
}

export function computeObservables(state: WireframeState, params: WireframeParams): Record<string, number> {
  const g = params.gravityEnabled && params.mode === 'wireframe-gravity-fall' ? CLASSROOM_GRAVITY : 0;
  const ke = 0.5 * params.massM * state.vy * state.vy;
  const pe = params.massM * g * state.centerY;
  return {
    t: state.t,
    centerY: state.centerY,
    vy: state.vy,
    fluxWb: state.fluxWb,
    emfV: state.emfV,
    currentA: state.currentA,
    ampereForceN: state.ampereForceN,
    jouleHeatJ: state.jouleHeatJ,
    totalEnergyJ: ke + pe + state.jouleHeatJ
  };
}

export function checkInvariants(
  state: WireframeState,
  _initial: WireframeState,
  params: WireframeParams
): InvariantReport[] {
  if (params.mode !== 'wireframe-gravity-fall') {
    return [{ name: '数值稳定性检定', measuredError: 0, tolerance: 1e-6, passed: Number.isFinite(state.emfV) }];
  }
  const obs = computeObservables(state, params);
  const err = Math.abs(obs.totalEnergyJ! - state.initialEnergy) / Math.max(1, Math.abs(state.initialEnergy));
  return [
    {
      name: '重力势能、动能与焦耳热能量守恒 (mgΔh = ΔEk + Q)',
      measuredError: err,
      tolerance: 1e-5,
      passed: Number.isFinite(err) && err < 1e-5
    }
  ];
}
