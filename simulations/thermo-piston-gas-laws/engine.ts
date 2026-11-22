import {
  CLASSROOM_GRAVITY,
  degToRad,
  stepHybridAutomaton,
  type HybridGuard
} from '@physforge/physics-core';
import type { InvariantReport, PhysicsEvent, StepResult } from '@physforge/sim-sdk';

export const R_GAS = 8.31446261815324;
export const P_ATM = 101325;
export const CM_HG_TO_PA = P_ATM / 76;

export type ThermoGasMode = 'stop-pin-cylinder' | 'mercury-tube-tilt' | 'multi-stroke-pump';

export type ThermoGasParams = {
  mode: ThermoGasMode;
  molesN: number;
  targetTempK: number;
  heatingRateKPerS: number;
  pistonAreaCm2: number;
  pistonMassKg: number;
  pinVolumeL: number;
  tubeTiltDeg: number;
  mercuryCm: number;
  tubeLengthCm: number;
  tankVolumeL: number;
  pumpDeltaVL: number;
  pumpStrokesK: number;
  pumpDirection: 'extract' | 'inject';
};

export interface ThermoGasState {
  readonly t: number;
  readonly mode: 'pinned' | 'floating';
  readonly temperatureK: number;
  readonly pressurePa: number;
  readonly volumeM3: number;
  readonly molesN: number;
  readonly mercuryColumnCm: number;
  readonly airColumnCm: number;
  readonly overflowed: boolean;
  readonly detachTempK: number | null;
  readonly pvHistory: readonly { vL: number; pKPa: number }[];
  readonly events: readonly PhysicsEvent[];
}

export function computeCylinderEquilibriumPressure(params: ThermoGasParams): number {
  const areaM2 = Math.max(1e-4, params.pistonAreaCm2 * 1e-4);
  return P_ATM + (Math.max(0, params.pistonMassKg) * CLASSROOM_GRAVITY) / areaM2;
}

export function computeDetachCriticalTempK(params: ThermoGasParams): number {
  const pEq = computeCylinderEquilibriumPressure(params);
  const vPinM3 = Math.max(1e-4, params.pinVolumeL * 1e-3);
  const n = Math.max(0.01, params.molesN);
  return (pEq * vPinM3) / (n * R_GAS);
}

export function computeMultiStrokePressure(params: ThermoGasParams): number {
  const V = Math.max(0.1, params.tankVolumeL);
  const dV = Math.max(0.01, params.pumpDeltaVL);
  const k = Math.max(0, Math.round(params.pumpStrokesK));
  if (params.pumpDirection === 'extract') {
    let p = P_ATM;
    for (let i = 0; i < k; i++) {
      p = (p * V) / (V + dV);
    }
    return p;
  }
  return P_ATM + k * P_ATM * (dV / V);
}

function solveMercuryTiltState(params: ThermoGasParams): {
  pressurePa: number;
  airCm: number;
  mercCm: number;
  overflowed: boolean;
} {
  const L = Math.max(30, params.tubeLengthCm);
  const hHg = Math.max(5, Math.min(35, params.mercuryCm));
  // Reference horizontal equilibrium at t0: L_air0 = 30 cm at P_ATM
  const L0 = Math.min(L - hHg - 2, 30);
  const sinTh = Math.sin(degToRad(params.tubeTiltDeg));
  const pMerc = hHg * sinTh * CM_HG_TO_PA;
  const p = Math.max(0.15 * P_ATM, P_ATM + pMerc);
  const airCmRaw = (P_ATM * L0) / p;
  const overflowed = airCmRaw + hHg > L;
  const mercCm = overflowed ? Math.max(0, L - airCmRaw) : hHg;
  return {
    pressurePa: P_ATM + mercCm * sinTh * CM_HG_TO_PA,
    airCm: Math.min(L, airCmRaw),
    mercCm,
    overflowed
  };
}

