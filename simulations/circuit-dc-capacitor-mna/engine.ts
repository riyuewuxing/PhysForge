import type { InvariantReport, PhysicsEvent, StepResult } from '@physforge/sim-sdk';
import { solveNonlinearMna, type NonlinearCircuitElement } from '@physforge/physics-core';
import { solveMnaNetwork, type MnaElement } from './mnaSolver.js';

export type CircuitTopology =
  | 'closed-power'
  | 'series-parallel-dynamic'
  | 'rc-transient'
  | 'rc-bridge-charge'
  | 'nonlinear-lamp-diode'
  | 'divider-lamp';

export type CircuitParams = {
  topology: CircuitTopology;
  emf: number;
  internalR: number;
  r1: number;
  r2: number;
  sliderR: number;
  capacitance: number;
  switchClosed: boolean; // RC 模式下：true 接电源充电，false 对 R1 放电
};

export interface DividerReadouts {
  readonly sourceTerminalVoltage: number;
  readonly lowerResistance: number;
  readonly upperResistance: number;
  readonly sourcePower: number;
  readonly internalLoss: number;
  readonly upperLoss: number;
  readonly lowerLoss: number;
}

export const DIVIDER_RESISTANCE = 20;
export function dividerLowerResistance(sliderR: number): number {
  return Math.max(0, Math.min(DIVIDER_RESISTANCE, sliderR));
}
export function dividerLampCurrent(voltage: number): number {
  return 0.25 * Math.pow(Math.abs(voltage) + 1e-6, 0.65 - 1) * voltage;
}

export interface CircuitState {
  readonly t: number;
  readonly nodeVoltages: readonly number[];
  readonly totalCurrent: number;
  readonly branchCurrent1: number;
  readonly branchCurrent2: number;
  readonly terminalVoltage: number;
  readonly outputPower: number;
  readonly efficiency: number;
  readonly capVoltage: number;
  readonly capCurrent: number;
  readonly capCharge: number;
  readonly capEnergy: number;
  readonly divider?: DividerReadouts;
  readonly events: readonly PhysicsEvent[];
}

