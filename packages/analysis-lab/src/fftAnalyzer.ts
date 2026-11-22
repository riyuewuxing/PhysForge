export type FftWindowKind = 'hann' | 'rectangular';

export interface FftPeak {
  readonly frequency: number;
  readonly magnitude: number;
  readonly binIndex: number;
}

export interface FftSpectrumResult {
  readonly frequencies: readonly number[];
  readonly magnitudes: readonly number[];
  readonly phases: readonly number[];
  readonly sampleRate: number;
  readonly binCount: number;
  readonly peaks: readonly FftPeak[];
}

export interface FftOptions {
  readonly window?: FftWindowKind;
  readonly removeDc?: boolean;
  readonly topPeaks?: number;
}

/**
 * 迭代版 Cooley-Tukey 基-2 快速傅里叶变换（零外部依赖）
 */
function radix2FftInPlace(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  // Bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    while (j & bit) {
      j ^= bit;
      bit >>= 1;
    }
    j ^= bit;
    if (i < j) {
      const tr = re[i]!;
      re[i] = re[j]!;
      re[j] = tr;
      const ti = im[i]!;
      im[i] = im[j]!;
      im[j] = ti;
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const angle = (-2 * Math.PI) / len;
    const wLenRe = Math.cos(angle);
    const wLenIm = Math.sin(angle);

    for (let i = 0; i < n; i += len) {
      let wRe = 1;
      let wIm = 0;
      for (let j = 0; j < half; j++) {
        const uIdx = i + j;
        const vIdx = uIdx + half;
        const uRe = re[uIdx]!;
        const uIm = im[uIdx]!;
        const vRe = re[vIdx]! * wRe - im[vIdx]! * wIm;
        const vIm = re[vIdx]! * wIm + im[vIdx]! * wRe;

        re[uIdx] = uRe + vRe;
        im[uIdx] = uIm + vIm;
        re[vIdx] = uRe - vRe;
        im[vIdx] = uIm - vIm;

        const nextWRe = wRe * wLenRe - wIm * wLenIm;
        wIm = wRe * wLenIm + wIm * wLenRe;
        wRe = nextWRe;
      }
    }
  }
}

/**
 * 计算实数时域序列的单边幅值频谱与前 K 个主频峰值（抛物线插值亚 bin 精化）
 */
export function computeFftSpectrum(
  samples: readonly number[],
  dt: number,
  options: FftOptions = {}
): FftSpectrumResult {
  if (!Number.isFinite(dt) || dt <= 0) {
    throw new Error(`computeFftSpectrum requires positive finite dt, got ${dt}.`);
  }
  if (samples.length < 4) {
    throw new Error(`computeFftSpectrum requires at least 4 samples, got ${samples.length}.`);
  }

  const windowKind = options.window ?? 'hann';
  const removeDc = options.removeDc ?? true;
  const topPeaks = options.topPeaks ?? 3;

  const nOrig = samples.length;
  let mean = 0;
  if (removeDc) {
    for (let i = 0; i < nOrig; i++) {
      mean += samples[i]!;
    }
    mean /= nOrig;
  }

  let nFft = 64;
  while (nFft < nOrig) {
    nFft <<= 1;
  }

  const re = new Float64Array(nFft);
  const im = new Float64Array(nFft);

  let windowSum = 0;
  for (let i = 0; i < nOrig; i++) {
    const w =
      windowKind === 'hann'
        ? nOrig > 1
          ? 0.5 * (1 - Math.cos((2 * Math.PI * i) / (nOrig - 1)))
          : 1
        : 1;
    windowSum += w;
    re[i] = (samples[i]! - mean) * w;
  }

  radix2FftInPlace(re, im);

  const halfBins = nFft >> 1;
  const sampleRate = 1 / dt;
  const df = sampleRate / nFft;
  const norm = windowSum > 0 ? 2 / windowSum : 1;

  const frequencies: number[] = new Array(halfBins);
  const magnitudes: number[] = new Array(halfBins);
  const phases: number[] = new Array(halfBins);

  for (let k = 0; k < halfBins; k++) {
    frequencies[k] = k * df;
    const r = re[k]!;
    const imVal = im[k]!;
    const rawMag = Math.hypot(r, imVal) * norm;
    magnitudes[k] = k === 0 ? rawMag * 0.5 : rawMag;
    phases[k] = Math.atan2(imVal, r);
  }

  // Extract local maxima for top-K peaks (skip DC bin 0 unless requested)
  const candidates: FftPeak[] = [];
  for (let k = 1; k < halfBins - 1; k++) {
    const prev = magnitudes[k - 1]!;
    const cur = magnitudes[k]!;
    const next = magnitudes[k + 1]!;
    if (cur >= prev && cur > next && cur > 1e-12) {
      // Parabolic interpolation around peak bin for sub-bin frequency estimate
      const denom = prev - 2 * cur + next;
      const delta = Math.abs(denom) > 1e-14 ? 0.5 * ((prev - next) / denom) : 0;
      const clampedDelta = Math.max(-0.5, Math.min(0.5, delta));
      candidates.push({
        frequency: (k + clampedDelta) * df,
        magnitude: cur,
        binIndex: k
      });
    }
  }

  candidates.sort((a, b) => b.magnitude - a.magnitude);

  return {
    frequencies,
    magnitudes,
    phases,
    sampleRate,
    binCount: nFft,
    peaks: candidates.slice(0, topPeaks)
  };
}
