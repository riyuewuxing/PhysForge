import { stepBorisPusher, type ChargedParticleState, type Vec3 } from '@physforge/physics-core';
import type { InvariantReport, StepResult } from '@physforge/sim-sdk';

export type FusionFieldMode = 'magnetic-mirror' | 'tokamak';

export type TokamakMirrorParams = {
  mode: FusionFieldMode;
  b0Tesla: number;
  mirrorLengthM: number;
  coilHalfSpanM: number;
  pitchAngleDeg: number;
  speed0: number;
  qOverM: number;
  majorRadiusM: number;
  safetyFactorQ: number;
};

export interface TokamakMirrorState {
  readonly t: number;
  readonly position: Vec3;
  readonly velocity: Vec3;
  readonly bField: Vec3;
  readonly mu0: number;
  readonly muCurrent: number;
  readonly maxMuRelDev: number;
  readonly initialKineticJ: number;
  readonly currentKineticJ: number;
  readonly escaped: boolean;
  readonly reflectionCount: number;
  readonly lastVzSign: number;
  readonly trail: readonly Vec3[];
}

export function evaluateTokamakMirrorField(pos: Vec3, params: TokamakMirrorParams): Vec3 {
  const B0 = Math.max(0.2, params.b0Tesla);
  if (params.mode === 'tokamak') {
    const R0 = Math.max(0.8, params.majorRadiusM);
    const R = Math.max(0.15, Math.hypot(pos.x, pos.y));
    const qSafe = Math.max(0.8, params.safetyFactorQ);
    const phi = Math.atan2(pos.y, pos.x);
    const bTorMag = (B0 * R0) / R;
    const bxTor = -bTorMag * Math.sin(phi);
    const byTor = bTorMag * Math.cos(phi);

    // Poloidal field tangent around minor cross section center (R0 cos phi, R0 sin phi, 0)
    const dR = R - R0;
    const dZ = pos.z;
    const scalePol = B0 / (qSafe * R);
    const bxPol = -scalePol * dZ * Math.cos(phi);
    const byPol = -scalePol * dZ * Math.sin(phi);
    const bzPol = scalePol * dR;
    return { x: bxTor + bxPol, y: byTor + byPol, z: bzPol };
  }

  const L = Math.max(0.4, params.mirrorLengthM);
  const L2 = L * L;
  return {
    x: (-B0 * pos.x * pos.z) / L2,
    y: (-B0 * pos.y * pos.z) / L2,
    z: B0 * (1 + (pos.z * pos.z) / L2)
  };
}

export function computeMirrorLossConeDeg(params: TokamakMirrorParams): number {
  const L = Math.max(0.4, params.mirrorLengthM);
  const zc = Math.max(0.5, params.coilHalfSpanM);
  const Rm = 1 + (zc * zc) / (L * L);
  return (Math.asin(Math.sqrt(1 / Rm)) * 180) / Math.PI;
}

function computeMuAndKinetic(v: Vec3, B: Vec3): { mu: number; ke: number; bMag: number } {
  const vSq = v.x * v.x + v.y * v.y + v.z * v.z;
  const bMag = Math.max(1e-12, Math.hypot(B.x, B.y, B.z));
  const vPar = (v.x * B.x + v.y * B.y + v.z * B.z) / bMag;
  const vPerpSq = Math.max(0, vSq - vPar * vPar);
  return {
    mu: (0.5 * vPerpSq) / bMag,
    ke: 0.5 * vSq,
    bMag
  };
}

