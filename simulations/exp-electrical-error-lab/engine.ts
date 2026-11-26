import { solveNonlinearMna, type NonlinearCircuitElement } from '@physforge/physics-core';
import type { InvariantReport, StepResult } from '@physforge/sim-sdk';

export type ElectricalExpMode = 'emf-inner-outer' | 'bulb-iv-curve' | 'half-bias-rg' | 'caliper-micrometer';
export type EmfWiring = 'voltmeter-across-source' | 'ammeter-in-series';
export type BulbWiring = 'voltage-divider' | 'current-limit';
export type VernierDivisions = '10' | '20' | '50';

export type ElectricalErrorParams = {
  mode: ElectricalExpMode;
  emfWiring: EmfWiring;
  emfVolts: number;
  rInternalOhm: number;
  rAmmeterOhm: number;
  rVoltmeterOhm: number;
  bulbWiring: BulbWiring;
  rheostatMaxOhm: number;
  rheostatTapFrac: number;
  rgTrueOhm: number;
  halfBiasSupplyV: number;
  targetVernierMm: number;
  vernierDivisions: VernierDivisions;
  targetMicrometerMm: number;
};

export interface EmfMeasurementSummary {
  readonly eFittedV: number;
  readonly rFittedOhm: number;
  readonly eAnalyticV: number;
  readonly rAnalyticOhm: number;
  readonly fitError: number;
  readonly uiCurve: readonly { currentA: number; voltageV: number }[];
}

export interface HalfBiasSummary {
  readonly rgTrueOhm: number;
  readonly rgMeasuredOhm: number;
  readonly rSeriesR1Ohm: number;
  readonly biasRelativeErr: number;
}

export interface InstrumentReadingSummary {
  readonly vernierMainMm: number;
  readonly vernierCoincidentIndex: number;
  readonly vernierReadoutMm: number;
  readonly vernierQuantErrorMm: number;
  readonly microFixedHalfMmCount: number;
  readonly microThimbleDiv: number;
  readonly microReadoutMm: number;
  readonly microQuantErrorMm: number;
}

export interface BulbOperatingPoint {
  readonly tap: number;
  readonly voltageV: number;
  readonly currentA: number;
}
export interface ElectricalErrorState {
  readonly t: number;
  readonly emfSummary: EmfMeasurementSummary;
  readonly halfBias: HalfBiasSummary;
  readonly bulbCurve: readonly BulbOperatingPoint[];
  readonly bulbOperatingPoint: BulbOperatingPoint;
  readonly instrument: InstrumentReadingSummary;
}

export function solveEmfViaMna(params: ElectricalErrorParams): EmfMeasurementSummary {
  const E = Math.max(0.5, params.emfVolts);
  const r = Math.max(0.05, params.rInternalOhm);
  const rA = Math.max(0.01, params.rAmmeterOhm);
  const rV = Math.max(10, params.rVoltmeterOhm);
  const loads = [2.0, 4.0, 7.0, 12.0, 20.0];

  const uiCurve = loads.map((rLoad) => {
    if (params.emfWiring === 'voltmeter-across-source') {
      // Nodes: 0=neg, 1=emf+ (after internal r -> node 2), 2=voltmeter terminal -> ammeter rA -> 3=load top -> 0
      const els: NonlinearCircuitElement[] = [
        { kind: 'voltageSource', id: 'E', pos: 1, neg: 0, voltage: E },
        { kind: 'resistor', id: 'rInt', a: 1, b: 2, resistance: r },
        { kind: 'resistor', id: 'RV', a: 2, b: 0, resistance: rV },
        { kind: 'resistor', id: 'RA', a: 2, b: 3, resistance: rA },
        { kind: 'resistor', id: 'RL', a: 3, b: 0, resistance: rLoad }
      ];
      const sol = solveNonlinearMna(3, els, 0);
      return {
        currentA: sol.elementCurrents.RA ?? 0,
        voltageV: sol.nodeVoltages[2] ?? 0
      };
    }

    // Ammeter in series directly with source: 0=neg, 1=emf+, 2=after r -> RA -> 3=load+voltmeter top -> 0
    const els: NonlinearCircuitElement[] = [
      { kind: 'voltageSource', id: 'E', pos: 1, neg: 0, voltage: E },
      { kind: 'resistor', id: 'rInt', a: 1, b: 2, resistance: r },
      { kind: 'resistor', id: 'RA', a: 2, b: 3, resistance: rA },
      { kind: 'resistor', id: 'RV', a: 3, b: 0, resistance: rV },
      { kind: 'resistor', id: 'RL', a: 3, b: 0, resistance: rLoad }
    ];
    const sol = solveNonlinearMna(3, els, 0);
    return {
      currentA: sol.elementCurrents.RA ?? 0,
      voltageV: sol.nodeVoltages[3] ?? 0
    };
  });

  // OLS fit U = E_fit - r_fit * I
  const n = uiCurve.length;
  let sx = 0;
  let sy = 0;
  for (const pt of uiCurve) {
    sx += pt.currentA;
    sy += pt.voltageV;
  }
  const mx = sx / n;
  const my = sy / n;
  let sxx = 0;
  let sxy = 0;
  for (const pt of uiCurve) {
    sxx += (pt.currentA - mx) * (pt.currentA - mx);
    sxy += (pt.currentA - mx) * (pt.voltageV - my);
  }
  const rFittedOhm = sxx > 1e-18 ? -sxy / sxx : 0;
  const eFittedV = my + rFittedOhm * mx;

  const eAnalyticV =
    params.emfWiring === 'voltmeter-across-source' ? (E * rV) / (rV + r) : E;
  const rAnalyticOhm =
    params.emfWiring === 'voltmeter-across-source' ? (r * rV) / (r + rV) : r + rA;

  const fitError = Math.max(
    Math.abs(eFittedV - eAnalyticV),
    Math.abs(rFittedOhm - rAnalyticOhm)
  );

  return { eFittedV, rFittedOhm, eAnalyticV, rAnalyticOhm, fitError, uiCurve };
}

