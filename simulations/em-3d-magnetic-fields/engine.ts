import {
  createScaleContext,
  cross3,
  dot3,
  stepBorisPusher,
  stepRK4,
  type Vec3
} from '@physforge/physics-core';
import type { InvariantReport, PhysicsEvent, StepResult } from '@physforge/sim-sdk';

export const MU_0 = 4 * Math.PI * 1e-7;

export type MagneticGeometry3D =
  | 'single-loop'
  | 'helmholtz-coil'
  | 'finite-solenoid'
  | 'straight-wire'
  | 'parallel-wires'
  | 'uniform-helix';

export type Magnetic3dParams = {
  geometryType: MagneticGeometry3D;
  currentI: number;
  radiusR: number;
  solenoidTurns: number;
  qOverM: number;
  vPerp: number;
  vParallel: number;
  uniformBz: number;
};

export interface WireSegment3D {
  readonly a: Vec3;
  readonly b: Vec3;
  readonly currentSign: number;
}

export interface Magnetic3dState {
  readonly t: number;
  readonly position: Vec3;
  readonly velocity: Vec3;
  readonly trail: readonly Vec3[];
  readonly bAtParticle: Vec3;
  readonly lorentzForce: Vec3;
  readonly speed0: number;
  readonly events: readonly PhysicsEvent[];
}

export const MAG3D_SCALE = createScaleContext({
  lengthUnit: 1.0,
  timeUnit: 1.0,
  massUnit: 1.0,
  chargeUnit: 1e-6
});

function buildCircularLoopSegments(zCenter: number, radius: number, numSegs = 96): WireSegment3D[] {
  const segs: WireSegment3D[] = [];
  for (let i = 0; i < numSegs; i++) {
    const a0 = (i / numSegs) * 2 * Math.PI;
    const a1 = ((i + 1) / numSegs) * 2 * Math.PI;
    segs.push({
      a: { x: radius * Math.cos(a0), y: radius * Math.sin(a0), z: zCenter },
      b: { x: radius * Math.cos(a1), y: radius * Math.sin(a1), z: zCenter },
      currentSign: 1
    });
  }
  return segs;
}

export function buildConductorSegments(params: Magnetic3dParams): WireSegment3D[] {
  const R = Math.max(0.2, params.radiusR);
  switch (params.geometryType) {
    case 'single-loop':
      return buildCircularLoopSegments(0, R, 96);
    case 'helmholtz-coil':
      return [
        ...buildCircularLoopSegments(-0.5 * R, R, 72),
        ...buildCircularLoopSegments(0.5 * R, R, 72)
      ];
    case 'finite-solenoid': {
      const turns = Math.max(4, Math.min(16, Math.round(params.solenoidTurns)));
      const length = 2.4 * R;
      const segs: WireSegment3D[] = [];
      for (let k = 0; k < turns; k++) {
        const z = -0.5 * length + (k / (turns - 1)) * length;
        segs.push(...buildCircularLoopSegments(z, R, 48));
      }
      return segs;
    }
    case 'straight-wire': {
      const segs: WireSegment3D[] = [];
      const n = 24;
      for (let i = 0; i < n; i++) {
        const z0 = -4 + (i / n) * 8;
        const z1 = -4 + ((i + 1) / n) * 8;
        segs.push({ a: { x: 0, y: 0, z: z0 }, b: { x: 0, y: 0, z: z1 }, currentSign: 1 });
      }
      return segs;
    }
    case 'parallel-wires': {
      const segs: WireSegment3D[] = [];
      const n = 20;
      const sep = R * 0.8;
      for (let i = 0; i < n; i++) {
        const z0 = -4 + (i / n) * 8;
        const z1 = -4 + ((i + 1) / n) * 8;
        segs.push({ a: { x: -sep, y: 0, z: z0 }, b: { x: -sep, y: 0, z: z1 }, currentSign: 1 });
        segs.push({ a: { x: sep, y: 0, z: z0 }, b: { x: sep, y: 0, z: z1 }, currentSign: 1 });
      }
      return segs;
    }
    case 'uniform-helix':
      return [];
  }
}