function solveTopology(
  params: CircuitParams,
  prevCapVoltage: number,
  prevCapCurrent: number,
  dt: number
): Omit<CircuitState, 't' | 'events'> {
  const E = params.emf;
  const r = Math.max(params.internalR, 1e-9);
  const R1 = Math.max(params.r1, 1e-4);
  const R2 = Math.max(params.r2, 1e-4);
  const Rp = Math.max(params.sliderR, 1e-4);
  const C = Math.max(params.capacitance, 1e-6);

  if (params.topology === 'closed-power') {
    // Node 0=GND, Node 1=理想E+, Node 2=路端+ (接 Rp 到 GND)
    const elements: MnaElement[] = [
      { kind: 'voltageSource', pos: 1, neg: 0, voltage: E },
      { kind: 'resistor', a: 1, b: 2, resistance: r },
      { kind: 'resistor', a: 2, b: 0, resistance: Rp }
    ];
    const sol = solveMnaNetwork(2, elements);
    const uTerm = sol.nodeVoltages[2]!;
    const I = (sol.nodeVoltages[1]! - uTerm) / r;
    const pOut = I * I * Rp;
    const pTotal = E * I;
    return {
      nodeVoltages: sol.nodeVoltages,
      totalCurrent: I,
      branchCurrent1: I,
      branchCurrent2: 0,
      terminalVoltage: uTerm,
      outputPower: pOut,
      efficiency: pTotal > 1e-9 ? pOut / pTotal : 0,
      capVoltage: 0,
      capCurrent: 0,
      capCharge: 0,
      capEnergy: 0
    };
  }

  if (params.topology === 'divider-lamp') {
    const lowerResistance = dividerLowerResistance(params.sliderR);
    const upperResistance = DIVIDER_RESISTANCE - lowerResistance;
    const internal = Math.max(0, params.internalR);
    const series = upperResistance + internal;
    let bulbVoltage: number, bulbCurrent: number, sourceCurrent: number, lowerCurrent: number;
    // Exact zero-resistance topology reductions; no hidden 5% clamp.
    if (lowerResistance === 0) {
      bulbVoltage = 0; bulbCurrent = 0;
      sourceCurrent = E / series; lowerCurrent = sourceCurrent;
    } else if (series === 0) {
      bulbVoltage = E; bulbCurrent = dividerLampCurrent(E);
      lowerCurrent = E / lowerResistance; sourceCurrent = lowerCurrent + bulbCurrent;
    } else {
      const elements: NonlinearCircuitElement[] = [
        { kind: 'voltageSource', id: 'V_main', pos: 1, neg: 0, voltage: E },
        { kind: 'resistor', id: 'R_upper', a: 1, b: 2, resistance: series },
        { kind: 'resistor', id: 'R_lower', a: 2, b: 0, resistance: lowerResistance },
        { kind: 'lamp', id: 'Lamp', a: 2, b: 0, k: 0.25, alpha: 0.65 }
      ];
      const solution = solveNonlinearMna(2, elements);
      bulbVoltage = solution.nodeVoltages[2]!;
      bulbCurrent = solution.elementCurrents.Lamp!;
      sourceCurrent = solution.elementCurrents.R_upper!;
      lowerCurrent = solution.elementCurrents.R_lower!;
    }
    const inputPower = E * sourceCurrent;
    const bulbPower = bulbVoltage * bulbCurrent;
    return {
      nodeVoltages: [0, E, bulbVoltage],
      totalCurrent: sourceCurrent,
      branchCurrent1: lowerCurrent,
      branchCurrent2: bulbCurrent,
      terminalVoltage: bulbVoltage, // historical alias; source terminal is separate
      outputPower: bulbPower,
      efficiency: inputPower > 1e-9 ? bulbPower / inputPower : 0,
      capVoltage: 0,
      capCurrent: 0,
      capCharge: 0,
      capEnergy: 0,
      divider: {
        sourceTerminalVoltage: E - sourceCurrent * internal,
        lowerResistance, upperResistance,
        sourcePower: inputPower,
        internalLoss: sourceCurrent * sourceCurrent * internal,
        upperLoss: sourceCurrent * sourceCurrent * upperResistance,
        lowerLoss: lowerCurrent * lowerCurrent * lowerResistance
      }
    };
  }

  if (params.topology === 'series-parallel-dynamic') {
    // 0=GND, 1=E+, 2=路端+, 3=并联节点 (R1在2-3间，R2与Rp并联在3-0间)
    const elements: MnaElement[] = [
      { kind: 'voltageSource', pos: 1, neg: 0, voltage: E },
      { kind: 'resistor', a: 1, b: 2, resistance: r },
      { kind: 'resistor', a: 2, b: 3, resistance: R1 },
      { kind: 'resistor', a: 3, b: 0, resistance: R2 },
      { kind: 'resistor', a: 3, b: 0, resistance: Rp }
    ];
    const sol = solveMnaNetwork(3, elements);
    const uTerm = sol.nodeVoltages[2]!;
    const uPar = sol.nodeVoltages[3]!;
    const I = (sol.nodeVoltages[1]! - uTerm) / r;
    const i2 = uPar / R2;
    const ip = uPar / Rp;
    const pOut = uTerm * I;
    const pTotal = E * I;
    return {
      nodeVoltages: sol.nodeVoltages,
      totalCurrent: I,
      branchCurrent1: i2,
      branchCurrent2: ip,
      terminalVoltage: uTerm,
      outputPower: pOut,
      efficiency: pTotal > 1e-9 ? pOut / pTotal : 0,
      capVoltage: uPar,
      capCurrent: 0,
      capCharge: C * uPar,
      capEnergy: 0.5 * C * uPar * uPar
    };
  }

  if (params.topology === 'rc-transient') {
    // Node 0=GND, 1=驱动电压源正极(闭合=E，断开=0), 2=电容正极
    // 等效总放电/充电电阻：充电 R_eff = R1 + r (或开关断开直接经 R1 放电)
    const rEff = params.switchClosed ? r + R1 : R1;
    const vDrive = params.switchClosed ? E : 0;

    if (dt === 0) {
      const i0 = (vDrive - prevCapVoltage) / rEff;
      return {
        nodeVoltages: [0, vDrive, prevCapVoltage],
        totalCurrent: i0,
        branchCurrent1: i0,
        branchCurrent2: 0,
        terminalVoltage: prevCapVoltage,
        outputPower: i0 * i0 * R1,
        efficiency: 0,
        capVoltage: prevCapVoltage,
        capCurrent: i0,
        capCharge: C * prevCapVoltage,
        capEnergy: 0.5 * C * prevCapVoltage * prevCapVoltage
      };
    }

    // Trapezoidal 伴随电容等效模型: g_C = 2*C/dt, I_hist = g_C * u_C + i_C
    const gC = (2 * C) / dt;
    const iHist = gC * prevCapVoltage + prevCapCurrent;
    const elements: MnaElement[] = [
      { kind: 'voltageSource', pos: 1, neg: 0, voltage: vDrive },
      { kind: 'resistor', a: 1, b: 2, resistance: rEff },
      { kind: 'resistor', a: 2, b: 0, resistance: 1 / gC },
      { kind: 'currentSource', from: 0, to: 2, current: iHist }
    ];
    const sol = solveMnaNetwork(2, elements);
    const uC = sol.nodeVoltages[2]!;
    const iC = gC * uC - iHist;
    return {
      nodeVoltages: sol.nodeVoltages,
      totalCurrent: iC,
      branchCurrent1: iC,
      branchCurrent2: 0,
      terminalVoltage: uC,
      outputPower: iC * iC * R1,
      efficiency: 0,
      capVoltage: uC,
      capCurrent: iC,
      capCharge: C * uC,
      capEnergy: 0.5 * C * uC * uC
    };
  }

  if (params.topology === 'nonlinear-lamp-diode') {
    // Node 0=GND, 1=E+, 2=经 internalR + r1 后的非线性节点 (串联小灯泡与二极管，按 switchClosed 切换灯泡/肖克利二极管)
    const seriesR = Math.max(1e-4, r + params.sliderR);
    const elements: NonlinearCircuitElement[] = [
      { kind: 'voltageSource', id: 'V_main', pos: 1, neg: 0, voltage: E },
      { kind: 'resistor', id: 'R_series', a: 1, b: 2, resistance: seriesR },
      params.switchClosed
        ? {
            kind: 'diode',
            id: 'NL_load',
            anode: 2,
            cathode: 0,
            saturationCurrent: 1e-12,
            thermalVoltage: 0.026
          }
        : { kind: 'lamp', id: 'NL_load', a: 2, b: 0, k: 0.25, alpha: 0.65 }
    ];
    const sol = solveNonlinearMna(2, elements);
    const uLoad = sol.nodeVoltages[2]!;
    const iMain = sol.elementCurrents['R_series']!;
    const pOut = uLoad * iMain;
    const pTotal = E * iMain;
    return {
      nodeVoltages: sol.nodeVoltages,
      totalCurrent: iMain,
      branchCurrent1: sol.elementCurrents['NL_load']!,
      branchCurrent2: 0,
      terminalVoltage: uLoad,
      outputPower: pOut,
      efficiency: pTotal > 1e-9 ? pOut / pTotal : 0,
      capVoltage: uLoad,
      capCurrent: 0,
      capCharge: 0,
      capEnergy: 0
    };
  }

  // rc-bridge-charge：电桥含容支路
  // 0=GND, 1=E+, 2=路端+, 3=左分压点 (2-R1-3-R2-0), 4=右分压点 (2-Rp-4-R_fixed-0)
  // 电容 C 跨接在节点 3 (+) 与 节点 4 (-) 之间！
  const rRightBot = R2;
  if (dt === 0) {
    const elements: MnaElement[] = [
      { kind: 'voltageSource', pos: 1, neg: 0, voltage: E },
      { kind: 'resistor', a: 1, b: 2, resistance: r },
      { kind: 'resistor', a: 2, b: 3, resistance: R1 },
      { kind: 'resistor', a: 3, b: 0, resistance: R2 },
      { kind: 'resistor', a: 2, b: 4, resistance: Rp },
      { kind: 'resistor', a: 4, b: 0, resistance: rRightBot }
    ];
    const sol = solveMnaNetwork(4, elements);
    const u34 = sol.nodeVoltages[3]! - sol.nodeVoltages[4]!;
    const I = (sol.nodeVoltages[1]! - sol.nodeVoltages[2]!) / r;
    return {
      nodeVoltages: sol.nodeVoltages,
      totalCurrent: I,
      branchCurrent1: (sol.nodeVoltages[2]! - sol.nodeVoltages[3]!) / R1,
      branchCurrent2: (sol.nodeVoltages[2]! - sol.nodeVoltages[4]!) / Rp,
      terminalVoltage: sol.nodeVoltages[2]!,
      outputPower: sol.nodeVoltages[2]! * I,
      efficiency: E * I > 1e-9 ? (sol.nodeVoltages[2]! * I) / (E * I) : 0,
      capVoltage: u34,
      capCurrent: 0,
      capCharge: C * u34,
      capEnergy: 0.5 * C * u34 * u34
    };
  }

  const gC = (2 * C) / dt;
  const iHist = gC * prevCapVoltage + prevCapCurrent;
  const elements: MnaElement[] = [
    { kind: 'voltageSource', pos: 1, neg: 0, voltage: E },
    { kind: 'resistor', a: 1, b: 2, resistance: r },
    { kind: 'resistor', a: 2, b: 3, resistance: R1 },
    { kind: 'resistor', a: 3, b: 0, resistance: R2 },
    { kind: 'resistor', a: 2, b: 4, resistance: Rp },
    { kind: 'resistor', a: 4, b: 0, resistance: rRightBot },
    { kind: 'resistor', a: 3, b: 4, resistance: 1 / gC },
    { kind: 'currentSource', from: 4, to: 3, current: iHist }
  ];
  const sol = solveMnaNetwork(4, elements);
  const u34 = sol.nodeVoltages[3]! - sol.nodeVoltages[4]!;
  const iC = gC * u34 - iHist;
  const I = (sol.nodeVoltages[1]! - sol.nodeVoltages[2]!) / r;
  return {
    nodeVoltages: sol.nodeVoltages,
    totalCurrent: I,
    branchCurrent1: (sol.nodeVoltages[2]! - sol.nodeVoltages[3]!) / R1,
    branchCurrent2: (sol.nodeVoltages[2]! - sol.nodeVoltages[4]!) / Rp,
    terminalVoltage: sol.nodeVoltages[2]!,
    outputPower: sol.nodeVoltages[2]! * I,
    efficiency: E * I > 1e-9 ? (sol.nodeVoltages[2]! * I) / (E * I) : 0,
    capVoltage: u34,
    capCurrent: iC,
    capCharge: C * u34,
    capEnergy: 0.5 * C * u34 * u34
  };
}

