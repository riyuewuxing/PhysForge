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

/** Exact integral of one finite straight z-directed filament on [-4,4].
 * On the filament the ideal model is undefined; the public field evaluator
 * retains its historical finite zero sentinel at exactly rho=0. This is NOT
 * a prediction on the conductor itself. Off-axis points are not softened. */
function finiteAxialWireB(pos:Vec3,x0:number,prefactor:number):Vec3 {
  const x=pos.x-x0,y=pos.y,rho=Math.hypot(x,y);
  if(prefactor===0||rho===0)return {x:0,y:0,z:0};
  const a=4-pos.z,b=4+pos.z;
  // Rationalized difference outside the segment avoids subtracting near-equal cosines.
  let factor:number;
  if(a*b<0){
    const u=Math.abs(a),v=Math.abs(b),A=Math.hypot(rho,u),B=Math.hypot(rho,v);
    factor=rho*rho*(v*v-u*u)/(A*B*(v*A+u*B));
    if(b<0)factor=-factor;
  }else factor=a/Math.hypot(rho,a)+b/Math.hypot(rho,b);
  const mag=prefactor*factor/rho;
  return {x:-mag*y/rho,y:mag*x/rho,z:0};
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

  if(params.geometryType==='straight-wire')return finiteAxialWireB(pos,0,prefactor);
  const a=finiteAxialWireB(pos,-.8*R,prefactor),b=finiteAxialWireB(pos,.8*R,prefactor);
  return {x:a.x+b.x,y:a.y+b.y,z:0};
}

