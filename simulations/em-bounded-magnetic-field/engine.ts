import {
  bisectEvent,
  degToRad,
  kineticEnergy3D,
  len2,
  radToDeg,
  signedDistanceCircle2D,
  signedDistanceHalfSpace2D,
  signedDistanceRect2D,
  stepBorisPusher,
  vec2,
  vec3,
  ZERO_VEC3,
  type ChargedParticleState,
  type EmFieldEvaluator,
  type Vec2,
  type Vec3
} from '@physforge/physics-core';
import type { InvariantReport, PhysicsEvent, StepResult } from '@physforge/sim-sdk';

export type FieldGeometryMode = 'half-space' | 'circular' | 'rectangular' | 'crossed-eb';
export type DynamicCircleFamily = 'single' | 'scaling' | 'rotating' | 'translating' | 'focusing';

export type BoundedMagneticParams = {
  mode: FieldGeometryMode;
  family: DynamicCircleFamily;
  mass: number;
  charge: number;
  magneticFieldZ: number;
  electricFieldY: number;
  initialSpeed: number;
  launchAngleDeg: number;
  fieldScale: number;
  beamCount: number;
};

export interface ParticleTrack {
  readonly id: number;
  readonly color: string;
  readonly state: ChargedParticleState;
  readonly initialSpeed: number;
  readonly initialAngleRad: number;
  readonly inField: boolean;
  readonly hasEntered: boolean;
  readonly hasExited: boolean;
  readonly entryPoint?: Vec2;
  readonly exitPoint?: Vec2;
  readonly entryTime?: number;
  readonly exitTime?: number;
  readonly trail: readonly Vec2[];
}

export interface BoundedMagneticState {
  readonly t: number;
  readonly particles: readonly ParticleTrack[];
  readonly events: readonly PhysicsEvent[];
}

const BEAM_COLORS = [
  '#38bdf8',
  '#f472b6',
  '#4ade80',
  '#fbbf24',
  '#a78bfa',
  '#fb7185',
  '#2dd4bf'
] as const;

const MAX_TRAIL_POINTS = 900;

/**
 * 计算给定区域模式下的磁场有向距离（场内 <= 0，场外 > 0）
 */
export function fieldSignedDistance(
  pos: Vec3,
  mode: FieldGeometryMode,
  fieldScale: number
): number {
  const p2 = vec2(pos.x, pos.y);
  switch (mode) {
    case 'half-space':
      // x >= 0 为磁场区域，x < 0 为无场区域；外法向朝 -x
      return signedDistanceHalfSpace2D(p2, vec2(0, 0), vec2(-1, 0));
    case 'circular':
      return signedDistanceCircle2D(p2, vec2(0, 0), Math.max(fieldScale, 0.05));
    case 'rectangular': {
      const w = Math.max(fieldScale, 0.1);
      const h = Math.max(fieldScale * 1.6, 0.2);
      return signedDistanceRect2D(p2, 0, w, -0.5 * h, 0.5 * h);
    }
    case 'crossed-eb':
      return -1;
  }
}

export function createFieldEvaluator(params: BoundedMagneticParams): EmFieldEvaluator {
  const B = vec3(0, 0, params.magneticFieldZ);
  const E = params.mode === 'crossed-eb' ? vec3(0, params.electricFieldY, 0) : ZERO_VEC3;

  return (position: Vec3): { E: Vec3; B: Vec3 } => {
    if (params.mode === 'crossed-eb') {
      return { E, B };
    }
    const inside = fieldSignedDistance(position, params.mode, params.fieldScale) <= 0;
    return inside ? { E: ZERO_VEC3, B } : { E: ZERO_VEC3, B: ZERO_VEC3 };
  };
}

/**
 * 根据教学模式生成主粒子与动态圆簇初始状态
 */