/** Returns the same epsilon-regularized lamp law used by the nonlinear MNA stamps. */
export function sampleDividerLampIvCurve(
  maximumVoltage: number,
  sampleCount = 16
): Array<{ u: number; i: number }> {
  const maxVoltage = Math.max(0, Number.isFinite(maximumVoltage) ? maximumVoltage : 0);
  const count = Math.max(2, Math.min(512, Math.floor(Number.isFinite(sampleCount) ? sampleCount : 16)));
  return Array.from({ length: count }, (_, index) => {
    const u = maxVoltage * index / (count - 1);
    const i = dividerLampCurrent(u);
    return { u, i };
  });
}

export function createInitialState(params: CircuitParams): CircuitState {
  const initCapV = params.topology === 'rc-transient' && !params.switchClosed ? params.emf : 0;
  const first = solveTopology(params, initCapV, 0, 0);
  const events: PhysicsEvent[] = [];
  if (
    params.topology === 'closed-power' &&
    params.internalR <= 1e-6 &&
    params.sliderR <= 1e-6 &&
    params.emf > 0
  ) {
    events.push({
      id: 'SHORT_CIRCUIT',
      time: 0,
      label: 'SHORT_CIRCUIT 电源极限短路告警'
    });
  }
  return {
    t: 0,
    ...first,
    events
  };
}

