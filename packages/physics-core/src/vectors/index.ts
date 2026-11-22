import { COULOMB_K } from '../units/index.js';

/**
 * 不可变二维矢量
 */
export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

/**
 * 不可变三维矢量
 */
export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export const ZERO_VEC2: Vec2 = { x: 0, y: 0 };
export const ZERO_VEC3: Vec3 = { x: 0, y: 0, z: 0 };

export function vec2(x: number, y: number): Vec2 {
  return { x, y };
}

export function add2(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function sub2(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function scale2(v: Vec2, s: number): Vec2 {
  return { x: v.x * s, y: v.y * s };
}

export function dot2(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

/**
 * 2D 矢量叉积的 z 分量（标量）：a_x b_y - a_y b_x
 */
export function cross2(a: Vec2, b: Vec2): number {
  return a.x * b.y - a.y * b.x;
}

export function lenSq2(v: Vec2): number {
  return v.x * v.x + v.y * v.y;
}

export function len2(v: Vec2): number {
  return Math.hypot(v.x, v.y);
}

export function dist2(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * 单位化二维矢量；零向量时安全返回零向量避免 NaN
 */
export function norm2(v: Vec2): Vec2 {
  const length = Math.hypot(v.x, v.y);
  if (length === 0) return ZERO_VEC2;
  return { x: v.x / length, y: v.y / length };
}

/**
 * 逆时针旋转 90° 的正交向量 (-y, x)
 */
export function perp2(v: Vec2): Vec2 {
  return { x: -v.y, y: v.x };
}

export function rotate2(v: Vec2, angleRad: number): Vec2 {
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  return {
    x: v.x * c - v.y * s,
    y: v.x * s + v.y * c
  };
}

/**
 * 将向量 a 投影到向量 onto 方向上
 */
export function proj2(a: Vec2, onto: Vec2): Vec2 {
  const denom = lenSq2(onto);
  if (denom === 0) return ZERO_VEC2;
  return scale2(onto, dot2(a, onto) / denom);
}

export function vec3(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

export function add3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function sub3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function scale3(v: Vec3, s: number): Vec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

export function dot3(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross3(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x
  };
}

export function lenSq3(v: Vec3): number {
  return v.x * v.x + v.y * v.y + v.z * v.z;
}

export function len3(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z);
}

export function dist3(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/**
 * 单位化三维矢量；零向量时安全返回零向量避免 NaN
 */
export function norm3(v: Vec3): Vec3 {
  const length = Math.hypot(v.x, v.y, v.z);
  if (length === 0) return ZERO_VEC3;
  return { x: v.x / length, y: v.y / length, z: v.z / length };
}

export function proj3(a: Vec3, onto: Vec3): Vec3 {
  const denom = lenSq3(onto);
  if (denom === 0) return ZERO_VEC3;
  return scale3(onto, dot3(a, onto) / denom);
}

/**
 * 洛伦兹力算子: F = q * (E + v × B)
 */
export function lorentzForce3D(q: number, E: Vec3, v: Vec3, B: Vec3): Vec3 {
  const vCrossB = cross3(v, B);
  return {
    x: q * (E.x + vCrossB.x),
    y: q * (E.y + vCrossB.y),
    z: q * (E.z + vCrossB.z)
  };
}

/**
 * 洛伦兹加速度算子: a = (q / m) * (E + v × B)
 */
export function lorentzAcceleration3D(q: number, m: number, E: Vec3, v: Vec3, B: Vec3): Vec3 {
  if (!Number.isFinite(m) || m <= 0) {
    throw new Error(`Particle mass must be a positive finite number, got ${m}.`);
  }
  const f = lorentzForce3D(q, E, v, B);
  return scale3(f, 1 / m);
}

/**
 * 直导线安培力算子: F = I * (L × B)
 * 其中 lengthVec 为电流方向乘以有效长度的矢量
 */
export function ampereForceStraightWire(current: number, lengthVec: Vec3, B: Vec3): Vec3 {
  return scale3(cross3(lengthVec, B), current);
}

/**
 * 点电荷在空间某点产生的静电场强: E = k * q * r / |r|^3
 */
export function electricFieldPointCharge3D(
  q: number,
  sourcePos: Vec3,
  targetPos: Vec3,
  k: number = COULOMB_K
): Vec3 {
  const r = sub3(targetPos, sourcePos);
  const dSq = lenSq3(r);
  if (dSq === 0) return ZERO_VEC3;
  const invCube = 1 / (dSq * Math.sqrt(dSq));
  return scale3(r, k * q * invCube);
}
