import { lenSq2, lenSq3, type Vec2, type Vec3 } from '../vectors/index.js';

export interface EnergyDriftSummary {
  readonly initial: number;
  readonly min: number;
  readonly max: number;
  readonly final: number;
  readonly maxAbsoluteDrift: number;
  readonly maxRelativeDrift: number;
}

export function absoluteError(actual: number, expected: number): number {
  return Math.abs(actual - expected);
}

/**
 * 计算相对误差；当期望值接近零时以 zeroFloor 兜底避免除零
 */
export function relativeError(actual: number, expected: number, zeroFloor = 1e-12): number {
  const denom = Math.max(Math.abs(expected), zeroFloor);
  return Math.abs(actual - expected) / denom;
}

/**
 * 断言数组中的所有数值均有限（无 NaN / Infinity）
 */
export function assertAllFinite(values: readonly number[], label = 'state'): void {
  for (let i = 0; i < values.length; i++) {
    const val = values[i]!;
    if (!Number.isFinite(val)) {
      throw new Error(`Non-finite value detected in ${label}[${i}]: ${val}`);
    }
  }
}

/**
 * 追踪守恒量序列（如总机械能、动能、动量模长）的极值与相对漂移
 */
export function trackInvariantDrift(
  series: readonly number[],
  reference?: number
): EnergyDriftSummary {
  if (series.length === 0) {
    throw new Error('Cannot compute invariant drift on an empty series.');
  }
  assertAllFinite(series, 'invariantSeries');

  const initial = series[0]!;
  const ref = reference ?? initial;
  let min = initial;
  let max = initial;
  let maxAbs = 0;

  for (const val of series) {
    if (val < min) min = val;
    if (val > max) max = val;
    const absDrift = Math.abs(val - ref);
    if (absDrift > maxAbs) maxAbs = absDrift;
  }

  const denom = Math.max(Math.abs(ref), 1e-12);
  return {
    initial,
    min,
    max,
    final: series[series.length - 1]!,
    maxAbsoluteDrift: maxAbs,
    maxRelativeDrift: maxAbs / denom
  };
}

export function kineticEnergy2D(mass: number, velocity: Vec2): number {
  if (!Number.isFinite(mass) || mass <= 0) {
    throw new Error(`Mass must be positive finite, got ${mass}.`);
  }
  return 0.5 * mass * lenSq2(velocity);
}

export function kineticEnergy3D(mass: number, velocity: Vec3): number {
  if (!Number.isFinite(mass) || mass <= 0) {
    throw new Error(`Mass must be positive finite, got ${mass}.`);
  }
  return 0.5 * mass * lenSq3(velocity);
}

export function harmonicOscillatorEnergy(mass: number, k: number, x: number, v: number): number {
  return 0.5 * k * x * x + 0.5 * mass * v * v;
}