export function solveHalfBiasViaMna(supplyV: number, rgTrue: number, iFullA = 0.001): HalfBiasSummary {
  // With R1 chosen so total current with S2 open equals I_full: E / (R1 + Rg) = I_full -> R1 = E/I_full - Rg
  const r1 = Math.max(10, supplyV / iFullA - rgTrue);
  // Solve exact R2 via bisection on MNA circuit so I_g(S2 closed) == 0.5 * I_full
  let lo = 1;
  let hi = rgTrue * 1.1 + 10;
  const evalIg = (r2: number): number => {
    const els: NonlinearCircuitElement[] = [
      { kind: 'voltageSource', id: 'E', pos: 1, neg: 0, voltage: supplyV },
      { kind: 'resistor', id: 'R1', a: 1, b: 2, resistance: r1 },
      { kind: 'resistor', id: 'Rg', a: 2, b: 0, resistance: rgTrue },
      { kind: 'resistor', id: 'R2', a: 2, b: 0, resistance: r2 }
    ];
    const sol = solveNonlinearMna(2, els, 0);
    return sol.elementCurrents.Rg ?? 0;
  };
  for (let k = 0; k < 56; k++) {
    const mid = 0.5 * (lo + hi);
    if (evalIg(mid) < 0.5 * iFullA) lo = mid;
    else hi = mid;
  }
  const rgMeasuredOhm = 0.5 * (lo + hi);
  return {
    rgTrueOhm: rgTrue,
    rgMeasuredOhm,
    rSeriesR1Ohm: r1,
    biasRelativeErr: (rgTrue - rgMeasuredOhm) / rgTrue
  };
}

/** Exact topology at each endpoint: collapse the zero-resistance branch, never insert epsilon R. */
export function solveBulbOperatingPoint(params: ElectricalErrorParams, tap = params.rheostatTapFrac): BulbOperatingPoint {
  const E = Math.max(1, params.emfVolts);
  const R = Math.max(5, params.rheostatMaxOhm);
  const frac = Math.max(0, Math.min(1, tap));
  if (params.bulbWiring === 'voltage-divider' && frac === 0)
    return { tap: 0, voltageV: 0, currentA: 0 };
  const lamp = { kind:'lamp' as const, id:'L', a:2, b:0, k:0.14, alpha:0.62 };
  const source = { kind:'voltageSource' as const, id:'E', pos:1, neg:0, voltage:E };
  if (frac === 1) {
    const sol=solveNonlinearMna(1,[source,{...lamp,a:1}],0);
    return {tap:frac,voltageV:E,currentA:sol.elementCurrents.L!};
  }
  const els: NonlinearCircuitElement[] = [source,
    {kind:'resistor',id:'Rtop',a:1,b:2,resistance:(1-frac)*R},lamp];
  if(params.bulbWiring==='voltage-divider')
    els.push({kind:'resistor',id:'Rbot',a:2,b:0,resistance:frac*R});
  const sol=solveNonlinearMna(2,els,0);
  return {tap:frac,voltageV:sol.elementVoltages.L!,currentA:sol.elementCurrents.L!};
}
export function solveBulbCurveViaMna(params: ElectricalErrorParams): BulbOperatingPoint[] {
  return Array.from({length:11},(_,k)=>solveBulbOperatingPoint(params,k/10));
}

