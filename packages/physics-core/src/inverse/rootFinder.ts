export interface BrentOptions {
  readonly tolerance?: number;
  readonly maxIterations?: number;
}

export interface RootResult {
  readonly root: number;
  readonly residual: number;
  readonly iterations: number;
}

export interface BoundarySearchOptions extends BrentOptions {
  readonly gridSamples?: number;
  readonly dedupTolerance?: number;
}

/**
 * Brent 混合求根法（结合二分稳健性与反二次插值/割线法超线性收敛）
 * 前提：f(a) 与 f(b) 异号（或至少一端为 0）
 */
export function findRootBrent(
  fn: (x: number) => number,
  xMin: number,
  xMax: number,
  options: BrentOptions = {}
): RootResult {
  const tol = options.tolerance ?? 1e-10;
  const maxIter = options.maxIterations ?? 80;

  let a = xMin;
  let b = xMax;
  let fa = fn(a);
  let fb = fn(b);

  if (!Number.isFinite(fa) || !Number.isFinite(fb)) {
    throw new Error(`findRootBrent received non-finite bracket values: fa=${fa}, fb=${fb}.`);
  }
  if (fa === 0) return { root: a, residual: 0, iterations: 0 };
  if (fb === 0) return { root: b, residual: 0, iterations: 0 };
  if (fa * fb > 0) {
    throw new Error(`findRootBrent requires opposite-sign bracket [${a}, ${b}], got fa=${fa}, fb=${fb}.`);
  }

  let c = a;
  let fc = fa;
  let d = b - a;
  let e = d;

  for (let iter = 1; iter <= maxIter; iter++) {
    if ((fb > 0 && fc > 0) || (fb < 0 && fc < 0)) {
      c = a;
      fc = fa;
      d = b - a;
      e = d;
    }
    if (Math.abs(fc) < Math.abs(fb)) {
      a = b;
      b = c;
      c = a;
      fa = fb;
      fb = fc;
      fc = fa;
    }

    const tol1 = 2 * Number.EPSILON * Math.abs(b) + 0.5 * tol;
    const xm = 0.5 * (c - b);
    if (Math.abs(xm) <= tol1 || fb === 0) {
      return { root: b, residual: fb, iterations: iter };
    }

    if (Math.abs(e) >= tol1 && Math.abs(fa) > Math.abs(fb)) {
      const s = fb / fa;
      let p: number;
      let q: number;
      if (a === c) {
        p = 2 * xm * s;
        q = 1 - s;
      } else {
        const qVal = fa / fc;
        const r = fb / fc;
        p = s * (2 * xm * qVal * (qVal - r) - (b - a) * (r - 1));
        q = (qVal - 1) * (r - 1) * (s - 1);
      }
      if (p > 0) q = -q;
      p = Math.abs(p);

      const min1 = 3 * xm * q - Math.abs(tol1 * q);
      const min2 = Math.abs(e * q);
      if (2 * p < Math.min(min1, min2)) {
        e = d;
        d = p / q;
      } else {
        d = xm;
        e = d;
      }
    } else {
      d = xm;
      e = d;
    }

    a = b;
    fa = fb;
    if (Math.abs(d) > tol1) b += d;
    else b += xm >= 0 ? tol1 : -tol1;
    fb = fn(b);
  }

  return { root: b, residual: fb, iterations: maxIter };
}

/**
 * 反问题多解打靶求解器：
 * 先在参数区间 [minParam, maxParam] 上做粗网格括号扫描，对所有过零子区间运行 Brent 寻根，
 * 返回按参数递增排列的所有精确临界解（如斜抛击中目标的高低弹道双解）。
 */
export function solveBoundaryParameter(
  residualFn: (paramValue: number) => number,
  bounds: readonly [number, number],
  options: BoundarySearchOptions = {}
): RootResult[] {
  const [minP, maxP] = bounds;
  if (!Number.isFinite(minP) || !Number.isFinite(maxP) || minP >= maxP) {
    throw new Error(`Invalid parameter bounds [${minP}, ${maxP}].`);
  }

  const samples = Math.max(8, Math.round(options.gridSamples ?? 40));
  const dedupTol = options.dedupTolerance ?? (options.tolerance ?? 1e-8) * 10;
  const xs: number[] = new Array(samples + 1);
  const fs: number[] = new Array(samples + 1);

  for (let i = 0; i <= samples; i++) {
    const p = minP + ((maxP - minP) * i) / samples;
    xs[i] = p;
    fs[i] = residualFn(p);
  }

  const roots: RootResult[] = [];
  const pushUnique = (cand: RootResult) => {
    if (!roots.some((r) => Math.abs(r.root - cand.root) <= dedupTol)) {
      roots.push(cand);
    }
  };

  for (let i = 0; i < samples; i++) {
    const x0 = xs[i]!;
    const x1 = xs[i + 1]!;
    const f0 = fs[i]!;
    const f1 = fs[i + 1]!;
    if (!Number.isFinite(f0) || !Number.isFinite(f1)) continue;

    if (f0 === 0) {
      pushUnique({ root: x0, residual: 0, iterations: 0 });
    } else if (f0 * f1 < 0) {
      pushUnique(findRootBrent(residualFn, x0, x1, options));
    } else if (i === samples - 1 && f1 === 0) {
      pushUnique({ root: x1, residual: 0, iterations: 0 });
    }
  }

  roots.sort((u, v) => u.root - v.root);
  return roots;
}
