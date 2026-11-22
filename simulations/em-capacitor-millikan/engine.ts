import { CLASSROOM_GRAVITY, stepRK4 } from '@physforge/physics-core';
import type { InvariantReport, PhysicsEvent, StepResult } from '@physforge/sim-sdk';

export const EPSILON_0 = 8.8541878128e-12;
export const BASE_AREA_M2 = 0.04;

export type CapSwitchMode = 'closed-const-u' | 'open-const-q';
export type GroundMode = 'bottom' | 'top' | 'none';

export type CapacitorMillikanParams = {
  switchMode: CapSwitchMode;
  groundMode: GroundMode;
  sourceVoltageU0: number;
  distanceMm: number;
  refDistanceMm: number;
  areaRatioS: number;
  refAreaRatioS: number;
  dielectricEr: number;
  refDielectricEr: number;
  probeFracP: number;
  oilDropEnabled: boolean;
  dropChargeSteps: number; // positive integer multiples of effective quantum unit
  dropMassScale: number;
  stokesDrag: number;
};

export interface CapacitorMillikanState {
  readonly t: number;
  readonly dropYFrac: number; // 0 = bottom plate, 1 = top plate
  readonly dropVy: number;
  readonly capacitanceF: number;
  readonly chargeC: number;
  readonly voltageV: number;
  readonly fieldE: number;
  readonly phiPV: number;
  readonly electrometerAngleDeg: number;
  readonly events: readonly PhysicsEvent[];
}

export function computeCapacitorMetrics(params: CapacitorMillikanParams): {
  capacitanceF: number;
  chargeC: number;
  voltageV: number;
  fieldE: number;
  phiPV: number;
  dMeters: number;
} {
  const d = Math.max(0.002, params.distanceMm * 1e-3);
  const S = Math.max(0.05, params.areaRatioS) * BASE_AREA_M2;
  const er = Math.max(1, params.dielectricEr);
  const capacitanceF = (EPSILON_0 * er * S) / d;

  let voltageV: number;
  let chargeC: number;
  if (params.switchMode === 'closed-const-u') {
    voltageV = params.sourceVoltageU0;
    chargeC = capacitanceF * voltageV;
  } else {
    const dRef = Math.max(0.002, params.refDistanceMm * 1e-3);
    const sRef = Math.max(0.05, params.refAreaRatioS) * BASE_AREA_M2;
    const erRef = Math.max(1, params.refDielectricEr);
    const cRef = (EPSILON_0 * erRef * sRef) / dRef;
    chargeC = cRef * params.sourceVoltageU0;
    // Closed form for E removes cancellation if desired: U = Q / C
    voltageV = chargeC / capacitanceF;
  }

  // Exact analytical field: E = Q / (eps0 * er * S) in open mode, U / d in closed mode
  const fieldE =
    params.switchMode === 'open-const-q'
      ? chargeC / (EPSILON_0 * er * S)
      : voltageV / d;

  // Bottom plate is assumed negative/ground unless top grounded; upper plate at +voltageV
  const pFrac = Math.max(0, Math.min(1, params.probeFracP));
  let phiPV: number;
  if (params.groundMode === 'bottom') {
    phiPV = fieldE * (pFrac * d);
  } else if (params.groundMode === 'top') {
    phiPV = -fieldE * ((1 - pFrac) * d);
  } else {
    phiPV = fieldE * ((pFrac - 0.5) * d);
  }

  return { capacitanceF, chargeC, voltageV, fieldE, phiPV, dMeters: d };
}

function getDropPhysicalParams(params: CapacitorMillikanParams): { mass: number; charge: number } {
  // Effective drop calibrated so at default U0=200V, d=20mm -> E=10000 V/m, step=2 balances mass=1
  const mass = Math.max(0.1, params.dropMassScale) * 1e-12;
  const qUnit = (0.5e-12 * CLASSROOM_GRAVITY) / 10000;
  const charge = params.dropChargeSteps * qUnit;
  return { mass, charge };
}