export function decodeInstruments(
  targetVernierMm: number,
  divsRaw: VernierDivisions,
  targetMicroMm: number
): InstrumentReadingSummary {
  const divs = Number(divsRaw) || 50;
  const vStep = 1 / divs;
  const vTicks = Math.max(0, Math.round(targetVernierMm / vStep));
  const vReadout = vTicks * vStep;
  const vMain = Math.floor(vTicks / divs);
  const vIndex = vTicks % divs;

  const mTicks = Math.max(0, Math.round(targetMicroMm / 0.01));
  const mReadout = mTicks * 0.01;
  const mHalfCount = Math.floor(mTicks / 50);
  const mThimble = mTicks % 50;

  return {
    vernierMainMm: vMain,
    vernierCoincidentIndex: vIndex,
    vernierReadoutMm: Number(vReadout.toFixed(4)),
    vernierQuantErrorMm: Math.abs(vReadout - targetVernierMm),
    microFixedHalfMmCount: mHalfCount,
    microThimbleDiv: mThimble,
    microReadoutMm: Number(mReadout.toFixed(4)),
    microQuantErrorMm: Math.abs(mReadout - targetMicroMm)
  };
}

export function createInitialState(params: ElectricalErrorParams): ElectricalErrorState {
  return {
    t: 0,
    emfSummary: solveEmfViaMna(params),
    halfBias: solveHalfBiasViaMna(params.halfBiasSupplyV, params.rgTrueOhm),
    bulbCurve: solveBulbCurveViaMna(params),
      bulbOperatingPoint: solveBulbOperatingPoint(params),
    instrument: decodeInstruments(params.targetVernierMm, params.vernierDivisions, params.targetMicrometerMm)
  };
}

export function stepElectricalErrorLab(
  state: ElectricalErrorState,
  params: ElectricalErrorParams,
  dt: number
): StepResult<ElectricalErrorState> {
  if (!Number.isFinite(dt) || dt < 0) throw new Error(`Invalid dt: ${dt}`);
  if (dt === 0) return { nextState: state, events: [] };
  return {
    nextState: {
      t: state.t + dt,
      emfSummary: solveEmfViaMna(params),
      halfBias: solveHalfBiasViaMna(params.halfBiasSupplyV, params.rgTrueOhm),
      bulbCurve: solveBulbCurveViaMna(params),
      bulbOperatingPoint: solveBulbOperatingPoint(params),
      instrument: decodeInstruments(params.targetVernierMm, params.vernierDivisions, params.targetMicrometerMm)
    },
    events: []
  };
}

export function computeObservables(state: ElectricalErrorState): Record<string, number> {
  return {
    t: state.t,
    eFittedV: state.emfSummary.eFittedV,
    rFittedOhm: state.emfSummary.rFittedOhm,
    rgMeasuredOhm: state.halfBias.rgMeasuredOhm,
    vernierReadoutMm: state.instrument.vernierReadoutMm,
    microReadoutMm: state.instrument.microReadoutMm,
    bulbVoltageV:state.bulbOperatingPoint.voltageV,
    bulbCurrentA:state.bulbOperatingPoint.currentA
  };
}

export function checkInvariants(state: ElectricalErrorState): InvariantReport[] {
  return [
    {
      name: '非理想 MNA 测电源 E/r 拟合与解析偏置误差',
      measuredError: state.emfSummary.fitError,
      tolerance: 1e-6,
      passed: state.emfSummary.fitError < 1e-6
    },
    {
      name: '半偏法满足 R_g测 < R_g真 物理定则',
      measuredError: state.halfBias.rgMeasuredOhm < state.halfBias.rgTrueOhm ? 0 : 1,
      tolerance: 1e-9,
      passed: state.halfBias.rgMeasuredOhm < state.halfBias.rgTrueOhm
    }
  ];
}
