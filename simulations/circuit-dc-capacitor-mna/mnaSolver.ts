export interface ResistorElement {
  readonly kind: 'resistor';
  readonly a: number; // 节点号，0 代表 GND
  readonly b: number;
  readonly resistance: number;
}

export interface VoltageSourceElement {
  readonly kind: 'voltageSource';
  readonly pos: number;
  readonly neg: number;
  readonly voltage: number;
}

export interface CurrentSourceElement {
  readonly kind: 'currentSource';
  readonly from: number; // 电流流出节点
  readonly to: number; // 电流流入节点
  readonly current: number;
}

export type MnaElement = ResistorElement | VoltageSourceElement | CurrentSourceElement;

export interface MnaSolution {
  readonly nodeVoltages: readonly number[]; // index 0 恒为 0
  readonly sourceCurrents: readonly number[]; // 与 voltageSources 顺序一致（流出正极取负或标准流入正极取正）
}

/**
 * 部分主元高斯消元求解线性方程组 A * x = b
 */
export function solveLinearSystem(A: number[][], b: number[]): number[] {
  const n = b.length;
  const mat = A.map((row, idx) => [...row, b[idx]!]);

  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    let maxAbs = Math.abs(mat[col]![col]!);
    for (let row = col + 1; row < n; row++) {
      const cand = Math.abs(mat[row]![col]!);
      if (cand > maxAbs) {
        maxAbs = cand;
        pivotRow = row;
      }
    }

    if (maxAbs < 1e-14) {
      throw new Error(`MNA circuit matrix is singular at column ${col} (check floating nodes or shorted voltage sources).`);
    }

    if (pivotRow !== col) {
      const tmp = mat[col]!;
      mat[col] = mat[pivotRow]!;
      mat[pivotRow] = tmp;
    }

    const pivot = mat[col]![col]!;
    for (let row = col + 1; row < n; row++) {
      const factor = mat[row]![col]! / pivot;
      if (factor === 0) continue;
      for (let k = col; k <= n; k++) {
        mat[row]![k] = mat[row]![k]! - factor * mat[col]![k]!;
      }
    }
  }

  const x = new Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    let sum = mat[row]![n]!;
    for (let k = row + 1; k < n; k++) {
      sum -= mat[row]![k]! * x[k]!;
    }
    x[row] = sum / mat[row]![row]!;
  }
  return x;
}

/**
 * 改进节点分析法（MNA）纯 TS 直流/伴随瞬态求解器
 */
export function solveMnaNetwork(nodeCount: number, elements: readonly MnaElement[]): MnaSolution {
  const voltageSources = elements.filter(
    (el): el is VoltageSourceElement => el.kind === 'voltageSource'
  );
  const dim = nodeCount + voltageSources.length;
  const A: number[][] = Array.from({ length: dim }, () => new Array<number>(dim).fill(0));
  const b: number[] = new Array<number>(dim).fill(0);

  for (const el of elements) {
    if (el.kind === 'resistor') {
      const g = 1 / Math.max(el.resistance, 1e-9);
      if (el.a > 0) A[el.a - 1]![el.a - 1]! += g;
      if (el.b > 0) A[el.b - 1]![el.b - 1]! += g;
      if (el.a > 0 && el.b > 0) {
        A[el.a - 1]![el.b - 1]! -= g;
        A[el.b - 1]![el.a - 1]! -= g;
      }
    } else if (el.kind === 'currentSource') {
      if (el.from > 0) b[el.from - 1]! -= el.current;
      if (el.to > 0) b[el.to - 1]! += el.current;
    }
  }

  voltageSources.forEach((vs, idx) => {
    const row = nodeCount + idx;
    if (vs.pos > 0) {
      A[vs.pos - 1]![row]! += 1;
      A[row]![vs.pos - 1]! += 1;
    }
    if (vs.neg > 0) {
      A[vs.neg - 1]![row]! -= 1;
      A[row]![vs.neg - 1]! -= 1;
    }
    b[row] = vs.voltage;
  });

  const sol = solveLinearSystem(A, b);
  const nodeVoltages = [0, ...sol.slice(0, nodeCount)];
  const sourceCurrents = sol.slice(nodeCount);
  return { nodeVoltages, sourceCurrents };
}