export function createInitialState(params: ThermoGasParams): ThermoGasState {
  const n = Math.max(0.01, params.molesN);
  if (params.mode === 'mercury-tube-tilt') {
    const m = solveMercuryTiltState(params);
    const vM3 = (m.airCm / 100) * Math.max(1e-4, params.pistonAreaCm2 * 1e-4);
    const nEff = (m.pressurePa * vM3) / (R_GAS * Math.max(100, params.targetTempK));
    return {
      t: 0,
      mode: 'floating',
      temperatureK: Math.max(100, params.targetTempK),
      pressurePa: m.pressurePa,
      volumeM3: vM3,
      molesN: nEff,
      mercuryColumnCm: m.mercCm,
      airColumnCm: m.airCm,
      overflowed: m.overflowed,
      detachTempK: null,
      pvHistory: [{ vL: vM3 * 1000, pKPa: m.pressurePa / 1000 }],
      events: []
    };
  }

  if (params.mode === 'multi-stroke-pump') {
    const pPa = computeMultiStrokePressure(params);
    const vM3 = Math.max(0.1, params.tankVolumeL) * 1e-3;
    const T = Math.max(100, params.targetTempK);
    const nNow = (pPa * vM3) / (R_GAS * T);
    return {
      t: 0,
      mode: 'pinned',
      temperatureK: T,
      pressurePa: pPa,
      volumeM3: vM3,
      molesN: nNow,
      mercuryColumnCm: 0,
      airColumnCm: 0,
      overflowed: false,
      detachTempK: null,
      pvHistory: [{ vL: vM3 * 1000, pKPa: pPa / 1000 }],
      events: []
    };
  }

  // Stop-pin vertical cylinder starting below critical temp at pinned volume
  const vPinM3 = Math.max(1e-4, params.pinVolumeL * 1e-3);
  const T0 = Math.min(params.targetTempK, 260);
  const pEq = computeCylinderEquilibriumPressure(params);
  const tCrit = computeDetachCriticalTempK(params);
  const isFloating = T0 >= tCrit;
  const p0 = isFloating ? pEq : (n * R_GAS * T0) / vPinM3;
  const v0 = isFloating ? (n * R_GAS * T0) / pEq : vPinM3;

  return {
    t: 0,
    mode: isFloating ? 'floating' : 'pinned',
    temperatureK: T0,
    pressurePa: p0,
    volumeM3: v0,
    molesN: n,
    mercuryColumnCm: 0,
    airColumnCm: 0,
    overflowed: false,
    detachTempK: isFloating ? T0 : null,
    pvHistory: [{ vL: v0 * 1000, pKPa: p0 / 1000 }],
    events: []
  };
}

