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
  /** No finite/unique current exists for an all-ideal short. Numeric fields are safe placeholders, not measurements. */
  readonly idealShort?: boolean;
  /** Direct ideal diode beyond the supported exponential interval. */
  readonly modelError?: 'diode-outside-model';
  /** Explicit source terminals; RC discharge has no connected source. */
  readonly sourceTerminalVoltage?: number;
  readonly sourceCurrent?: number;
  readonly events: readonly PhysicsEvent[];
}

// An exact 0 Ω connection imposes equality of node voltages, not a tiny artificial resistance.
function resistor(a:number,b:number,resistance:number): MnaElement {
  return resistance===0 ? {kind:'voltageSource',pos:a,neg:b,voltage:0} : {kind:'resistor',a,b,resistance};
}

function solveTopology(
  params: CircuitParams,
  prevCapVoltage: number,
  _prevCapCurrent: number,
  dt: number
): Omit<CircuitState, 't' | 'events'> {
  const E = params.emf;
  const r = Math.max(params.internalR, 0);
  const R1 = Math.max(params.r1, 1e-4);
  const R2 = Math.max(params.r2, 1e-4);
  const Rp = Math.max(params.sliderR, 0);
  const C = Math.max(params.capacitance, 1e-6);

  if (params.topology === 'closed-power') {
    // Ideal E across an ideal wire is inconsistent (E≠0) or underdetermined (E=0).
    if (r===0 && Rp===0) return {
      nodeVoltages:[0,E,0], totalCurrent:0, branchCurrent1:0, branchCurrent2:0,
      terminalVoltage:0, outputPower:0, efficiency:0, capVoltage:0, capCurrent:0,
      capCharge:0, capEnergy:0, idealShort:true
    };
    const elements: MnaElement[] = [
      {kind:'voltageSource',pos:1,neg:0,voltage:E},
      resistor(1,2,r),resistor(2,0,Rp)
    ];
    const sol=solveMnaNetwork(2,elements);
    const I=-sol.sourceCurrents[0]!;
    // Enforce exact ideal constraints at the exported nodes.
    const uTerm=Rp===0?0:r===0?E:sol.nodeVoltages[2]!;
    const pOut=uTerm*I,pTotal=E*I;
    return {
      nodeVoltages:[0,E,uTerm],totalCurrent:I,branchCurrent1:I,branchCurrent2:0,
      terminalVoltage:uTerm,sourceTerminalVoltage:uTerm,sourceCurrent:I,outputPower:pOut,
      efficiency:pTotal>1e-9?pOut/pTotal:0,capVoltage:0,capCurrent:0,capCharge:0,capEnergy:0
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
    const elements:MnaElement[]=[
      {kind:'voltageSource',pos:1,neg:0,voltage:E},
      resistor(1,2,r),resistor(2,3,R1),resistor(3,0,R2),resistor(3,0,Rp)
    ];
    const sol=solveMnaNetwork(3,elements);
    const I=-sol.sourceCurrents[0]!;
    const uTerm=r===0?E:sol.nodeVoltages[2]!;
    const uPar=Rp===0?0:sol.nodeVoltages[3]!;
    const i2=uPar/R2,ip=Rp===0?I-i2:uPar/Rp;
    const pOut=uTerm*I,pTotal=E*I;
    return {
      nodeVoltages:[0,E,uTerm,uPar],totalCurrent:I,branchCurrent1:i2,branchCurrent2:ip,
      terminalVoltage:uTerm,sourceTerminalVoltage:uTerm,sourceCurrent:I,outputPower:pOut,
      efficiency:pTotal>1e-9?pOut/pTotal:0,capVoltage:0,capCurrent:0,capCharge:0,capEnergy:0
    };
  }

  if (params.topology === 'rc-transient') {
    // Exact one-state RC flow for piecewise constant controls. The new circuit
    // determines the instantaneous current after a switch, not the old branch.
    const rEff=params.switchClosed?r+R1:R1;
    const vDrive=params.switchClosed?E:0;
    const uC=prevCapVoltage+(vDrive-prevCapVoltage)*(-Math.expm1(-dt/(rEff*C)));
    const iC=(vDrive-uC)/rEff;
    const sourceTerminal=params.switchClosed?E-iC*r:0;
    return {
      nodeVoltages:[0,vDrive,uC,sourceTerminal],totalCurrent:iC,branchCurrent1:iC,branchCurrent2:0,
      terminalVoltage:uC,sourceTerminalVoltage:sourceTerminal,sourceCurrent:params.switchClosed?iC:0,
      outputPower:iC*iC*R1,efficiency:0,capVoltage:uC,capCurrent:iC,
      capCharge:C*uC,capEnergy:.5*C*uC*uC
    };
  }

  if (params.topology === 'nonlinear-lamp-diode') {
    // Node 0=GND, 1=E+, 2=经 internalR + r1 后的非线性节点 (串联小灯泡与二极管，按 switchClosed 切换灯泡/肖克利二极管)
    const seriesR = r + Rp;
    if(seriesR===0){
      // Exact ideal connection, not a fictitious series resistor. The diode
      // exponential model is only supported through exponent 40.
      const invalid=params.switchClosed&&E/.026>40;
      const i=invalid?0:params.switchClosed?1e-12*Math.expm1(E/.026):dividerLampCurrent(E);
      return {nodeVoltages:[0,E,E],totalCurrent:i,branchCurrent1:i,branchCurrent2:0,terminalVoltage:E,
        outputPower:E*i,efficiency:E*i>0?1:0,sourceTerminalVoltage:E,sourceCurrent:i,
        capVoltage:0,capCurrent:0,capCharge:0,capEnergy:0,...(invalid?{modelError:'diode-outside-model' as const}:{})};
    }
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
      sourceTerminalVoltage:E-iMain*r,
      sourceCurrent:iMain,
      capVoltage: 0,
      capCurrent: 0,
      capCharge: 0,
      capEnergy: 0
    };
  }

  // Bridge starts at its explicitly labelled DC equilibrium. Afterwards the
  // one capacitor evolves exactly under the MNA-derived Thevenin equivalent.
  // Vth is the open-circuit voltage; Rth is measured with E=0 and a unit test current.
  const bridge=(drive:number):MnaElement[]=>[
    {kind:'voltageSource',pos:1,neg:0,voltage:drive},
    resistor(1,2,r),resistor(2,3,R1),resistor(3,0,R2),
    resistor(2,4,Rp),resistor(4,0,R2)
  ];
  const open=solveMnaNetwork(4,bridge(E));
  const vTh=open.nodeVoltages[3]!-open.nodeVoltages[4]!;
  let sol=open,iC=0;
  if(dt>0){
    const test=solveMnaNetwork(4,[...bridge(0),{kind:'currentSource',from:4,to:3,current:1}]);
    const rTh=test.nodeVoltages[3]!-test.nodeVoltages[4]!;
    const uC=prevCapVoltage+(vTh-prevCapVoltage)*(-Math.expm1(-dt/(rTh*C)));
    // The capacitor is an instantaneous voltage constraint. Its MNA source
    // current uses the passive positive direction 3→4.
    sol=solveMnaNetwork(4,[...bridge(E),{kind:'voltageSource',pos:3,neg:4,voltage:uC}]);
    iC=sol.sourceCurrents.at(-1)!;
  }
  const u34=sol.nodeVoltages[3]!-sol.nodeVoltages[4]!;
  const I=-sol.sourceCurrents[0]!;
  const iLeft=(sol.nodeVoltages[2]!-sol.nodeVoltages[3]!)/R1;
  const uTerm=r===0?E:sol.nodeVoltages[2]!;
  const pTotal=E*I,pOut=uTerm*I;
  return {
    nodeVoltages:sol.nodeVoltages,totalCurrent:I,branchCurrent1:iLeft,branchCurrent2:I-iLeft,
    terminalVoltage:uTerm,sourceTerminalVoltage:uTerm,sourceCurrent:I,
    outputPower:pOut,efficiency:pTotal>1e-9?pOut/pTotal:0,
    capVoltage:u34,capCurrent:iC,capCharge:C*u34,capEnergy:.5*C*u34*u34
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
    first.idealShort &&
    params.emf > 0
  ) {
    events.push({
      id: 'SHORT_CIRCUIT',
      time: 0,
      label: 'SHORT_CIRCUIT 理想电源与零欧姆导线矛盾，无有限解'
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
  const events:PhysicsEvent[]=solved.idealShort&&!state.idealShort&&params.emf>0 ? [{id:'SHORT_CIRCUIT',time:state.t,label:'SHORT_CIRCUIT 理想电源短路，无有限解'}]:[];
  return {
    nextState: {
      t: state.t + dt,
      ...solved,
      events: [...state.events,...events]
    },
    events
  };
}

export function computeObservables(state: CircuitState): Record<string, number> {
  // Invalid solutions have no electrical measurements; state-level finite
  // placeholders are deliberately not published as physical observables.
  if(state.idealShort||state.modelError)return {solutionDefined:0};
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
    solutionDefined:state.idealShort?0:1,
    ...(state.sourceTerminalVoltage!==undefined?{sourceTerminalVoltage:state.sourceTerminalVoltage,sourceCurrent:state.sourceCurrent??0}:{}),
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
  if(state.idealShort||state.modelError)return [];
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
  const residual = (name: string, value: number, tolerance: number, unit: string): InvariantReport => {
    const measuredError = Math.abs(value);
    return { name, measuredError, tolerance, unit, passed: Number.isFinite(measuredError) && measuredError < tolerance };
  };
  if (params.topology === 'rc-transient') {
    const i=state.capCurrent, u=state.capVoltage;
    const r1=Math.max(params.r1,1e-4), r=params.switchClosed?Math.max(params.internalR,0):0;
    const drive=params.switchClosed?params.emf:0;
    const sourceI=state.sourceCurrent ?? NaN;
    return [
      residual('RC 回路 KVL',drive-u-i*(r+r1),1e-8,'V'),
      residual('RC 电源支路 KCL',sourceI-(params.switchClosed?i:0),1e-9,'A'),
      residual('RC 瞬时功率平衡',params.emf*sourceI-i*i*(r+r1)-u*i,1e-8,'W'),
    ];
  }
  if (params.topology === 'rc-bridge-charge') {
    const i=state.totalCurrent, il=state.branchCurrent1, ir=state.branchCurrent2, ic=state.capCurrent;
    const r=Math.max(params.internalR,0), r1=Math.max(params.r1,1e-4), r2=Math.max(params.r2,1e-4), rp=Math.max(params.sliderR,0);
    const ul=state.nodeVoltages[3]!, ur=state.nodeVoltages[4]!, itl=ul/r2, itr=ur/r2;
    return [
      residual('电桥源节点 KCL',i-il-ir,1e-9,'A'),
      residual('电桥左中点 KCL',il-itl-ic,1e-9,'A'),
      residual('电桥右中点 KCL',ir+ic-itr,1e-9,'A'),
      residual('电桥电容端电压',ul-ur-state.capVoltage,1e-8,'V'),
      residual('电桥瞬时功率平衡',params.emf*i-r*i*i-r1*il*il-rp*ir*ir-r2*(itl*itl+itr*itr)-state.capVoltage*ic,1e-8,'W'),
    ];
  }
  if (params.topology === 'nonlinear-lamp-diode') {
    const i=state.totalCurrent,u=state.terminalVoltage,r=Math.max(params.internalR,0)+Math.max(params.sliderR,0);
    // The scene invariant checks the physical load law, not NR's iteration count.
    const expected=params.switchClosed?1e-12*Math.expm1(u/.026):dividerLampCurrent(u);
    return [
      residual('非线性负载 KCL',i-state.branchCurrent1,1e-9,'A'),
      residual('非线性回路 KVL',params.emf-i*r-u,1e-8,'V'),
      residual('非线性器件伏安关系',state.branchCurrent1-expected,1e-9,'A'),
      residual('非线性回路功率平衡',params.emf*i-r*i*i-state.outputPower,1e-8,'W'),
    ];
  }
  return [];
}
