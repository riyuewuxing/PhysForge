export interface LinearResistorStamp {
  readonly kind: 'resistor';
  readonly id: string;
  readonly a: number;
  readonly b: number;
  readonly resistance: number;
}

export interface LinearVoltageSourceStamp {
  readonly kind: 'voltageSource';
  readonly id: string;
  readonly pos: number;
  readonly neg: number;
  readonly voltage: number;
}

export interface LinearCurrentSourceStamp {
  readonly kind: 'currentSource';
  readonly id: string;
  readonly from: number;
  readonly to: number;
  readonly current: number;
}

export interface CapacitorCompanionStamp {
  readonly kind: 'capacitor';
  readonly id: string;
  readonly a: number;
  readonly b: number;
  readonly capacitance: number;
  readonly prevVoltage: number;
  readonly prevCurrent: number;
}

export interface InductorCompanionStamp {
  readonly kind: 'inductor';
  readonly id: string;
  readonly a: number;
  readonly b: number;
  readonly inductance: number;
  readonly prevVoltage: number;
  readonly prevCurrent: number;
}

/** 非线性小灯泡元件：I = k * sgn(U) * (|U| + eps)^(alpha - 1) * U */
export interface NonlinearLampStamp {
  readonly kind: 'lamp';
  readonly id: string;
  readonly a: number;
  readonly b: number;
  readonly k: number;
  readonly alpha: number;
}

/** 肖克利二极管元件：I = Is * (exp(U / (n * Vt)) - 1) */
export interface DiodeStamp {
  readonly kind: 'diode';
  readonly id: string;
  readonly anode: number;
  readonly cathode: number;
  readonly saturationCurrent?: number;
  readonly thermalVoltage?: number;
}

export type NonlinearCircuitElement =
  | LinearResistorStamp
  | LinearVoltageSourceStamp
  | LinearCurrentSourceStamp
  | CapacitorCompanionStamp
  | InductorCompanionStamp
  | NonlinearLampStamp
  | DiodeStamp;

export interface NonlinearMnaResult {
  readonly nodeVoltages: readonly number[];
  readonly sourceCurrents: readonly number[];
  readonly elementCurrents: Readonly<Record<string, number>>;
  readonly elementVoltages: Readonly<Record<string, number>>;
  readonly iterations: number;
  readonly maxResidual: number;
  readonly injectedBleedNodes: readonly number[];
}

