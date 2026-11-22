export interface UdwadiaKalabaInput {
  /** 广义质量矩阵对角元 M_ii > 0（长度 n） */
  readonly massDiagonal: readonly number[];
  /** 无约束加速度 a_u = M^{-1} F_ext（长度 n） */
  readonly unconstrainedAccel: readonly number[];
  /** 约束方程二次求导 A * a = b 的雅可比矩阵 A（m × n） */
  readonly constraintMatrixA: readonly (readonly number[])[];
  /** 约束方程右端项 b（长度 m，建议已包含 Baumgarte 稳定项 -α*dφ/dt - β²*φ） */
  readonly constraintVectorB: readonly number[];
  /** 奇异值伪逆相对截断阈值，默认 1e-10 */
  readonly svdTolerance?: number;
}

export interface UdwadiaKalabaOutput {
  /** 满足约束的精确广义加速度 a */
  readonly acceleration: readonly number[];
  /** 精确解析约束广义反力 Fc = M * (a - a_u) */
  readonly constraintForce: readonly number[];
  /** 约束加速度残差 ||A*a - b||_2 */
  readonly constraintResidual: number;
}

/**
 * 实对称矩阵的 Jacobi 特征分解：S = V * diag(lambda) * V^T
 */
function jacobiSymmetricEigen(matrix: number[][], maxSweeps = 40): {
  eigenvalues: number[];
  eigenvectors: number[][];
} {
  const m = matrix.length;
  const A = matrix.map((row) => [...row]);
  const V: number[][] = Array.from({ length: m }, (_, i) =>
    Array.from({ length: m }, (__, j) => (i === j ? 1 : 0))
  );

  for (let sweep = 0; sweep < maxSweeps; sweep++) {
    let offDiagSum = 0;
    for (let p = 0; p < m; p++) {
      for (let q = p + 1; q < m; q++) {
        offDiagSum += Math.abs(A[p]![q]!);
      }
    }
    if (offDiagSum < 1e-14) break;

    for (let p = 0; p < m; p++) {
      for (let q = p + 1; q < m; q++) {
        const apq = A[p]![q]!;
        if (Math.abs(apq) < 1e-15) continue;

        const app = A[p]![p]!;
        const aqq = A[q]![q]!;
        const tau = (aqq - app) / (2 * apq);
        const t =
          tau >= 0
            ? 1 / (tau + Math.sqrt(1 + tau * tau))
            : -1 / (-tau + Math.sqrt(1 + tau * tau));
        const c = 1 / Math.sqrt(1 + t * t);
        const s = t * c;

        A[p]![p] = app - t * apq;
        A[q]![q] = aqq + t * apq;
        A[p]![q] = 0;
        A[q]![p] = 0;

        for (let k = 0; k < m; k++) {
          if (k === p || k === q) continue;
          const akp = A[k]![p]!;
          const akq = A[k]![q]!;
          A[k]![p] = c * akp - s * akq;
          A[p]![k] = A[k]![p]!;
          A[k]![q] = s * akp + c * akq;
          A[q]![k] = A[k]![q]!;
        }

        for (let k = 0; k < m; k++) {
          const vkp = V[k]![p]!;
          const vkq = V[k]![q]!;
          V[k]![p] = c * vkp - s * vkq;
          V[k]![q] = s * vkp + c * vkq;
        }
      }
    }
  }

  return {
    eigenvalues: A.map((row, idx) => row[idx]!),
    eigenvectors: V
  };
}

/**
 * 基于 Gauss 最小拘束原理的 Udwadia-Kalaba 显式解析约束求解器：
 * a = a_u + M^{-1/2} (A M^{-1/2})^+ (b - A a_u),   F_c = M (a - a_u)
 * 使用 Jacobi 对称 SVD 求 Moore-Penrose 伪逆，稳健兼容任意秩亏或多余约束。
 */