export function stepCircuit(
  state: CircuitState,
  params: CircuitParams,
  dt: number
): StepResult<CircuitState> {
  if (!Number.isFinite(dt) || dt < 0) {
    throw new Error(`Time step dt must be non-negative finite, got ${dt}.`);
  }
  if (dt === 0) {
    return { nextState: state, events: [] };
  }

  const solved = solveTopology(params, state.capVoltage, state.capCurrent, dt);
  return {
    nextState: {
      t: state.t + dt,
      ...solved,
      events: state.events
    },
    events: []
  };
}

export function computeObservables(state: CircuitState): Record<string, number> {
  return {
    totalCurrent: state.totalCurrent,
    terminalVoltage: state.terminalVoltage,
    outputPower: state.outputPower,
    efficiency: state.efficiency,
    branchCurrent1: state.branchCurrent1,
    branchCurrent2: state.branchCurrent2,
    capVoltage: state.capVoltage,
    capCurrent: state.capCurrent,
    capCharge: state.capCharge,
    capacitorEnergy: state.capEnergy,
    ...(state.divider ? {
      sourceTerminalVoltage: state.divider.sourceTerminalVoltage,
      lampVoltage: state.terminalVoltage, lampCurrent: state.branchCurrent2,
      sourcePower: state.divider.sourcePower, internalLoss: state.divider.internalLoss,
      upperLoss: state.divider.upperLoss, lowerLoss: state.divider.lowerLoss,
      dividerLowerResistance: state.divider.lowerResistance, dividerUpperResistance: state.divider.upperResistance
    } : {})
  };
}

