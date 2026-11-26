import { integrateAdaptiveRK45 } from '@physforge/physics-core';
import type { InvariantReport, StepResult } from '@physforge/sim-sdk';

export type EmMotionMode = 'railgun' | 'regen-brake';
export type RailgunDriveMode = 'capacitor-pulse' | 'constant-current';

export type EmLaunchRegenParams = {
  mode: EmMotionMode;
  driveMode: RailgunDriveMode;
  massKg: number;
  v0Mps: number;
  bFieldT: number;
  trackSpanM: number;
  circuitResOhm: number;
  loadResOhm: number;
  capacitanceF: number;
  capVoltageV: number;
  driveCurrentA: number;
  aeroDragCoeff: number;
  mechBrakeN: number;
};

export interface EmLaunchRegenState {
  readonly t: number;
  readonly x: number;
  readonly v: number;
  readonly qCapC: number;
  readonly currentA: number;
  readonly energyInitialJ: number;
  readonly energyInputWorkJ: number;
  readonly energyKineticJ: number;
  readonly energyCapJ: number;
  readonly energyJouleJ: number;
  readonly energyRegenJ: number;
  readonly energyDragMechJ: number;
  readonly ledgerResidualJ: number;
  readonly trail: readonly { t: number; v: number; x: number }[];
}

export function computeAnalyticPureEmStopDistance(params: EmLaunchRegenParams): number {
  const M = Math.max(1, params.massKg);
  const BL = Math.max(0.1, params.bFieldT * params.trackSpanM);
  const rTotal = Math.max(0.05, params.circuitResOhm + params.loadResOhm);
  return (M * Math.max(0, params.v0Mps) * rTotal) / (BL * BL);
}

export function createInitialState(params: EmLaunchRegenParams): EmLaunchRegenState {
  const M = Math.max(1, params.massKg);
  if (params.mode === 'railgun') {
    const C = Math.max(1e-3, params.capacitanceF);
    const q0 = C * Math.max(0, params.capVoltageV);
    const eCap0 = params.driveMode === 'capacitor-pulse' ? 0.5 * C * params.capVoltageV * params.capVoltageV : 0;
    return {
      t: 0,
      x: 0,
      v: 0,
      qCapC: q0,
      currentA: 0,
      energyInitialJ: eCap0,
      energyInputWorkJ: 0,
      energyKineticJ: 0,
      energyCapJ: eCap0,
      energyJouleJ: 0,
      energyRegenJ: 0,
      energyDragMechJ: 0,
      ledgerResidualJ: 0,
      trail: [{ t: 0, v: 0, x: 0 }]
    };
  }

  const ke0 = 0.5 * M * params.v0Mps * params.v0Mps;
  const brakingBL = Math.max(0.05, params.bFieldT * params.trackSpanM);
  const brakingResistance = Math.max(0.02, params.circuitResOhm) + Math.max(0, params.loadResOhm);
  return {
    t: 0,
    x: 0,
    v: params.v0Mps,
    qCapC: 0,
    currentA: brakingBL * params.v0Mps / brakingResistance,
    energyInitialJ: ke0,
    energyInputWorkJ: 0,
    energyKineticJ: ke0,
    energyCapJ: 0,
    energyJouleJ: 0,
    energyRegenJ: 0,
    energyDragMechJ: 0,
    ledgerResidualJ: 0,
    trail: [{ t: 0, v: params.v0Mps, x: 0 }]
  };
}