export function createInitialState(params: BoundedMagneticParams): BoundedMagneticState {
  const count = params.family === 'single' ? 1 : Math.max(1, Math.min(7, Math.round(params.beamCount)));
  const R = Math.max(params.fieldScale, 0.1);
  const baseAngleRad = degToRad(params.launchAngleDeg);
  const particles: ParticleTrack[] = [];

  for (let i = 0; i < count; i++) {
    const offsetIndex = count === 1 ? 0 : i - 0.5 * (count - 1);
    let pos = vec3(-0.35 * R, 0, 0);
    let speed = params.initialSpeed;
    let angle = baseAngleRad;

    if (params.mode === 'crossed-eb') {
      pos = vec3(0, 0, 0);
      if (params.family === 'scaling') {
        speed = Math.max(0, params.initialSpeed * (1 + 0.2 * offsetIndex));
      }
    } else if (params.mode === 'circular') {
      if (params.family === 'focusing') {
        // 从圆形左边界水平向右入射，y0 均匀分布，展示 R_c = R_field 时的磁聚焦
        const y0 = (offsetIndex / Math.max(1, Math.ceil(count / 2))) * 0.72 * R;
        const xBoundary = -Math.sqrt(Math.max(0, R * R - y0 * y0));
        // 微微置于边界内侧以保证在圆形边界处平稳起始
        pos = vec3(xBoundary - 0.04 * R, y0, 0);
        angle = 0;
      } else if (params.family === 'scaling') {
        pos = vec3(-R - 0.12 * R, 0, 0);
        speed = Math.max(0.2, params.initialSpeed * (1 + 0.22 * offsetIndex));
      } else if (params.family === 'rotating') {
        pos = vec3(-R - 0.06 * R, 0, 0);
        angle = baseAngleRad + degToRad(offsetIndex * 18);
      } else if (params.family === 'translating') {
        const y0 = offsetIndex * 0.26 * R;
        const xB = -Math.sqrt(Math.max(0, R * R - y0 * y0));
        pos = vec3(xB - 0.08 * R, y0, 0);
      } else {
        pos = vec3(-R - 0.12 * R, 0, 0);
      }
    } else {
      // half-space 或 rectangular
      if (params.family === 'scaling') {
        pos = vec3(-0.12 * R, 0, 0);
        speed = Math.max(0.2, params.initialSpeed * (1 + 0.22 * offsetIndex));
      } else if (params.family === 'rotating') {
        pos = vec3(-0.04 * R, 0, 0);
        angle = baseAngleRad + degToRad(offsetIndex * 20);
      } else if (params.family === 'translating' || params.family === 'focusing') {
        pos = vec3(-0.12 * R, offsetIndex * 0.25 * R, 0);
      } else {
        pos = vec3(-0.15 * R, 0, 0);
      }
    }

    const vx = speed * Math.cos(angle);
    const vy = speed * Math.sin(angle);
    const inField = fieldSignedDistance(pos, params.mode, params.fieldScale) <= 0;

    particles.push({
      id: i,
      color: BEAM_COLORS[i % BEAM_COLORS.length]!,
      state: {
        position: pos,
        velocity: vec3(vx, vy, 0),
        t: 0
      },
      initialSpeed: speed,
      initialAngleRad: angle,
      inField,
      hasEntered: inField,
      hasExited: false,
      entryPoint: inField ? vec2(pos.x, pos.y) : undefined,
      entryTime: inField ? 0 : undefined,
      trail: [vec2(pos.x, pos.y)]
    });
  }

  return {
    t: 0,
    particles,
    events: []
  };
}

function appendTrail(trail: readonly Vec2[], pt: Vec2): Vec2[] {
  const last = trail[trail.length - 1];
  if (last && Math.hypot(pt.x - last.x, pt.y - last.y) < 1e-4) {
    return [...trail];
  }
  if (trail.length >= MAX_TRAIL_POINTS) {
    return [...trail.slice(trail.length - MAX_TRAIL_POINTS + 1), pt];
  }
  return [...trail, pt];
}

/**
 * 单步演化：内置 BorisPusher + bisectEvent 精确进出边界捕获与分段积分
 */
