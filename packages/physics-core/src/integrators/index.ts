import { scale3, add3, cross3, type Vec3 } from '../vectors/index.js';

/**
 * 通用常微分方程右端导数函数: dy/dt = f(t, y)
 */
export type OdeDerivative = (t: number, state: readonly number[]) => number[];

/**
 * 保守/二阶力学系统加速度函数: a = f(positions, velocities, t)
 */
export type AccelerationFn = (
  positions: readonly number[],
  velocities: readonly number[],
  t: number
) => number[];

export interface VerletState {
  readonly positions: readonly number[];
  readonly velocities: readonly number[];
  readonly t: number;
}

export interface ChargedParticleState {
  readonly position: Vec3;
  readonly velocity: Vec3;
  readonly t: number;
}

export interface EmFields {
  readonly E: Vec3;
  readonly B: Vec3;
}

export type EmFieldEvaluator = (position: Vec3, t: number) => EmFields;

export interface AdaptiveRK45Options {
  absTol?: number;
  relTol?: number;
  minStep?: number;
  maxSubsteps?: number;
}

export interface AdaptiveRK45Result {
  readonly state: number[];
  readonly t: number;
  readonly steps: number;
}

function validateDt(dt: number): void {
  if (!Number.isFinite(dt)) {
    throw new Error(`Time step dt must be finite, got ${dt}.`);
  }
}

function assertVectorLength(vec: readonly number[], expected: number, label: string): void {
  if (vec.length !== expected) {
    throw new Error(
      `${label} length mismatch: expected ${expected}, got ${vec.length}.`
    );
  }
}

/**
 * 经典四阶显式龙格-库塔（RK4）单步积分器
 */
export function stepRK4(
  state: readonly number[],
  t: number,
  dt: number,
  derivative: OdeDerivative
): number[] {
  validateDt(dt);
  if (!Number.isFinite(t)) {
    throw new Error(`Time t must be finite, got ${t}.`);
  }
  const n = state.length;
  if (dt === 0) {
    return [...state];
  }

  const k1 = derivative(t, state);
  assertVectorLength(k1, n, 'RK4 k1 derivative');
  const y2 = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    y2[i] = state[i]! + 0.5 * dt * k1[i]!;
  }

  const k2 = derivative(t + 0.5 * dt, y2);
  assertVectorLength(k2, n, 'RK4 k2 derivative');
  const y3 = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    y3[i] = state[i]! + 0.5 * dt * k2[i]!;
  }

  const k3 = derivative(t + 0.5 * dt, y3);
  assertVectorLength(k3, n, 'RK4 k3 derivative');
  const y4 = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    y4[i] = state[i]! + dt * k3[i]!;
  }

  const k4 = derivative(t + dt, y4);
  assertVectorLength(k4, n, 'RK4 k4 derivative');
  const next = new Array<number>(n);
  const factor = dt / 6;
  for (let i = 0; i < n; i++) {
    next[i] = state[i]! + factor * (k1[i]! + 2 * k2[i]! + 2 * k3[i]! + k4[i]!);
  }
  return next;
}

/**
 * Velocity Verlet 二阶辛积分器（保守力学、简谐振动与天体系统专用）
 */
export function stepVelocityVerlet(
  state: VerletState,
  dt: number,
  acceleration: AccelerationFn
): VerletState {
  validateDt(dt);
  if (!Number.isFinite(state.t)) {
    throw new Error(`Time t must be finite, got ${state.t}.`);
  }
  const n = state.positions.length;
  if (state.velocities.length !== n) {
    throw new Error(
      `Position/velocity dimension mismatch: ${n} vs ${state.velocities.length}.`
    );
  }
  if (dt === 0) {
    return {
      positions: [...state.positions],
      velocities: [...state.velocities],
      t: state.t
    };
  }

  const a0 = acceleration(state.positions, state.velocities, state.t);
  assertVectorLength(a0, n, 'VelocityVerlet initial acceleration');
  const nextPositions = new Array<number>(n);
  const halfDtSq = 0.5 * dt * dt;
  for (let i = 0; i < n; i++) {
    nextPositions[i] = state.positions[i]! + state.velocities[i]! * dt + a0[i]! * halfDtSq;
  }

  const nextT = state.t + dt;
  const a1 = acceleration(nextPositions, state.velocities, nextT);
  assertVectorLength(a1, n, 'VelocityVerlet end acceleration');
  const nextVelocities = new Array<number>(n);
  const halfDt = 0.5 * dt;
  for (let i = 0; i < n; i++) {
    nextVelocities[i] = state.velocities[i]! + (a0[i]! + a1[i]!) * halfDt;
  }

  return {
    positions: nextPositions,
    velocities: nextVelocities,
    t: nextT
  };
}