export function createInitialState(params: TokamakMirrorParams): TokamakMirrorState {
  const theta = (Math.max(1, Math.min(89, params.pitchAngleDeg)) * Math.PI) / 180;
  const v0 = Math.max(0.2, params.speed0);
  const vPerp = v0 * Math.sin(theta);
  const vPar = v0 * Math.cos(theta);

  const pos0: Vec3 =
    params.mode === 'tokamak'
      ? { x: params.majorRadiusM + 0.28, y: 0, z: 0 }
      : { x: 0.04, y: 0, z: 0 };
  const b0 = evaluateTokamakMirrorField(pos0, params);

  let vel0: Vec3;
  if (params.mode === 'tokamak') {
    vel0 = { x: vPerp * 0.7, y: vPar, z: vPerp * 0.714 };
  } else {
    vel0 = { x: 0, y: vPerp, z: vPar };
  }

  const { mu, ke } = computeMuAndKinetic(vel0, b0);
  return {
    t: 0,
    position: pos0,
    velocity: vel0,
    bField: b0,
    mu0: mu,
    muCurrent: mu,
    maxMuRelDev: 0,
    initialKineticJ: ke,
    currentKineticJ: ke,
    escaped: false,
    reflectionCount: 0,
    lastVzSign: Math.sign(vel0.z) || 1,
    trail: [pos0]
  };
}

export function stepTokamakMirror(
  state: TokamakMirrorState,
  params: TokamakMirrorParams,
  dt: number
): StepResult<TokamakMirrorState> {
  if (!Number.isFinite(dt) || dt < 0) throw new Error(`Invalid dt: ${dt}`);
  if (dt === 0) return { nextState: state, events: [] };

  const qOverM = Math.max(2, params.qOverM);
  const substeps = Math.max(8, Math.ceil(dt / 0.0008));
  const subDt = dt / substeps;
  const fieldFn = (pos: Vec3) => ({ E: { x: 0, y: 0, z: 0 }, B: evaluateTokamakMirrorField(pos, params) });

  let particle: ChargedParticleState = {
    position: state.position,
    velocity: state.velocity,
    t: state.t
  };

  let reflections = state.reflectionCount;
  let lastSign = state.lastVzSign;
  let escaped = state.escaped;
  let maxMuDev = state.maxMuRelDev;
  let lastMu = state.muCurrent;
  let lastKe = state.currentKineticJ;
  let lastB = state.bField;

  for (let i = 0; i < substeps; i++) {
    particle = stepBorisPusher(particle, fieldFn, qOverM, 1, subDt);
    lastB = evaluateTokamakMirrorField(particle.position, params);
    const diag = computeMuAndKinetic(particle.velocity, lastB);
    lastMu = diag.mu;
    lastKe = diag.ke;
    if (state.mu0 > 1e-12 && !escaped) {
      const dev = Math.abs(diag.mu - state.mu0) / state.mu0;
      if (dev > maxMuDev) maxMuDev = dev;
    }
    if (params.mode === 'magnetic-mirror') {
      const curSign = Math.sign(particle.velocity.z);
      if (curSign !== 0 && curSign !== lastSign && Math.abs(particle.position.z) < params.coilHalfSpanM) {
        reflections++;
        lastSign = curSign;
      }
      if (Math.abs(particle.position.z) > params.coilHalfSpanM) {
        escaped = true;
      }
    }
  }

  return {
    nextState: {
      t: particle.t,
      position: particle.position,
      velocity: particle.velocity,
      bField: lastB,
      mu0: state.mu0,
      muCurrent: lastMu,
      maxMuRelDev: maxMuDev,
      initialKineticJ: state.initialKineticJ,
      currentKineticJ: lastKe,
      escaped,
      reflectionCount: reflections,
      lastVzSign: lastSign,
      trail: [...state.trail.slice(-260), particle.position]
    },
    events: []
  };
}