export function createInitialState(params: CapacitorMillikanParams): CapacitorMillikanState {
  const m = computeCapacitorMetrics(params);
  return {
    t: 0,
    dropYFrac: 0.5,
    dropVy: 0,
    capacitanceF: m.capacitanceF,
    chargeC: m.chargeC,
    voltageV: m.voltageV,
    fieldE: m.fieldE,
    phiPV: m.phiPV,
    electrometerAngleDeg: Math.min(82, Math.abs(m.voltageV) * 0.16),
    events: []
  };
}

export function stepCapacitorMillikan(
  state: CapacitorMillikanState,
  params: CapacitorMillikanParams,
  dt: number
): StepResult<CapacitorMillikanState> {
  if (!Number.isFinite(dt) || dt < 0) throw new Error(`Invalid dt: ${dt}`);
  const m = computeCapacitorMetrics(params);
  if (dt === 0) {
    return {
      nextState: {
        ...state,
        capacitanceF: m.capacitanceF,
        chargeC: m.chargeC,
        voltageV: m.voltageV,
        fieldE: m.fieldE,
        phiPV: m.phiPV,
        electrometerAngleDeg: Math.min(82, Math.abs(m.voltageV) * 0.16)
      },
      events: []
    };
  }

  let dropYFrac = state.dropYFrac;
  let dropVy = state.dropVy;
  const events: PhysicsEvent[] = [];

  if (params.oilDropEnabled) {
    const { mass, charge } = getDropPhysicalParams(params);
    const kDrag = Math.max(0, params.stokesDrag) * mass;
    const y0Meters = dropYFrac * m.dMeters;
    const next = stepRK4([y0Meters, dropVy], state.t, dt, (_t, yv) => [
      yv[1]!,
      (charge * m.fieldE) / mass - CLASSROOM_GRAVITY - (kDrag * yv[1]!) / mass
    ]);
    let nyMeters = next[0]!;
    let nvy = next[1]!;
    if (nyMeters <= 0) {
      nyMeters = 0;
      nvy = 0;
    } else if (nyMeters >= m.dMeters) {
      nyMeters = m.dMeters;
      nvy = 0;
    }
    dropYFrac = nyMeters / m.dMeters;
    dropVy = nvy;
  }

  return {
    nextState: {
      ...state,
      t: state.t + dt,
      dropYFrac,
      dropVy,
      capacitanceF: m.capacitanceF,
      chargeC: m.chargeC,
      voltageV: m.voltageV,
      fieldE: m.fieldE,
      phiPV: m.phiPV,
      electrometerAngleDeg: Math.min(82, Math.abs(m.voltageV) * 0.16)
    },
    events
  };
}

export function computeObservables(
  state: CapacitorMillikanState,
  params: CapacitorMillikanParams
): Record<string, number> {
  const m = computeCapacitorMetrics(params);
  return {
    t: state.t,
    capacitancePF: m.capacitanceF * 1e12,
    chargeNC: m.chargeC * 1e9,
    voltageV: m.voltageV,
    fieldE: m.fieldE,
    phiPV: m.phiPV,
    dropVyMmS: state.dropVy * 1e3,
    electrometerAngleDeg: Math.min(82, Math.abs(m.voltageV) * 0.16)
  };
}

export function checkInvariants(
  _state: CapacitorMillikanState,
  _initial: CapacitorMillikanState,
  params: CapacitorMillikanParams
): InvariantReport[] {
  const m = computeCapacitorMetrics(params);
  const qErr = Math.abs(m.chargeC - m.capacitanceF * m.voltageV) / Math.max(1e-18, Math.abs(m.chargeC));
  return [
    {
      name: '电容基本定义式 Q = C·U 一致性',
      measuredError: qErr,
      tolerance: 1e-10,
      passed: Number.isFinite(qErr) && qErr < 1e-10
    }
  ];
}