export function trace3dFieldLines(params: Magnetic3dParams, displaySampling = false): Vec3[][] {
  if (params.geometryType === 'uniform-helix' ? params.uniformBz === 0 : params.currentI === 0) return [];
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
        { x: offset.x, y: offset.y, z: -2.2 * Math.sign(params.uniformBz) },
        { x: offset.x, y: offset.y, z: 2.2 * Math.sign(params.uniformBz) }
      ]);
    }
    return lines;
  }

  const R = Math.max(0.2, params.radiusR);
  if (displaySampling && (params.geometryType === 'straight-wire' || params.geometryType === 'parallel-wires')) {
    // A finite axial straight segment has azimuthal B. Two parallel axial
    // conductors have a planar superposition (Bz = 0), including the central null.
    // Integrate actual ordered field tangents around each conductor and both.
    const lines: Vec3[][] = [];
    const h = Math.min(0.04, 0.025 * R);
    for (const z of [-2, 0, 2]) {
      const seeds = params.geometryType === 'straight-wire'
        ? [0.45, 0.85, 1.3].map(r => ({ x: r * R, y: 0, z }))
        : [
          ...[-0.8, 0.8].flatMap(x => [0.35, 0.55].map(y => ({ x: x * R, y: y * R, z }))),
          { x: 0, y: 1.45 * R, z }
        ];
      for (const seed of seeds) {
        const line: Vec3[] = [seed];
        let point = seed;
        for (let i = 0; i < Math.ceil(24 * R / h); i++) {
          const next = stepRK4([point.x, point.y, point.z], 0, h, (_t, xyz) => {
            const field = evalBiotSavartB({ x: xyz[0]!, y: xyz[1]!, z: xyz[2]! }, params);
            const magnitude = Math.hypot(field.x, field.y, field.z);
            return magnitude > 1e-14 ? [field.x / magnitude, field.y / magnitude, field.z / magnitude] : [0, 0, 0];
          });
          const candidate = { x: next[0]!, y: next[1]!, z: next[2]! };
          if (![candidate.x,candidate.y,candidate.z].every(Number.isFinite) ||
              Math.hypot(candidate.x-point.x,candidate.y-point.y,candidate.z-point.z) < 1e-10) break;
          line.push(candidate);
          point = candidate;
          if (i > 16 && Math.hypot(point.x-seed.x,point.y-seed.y,point.z-seed.z) <= 1.1*h) break;
          if (Math.hypot(point.x,point.y) > 4*R) break;
        }
        if (line.length > 1) lines.push(line);
      }
    }
    return lines;
  }
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

    const traceDirection = (seed: Vec3, direction: 1 | -1, extent = 10 * R, maxSteps = 1400): Vec3[] => {
      const points: Vec3[] = [seed];
      let point = seed;
      let distance = 0;
      for (let step = 0; step < maxSteps; step++) {
        const next = stepRK4([point.x, point.y, point.z], 0, 0.035, (_t, xyz) => {
          const field = evalBiotSavartB({ x: xyz[0]!, y: xyz[1]!, z: xyz[2]! }, params);
          const magnitude = Math.hypot(field.x, field.y, field.z);
          return magnitude > 1e-14
            ? [direction * field.x / magnitude, direction * field.y / magnitude, direction * field.z / magnitude]
            : [0, 0, 0];
        });
        const candidate = { x: next[0]!, y: next[1]!, z: next[2]! };
        if (![candidate.x, candidate.y, candidate.z].every(Number.isFinite) || Math.hypot(candidate.x - point.x, candidate.y - point.y, candidate.z - point.z) < 1e-10) break;
        point = candidate;
        distance += 0.035;
        points.push(point);

        const distanceFromSeed = Math.hypot(
          point.x - seed.x,
          point.y - seed.y,
          point.z - seed.z
        );
        if (step > 80 && distanceFromSeed < 0.07 * R) break;
        if (distance > 48 || Math.hypot(point.x, point.y, point.z) > extent) break;
      }
      return points;
    };

    if (displaySampling) {
      // A complete forward orbit is not traced a second time. Open curves are
      // joined from both directions and stopped at the display domain.
      const sample = (seed: Vec3): Vec3[] => {
        const forward = traceDirection(seed, 1, 3.4 * R);
        const end = forward.at(-1)!;
        if (forward.length > 81 && Math.hypot(end.x - seed.x, end.y - seed.y, end.z - seed.z) < 0.07 * R) return forward;
        const backward = traceDirection(seed, -1, 3.4 * R);
        return [...backward.slice(1).reverse(), seed, ...forward.slice(1)];
      };
      // Each turn has 64 quadrature nodes: eighth turns preserve the sampled field.
      // Add diagonal return planes without recomputing identical physical orbits.
      const lines: Vec3[][] = [];
      for (const ratio of [0.82, 0.86, 0.88, 0.25, 0.55]) {
        const line = sample({ x: ratio * R, y: 0, z: 0 });
        const count = ratio >= 0.82 ? 8 : 4;
        for (let azimuth = 0; azimuth < count; azimuth++) {
          const angle = azimuth * 2 * Math.PI / count;
          const c = Math.cos(angle), s = Math.sin(angle);
          lines.push(line.map(q => ({ x: c * q.x - s * q.y, y: s * q.x + c * q.y, z: q.z })));
        }
      }
      lines.push(sample({ x: 0, y: 0, z: 0 }));
      return lines.filter(line => line.length >= 2);
    }

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
      const candidate = { x: next[0]!, y: next[1]!, z: next[2]! };
      if (![candidate.x, candidate.y, candidate.z].every(Number.isFinite) || Math.hypot(candidate.x - p.x, candidate.y - p.y, candidate.z - p.z) < 1e-10) break;
      p = candidate;
      pts.push(p);
      if (Math.hypot(p.x, p.y, p.z) > 3.2) break;
    }
    return pts;
  });
}

/** Only geometry/field parameters affect static display geometry. */
export function magneticFieldGeometrySignature(params: Magnetic3dParams): string {
  return JSON.stringify([params.geometryType, params.radiusR, params.solenoidTurns, params.currentI, params.uniformBz]);
}

// One bounded cache, shared by Canvas and WebGL; particle state never invalidates it.
let displayFieldCache: { key: string; lines: readonly (readonly Vec3[])[] } | undefined;
export function getMagneticDisplayFieldLines(params: Magnetic3dParams): readonly (readonly Vec3[])[] {
  const key = magneticFieldGeometrySignature(params);
  if (displayFieldCache?.key === key) return displayFieldCache.lines;
  const lines = trace3dFieldLines(params, true).filter(line => line.length >= 2);
  displayFieldCache = { key, lines };
  return lines;
}

