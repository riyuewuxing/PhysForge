import Papa from 'papaparse';
import { computeFftSpectrum } from './fftAnalyzer.js';

export type CsvDialect =
  | 'standard-csv'
  | 'phyphox-semicolon'
  | 'phyphox-tab'
  | 'tracker-multirow';

export interface ParsedPhysicsCsv {
  readonly headers: readonly string[];
  readonly rows: readonly Record<string, number>[];
  readonly rawRowCount: number;
  readonly detectedDialect: CsvDialect;
}

export interface CurveFitResult {
  readonly kind: 'linear' | 'polynomial' | 'exponential' | 'damped-harmonic';
  readonly params: readonly number[];
  readonly paramLabels: readonly string[];
  readonly rSquared: number;
  readonly rmse: number;
  readonly formulaLatex: string;
  readonly evaluate: (x: number) => number;
}

function parseLocaleFloat(raw: string, commaDecimals: boolean): number {
  const trimmed = raw.trim();
  if (!trimmed) return Number.NaN;
  const normalized = commaDecimals ? trimmed.replace(/,/g, '.') : trimmed;
  const val = Number(normalized);
  return Number.isFinite(val) ? val : Number.NaN;
}

function isNumericCell(raw: string, commaDecimals: boolean): boolean {
  const n = parseLocaleFloat(raw, commaDecimals);
  return Number.isFinite(n);
}

/**
 * 兼容标准 CSV、Phyphox (分号 `;` / 制表符 `\t` + 欧式逗号小数) 与 Tracker 多表头 CSV 的通用解析器
 */
export function parsePhysicsCsv(text: string): ParsedPhysicsCsv {
  const cleanedLines = text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter((line) => line.trim().length > 0 && !line.trim().startsWith('#'));

  if (cleanedLines.length < 2) {
    throw new Error('CSV input must contain at least a header row and one data row.');
  }

  // Detect delimiter from first 5 non-empty lines
  const sampleBlock = cleanedLines.slice(0, Math.min(5, cleanedLines.length)).join('\n');
  const semicolonCount = (sampleBlock.match(/;/g) ?? []).length;
  const tabCount = (sampleBlock.match(/\t/g) ?? []).length;
  const commaCount = (sampleBlock.match(/,/g) ?? []).length;

  let delimiter = ',';
  if (tabCount >= semicolonCount && tabCount > 0 && tabCount >= cleanedLines.slice(0, 5).length) {
    delimiter = '\t';
  } else if (semicolonCount > 0 && semicolonCount >= cleanedLines.slice(0, 5).length) {
    delimiter = ';';
  } else if (commaCount === 0 && semicolonCount > 0) {
    delimiter = ';';
  }

  // Check if decimal comma is used when delimiter is ';' or '\t'
  const commaDecimals =
    delimiter !== ',' && /^-?\d+,\d+/.test(cleanedLines[cleanedLines.length - 1]!.trim());

  const parsed = Papa.parse<string[]>(cleanedLines.join('\n'), {
    delimiter,
    skipEmptyLines: true
  });

  const grid = parsed.data
    .map((row) => row.map((cell) => cell.trim()))
    .filter((row) => row.some((c) => c.length > 0));

  // Locate first row whose cells are predominantly numeric (handles Tracker multi-row title headers)
  let firstDataRowIdx = -1;
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r]!;
    const nonEmpty = row.filter((c) => c.length > 0);
    if (nonEmpty.length >= 2 && nonEmpty.every((c) => isNumericCell(c, commaDecimals))) {
      firstDataRowIdx = r;
      break;
    }
  }

  if (firstDataRowIdx <= 0) {
    throw new Error('Unable to locate numeric data rows preceded by column headers in CSV.');
  }

  const headerRow = grid[firstDataRowIdx - 1]!;
  const detectedDialect: CsvDialect =
    firstDataRowIdx >= 2
      ? 'tracker-multirow'
      : delimiter === ';'
        ? 'phyphox-semicolon'
        : delimiter === '\t'
          ? 'phyphox-tab'
          : 'standard-csv';

  const headers = headerRow.map((h, idx) => (h.length > 0 ? h : `col_${idx}`));
  const rows: Record<string, number>[] = [];

  for (let r = firstDataRowIdx; r < grid.length; r++) {
    const cells = grid[r]!;
    const record: Record<string, number> = {};
    let hasValid = false;
    for (let c = 0; c < headers.length; c++) {
      const val = parseLocaleFloat(cells[c] ?? '', commaDecimals);
      if (Number.isFinite(val)) {
        record[headers[c]!] = val;
        hasValid = true;
      }
    }
    if (hasValid) {
      rows.push(record);
    }
  }

  return {
    headers,
    rows,
    rawRowCount: grid.length - firstDataRowIdx,
    detectedDialect
  };
}