function accumulateCircularArcB(
  pos: Vec3,
  zCenter: number,
  radius: number,
  turns = 1,
  numPts = 128
): { bx: number; by: number; bz: number } {
  const dTh = (2 * Math.PI) / numPts;
  let bx = 0;
  let by = 0;
  let bz = 0;
  for (let i = 0; i < numPts; i++) {
    const th = i * dTh;
    const cTh = Math.cos(th);
    const sTh = Math.sin(th);
    const px = radius * cTh;
    const py = radius * sTh;
    const rx = pos.x - px;
    const ry = pos.y - py;
    const rz = pos.z - zCenter;
    const r2 = rx * rx + ry * ry + rz * rz;
    if (r2 < 1e-8) continue;
    const invR3 = turns / (r2 * Math.sqrt(r2));
    // dl = (-R * sin(th) * dTh, R * cos(th) * dTh, 0)
    const dlx = -radius * sTh * dTh;
    const dly = radius * cTh * dTh;
    bx += (dly * rz) * invR3;
    by += (-dlx * rz) * invR3;
    bz += (dlx * ry - dly * rx) * invR3;
  }
  return { bx, by, bz };
}

export function evalBiotSavartB(pos: Vec3, params: Magnetic3dParams): Vec3 {
  if (params.geometryType === 'uniform-helix') {
    return { x: 0, y: 0, z: params.uniformBz };
  }
  const prefactor = (MU_0 * params.currentI) / (4 * Math.PI);
  const R = Math.max(0.2, params.radiusR);

  if (params.geometryType === 'single-loop') {
    const b = accumulateCircularArcB(pos, 0, R, 1, 128);
    return { x: b.bx * prefactor, y: b.by * prefactor, z: b.bz * prefactor };
  }
  if (params.geometryType === 'helmholtz-coil') {
    const b1 = accumulateCircularArcB(pos, -0.5 * R, R, 1, 96);
    const b2 = accumulateCircularArcB(pos, 0.5 * R, R, 1, 96);
    return {
      x: (b1.bx + b2.bx) * prefactor,
      y: (b1.by + b2.by) * prefactor,
      z: (b1.bz + b2.bz) * prefactor
    };
  }
  if (params.geometryType === 'finite-solenoid') {
    const turns = Math.max(4, Math.min(16, Math.round(params.solenoidTurns)));
    const length = 2.4 * R;
    let bx = 0;
    let by = 0;
    let bz = 0;
    for (let k = 0; k < turns; k++) {
      const z = -0.5 * length + (k / (turns - 1)) * length;
      const b = accumulateCircularArcB(pos, z, R, 1, 64);
      bx += b.bx;
      by += b.by;
      bz += b.bz;
    }
    return { x: bx * prefactor, y: by * prefactor, z: bz * prefactor };
  }

  const segs = buildConductorSegments(params);
  let bx = 0;
  let by = 0;
  let bz = 0;

  for (const s of segs) {
    const dl = { x: s.b.x - s.a.x, y: s.b.y - s.a.y, z: s.b.z - s.a.z };
    const mid = { x: 0.5 * (s.a.x + s.b.x), y: 0.5 * (s.a.y + s.b.y), z: 0.5 * (s.a.z + s.b.z) };
    const r = { x: pos.x - mid.x, y: pos.y - mid.y, z: pos.z - mid.z };
    const r2 = r.x * r.x + r.y * r.y + r.z * r.z;
    if (r2 < 1e-8) continue;
    const invR3 = s.currentSign / (r2 * Math.sqrt(r2));
    const c = cross3(dl, r);
    bx += c.x * invR3;
    by += c.y * invR3;
    bz += c.z * invR3;
  }
  return { x: bx * prefactor, y: by * prefactor, z: bz * prefactor };
}