/**
 * 电磁场带电粒子 Boris 推粒器（半步电加速 → 磁场精确纯旋转 → 半步电加速）
 * 在纯磁场下（E = 0），动能数学严格守恒，匀强场轨道半径离散无漂移。
 */
export function stepBorisPusher(
  particle: ChargedParticleState,
  fields: EmFieldEvaluator,
  q: number,
  m: number,
  dt: number
): ChargedParticleState {
  validateDt(dt);
  if (!Number.isFinite(particle.t)) {
    throw new Error(`Particle time t must be finite, got ${particle.t}.`);
  }
  if (!Number.isFinite(q)) {
    throw new Error(`Charge q must be finite, got ${q}.`);
  }
  if (!Number.isFinite(m) || m <= 0) {
    throw new Error(`Mass m must be a positive finite number, got ${m}.`);
  }
  if (dt === 0) {
    return {
      position: { ...particle.position },
      velocity: { ...particle.velocity },
      t: particle.t
    };
  }

  // 在步中点估算场强（二阶时间对称）
  const halfDt = 0.5 * dt;
  const midPos = add3(particle.position, scale3(particle.velocity, halfDt));
  const { E, B } = fields(midPos, particle.t + halfDt);

  if (q === 0) {
    return {
      position: add3(particle.position, scale3(particle.velocity, dt)),
      velocity: { ...particle.velocity },
      t: particle.t + dt
    };
  }

  const qOverMHalfDt = (q / m) * halfDt;
  const halfImpulseE = scale3(E, qOverMHalfDt);

  // 1. 半步电场加速
  const vMinus = add3(particle.velocity, halfImpulseE);

  // 2. 磁场纯旋转 (Cayley transform)
  const tVec = scale3(B, qOverMHalfDt);
  const tMagSq = tVec.x * tVec.x + tVec.y * tVec.y + tVec.z * tVec.z;
  const sVec = scale3(tVec, 2 / (1 + tMagSq));

  const vPrime = add3(vMinus, cross3(vMinus, tVec));
  const vPlus = add3(vMinus, cross3(vPrime, sVec));

  // 3. 半步电场加速
  const nextVelocity = add3(vPlus, halfImpulseE);

  // 4. 时间对称位置更新（匀强磁场中离散点严格落在理论回旋圆上）
  const avgVelocity = scale3(add3(particle.velocity, nextVelocity), 0.5);
  const nextPosition = add3(particle.position, scale3(avgVelocity, dt));

  return {
    position: nextPosition,
    velocity: nextVelocity,
    t: particle.t + dt
  };
}

// Dormand-Prince RK45 Butcher tableau
const DP_A21 = 1 / 5;
const DP_A31 = 3 / 40;
const DP_A32 = 9 / 40;
const DP_A41 = 44 / 45;
const DP_A42 = -56 / 15;
const DP_A43 = 32 / 9;
const DP_A51 = 19372 / 6561;
const DP_A52 = -25360 / 2187;
const DP_A53 = 64448 / 6561;
const DP_A54 = -212 / 729;
const DP_A61 = 9017 / 3168;
const DP_A62 = -355 / 33;
const DP_A63 = 46732 / 5247;
const DP_A64 = 49 / 176;
const DP_A65 = -5103 / 18656;

const DP_B1 = 35 / 384;
const DP_B3 = 500 / 1113;
const DP_B4 = 125 / 192;
const DP_B5 = -2187 / 6784;
const DP_B6 = 11 / 84;

const DP_E1 = 71 / 57600;
const DP_E3 = -71 / 16695;
const DP_E4 = 71 / 1920;
const DP_E5 = -17253 / 339200;
const DP_E6 = 22 / 525;
const DP_E7 = -1 / 40;

/**
 * 单步 Dormand-Prince 5(4) 计算，返回 5 阶解与嵌入式误差向量估计
 */