function solveLinearSystem(A: number[][], b: number[]): number[] {
  const n = b.length;
  const mat = A.map((row, idx) => [...row, b[idx]!]);

  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    let maxVal = Math.abs(mat[col]![col]!);
    for (let row = col + 1; row < n; row++) {
      const cand = Math.abs(mat[row]![col]!);
      if (cand > maxVal) {
        maxVal = cand;
        pivotRow = row;
      }
    }
    if (maxVal < 1e-14) {
      throw new Error(`Singular normal-equation matrix at column ${col}.`);
    }
    if (pivotRow !== col) {
      const tmp = mat[col]!;
      mat[col] = mat[pivotRow]!;
      mat[pivotRow] = tmp;
    }
    const pivot = mat[col]![col]!;
    for (let j = col; j <= n; j++) {
      mat[col]![j]! /= pivot;
    }
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = mat[row]![col]!;
      if (factor === 0) continue;
      for (let j = col; j <= n; j++) {
        mat[row]![j]! -= factor * mat[col]![j]!;
      }
    }
  }
  return mat.map((row) => row[n]!);
}

function computeFitMetrics(ys: readonly number[], predicted: readonly number[]): {
  rSquared: number;
  rmse: number;
} {
  const n = ys.length;
  let meanY = 0;
  for (let i = 0; i < n; i++) meanY += ys[i]!;
  meanY /= n;

  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    const err = ys[i]! - predicted[i]!;
    ssRes += err * err;
    const dev = ys[i]! - meanY;
    ssTot += dev * dev;
  }

  const rmse = Math.sqrt(ssRes / n);
  const rSquared = ssTot > 1e-15 ? Math.max(0, 1 - ssRes / ssTot) : ssRes < 1e-12 ? 1 : 0;
  return { rSquared, rmse };
}

/**
 * 最小二乘线性拟合 y = k*x + b
 */
export function fitLinear(xs: readonly number[], ys: readonly number[]): CurveFitResult {
  if (xs.length !== ys.length || xs.length < 2) {
    throw new Error('fitLinear requires matching xs/ys arrays with at least 2 points.');
  }
  const n = xs.length;
  let sumX = 0;
  let sumY = 0;
  let sumXX = 0;
  let sumXY = 0;
  for (let i = 0; i < n; i++) {
    const x = xs[i]!;
    const y = ys[i]!;
    sumX += x;
    sumY += y;
    sumXX += x * x;
    sumXY += x * y;
  }
  const denom = n * sumXX - sumX * sumX;
  const slope = Math.abs(denom) > 1e-14 ? (n * sumXY - sumX * sumY) / denom : 0;
  const intercept = (sumY - slope * sumX) / n;

  const evaluate = (x: number) => slope * x + intercept;
  const { rSquared, rmse } = computeFitMetrics(
    ys,
    xs.map((x) => evaluate(x))
  );

  return {
    kind: 'linear',
    params: [slope, intercept],
    paramLabels: ['k', 'b'],
    rSquared,
    rmse,
    formulaLatex: `y = ${slope.toFixed(4)}x ${intercept >= 0 ? '+' : '-'} ${Math.abs(intercept).toFixed(4)}`,
    evaluate
  };
}

/**
 * 多项式回归 y = c0 + c1*x + ... + cd*x^d
 */
export function fitPolynomial(
  xs: readonly number[],
  ys: readonly number[],
  degree = 2
): CurveFitResult {
  if (xs.length !== ys.length || xs.length <= degree) {
    throw new Error(`fitPolynomial degree ${degree} requires at least ${degree + 1} points.`);
  }
  const m = degree + 1;
  const A: number[][] = Array.from({ length: m }, () => new Array<number>(m).fill(0));
  const b: number[] = new Array<number>(m).fill(0);

  for (let k = 0; k < xs.length; k++) {
    const x = xs[k]!;
    const y = ys[k]!;
    let xPowRow = 1;
    for (let i = 0; i < m; i++) {
      b[i]! += y * xPowRow;
      let xPowCol = xPowRow;
      for (let j = 0; j < m; j++) {
        A[i]![j]! += xPowCol;
        xPowCol *= x;
      }
      xPowRow *= x;
    }
  }

  const coeffs = solveLinearSystem(A, b);
  const evaluate = (x: number) => {
    let val = 0;
    let xp = 1;
    for (let i = 0; i < coeffs.length; i++) {
      val += coeffs[i]! * xp;
      xp *= x;
    }
    return val;
  };
  const { rSquared, rmse } = computeFitMetrics(
    ys,
    xs.map((x) => evaluate(x))
  );
  const paramLabels = coeffs.map((_, idx) => `c_${idx}`);
  const terms = coeffs
    .map((c, idx) =>
      idx === 0 ? c.toFixed(4) : `${c >= 0 ? '+' : '-'} ${Math.abs(c).toFixed(4)}x^{${idx}}`
    )
    .join(' ');

  return {
    kind: 'polynomial',
    params: coeffs,
    paramLabels,
    rSquared,
    rmse,
    formulaLatex: `y = ${terms}`,
    evaluate
  };
}