export function stepThermoGasLaws(
  state: ThermoGasState,
  params: ThermoGasParams,
  dt: number
): StepResult<ThermoGasState> {
  if (!Number.isFinite(dt) || dt < 0) throw new Error(`Invalid dt: ${dt}`);
  if (dt === 0) return { nextState: state, events: [] };

  if (params.mode === 'mercury-tube-tilt') {
    const m = solveMercuryTiltState(params);
    const T = Math.max(100, params.targetTempK);
    const vM3 = (m.airCm / 100) * Math.max(1e-4, params.pistonAreaCm2 * 1e-4);
    const nEff = (m.pressurePa * vM3) / (R_GAS * T);
    return {
      nextState: {
        ...state,
        t: state.t + dt,
        temperatureK: T,
        pressurePa: m.pressurePa,
        volumeM3: vM3,
        molesN: nEff,
        mercuryColumnCm: m.mercCm,
        airColumnCm: m.airCm,
        overflowed: m.overflowed
      },
      events: []
    };
  }

  if (params.mode === 'multi-stroke-pump') {
    const pPa = computeMultiStrokePressure(params);
    const vM3 = Math.max(0.1, params.tankVolumeL) * 1e-3;
    const T = Math.max(100, params.targetTempK);
    const nNow = (pPa * vM3) / (R_GAS * T);
    return {
      nextState: {
        ...state,
        t: state.t + dt,
        temperatureK: T,
        pressurePa: pPa,
        volumeM3: vM3,
        molesN: nNow,
        pvHistory: [...state.pvHistory.slice(-120), { vL: vM3 * 1000, pKPa: pPa / 1000 }]
      },
      events: []
    };
  }

  // Stop-pin cylinder heating/cooling via HybridAutomaton
  const n = Math.max(0.01, params.molesN);
  const vPinM3 = Math.max(1e-4, params.pinVolumeL * 1e-3);
  const pEq = computeCylinderEquilibriumPressure(params);

  const guards: HybridGuard<'pinned' | 'floating', ThermoGasState>[] = [
    {
      id: 'detach-pin',
      label: '活塞脱离下卡口转为等压膨胀',
      fromModes: ['pinned'],
      biasEndpoint: 'positive',
      eventFn: (s) => (n * R_GAS * s.temperatureK) / vPinM3 - pEq,
      reset: (boundaryState) => ({
        nextState: {
          ...boundaryState,
          mode: 'floating',
          pressurePa: pEq,
          volumeM3: (n * R_GAS * boundaryState.temperatureK) / pEq,
          detachTempK: boundaryState.temperatureK
        },
        metrics: { detachTempK: boundaryState.temperatureK }
      })
    },
    {
      id: 'hit-pin',
      label: '降温回落触及下卡口转为等容降温',
      fromModes: ['floating'],
      biasEndpoint: 'positive',
      eventFn: (s) => vPinM3 - (n * R_GAS * s.temperatureK) / pEq,
      reset: (boundaryState) => ({
        nextState: {
          ...boundaryState,
          mode: 'pinned',
          volumeM3: vPinM3,
          pressurePa: (n * R_GAS * boundaryState.temperatureK) / vPinM3
        },
        metrics: { hitTempK: boundaryState.temperatureK }
      })
    }
  ];

  const advanceContinuous = (s: ThermoGasState, h: number): ThermoGasState => {
    const dTMax = params.heatingRateKPerS * h;
    const diff = params.targetTempK - s.temperatureK;
    const nextT = Math.abs(diff) <= Math.abs(dTMax) ? params.targetTempK : s.temperatureK + Math.sign(diff) * Math.abs(dTMax);
    if (s.mode === 'pinned') {
      return {
        ...s,
        t: s.t + h,
        temperatureK: nextT,
        volumeM3: vPinM3,
        pressurePa: (n * R_GAS * nextT) / vPinM3
      };
    }
    return {
      ...s,
      t: s.t + h,
      temperatureK: nextT,
      pressurePa: pEq,
      volumeM3: (n * R_GAS * nextT) / pEq
    };
  };

  const outcome = stepHybridAutomaton<'pinned' | 'floating', ThermoGasState>(
    {
      advanceContinuous,
      guards,
      timeTolerance: 1e-9
    },
    state,
    dt
  );

  const ns = outcome.nextState;
  const newEvents: PhysicsEvent[] = outcome.events.map((e) => ({
    id: e.id,
    time: e.time,
    label: e.label,
    metrics: e.metrics
  }));
  const pvPt = { vL: ns.volumeM3 * 1000, pKPa: ns.pressurePa / 1000 };
  const lastPv = ns.pvHistory[ns.pvHistory.length - 1];
  const append = !lastPv || Math.hypot(pvPt.vL - lastPv.vL, pvPt.pKPa - lastPv.pKPa) > 0.05;

  return {
    nextState: {
      ...ns,
      pvHistory: append ? [...ns.pvHistory.slice(-150), pvPt] : ns.pvHistory,
      events: newEvents.length > 0 ? [...ns.events, ...newEvents] : ns.events
    },
    events: newEvents
  };
}

export function computeObservables(state: ThermoGasState): Record<string, number> {
  const pvRatio = (state.pressurePa * state.volumeM3) / (state.molesN * R_GAS * state.temperatureK);
  return {
    t: state.t,
    temperatureK: state.temperatureK,
    pressureKPa: state.pressurePa / 1000,
    volumeL: state.volumeM3 * 1000,
    molesN: state.molesN,
    pvOverNrt: pvRatio,
    airColumnCm: state.airColumnCm
  };
}

export function checkInvariants(state: ThermoGasState): InvariantReport[] {
  const ratioErr = Math.abs((state.pressurePa * state.volumeM3) / (state.molesN * R_GAS * state.temperatureK) - 1);
  return [
    {
      name: '理想气体状态方程一致性 |PV/(nRT) - 1|',
      measuredError: ratioErr,
      tolerance: 1e-10,
      passed: Number.isFinite(ratioErr) && ratioErr < 1e-10
    }
  ];
}