export function stepEmLaunchRegen(
  state: EmLaunchRegenState,
  params: EmLaunchRegenParams,
  dt: number
): StepResult<EmLaunchRegenState> {
  if (!Number.isFinite(dt) || dt < 0) throw new Error(`Invalid dt: ${dt}`);
  if (dt === 0) return { nextState: state, events: [] };

  const M = Math.max(1, params.massKg);
  const BL = Math.max(0.05, params.bFieldT * params.trackSpanM);
  const C = Math.max(1e-3, params.capacitanceF);
  const rInt = Math.max(0.02, params.circuitResOhm);
  const rLoad = Math.max(0, params.loadResOhm);
  const rTotal = rInt + rLoad;
  const kd = Math.max(0, params.aeroDragCoeff);
  const fMech = Math.max(0, params.mechBrakeN);

  // y = [x, v, qCapC, eIn, eJoule, eRegen, eDragMech]
  const y0: readonly number[] = [
    state.x,
    state.v,
    state.qCapC,
    state.energyInputWorkJ,
    state.energyJouleJ,
    state.energyRegenJ,
    state.energyDragMechJ
  ];

  const deriv = (_t: number, st: readonly number[]): number[] => {
    const v = st[1]!;
    const qC = st[2]!;
    if (params.mode === 'railgun') {
      const i =
        params.driveMode === 'capacitor-pulse'
          ? Math.max(0, (qC / C - BL * v) / rInt)
          : Math.max(0, params.driveCurrentA);
      const uTerm = params.driveMode === 'capacitor-pulse' ? qC / C : i * rInt + BL * v;
      const fDrag = kd * v * Math.abs(v);
      const a = (BL * i - fDrag) / M;
      const dQCap = params.driveMode === 'capacitor-pulse' ? -i : 0;
      const dEin = params.driveMode === 'capacitor-pulse' ? 0 : uTerm * i;
      const dJoule = i * i * rInt;
      const dDrag = fDrag * v;
      return [v, a, dQCap, dEin, dJoule, 0, dDrag];
    }

    // Regen brake
    if (v <= 1e-12) return [0, 0, 0, 0, 0, 0, 0];
    const i = (BL * v) / rTotal;
    const fEm = BL * i;
    const fDrag = kd * v * v + fMech;
    const a = -(fEm + fDrag) / M;
    return [v, a, 0, 0, i * i * rInt, i * i * rLoad, fDrag * v];
  };

  const res = integrateAdaptiveRK45(y0, state.t, dt, deriv, {
    absTol: 1e-11,
    relTol: 1e-11,
    maxSubsteps: 10000
  });
  const y =
    params.mode === 'regen-brake' && res.state[1]! <= 0
      ? [res.state[0]!, 0, 0, res.state[3]!, res.state[4]!, res.state[5]!, res.state[6]!]
      : res.state;
  const simT = res.t;

  const nextX = y[0]!;
  const nextV = y[1]!;
  const nextQ = y[2]!;
  const nextEin = y[3]!;
  const nextJoule = y[4]!;
  const nextRegen = y[5]!;
  const nextDrag = y[6]!;

  const ke = 0.5 * M * nextV * nextV;
  const eCap = params.mode === 'railgun' && params.driveMode === 'capacitor-pulse' ? (nextQ * nextQ) / (2 * C) : 0;
  const totalIn = state.energyInitialJ + nextEin;
  const totalOut = ke + eCap + nextJoule + nextRegen + nextDrag;
  const residual = Math.abs(totalIn - totalOut);

  const curI =
    params.mode === 'railgun'
      ? params.driveMode === 'capacitor-pulse'
        ? Math.max(0, (nextQ / C - BL * nextV) / rInt)
        : params.driveCurrentA
      : (BL * nextV) / rTotal;

  return {
    nextState: {
      t: simT,
      x: nextX,
      v: nextV,
      qCapC: nextQ,
      currentA: curI,
      energyInitialJ: state.energyInitialJ,
      energyInputWorkJ: nextEin,
      energyKineticJ: ke,
      energyCapJ: eCap,
      energyJouleJ: nextJoule,
      energyRegenJ: nextRegen,
      energyDragMechJ: nextDrag,
      ledgerResidualJ: residual,
      trail: [...state.trail.slice(-140), { t: simT, v: nextV, x: nextX }]
    },
    events: []
  };
}

export function computeObservables(state: EmLaunchRegenState, params?: EmLaunchRegenParams): Record<string, number> {
  return {
    ...(params?.mode==='regen-brake' ? {
      energyInitialKj: state.energyInitialJ / 1000,
      energyJouleKj: state.energyJouleJ / 1000,
      energyDragMechKj: state.energyDragMechJ / 1000,
      ...(state.energyInitialJ>0 ? { loadTransferFraction: state.energyRegenJ/state.energyInitialJ } : {})
    } : {}),
    t: state.t,
    x: state.x,
    v: state.v,
    currentA: state.currentA,
    energyKineticKj: state.energyKineticJ / 1000,
    energyRegenKj: state.energyRegenJ / 1000,
    ledgerResidualJ: state.ledgerResidualJ
  };
}

export function checkInvariants(state: EmLaunchRegenState): InvariantReport[] {
  return [
    {
      name: '电磁发射/再生制动全能量账本残差 (J)',
      measuredError: state.ledgerResidualJ,
      tolerance: 1e-6,
      passed: state.ledgerResidualJ < 1e-6,
      unit: 'J'
    }
  ];
}
