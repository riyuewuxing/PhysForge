import { degToRad } from '@physforge/physics-core';
import type { InvariantReport, PhysicsEvent, StepResult } from '@physforge/sim-sdk';

export type ConstrainedMode = 'rope-pull-boat' | 'ladder-wall' | 'wedge-rod';

export type ConstrainedVelocityParams = {
  mode: ConstrainedMode;
  driveSpeed: number;
  heightOrLength: number;
  initialAngleDeg: number;
};

export interface ConstrainedVelocityState {
  readonly t: number;
  readonly posA: { x: number; y: number };
  readonly posB: { x: number; y: number };
  readonly velA: { x: number; y: number };
  readonly velB: { x: number; y: number };
  readonly accelBoatMag: number;
  readonly analyticalAccelBoatMag: number;
  readonly angleDeg: number;
  readonly projSpeedA: number;
  readonly projSpeedB: number;
  readonly events: readonly PhysicsEvent[];
}

function computeKinematics(
  mode: ConstrainedMode,
  driveSpeed: number,
  geom: number,
  angleDeg: number,
  xCoord?: number
): Omit<ConstrainedVelocityState, 't' | 'events'> {
  const rad = degToRad(Math.max(12, Math.min(78, angleDeg)));

  if (mode === 'rope-pull-boat') {
    const H = Math.max(0.5, geom);
    const x = xCoord !== undefined ? Math.max(0.2, xCoord) : H / Math.tan(rad);
    const L = Math.hypot(x, H);
    const cosT = x / L;
    const sinT = H / L;
    const vBoat = driveSpeed / Math.max(cosT, 1e-6);
    // |a_boat| = v_rope^2 * tan^2(theta) / x = v_rope^2 * (H/x)^2 / x
    const aAna = (driveSpeed * driveSpeed * sinT * sinT) / Math.max(x * cosT * cosT, 1e-9);
    const ux = -cosT;
    const uy = sinT;
    const vAx = -vBoat;
    const vAy = 0;
    const vBx = 0;
    const vBy = 0;
    return {
      posA: { x, y: 0 },
      posB: { x: 0, y: H },
      velA: { x: vAx, y: vAy },
      velB: { x: vBx, y: vBy },
      accelBoatMag: aAna,
      analyticalAccelBoatMag: aAna,
      angleDeg: (Math.atan2(H, x) * 180) / Math.PI,
      projSpeedA: vAx * ux + vAy * uy,
      projSpeedB: driveSpeed
    };
  }

  if (mode === 'ladder-wall') {
    const L = Math.max(1.0, geom);
    // theta = angle between ladder and floor -> xB = L cos theta, yA = L sin theta
    const xB = L * Math.cos(rad);
    const yA = L * Math.sin(rad);
    const ux = xB / L;
    const uy = -yA / L;
    const vA = { x: 0, y: -driveSpeed }; // moving down wall
    const vBMag = driveSpeed * Math.tan(rad);
    const vB = { x: vBMag, y: 0 };
    return {
      posA: { x: 0, y: yA },
      posB: { x: xB, y: 0 },
      velA: vA,
      velB: vB,
      accelBoatMag: 0,
      analyticalAccelBoatMag: 0,
      angleDeg,
      projSpeedA: vA.x * ux + vA.y * uy,
      projSpeedB: vB.x * ux + vB.y * uy
    };
  }

  // wedge-rod: horizontal wedge sloping down to the right (+x moves wedge under rod, normal = (+sin alpha, +cos alpha))
  const vA = { x: driveSpeed, y: 0 };
  const vB = { x: 0, y: driveSpeed * Math.tan(rad) };
  const nx = Math.sin(rad);
  const ny = Math.cos(rad);
  return {
    posA: { x: 0.6, y: 0 },
    posB: { x: 0.6, y: 0.6 * Math.tan(rad) },
    velA: vA,
    velB: vB,
    accelBoatMag: 0,
    analyticalAccelBoatMag: 0,
    angleDeg,
    projSpeedA: vA.x * nx + vA.y * ny,
    projSpeedB: vB.x * nx + vB.y * ny
  };
}

export function createInitialState(params: ConstrainedVelocityParams): ConstrainedVelocityState {
  const k = computeKinematics(params.mode, params.driveSpeed, params.heightOrLength, params.initialAngleDeg);
  return { t: 0, ...k, events: [] };
}

export function stepConstrainedVelocity(
  state: ConstrainedVelocityState,
  params: ConstrainedVelocityParams,
  dt: number
): StepResult<ConstrainedVelocityState> {
  if (!Number.isFinite(dt) || dt < 0) throw new Error(`Invalid dt: ${dt}`);
  if (dt === 0) return { nextState: state, events: [] };

  const nextT = state.t + dt;
  if (params.mode === 'rope-pull-boat') {
    const H = Math.max(0.5, params.heightOrLength);
    // Exact kinematic step on rope length L(t) = L0 - v_rope * dt
    const L0 = Math.hypot(state.posA.x, H);
    const minL = H + 0.12;
    const Lnext = Math.max(minL, L0 - params.driveSpeed * dt);
    const xNext = Math.sqrt(Math.max(0.01, Lnext * Lnext - H * H));
    const kNext = computeKinematics(params.mode, params.driveSpeed, H, state.angleDeg, xNext);
    const vPrev = Math.hypot(state.velA.x, state.velA.y);
    const vNow = Math.hypot(kNext.velA.x, kNext.velA.y);
    const numAccel = Lnext > minL + 1e-6 ? Math.abs(vNow - vPrev) / dt : kNext.analyticalAccelBoatMag;
    return {
      nextState: {
        t: nextT,
        ...kNext,
        accelBoatMag: numAccel,
        events: state.events
      },
      events: []
    };
  }

  const nextAng =
    params.mode === 'ladder-wall'
      ? Math.max(15, params.initialAngleDeg - nextT * 10)
      : params.initialAngleDeg;
  const k = computeKinematics(params.mode, params.driveSpeed, params.heightOrLength, nextAng);
  return {
    nextState: { t: nextT, ...k, events: state.events },
    events: []
  };
}

export function computeObservables(state: ConstrainedVelocityState): Record<string, number> {
  return {
    speedA: Math.hypot(state.velA.x, state.velA.y),
    speedB: Math.hypot(state.velB.x, state.velB.y),
    projSpeedDiff: Math.abs(state.projSpeedA - state.projSpeedB),
    angleDeg: state.angleDeg,
    accelBoatMag: state.accelBoatMag
  };
}

export function checkInvariants(state: ConstrainedVelocityState): InvariantReport[] {
  const diff = Math.abs(state.projSpeedA - state.projSpeedB);
  return [
    {
      name: '沿绳/杆方向速度投影严格相等 |vA·e - vB·e|',
      measuredError: diff,
      tolerance: 1e-10,
      passed: diff < 1e-10
    }
  ];
}