export function trace3dFieldLines(params: Magnetic3dParams): Vec3[][] {
  if (params.geometryType === 'uniform-helix') {
    const lines: Vec3[][] = [];
    for (const offset of [
      { x: -0.8, y: -0.8 },
      { x: 0.8, y: -0.8 },
      { x: -0.8, y: 0.8 },
      { x: 0.8, y: 0.8 },
      { x: 0, y: 0 }
    ]) {
      lines.push([
        { x: offset.x, y: offset.y, z: -2.2 },
        { x: offset.x, y: offset.y, z: 2.2 }
      ]);
    }
    return lines;
  }

  const R = Math.max(0.2, params.radiusR);
  if (params.geometryType === 'finite-solenoid') {
    const seeds: Vec3[] = [];
    for (const radiusRatio of [0.82, 0.86, 0.88]) {
      for (const angle of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
        seeds.push({
          x: radiusRatio * R * Math.cos(angle),
          y: radiusRatio * R * Math.sin(angle),
          z: 0
        });
      }
    }

    const traceDirection = (seed: Vec3, direction: 1 | -1): Vec3[] => {
      const points: Vec3[] = [seed];
      let point = seed;
      let distance = 0;
      for (let step = 0; step < 1400; step++) {
        const next = stepRK4([point.x, point.y, point.z], 0, 0.035, (_t, xyz) => {
          const field = evalBiotSavartB({ x: xyz[0]!, y: xyz[1]!, z: xyz[2]! }, params);
          const magnitude = Math.hypot(field.x, field.y, field.z);
          return magnitude > 1e-14
            ? [direction * field.x / magnitude, direction * field.y / magnitude, direction * field.z / magnitude]
            : [0, 0, 0];
        });
        point = { x: next[0]!, y: next[1]!, z: next[2]! };
        if (![point.x, point.y, point.z].every(Number.isFinite)) break;
        distance += 0.035;
        points.push(point);

        const distanceFromSeed = Math.hypot(
          point.x - seed.x,
          point.y - seed.y,
          point.z - seed.z
        );
        if (step > 80 && distanceFromSeed < 0.07 * R) break;
        if (distance > 48 || Math.hypot(point.x, point.y, point.z) > 10 * R) break;
      }
      return points;
    };

    return seeds.map((seed) => {
      const backward = traceDirection(seed, -1);
      const forward = traceDirection(seed, 1);
      return [...backward.slice(1).reverse(), seed, ...forward.slice(1)];
    });
  }

  const seeds: Vec3[] =
    params.geometryType === 'straight-wire' || params.geometryType === 'parallel-wires'
      ? [
          { x: 0.6, y: 0, z: 0 },
          { x: 1.1, y: 0, z: 0 },
          { x: 0.6, y: 0, z: 1.0 }
        ]
      : [
          { x: 0, y: 0, z: -1.4 },
          { x: 0.35 * R, y: 0, z: -1.3 },
          { x: -0.35 * R, y: 0, z: -1.3 },
          { x: 0, y: 0.35 * R, z: -1.3 },
          { x: 0, y: -0.35 * R, z: -1.3 },
          { x: 0, y: 0.65 * R, z: -1.3 },
          { x: 0, y: -0.65 * R, z: -1.3 }
        ];

  return seeds.map((seed) => {
    const pts: Vec3[] = [seed];
    let p = seed;
    for (let i = 0; i < 65; i++) {
      const next = stepRK4([p.x, p.y, p.z], 0, 0.055, (_t, xyz) => {
        const b = evalBiotSavartB({ x: xyz[0]!, y: xyz[1]!, z: xyz[2]! }, params);
        const mag = Math.hypot(b.x, b.y, b.z);
        return mag > 1e-14 ? [b.x / mag, b.y / mag, b.z / mag] : [0, 0, 0];
      });
      p = { x: next[0]!, y: next[1]!, z: next[2]! };
      pts.push(p);
      if (Math.hypot(p.x, p.y, p.z) > 3.2) break;
    }
    return pts;
  });
}

