/**
 * 确定性 32 位 Mulberry32 伪随机数生成器（严禁在物理引擎使用 Math.random）
 */
export interface SeededPrng {
  /** 生成 [0, 1) 区间均匀分布浮点数 */
  next: () => number;
  /** 生成 [min, max) 区间均匀分布浮点数 */
  range: (min: number, max: number) => number;
  /** 生成整数 [minInt, maxInt] */
  int: (minInt: number, maxInt: number) => number;
  /** Box-Muller 变换生成标准/指定正态分布采样 */
  gaussian: (mean?: number, stdDev?: number) => number;
}

export function createSeededPrng(seed = 20261122): SeededPrng {
  let state = seed >>> 0;
  let spareGaussian: number | null = null;

  const next = (): number => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const range = (min: number, max: number): number => min + (max - min) * next();

  const int = (minInt: number, maxInt: number): number =>
    Math.floor(range(minInt, maxInt + 1));

  const gaussian = (mean = 0, stdDev = 1): number => {
    if (spareGaussian !== null) {
      const z = spareGaussian;
      spareGaussian = null;
      return mean + stdDev * z;
    }
    let u1 = next();
    if (u1 < 1e-12) u1 = 1e-12;
    const u2 = next();
    const mag = Math.sqrt(-2 * Math.log(u1));
    const z0 = mag * Math.cos(2 * Math.PI * u2);
    spareGaussian = mag * Math.sin(2 * Math.PI * u2);
    return mean + stdDev * z0;
  };

  return { next, range, int, gaussian };
}