export function tryStepRK45(
  state: readonly number[],
  t: number,
  dt: number,
  derivative: OdeDerivative
): { y5: number[]; err: number[] } {
  const n = state.length;
  const k1 = derivative(t, state);
  assertVectorLength(k1, n, 'RK45 k1 derivative');

  const y2 = new Array<number>(n);
  for (let i = 0; i < n; i++) y2[i] = state[i]! + dt * DP_A21 * k1[i]!;
  const k2 = derivative(t + 0.2 * dt, y2);
  assertVectorLength(k2, n, 'RK45 k2 derivative');

  const y3 = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    y3[i] = state[i]! + dt * (DP_A31 * k1[i]! + DP_A32 * k2[i]!);
  }
  const k3 = derivative(t + 0.3 * dt, y3);
  assertVectorLength(k3, n, 'RK45 k3 derivative');

  const y4 = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    y4[i] = state[i]! + dt * (DP_A41 * k1[i]! + DP_A42 * k2[i]! + DP_A43 * k3[i]!);
  }
  const k4 = derivative(t + 0.8 * dt, y4);
  assertVectorLength(k4, n, 'RK45 k4 derivative');

  const y5Stage = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    y5Stage[i] =
      state[i]! +
      dt * (DP_A51 * k1[i]! + DP_A52 * k2[i]! + DP_A53 * k3[i]! + DP_A54 * k4[i]!);
  }
  const k5 = derivative(t + (8 / 9) * dt, y5Stage);
  assertVectorLength(k5, n, 'RK45 k5 derivative');

  const y6 = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    y6[i] =
      state[i]! +
      dt *
        (DP_A61 * k1[i]! +
          DP_A62 * k2[i]! +
          DP_A63 * k3[i]! +
          DP_A64 * k4[i]! +
          DP_A65 * k5[i]!);
  }
  const k6 = derivative(t + dt, y6);
  assertVectorLength(k6, n, 'RK45 k6 derivative');

  const y5 = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    y5[i] =
      state[i]! +
      dt * (DP_B1 * k1[i]! + DP_B3 * k3[i]! + DP_B4 * k4[i]! + DP_B5 * k5[i]! + DP_B6 * k6[i]!);
  }
  const k7 = derivative(t + dt, y5);
  assertVectorLength(k7, n, 'RK45 k7 derivative');

  const err = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    err[i] =
      dt *
      (DP_E1 * k1[i]! +
        DP_E3 * k3[i]! +
        DP_E4 * k4[i]! +
        DP_E5 * k5[i]! +
        DP_E6 * k6[i]! +
        DP_E7 * k7[i]!);
  }

  return { y5, err };
}

/**
 * 自适应步长 Dormand-Prince RK45 区间积分器
 */
export function integrateAdaptiveRK45(
  initialState: readonly number[],
  tStart: number,
  duration: number,
  derivative: OdeDerivative,
  options: AdaptiveRK45Options = {}
): AdaptiveRK45Result {
  validateDt(duration);
  if (!Number.isFinite(tStart)) {
    throw new Error(`Start time tStart must be finite, got ${tStart}.`);
  }
  if (duration === 0) {
    return { state: [...initialState], t: tStart, steps: 0 };
  }

  const absTol = options.absTol ?? 1e-9;
  const relTol = options.relTol ?? 1e-7;
  const minStep = options.minStep ?? 1e-12;
  const maxSubsteps = options.maxSubsteps ?? 10000;

  const direction = duration > 0 ? 1 : -1;
  const tEnd = tStart + duration;
  let t = tStart;
  let y = [...initialState];
  let h = duration;
  let steps = 0;

  while ((direction > 0 ? t < tEnd : t > tEnd) && steps < maxSubsteps) {
    const remaining = tEnd - t;
    if (Math.abs(h) > Math.abs(remaining)) {
      h = remaining;
    }

    const { y5, err } = tryStepRK45(y, t, h, derivative);

    let errNormSq = 0;
    for (let i = 0; i < y.length; i++) {
      const scale = absTol + relTol * Math.max(Math.abs(y[i]!), Math.abs(y5[i]!));
      const ratio = err[i]! / scale;
      errNormSq += ratio * ratio;
    }
    const errNorm = y.length > 0 ? Math.sqrt(errNormSq / y.length) : 0;

    if (errNorm <= 1 || Math.abs(h) <= minStep) {
      t += h;
      y = y5;
      steps++;
      const factor = errNorm === 0 ? 2 : Math.min(2, Math.max(0.5, 0.9 * Math.pow(errNorm, -0.2)));
      h *= factor;
    } else {
      const factor = Math.max(0.1, 0.9 * Math.pow(errNorm, -0.2));
      h *= factor;
    }
  }

  if (direction > 0 ? t < tEnd - 1e-12 : t > tEnd + 1e-12) {
    throw new Error(
      `AdaptiveRK45 exceeded maxSubsteps (${maxSubsteps}) before reaching target time ${tEnd}.`
    );
  }

  return { state: y, t, steps };
}