export function stepBoundedMagnetic(
  state: BoundedMagneticState,
  params: BoundedMagneticParams,
  dt: number
): StepResult<BoundedMagneticState> {
  if (!Number.isFinite(dt) || dt < 0) {
    throw new Error(`Time step dt must be non-negative finite, got ${dt}.`);
  }
  if (dt === 0) {
    return { nextState: state, events: [] };
  }

  const mass = Math.max(params.mass, 1e-12);
  const fields = createFieldEvaluator(params);
  const pureBFields: EmFieldEvaluator = () => ({
    E: params.mode === 'crossed-eb' ? vec3(0, params.electricFieldY, 0) : ZERO_VEC3,
    B: vec3(0, 0, params.magneticFieldZ)
  });
  const freeFields: EmFieldEvaluator = () => ({ E: ZERO_VEC3, B: ZERO_VEC3 });

  const stepEvents: PhysicsEvent[] = [];
  const nextParticles: ParticleTrack[] = [];

  for (const track of state.particles) {
    let cur = track.state;
    let inField = track.inField;
    let hasEntered = track.hasEntered;
    let hasExited = track.hasExited;
    let entryPoint = track.entryPoint;
    let exitPoint = track.exitPoint;
    let entryTime = track.entryTime;
    let exitTime = track.exitTime;
    let trail = [...track.trail];

    if (params.mode === 'crossed-eb') {
      cur = stepBorisPusher(cur, fields, params.charge, mass, dt);
      trail = appendTrail(trail, vec2(cur.position.x, cur.position.y));
    } else {
      // 最多允许本步发生一次入射与一次出射分段，保证精确过界
      let remaining = dt;
      for (let seg = 0; seg < 2 && remaining > 1e-12; seg++) {
        const segFields = inField ? pureBFields : freeFields;
        const advanceSeg = (s: ChargedParticleState, subDt: number): ChargedParticleState =>
          stepBorisPusher(s, segFields, params.charge, mass, subDt);

        const candidateEnd = advanceSeg(cur, remaining);
        const gStart = fieldSignedDistance(cur.position, params.mode, params.fieldScale);
        const gEnd = fieldSignedDistance(candidateEnd.position, params.mode, params.fieldScale);

        // 单向边界门控：场外只检测进入(g<=0)，场内只检测穿出(g>0)，彻底避免落点微小浮点偏差导致跨界震荡
        const shouldCross = (!inField && gStart > 0 && gEnd <= 0) || (inField && gStart <= 0 && gEnd > 0);
        const eventRes = shouldCross
          ? bisectEvent(
              cur,
              cur.t,
              remaining,
              advanceSeg,
              (s) => fieldSignedDistance(s.position, params.mode, params.fieldScale),
              {
                timeTolerance: 1e-8,
                biasEndpoint: inField ? 'positive' : 'negative'
              }
            )
          : null;

        if (!eventRes) {
          cur = candidateEnd;
          trail = appendTrail(trail, vec2(cur.position.x, cur.position.y));
          remaining = 0;
        } else {
          const hitPos = vec2(eventRes.state.position.x, eventRes.state.position.y);
          trail = appendTrail(trail, hitPos);

          if (!inField) {
            inField = true;
            hasEntered = true;
            entryPoint = hitPos;
            entryTime = eventRes.time;
            if (track.id === 0) {
              stepEvents.push({
                id: `entry-${eventRes.time.toFixed(6)}`,
                time: eventRes.time,
                label: '进入磁场边界',
                position: { x: hitPos.x, y: hitPos.y },
                metrics: { speed: len2(vec2(eventRes.state.velocity.x, eventRes.state.velocity.y)) }
              });
            }
          } else {
            inField = false;
            hasExited = true;
            exitPoint = hitPos;
            exitTime = eventRes.time;
            if (track.id === 0) {
              const deflectionRad = Math.atan2(
                eventRes.state.velocity.y,
                eventRes.state.velocity.x
              ) - track.initialAngleRad;
              stepEvents.push({
                id: `exit-${eventRes.time.toFixed(6)}`,
                time: eventRes.time,
                label: '穿出磁场边界',
                position: { x: hitPos.x, y: hitPos.y },
                metrics: {
                  deflectionDeg: radToDeg(deflectionRad),
                  durationInField: entryTime !== undefined ? eventRes.time - entryTime : eventRes.time
                }
              });
            }
          }

          cur = eventRes.state;
          remaining -= eventRes.timeOffset;
        }
      }
    }

    nextParticles.push({
      ...track,
      state: cur,
      inField,
      hasEntered,
      hasExited,
      entryPoint,
      exitPoint,
      entryTime,
      exitTime,
      trail
    });
  }

  return {
    nextState: {
      t: state.t + dt,
      particles: nextParticles,
      events: [...state.events, ...stepEvents]
    },
    events: stepEvents
  };
}

