/**
 * SI 标准物理常量（CODATA 2018 / 2022 精确与推荐值）
 */
export const STANDARD_GRAVITY = 9.80665;
export const CLASSROOM_GRAVITY = 9.8;
export const EXAM_GRAVITY = 10;

export const ELEMENTARY_CHARGE = 1.602176634e-19;
export const ELECTRON_MASS = 9.1093837015e-31;
export const PROTON_MASS = 1.67262192369e-27;
export const NEUTRON_MASS = 1.67492749804e-27;

export const SPEED_OF_LIGHT = 299792458;
export const VACUUM_PERMITTIVITY = 8.8541878128e-12;
export const VACUUM_PERMEABILITY = 1.25663706212e-6;
export const COULOMB_K = 8.9875517923e9;
export const GRAVITATIONAL_G = 6.67430e-11;

export const PLANCK_H = 6.62607015e-34;
export const BOLTZMANN_K = 1.380649e-23;
export const AVOGADRO_NA = 6.02214076e23;
export const IDEAL_GAS_R = 8.314462618;

/**
 * 常用安全单位换算辅助（防数量级错位）
 */
export function cmToM(cm: number): number {
  return cm * 1e-2;
}

export function mToCm(m: number): number {
  return m * 1e2;
}

export function mmToM(mm: number): number {
  return mm * 1e-3;
}

export function mToMm(m: number): number {
  return m * 1e3;
}

export function mTToT(mT: number): number {
  return mT * 1e-3;
}

export function tToMT(T: number): number {
  return T * 1e3;
}

export function uCToC(uC: number): number {
  return uC * 1e-6;
}

export function cToUC(C: number): number {
  return C * 1e6;
}

export function eVToJ(eV: number): number {
  return eV * ELEMENTARY_CHARGE;
}

export function jToEV(J: number): number {
  return J / ELEMENTARY_CHARGE;
}

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

export function kmhToMs(kmh: number): number {
  return kmh / 3.6;
}

export function msToKmh(ms: number): number {
  return ms * 3.6;
}