export function createInitialState(params: Magnetic3dParams): Magnetic3dState {
  const pos: Vec3 =
    params.geometryType === 'uniform-helix'
      ? { x: 0.4, y: 0, z: -1.2 }
      : params.geometryType === 'finite-solenoid'
        ? { x: 0.35 * params.radiusR, y: 0.25 * params.radiusR, z: -0.65 * params.radiusR }
        : { x: 0.25 * params.radiusR, y: 0, z: -0.9 };
  const vel: Vec3 = { x: params.vPerp, y: 0, z: params.vParallel };
  const bAtParticle = evalBiotSavartB(pos, params);
  const scaleQm =
    params.geometryType === 'uniform-helix' ? params.qOverM : params.qOverM / MAG3D_SCALE.chargeUnit;
  const fL = cross3(vel, bAtParticle);
  return {
    t: 0,
    position: pos,
    velocity: vel,
    trail: [pos],
    bAtParticle,
    lorentzForce: { x: scaleQm * fL.x, y: scaleQm * fL.y, z: scaleQm * fL.z },
    speed0: Math.hypot(vel.x, vel.y, vel.z),
    events: []
  };
}

export function stepMagnetic3d(
  state: Magnetic3dState,
  params: Magnetic3dParams,
  dt: number
): StepResult<Magnetic3dState> {
  if (!Number.isFinite(dt) || dt < 0) throw new Error(`Invalid dt: ${dt}`);
  if (dt === 0) return { nextState: state, events: [] };

  const subN = Math.max(1, Math.ceil(dt / 0.004));
  const subH = dt / subN;
  const effQOverM =
    params.geometryType === 'uniform-helix' ? params.qOverM : params.qOverM / MAG3D_SCALE.chargeUnit;

  let curP = { position: state.position, velocity: state.velocity, t: state.t };
  for (let i = 0; i < subN; i++) {
    curP = stepBorisPusher(
      curP,
      (pos) => ({ E: { x: 0, y: 0, z: 0 }, B: evalBiotSavartB(pos, params) }),
      effQOverM,
      1.0,
      subH
    );
  }

  const last = state.trail[state.trail.length - 1];
  const np = curP.position;
  const dist = last ? Math.hypot(np.x - last.x, np.y - last.y, np.z - last.z) : 1;
  const trail = dist > 0.03 ? [...state.trail.slice(-300), np] : state.trail;

  const bAtParticle = evalBiotSavartB(np, params);
  const fRaw = cross3(curP.velocity, bAtParticle);

  return {
    nextState: {
      ...state,
      t: curP.t,
      position: np,
      velocity: curP.velocity,
      trail,
      bAtParticle,
      lorentzForce: { x: effQOverM * fRaw.x, y: effQOverM * fRaw.y, z: effQOverM * fRaw.z }
    },
    events: []
  };
}

export function computeObservables(state: Magnetic3dState): Record<string, number> {
  const speed = Math.hypot(state.velocity.x, state.velocity.y, state.velocity.z);
  const ke = 0.5 * speed * speed;
  const vDotF = dot3(state.velocity, state.lorentzForce);
  return {
    t: state.t,
    x: state.position.x,
    y: state.position.y,
    z: state.position.z,
    bMagMicroT: Math.hypot(state.bAtParticle.x, state.bAtParticle.y, state.bAtParticle.z) * 1e6,
    speed,
    ke,
    vDotF
  };
}

export function checkInvariants(state: Magnetic3dState): InvariantReport[] {
  const speedNow = Math.hypot(state.velocity.x, state.velocity.y, state.velocity.z);
  const ke0 = 0.5 * state.speed0 * state.speed0;
  const keNow = 0.5 * speedNow * speedNow;
  const relErr = ke0 > 1e-12 ? Math.abs(keNow - ke0) / ke0 : Math.abs(keNow - ke0);
  return [
    {
      name: '纯磁场 Boris 推粒器动能严格守恒 (ΔEk / Ek0)',
      measuredError: relErr,
      tolerance: 1e-8,
      passed: Number.isFinite(relErr) && relErr < 1e-8
    }
  ];
}