/** Keep the interleaved Biot–Savart segments of the two wires separate in the scene. */
export function buildMagneticConductorPaths(params: Magnetic3dParams): WireSegment3D[][] {
  const segments = buildConductorSegments(params);
  if (params.geometryType === 'parallel-wires') return [segments.filter((_, i) => i % 2 === 0), segments.filter((_, i) => i % 2 === 1)];
  const size = params.geometryType === 'single-loop' ? 96 : params.geometryType === 'helmholtz-coil' ? 72 : params.geometryType === 'finite-solenoid' ? 48 : 24;
  const paths: WireSegment3D[][] = [];
  for (let start = 0; start < segments.length; start += size) paths.push(segments.slice(start, start + size));
  return paths;
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

  const effQOverM =
    params.geometryType === 'uniform-helix' ? params.qOverM : params.qOverM / MAG3D_SCALE.chargeUnit;
  // Cayley rotation has phase 2 atan(omega h/2), not omega h. Keep
  // uniform-field relative phase error below (0.002)^2/12 while preserving
  // the shared Boris step and its time-symmetric position update.
  const omega=params.geometryType==='uniform-helix'?Math.abs(effQOverM*params.uniformBz):0;
  const maxH=omega>0?Math.min(.004,.002/omega):.004;
  const subN=Math.max(1,Math.ceil(dt/maxH)),subH=dt/subN;

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
    vx:state.velocity.x,vy:state.velocity.y,vz:state.velocity.z,
    bxT:state.bAtParticle.x,byT:state.bAtParticle.y,bzT:state.bAtParticle.z,
    ax:state.lorentzForce.x,ay:state.lorentzForce.y,az:state.lorentzForce.z,
    bMagT:Math.hypot(state.bAtParticle.x,state.bAtParticle.y,state.bAtParticle.z),
    bMagMicroT: Math.hypot(state.bAtParticle.x, state.bAtParticle.y, state.bAtParticle.z) * 1e6,
    speed,
    ke,
    vDotF
  };
}


export function checkInvariants(state:Magnetic3dState,initial?:Magnetic3dState,params?:Magnetic3dParams):InvariantReport[]{
  const v=state.velocity,B=state.bAtParticle,a=state.lorentzForce;
  const norm=(p:Vec3)=>Math.hypot(p.x,p.y,p.z);
  const ke0=.5*(initial?norm(initial.velocity):state.speed0)**2,ke=.5*norm(v)**2;
  const report=(name:string,error:number,tolerance:number):InvariantReport=>({name,measuredError:Number.isFinite(error)?error:Number.MAX_VALUE,tolerance,passed:Number.isFinite(error)&&error<=tolerance});
  const out=[
    report('纯磁场 Boris 比动能守恒',Math.abs(ke-ke0)/Math.max(1e-12,ke0),1e-8),
    report('磁加速度与速度正交',Math.abs(dot3(v,a))/Math.max(1e-12,norm(v)*norm(a)),1e-10),
    report('磁加速度与磁场正交',Math.abs(dot3(B,a))/Math.max(1e-20,norm(B)*norm(a)),1e-10)
  ];
  if(params){
    const expectedB=evalBiotSavartB(state.position,params),qm=params.geometryType==='uniform-helix'?params.qOverM:params.qOverM/MAG3D_SCALE.chargeUnit,cross=cross3(v,expectedB),
      expectedA={x:qm*cross.x,y:qm*cross.y,z:qm*cross.z};
    out.push(report('粒子位置处磁场',Math.hypot(B.x-expectedB.x,B.y-expectedB.y,B.z-expectedB.z)/Math.max(1e-15,norm(expectedB)),1e-10));
    out.push(report('有向洛伦兹加速度 (q/m)v×B',Math.hypot(a.x-expectedA.x,a.y-expectedA.y,a.z-expectedA.z)/Math.max(1e-12,norm(expectedA)),1e-10));
    if(initial&&params.geometryType==='uniform-helix'){
      const t=state.t-initial.t,w=params.qOverM*params.uniformBz,c=Math.cos(w*t),s=Math.sin(w*t),
        v0=initial.velocity,r0=initial.position,
        vx=v0.x*c+v0.y*s,vy=-v0.x*s+v0.y*c,
        x=r0.x+(w===0?v0.x*t:(v0.x*s+v0.y*(1-c))/w),
        y=r0.y+(w===0?v0.y*t:(v0.x*(c-1)+v0.y*s)/w),z=r0.z+v0.z*t;
      out.push(report('匀强场解析速度',Math.hypot(v.x-vx,v.y-vy,v.z-v0.z)/Math.max(1,norm(v0)),3e-5));
      out.push(report('匀强场解析轨迹',Math.hypot(state.position.x-x,state.position.y-y,state.position.z-z)/Math.max(1,norm(v0)*Math.abs(t)),3e-5));
    }
  }
  return out;
}