function solveDenseLinear(A: number[][], b: number[]): number[] {
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
    if (maxVal < 1e-15) {
      throw new Error(`MNA matrix is singular at pivot column ${col}; check shorted voltage sources or open current sources.`);
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
 * 动态拓扑预检：找出未连通至 GND(0) 的孤立子网并分配 10^12 Ω 泄放参考点，防止奇异矩阵崩溃
 */
function findFloatingComponentAnchors(
  nodeCount: number,
  elements: readonly NonlinearCircuitElement[]
): number[] {
  const adj: number[][] = Array.from({ length: nodeCount + 1 }, () => []);
  const connect = (u: number, v: number) => {
    if (u < 0 || u > nodeCount || v < 0 || v > nodeCount) return;
    adj[u]!.push(v);
    adj[v]!.push(u);
  };

  for (const el of elements) {
    if (el.kind === 'voltageSource') connect(el.pos, el.neg);
    else if (el.kind === 'currentSource') connect(el.from, el.to);
    else if (el.kind === 'diode') connect(el.anode, el.cathode);
    else connect(el.a, el.b);
  }

  const visited = new Uint8Array(nodeCount + 1);
  const bfs = (start: number) => {
    const queue = [start];
    visited[start] = 1;
    for (let head = 0; head < queue.length; head++) {
      const cur = queue[head]!;
      for (const nxt of adj[cur]!) {
        if (!visited[nxt]) {
          visited[nxt] = 1;
          queue.push(nxt);
        }
      }
    }
  };

  bfs(0);
  const anchors: number[] = [];
  for (let node = 1; node <= nodeCount; node++) {
    if (!visited[node]) {
      anchors.push(node);
      bfs(node);
    }
  }
  return anchors;
}

/**
 * 自由拓扑非线性 MNA 电路求解器：
 * - 支持直流拓扑预检 + 孤岛 10^12 Ω 泄放锚定
 * - 支持电容/电感二阶梯形伴随瞬态模型
 * - 支持 Newton-Raphson 非线性迭代（小灯泡幂律 + 肖克利二极管带压降阻尼防溢出）
 */
export function solveNonlinearMna(
  nodeCount: number,
  elements: readonly NonlinearCircuitElement[],
  dt = 0,
  initialGuess?: readonly number[]
): NonlinearMnaResult {
  const voltageSources = elements.filter(
    (el): el is LinearVoltageSourceStamp => el.kind === 'voltageSource'
  );
  const hasNonlinear = elements.some((el) => el.kind === 'lamp' || el.kind === 'diode');
  const bleedNodes = findFloatingComponentAnchors(nodeCount, elements);

  const dim = nodeCount + voltageSources.length;
  let x = new Array<number>(dim).fill(0);
  if (initialGuess && initialGuess.length === dim) {
    x = [...initialGuess];
  }

  const maxIter = hasNonlinear ? 80 : 1;
  let iterations = 0;
  let maxResidual = 0;

  for (let iter = 0; iter < maxIter; iter++) {
    iterations = iter + 1;
    const J: number[][] = Array.from({ length: dim }, () => new Array<number>(dim).fill(0));
    const rhs: number[] = new Array<number>(dim).fill(0);

    const addConductance = (u: number, v: number, g: number) => {
      if (u > 0) J[u - 1]![u - 1]! += g;
      if (v > 0) J[v - 1]![v - 1]! += g;
      if (u > 0 && v > 0) {
        J[u - 1]![v - 1]! -= g;
        J[v - 1]![u - 1]! -= g;
      }
    };

    const addCurrent = (from: number, to: number, curr: number) => {
      if (from > 0) rhs[from - 1]! -= curr;
      if (to > 0) rhs[to - 1]! += curr;
    };

    const nodeV = (node: number) => (node === 0 ? 0 : x[node - 1]!);

    // 孤岛泄放电阻 1e12 Ω (g = 1e-12)
    for (const anchor of bleedNodes) {
      addConductance(anchor, 0, 1e-12);
    }

    for (const el of elements) {
      if (el.kind === 'resistor') {
        addConductance(el.a, el.b, 1 / Math.max(el.resistance, 1e-9));
      } else if (el.kind === 'currentSource') {
        addCurrent(el.from, el.to, el.current);
      } else if (el.kind === 'capacitor') {
        if (dt > 0) {
          const gC = (2 * el.capacitance) / dt;
          const iHist = gC * el.prevVoltage + el.prevCurrent;
          addConductance(el.a, el.b, gC);
          addCurrent(el.b, el.a, iHist);
        }
      } else if (el.kind === 'inductor') {
        if (dt > 0) {
          const gL = dt / (2 * Math.max(el.inductance, 1e-12));
          const iHist = el.prevCurrent + gL * el.prevVoltage;
          addConductance(el.a, el.b, gL);
          addCurrent(el.a, el.b, iHist);
        } else {
          // 稳态直流等效超小电阻 1e-6 Ω
          addConductance(el.a, el.b, 1e6);
        }
      } else if (el.kind === 'lamp') {
        const u = nodeV(el.a) - nodeV(el.b);
        const absU = Math.abs(u);
        const eps = 1e-6;
        const effU = absU + eps;
        const curr = el.k * Math.pow(effU, el.alpha - 1) * u;
        const gEq = Math.max(1e-9, el.k * el.alpha * Math.pow(effU, el.alpha - 1));
        const iEq = curr - gEq * u;
        addConductance(el.a, el.b, gEq);
        addCurrent(el.a, el.b, iEq);
      } else if (el.kind === 'diode') {
        const Is = el.saturationCurrent ?? 1e-12;
        const nVt = el.thermalVoltage ?? 0.026;
        const u = nodeV(el.anode) - nodeV(el.cathode);
        const exponent = Math.min(40, u / nVt);
        const expVal = Math.exp(exponent);
        const curr = Is * (expVal - 1);
        const gEq = Math.max(1e-12, (Is / nVt) * expVal);
        const iEq = curr - gEq * u;
        addConductance(el.anode, el.cathode, gEq);
        addCurrent(el.anode, el.cathode, iEq);
      }
    }

    voltageSources.forEach((vs, idx) => {
      const row = nodeCount + idx;
      if (vs.pos > 0) {
        J[vs.pos - 1]![row]! += 1;
        J[row]![vs.pos - 1]! += 1;
      }
      if (vs.neg > 0) {
        J[vs.neg - 1]![row]! -= 1;
        J[row]![vs.neg - 1]! -= 1;
      }
      rhs[row] = vs.voltage;
    });

    const nextX = solveDenseLinear(J, rhs);

    let maxStep = 0;
    for (let k = 0; k < dim; k++) {
      let delta = nextX[k]! - x[k]!;
      // 非线性节点电压步长阻尼，防止二极管指数溢出发散
      if (hasNonlinear && k < nodeCount && Math.abs(delta) > 0.35) {
        delta = Math.sign(delta) * 0.35;
      }
      if (Math.abs(delta) > maxStep) maxStep = Math.abs(delta);
      x[k] = x[k]! + delta;
    }

    maxResidual = maxStep;
    if (!hasNonlinear || maxStep < 1e-10) {
      break;
    }
  }

  const nodeVoltages = [0, ...x.slice(0, nodeCount)];
  const sourceCurrents = x.slice(nodeCount);
  const elementVoltages: Record<string, number> = {};
  const elementCurrents: Record<string, number> = {};

  let vsIdx = 0;
  for (const el of elements) {
    if (el.kind === 'voltageSource') {
      elementVoltages[el.id] = nodeVoltages[el.pos]! - nodeVoltages[el.neg]!;
      elementCurrents[el.id] = sourceCurrents[vsIdx++]!;
    } else if (el.kind === 'currentSource') {
      elementVoltages[el.id] = nodeVoltages[el.to]! - nodeVoltages[el.from]!;
      elementCurrents[el.id] = el.current;
    } else if (el.kind === 'resistor') {
      const u = nodeVoltages[el.a]! - nodeVoltages[el.b]!;
      elementVoltages[el.id] = u;
      elementCurrents[el.id] = u / Math.max(el.resistance, 1e-9);
    } else if (el.kind === 'capacitor') {
      const u = nodeVoltages[el.a]! - nodeVoltages[el.b]!;
      elementVoltages[el.id] = u;
      if (dt > 0) {
        const gC = (2 * el.capacitance) / dt;
        const iHist = gC * el.prevVoltage + el.prevCurrent;
        elementCurrents[el.id] = gC * u - iHist;
      } else {
        elementCurrents[el.id] = 0;
      }
    } else if (el.kind === 'inductor') {
      const u = nodeVoltages[el.a]! - nodeVoltages[el.b]!;
      elementVoltages[el.id] = u;
      if (dt > 0) {
        const gL = dt / (2 * Math.max(el.inductance, 1e-12));
        const iHist = el.prevCurrent + gL * el.prevVoltage;
        elementCurrents[el.id] = gL * u + iHist;
      } else {
        elementCurrents[el.id] = u * 1e6;
      }
    } else if (el.kind === 'lamp') {
      const u = nodeVoltages[el.a]! - nodeVoltages[el.b]!;
      elementVoltages[el.id] = u;
      elementCurrents[el.id] = el.k * Math.pow(Math.abs(u) + 1e-6, el.alpha - 1) * u;
    } else if (el.kind === 'diode') {
      const Is = el.saturationCurrent ?? 1e-12;
      const nVt = el.thermalVoltage ?? 0.026;
      const u = nodeVoltages[el.anode]! - nodeVoltages[el.cathode]!;
      elementVoltages[el.id] = u;
      elementCurrents[el.id] = Is * (Math.exp(Math.min(40, u / nVt)) - 1);
    }
  }

  return {
    nodeVoltages,
    sourceCurrents,
    elementCurrents,
    elementVoltages,
    iterations,
    maxResidual,
    injectedBleedNodes: bleedNodes
  };
}