export function checkInvariants(
  state: CircuitState,
  _initial: CircuitState,
  params: CircuitParams
): InvariantReport[] {
  if (params.topology === 'closed-power') {
    const expected = params.emf;
    const actual = state.terminalVoltage + state.totalCurrent * params.internalR;
    const err = Math.abs(actual - expected) / Math.max(Math.abs(expected), 1e-9);
    return [
      {
        name: '闭合电路 KVL (U路端 + Ir = E)',
        measuredError: err,
        tolerance: 1e-9,
        passed: err < 1e-9
      }
    ];
  }
  if (params.topology === 'series-parallel-dynamic') {
    const kclErr =
      Math.abs(state.totalCurrent - (state.branchCurrent1 + state.branchCurrent2)) /
      Math.max(Math.abs(state.totalCurrent), 1e-9);
    return [
      {
        name: '并联节点 KCL (I总 = I₂ + Ip)',
        measuredError: kclErr,
        tolerance: 1e-9,
        passed: kclErr < 1e-9
      }
    ];
  }
  if (params.topology === 'divider-lamp') {
    const kclErr = Math.abs(state.totalCurrent - (state.branchCurrent1 + state.branchCurrent2)) /
      Math.max(Math.abs(state.totalCurrent), 1e-9);
    const divider = state.divider;
    const powerError = divider ? Math.abs(divider.sourcePower - divider.internalLoss - divider.upperLoss - divider.lowerLoss - state.outputPower) : Infinity;
    const loopError = divider ? Math.abs(params.emf - state.totalCurrent * (params.internalR + divider.upperResistance) - state.terminalVoltage) : Infinity;
    return [
      { name: '分压小灯泡节点 KCL (I总 = I灯 + I下段)', measuredError: kclErr, tolerance: 1e-9, passed: kclErr < 1e-9 },
      { name: '分压回路 KVL', measuredError: loopError, tolerance: 1e-8, passed: loopError < 1e-8, unit: 'V' },
      { name: '分压电路功率平衡', measuredError: powerError, tolerance: 1e-8, passed: powerError < 1e-8, unit: 'W' }
    ];
  }
  return [];
}