/**
 * 通用 Levenberg-Marquardt 非线性最小二乘求解器
 */
function runLevenbergMarquardt(
  xs: readonly number[],
  ys: readonly number[],
  initialParams: number[],
  modelFn: (x: number, p: readonly number[]) => number,
  maxIter = 120
): number[] {
  const n = xs.length;
  const k = initialParams.length;
  let params = [...initialParams];
  let lambda = 1e-2;

  const computeCost = (p: readonly number[]): number => {
    let sse = 0;
    for (let i = 0; i < n; i++) {
      const r = ys[i]! - modelFn(xs[i]!, p);
      sse += r * r;
    }
    return sse;
  };

  let curCost = computeCost(params);

  for (let iter = 0; iter < maxIter; iter++) {
    const JtJ: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
    const Jtr: number[] = new Array<number>(k).fill(0);

    for (let i = 0; i < n; i++) {
      const x = xs[i]!;
      const f0 = modelFn(x, params);
      const residual = ys[i]! - f0;
      const rowJ: number[] = new Array<number>(k);

      for (let j = 0; j < k; j++) {
        const eps = 1e-6 * Math.max(1, Math.abs(params[j]!));
        const pPlus = [...params];
        pPlus[j]! += eps;
        const pMinus = [...params];
        pMinus[j]! -= eps;
        rowJ[j] = (modelFn(x, pPlus) - modelFn(x, pMinus)) / (2 * eps);
      }

      for (let a = 0; a < k; a++) {
        Jtr[a]! += rowJ[a]! * residual;
        for (let b = 0; b < k; b++) {
          JtJ[a]![b]! += rowJ[a]! * rowJ[b]!;
        }
      }
    }

    const damped = JtJ.map((row, i) =>
      row.map((val, j) => (i === j ? val + lambda * Math.max(1, val) : val))
    );

    let step: number[];
    try {
      step = solveLinearSystem(damped, Jtr);
    } catch {
      lambda *= 10;
      continue;
    }

    const stepNorm = Math.hypot(...step);
    if (!Number.isFinite(stepNorm)) {
      lambda *= 10;
      continue;
    }

    const candidate = params.map((v, idx) => v + step[idx]!);
    const nextCost = computeCost(candidate);
    if (Number.isFinite(nextCost) && nextCost < curCost) {
      const improvement = (curCost - nextCost) / Math.max(curCost, 1e-12);
      params = candidate;
      curCost = nextCost;
      lambda = Math.max(1e-7, lambda * 0.3);
      if (improvement < 1e-11 && stepNorm < 1e-8) {
        break;
      }
    } else {
      lambda *= 5;
      if (lambda > 1e10) break;
    }
  }

  return params;
}

/**
 * 指数衰减/增长 LM 拟合：y = a * exp(b * x) + c
 */
export function fitExponential(xs: readonly number[], ys: readonly number[]): CurveFitResult {
  if (xs.length !== ys.length || xs.length < 3) {
    throw new Error('fitExponential requires at least 3 data points.');
  }

  let yMin = ys[0]!;
  let yMax = ys[0]!;
  for (const y of ys) {
    if (y < yMin) yMin = y;
    if (y > yMax) yMax = y;
  }
  const c0 = yMin - 0.05 * Math.max(1, yMax - yMin);
  const logYs = ys.map((y) => Math.log(Math.max(1e-6, y - c0)));
  const lin = fitLinear(xs, logYs);
  const b0 = lin.params[0]!;
  const a0 = Math.exp(lin.params[1]!);

  const model = (x: number, p: readonly number[]) =>
    p[0]! * Math.exp(Math.max(-50, Math.min(50, p[1]! * x))) + p[2]!;
  const fitted = runLevenbergMarquardt(xs, ys, [a0, b0, c0], model);

  const evaluate = (x: number) => model(x, fitted);
  const { rSquared, rmse } = computeFitMetrics(
    ys,
    xs.map((x) => evaluate(x))
  );

  return {
    kind: 'exponential',
    params: fitted,
    paramLabels: ['A', 'k', 'C'],
    rSquared,
    rmse,
    formulaLatex: `y = ${fitted[0]!.toFixed(4)} e^{${fitted[1]!.toFixed(4)}x} ${fitted[2]! >= 0 ? '+' : '-'} ${Math.abs(fitted[2]!).toFixed(4)}`,
    evaluate
  };
}