export function solveUdwadiaKalaba(input: UdwadiaKalabaInput): UdwadiaKalabaOutput {
  const { massDiagonal, unconstrainedAccel, constraintMatrixA, constraintVectorB } = input;
  const n = massDiagonal.length;
  const m = constraintMatrixA.length;

  if (unconstrainedAccel.length !== n) {
    throw new Error(
      `unconstrainedAccel length (${unconstrainedAccel.length}) must match massDiagonal (${n}).`
    );
  }
  if (constraintVectorB.length !== m) {
    throw new Error(
      `constraintVectorB length (${constraintVectorB.length}) must match constraint rows (${m}).`
    );
  }
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(massDiagonal[i]) || massDiagonal[i]! <= 0) {
      throw new Error(`massDiagonal[${i}] must be positive finite, got ${massDiagonal[i]}.`);
    }
  }

  if (m === 0) {
    return {
      acceleration: [...unconstrainedAccel],
      constraintForce: new Array<number>(n).fill(0),
      constraintResidual: 0
    };
  }

  const wInvSqrt = massDiagonal.map((mass) => 1 / Math.sqrt(mass));

  // B = A * M^{-1/2} (m × n)
  const B: number[][] = constraintMatrixA.map((row, r) => {
    if (row.length !== n) {
      throw new Error(`constraintMatrixA row ${r} length (${row.length}) != n (${n}).`);
    }
    return row.map((val, c) => val * wInvSqrt[c]!);
  });

  // errorVec = b - A * a_u (m)
  const errorVec = new Array<number>(m);
  for (let r = 0; r < m; r++) {
    let aAu = 0;
    const row = constraintMatrixA[r]!;
    for (let c = 0; c < n; c++) {
      aAu += row[c]! * unconstrainedAccel[c]!;
    }
    errorVec[r] = constraintVectorB[r]! - aAu;
  }

  // S = B * B^T (对称半正定 m × m)
  const S: number[][] = Array.from({ length: m }, () => new Array<number>(m).fill(0));
  for (let i = 0; i < m; i++) {
    for (let j = i; j < m; j++) {
      let sum = 0;
      for (let k = 0; k < n; k++) {
        sum += B[i]![k]! * B[j]![k]!;
      }
      S[i]![j] = sum;
      S[j]![i] = sum;
    }
  }

  const { eigenvalues, eigenvectors } = jacobiSymmetricEigen(S);
  const maxEigen = eigenvalues.reduce((acc, ev) => Math.max(acc, ev), 0);
  const tol = (input.svdTolerance ?? 1e-10) * Math.max(1, maxEigen);

  // 计算 y = (B B^T)^+ * errorVec = U * diag(1/lambda_i) * U^T * errorVec
  const uTError = new Array<number>(m).fill(0);
  for (let col = 0; col < m; col++) {
    let dot = 0;
    for (let row = 0; row < m; row++) {
      dot += eigenvectors[row]![col]! * errorVec[row]!;
    }
    uTError[col] = eigenvalues[col]! > tol ? dot / eigenvalues[col]! : 0;
  }

  const y = new Array<number>(m).fill(0);
  for (let row = 0; row < m; row++) {
    let sum = 0;
    for (let col = 0; col < m; col++) {
      sum += eigenvectors[row]![col]! * uTError[col]!;
    }
    y[row] = sum;
  }

  // B^+ * errorVec = B^T * y (长度 n), deltaA = M^{-1/2} * B^T * y
  const acceleration = new Array<number>(n);
  const constraintForce = new Array<number>(n);
  for (let c = 0; c < n; c++) {
    let bTy = 0;
    for (let r = 0; r < m; r++) {
      bTy += B[r]![c]! * y[r]!;
    }
    const deltaA = wInvSqrt[c]! * bTy;
    acceleration[c] = unconstrainedAccel[c]! + deltaA;
    constraintForce[c] = massDiagonal[c]! * deltaA;
  }

  // 计算最终约束残差 ||A*a - b||_2
  let resSq = 0;
  for (let r = 0; r < m; r++) {
    let aa = 0;
    for (let c = 0; c < n; c++) {
      aa += constraintMatrixA[r]![c]! * acceleration[c]!;
    }
    const diff = aa - constraintVectorB[r]!;
    resSq += diff * diff;
  }

  return {
    acceleration,
    constraintForce,
    constraintResidual: Math.sqrt(resSq)
  };
}