export function buildTokamakMirrorSegments(params: TokamakMirrorParams): { a: Vec3; b: Vec3 }[] {
  const segs: { a: Vec3; b: Vec3 }[] = [];
  if (params.mode === 'magnetic-mirror') {
    for (const zCoil of [-params.coilHalfSpanM, params.coilHalfSpanM]) {
      const R = 0.7;
      for (let i = 0; i < 32; i++) {
        const a1 = (i / 32) * 2 * Math.PI;
        const a2 = ((i + 1) / 32) * 2 * Math.PI;
        segs.push({
          a: { x: R * Math.cos(a1), y: R * Math.sin(a1), z: zCoil },
          b: { x: R * Math.cos(a2), y: R * Math.sin(a2), z: zCoil }
        });
      }
    }
  } else {
    const R0 = Math.max(0.8, params.majorRadiusM);
    const rMin = 0.55;
    for (let j = 0; j < 12; j++) {
      const phi = (j / 12) * 2 * Math.PI;
      const cx = R0 * Math.cos(phi);
      const cy = R0 * Math.sin(phi);
      for (let i = 0; i < 24; i++) {
        const t1 = (i / 24) * 2 * Math.PI;
        const t2 = ((i + 1) / 24) * 2 * Math.PI;
        segs.push({
          a: { x: cx + rMin * Math.cos(t1) * Math.cos(phi), y: cy + rMin * Math.cos(t1) * Math.sin(phi), z: rMin * Math.sin(t1) },
          b: { x: cx + rMin * Math.cos(t2) * Math.cos(phi), y: cy + rMin * Math.cos(t2) * Math.sin(phi), z: rMin * Math.sin(t2) }
        });
      }
    }
  }
  return segs;
}

export function traceTokamakMirrorLines(params: TokamakMirrorParams): Vec3[][] {
  const lines: Vec3[][] = [];
  if (params.mode === 'magnetic-mirror') {
    for (const angle of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
      for (const r0 of [0.22, 0.42]) {
        const pts: Vec3[] = [];
        let p: Vec3 = { x: r0 * Math.cos(angle), y: r0 * Math.sin(angle), z: -params.coilHalfSpanM * 1.1 };
        for (let k = 0; k < 60; k++) {
          pts.push(p);
          const b = evaluateTokamakMirrorField(p, params);
          const bm = Math.max(1e-6, Math.hypot(b.x, b.y, b.z));
          const step = (params.coilHalfSpanM * 2.2) / 58;
          p = { x: p.x + (b.x / bm) * step, y: p.y + (b.y / bm) * step, z: p.z + (b.z / bm) * step };
        }
        lines.push(pts);
      }
    }
  } else {
    const pts: Vec3[] = [];
    let p: Vec3 = { x: params.majorRadiusM + 0.35, y: 0, z: 0 };
    for (let k = 0; k < 180; k++) {
      pts.push(p);
      const b = evaluateTokamakMirrorField(p, params);
      const bm = Math.max(1e-6, Math.hypot(b.x, b.y, b.z));
      p = { x: p.x + (b.x / bm) * 0.12, y: p.y + (b.y / bm) * 0.12, z: p.z + (b.z / bm) * 0.12 };
    }
    lines.push(pts);
  }
  return lines;
}

export function computeObservables(state: TokamakMirrorState, params: TokamakMirrorParams): Record<string, number> {
  const keErr = Math.abs(state.currentKineticJ - state.initialKineticJ) / Math.max(1e-12, state.initialKineticJ);
  return {
    t: state.t,
    z: state.position.z,
    bMagT: Math.hypot(state.bField.x, state.bField.y, state.bField.z),
    muCurrent: state.muCurrent,
    maxMuRelDev: state.maxMuRelDev,
    keDriftRel: keErr,
    reflectionCount: state.reflectionCount,
    lossConeDeg: computeMirrorLossConeDeg(params)
  };
}

export function checkInvariants(state: TokamakMirrorState): InvariantReport[] {
  const keErr = Math.abs(state.currentKineticJ - state.initialKineticJ) / Math.max(1e-12, state.initialKineticJ);
  return [
    {
      name: 'Boris 3D 磁场动能相对漂移',
      measuredError: keErr,
      tolerance: 1e-8,
      passed: keErr < 1e-8
    },
    {
      name: '磁矩绝热不变量 μ 相对波动',
      measuredError: state.maxMuRelDev,
      tolerance: 0.05,
      passed: state.maxMuRelDev < 0.05
    }
  ];
}