/**
 * 计算主粒子瞬时观测量及配速法分量
 */
export function computeObservables(
  state: BoundedMagneticState,
  params: BoundedMagneticParams
): Record<string, number> {
  const primary = state.particles[0];
  if (!primary) {
    return { x: 0, y: 0, vx: 0, vy: 0, speed: 0, kineticEnergy: 0, larmorRadius: 0 };
  }

  const { position, velocity } = primary.state;
  const speed = Math.hypot(velocity.x, velocity.y);
  const ke = kineticEnergy3D(Math.max(params.mass, 1e-12), velocity);
  const qB = Math.abs(params.charge * params.magneticFieldZ);
  const larmorRadius = qB > 0 ? (params.mass * speed) / qB : 0;

  let vDriftX = 0;
  if (params.mode === 'crossed-eb' && Math.abs(params.magneticFieldZ) > 0) {
    vDriftX = params.electricFieldY / params.magneticFieldZ;
  }

  return {
    x: position.x,
    y: position.y,
    vx: velocity.x,
    vy: velocity.y,
    speed,
    kineticEnergy: ke,
    larmorRadius,
    vDriftX,
    vRotMag: Math.hypot(velocity.x - vDriftX, velocity.y)
  };
}

/**
 * 解析计算动态圆（圆心与回旋半径）供渲染辅助层使用
 */
export function computeLarmorCircleForTrack(
  track: ParticleTrack,
  params: BoundedMagneticParams
): { center: Vec2; radius: number } | null {
  const qB = params.charge * params.magneticFieldZ;
  if (qB === 0) return null;
  const vx = track.state.velocity.x;
  const vy = track.state.velocity.y;
  const speed = Math.hypot(vx, vy);
  if (speed === 0) return null;

  // a_Lorentz = (q/m)(vx, vy, 0) × (0, 0, Bz) = (qBz/m)(vy, -vx, 0)
  // 向心方向单位矢量 = sgn(qBz) * (vy, -vx) / speed
  const radius = (params.mass * speed) / Math.abs(qB);
  const sgn = qB > 0 ? 1 : -1;
  const cx = track.state.position.x + sgn * radius * (vy / speed);
  const cy = track.state.position.y - sgn * radius * (vx / speed);
  return { center: vec2(cx, cy), radius };
}

/**
 * 守恒律校验
 */
export function checkInvariants(
  state: BoundedMagneticState,
  initial: BoundedMagneticState,
  params: BoundedMagneticParams
): InvariantReport[] {
  const p0 = initial.particles[0];
  const p1 = state.particles[0];
  if (!p0 || !p1) return [];

  if (params.mode !== 'crossed-eb') {
    const ke0 = kineticEnergy3D(Math.max(params.mass, 1e-12), p0.state.velocity);
    const ke1 = kineticEnergy3D(Math.max(params.mass, 1e-12), p1.state.velocity);
    const relErr = Math.abs(ke1 - ke0) / Math.max(ke0, 1e-12);
    return [
      {
        name: '纯磁场动能守恒 (ΔEk / Ek0)',
        measuredError: relErr,
        tolerance: 1e-6,
        passed: relErr < 1e-6
      }
    ];
  }

  return [];
}