/**
 * 阻尼简谐振动 LM 拟合：y(t) = A * exp(-gamma * t) * cos(omega * t + phi) + y0
 */
export function fitDampedHarmonic(ts: readonly number[], ys: readonly number[]): CurveFitResult {
  if (ts.length !== ys.length || ts.length < 6) {
    throw new Error('fitDampedHarmonic requires at least 6 data points.');
  }

  const n = ts.length;
  let yMin = ys[0]!;
  let yMax = ys[0]!;
  let yMean = 0;
  for (let i = 0; i < n; i++) {
    const y = ys[i]!;
    if (y < yMin) yMin = y;
    if (y > yMax) yMax = y;
    yMean += y;
  }
  yMean /= n;
  const y0Guess = 0.5 * (yMin + yMax);
  const ampGuess = Math.max(1e-6, 0.5 * (yMax - yMin));
  const dtAvg = (ts[n - 1]! - ts[0]!) / Math.max(1, n - 1);

  // Estimate dominant angular frequency from FFT spectrum
  let omegaGuess = 2 * Math.PI / Math.max(dtAvg * 8, ts[n - 1]! - ts[0]!);
  if (dtAvg > 0) {
    const centered = ys.map((y) => y - yMean);
    const fft = computeFftSpectrum(centered, dtAvg, { window: 'hann', removeDc: false });
    if (fft.peaks.length > 0 && fft.peaks[0]!.frequency > 0) {
      omegaGuess = 2 * Math.PI * fft.peaks[0]!.frequency;
    }
  }

  const model = (t: number, p: readonly number[]) => {
    const dtLocal = t - ts[0]!;
    return (
      p[0]! * Math.exp(Math.max(-30, Math.min(30, -p[1]! * dtLocal))) * Math.cos(p[2]! * dtLocal + p[3]!) +
      p[4]!
    );
  };

  // Coarse grid over phase phi in [0, 2*pi) to avoid wrong local minimum
  let bestInit = [ampGuess, 0.05, omegaGuess, 0, y0Guess];
  let bestSse = Number.POSITIVE_INFINITY;
  for (let idx = 0; idx < 16; idx++) {
    const phiCand = (idx * 2 * Math.PI) / 16;
    const cand = [ampGuess, 0.05, omegaGuess, phiCand, y0Guess];
    let sse = 0;
    for (let i = 0; i < n; i++) {
      const r = ys[i]! - model(ts[i]!, cand);
      sse += r * r;
    }
    if (sse < bestSse) {
      bestSse = sse;
      bestInit = cand;
    }
  }

  const fitted = runLevenbergMarquardt(ts, ys, bestInit, model, 150);
  // Normalize positive amplitude
  if (fitted[0]! < 0) {
    fitted[0] = -fitted[0]!;
    fitted[3] = fitted[3]! + Math.PI;
  }

  const evaluate = (t: number) => model(t, fitted);
  const { rSquared, rmse } = computeFitMetrics(
    ys,
    ts.map((t) => evaluate(t))
  );

  return {
    kind: 'damped-harmonic',
    params: fitted,
    paramLabels: ['A', 'gamma', 'omega', 'phi', 'y_0'],
    rSquared,
    rmse,
    formulaLatex: `y(t) = ${fitted[0]!.toFixed(3)} e^{-${fitted[1]!.toFixed(4)}t}\\cos(${fitted[2]!.toFixed(3)}t ${fitted[3]! >= 0 ? '+' : '-'} ${Math.abs(fitted[3]!).toFixed(3)})`,
    evaluate
  };
}

/**
 * 利用 Green 定理鞋带公式计算相图闭合环路所围面积 ∮ y dx
 * 对椭圆 (a cos t, b sin t) 正向/反向闭合采样返回真实有符号与绝对面积 π*a*b
 */
export function computePhaseLoopArea(xs: readonly number[], ys: readonly number[]): {
  readonly signedArea: number;
  readonly magnitudeArea: number;
} {
  if (xs.length !== ys.length || xs.length < 3) {
    return { signedArea: 0, magnitudeArea: 0 };
  }
  let twiceArea = 0;
  const n = xs.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    twiceArea += xs[i]! * ys[j]! - xs[j]! * ys[i]!;
  }
  const signedArea = 0.5 * twiceArea;
  return {
    signedArea,
    magnitudeArea: Math.abs(signedArea)
  };
}
