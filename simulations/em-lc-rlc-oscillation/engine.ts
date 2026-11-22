import { bisectEvent, stepRK4 } from '@physforge/physics-core';
import type { InvariantReport, PhysicsEvent, StepResult } from '@physforge/sim-sdk';

export type LcRlcMode = 'lc-undamped' | 'rlc-damped' | 'rlc-ac-resonance';

export type LcRlcParams = {
  mode: LcRlcMode;
  inductanceH: number;
  capacitanceF: number;
  resistanceR: number;
  initialChargeC: number;
  driveVoltAmpUm: number;
  driveOmega: number;
};

export interface LcRlcState {
  readonly t: number;
  readonly chargeQ: number;
  readonly currentI: number;
  readonly energyElectricJ: number;
  readonly energyMagneticJ: number;
  readonly initialEnergyJ: number;
  readonly measuredPeriod: number | null;
  readonly lastUpwardCrossT: number | null;
  readonly events: readonly PhysicsEvent[];
}

export function computeLcNaturalOmega(params: LcRlcParams): number {
  const L = Math.max(1e-4, params.inductanceH);
  const C = Math.max(1e-6, params.capacitanceF);
  return 1 / Math.sqrt(L * C);
}

export function computeImpedanceSummary(params: LcRlcParams): {
  xl: number;
  xc: number;
  zMag: number;
  phaseRad: number;
  steadyCurrentPeak: number;
} {
  const L = Math.max(1e-4, params.inductanceH);
  const C = Math.max(1e-6, params.capacitanceF);
  const R = params.mode === 'lc-undamped' ? 0 : Math.max(0.05, params.resistanceR);
  const w = Math.max(0.1, params.driveOmega);
  const xl = w * L;
  const xc = 1 / (w * C);
  const zMag = Math.hypot(R, xl - xc);
  return {
    xl,
    xc,
    zMag,
    phaseRad: Math.atan2(xl - xc, R),
    steadyCurrentPeak: zMag > 1e-9 ? params.driveVoltAmpUm / zMag : 0
  };
}

export function createInitialState(params: LcRlcParams): LcRlcState {
  const q0 = params.mode === 'rlc-ac-resonance' ? 0 : params.initialChargeC;
  const C = Math.max(1e-6, params.capacitanceF);
  const ee = (q0 * q0) / (2 * C);
  return {
    t: 0,
    chargeQ: q0,
    currentI: 0,
    energyElectricJ: ee,
    energyMagneticJ: 0,
    initialEnergyJ: ee,
    measuredPeriod: null,
    lastUpwardCrossT: null,
    events: []
  };
}

interface LcSubState {
  readonly t: number;
  readonly q: number;
  readonly i: number;
}

export function stepLcRlcOscillation(
  state: LcRlcState,
  params: LcRlcParams,
  dt: number
): StepResult<LcRlcState> {
  if (!Number.isFinite(dt) || dt < 0) throw new Error(`Invalid dt: ${dt}`);
  if (dt === 0) return { nextState: state, events: [] };

  const L = Math.max(1e-4, params.inductanceH);
  const C = Math.max(1e-6, params.capacitanceF);
  const R = params.mode === 'lc-undamped' ? 0 : Math.max(0, params.resistanceR);
  const um = params.mode === 'rlc-ac-resonance' ? params.driveVoltAmpUm : 0;
  const wd = params.driveOmega;

  const t0Natural = 2 * Math.PI * Math.sqrt(L * C);
  const maxSub = Math.min(0.002, t0Natural / 250);
  const nSub = Math.max(1, Math.ceil(dt / maxSub));
  const subH = dt / nSub;

  const advSub = (s: LcSubState, h: number): LcSubState => {
    const next = stepRK4([s.q, s.i], s.t, h, (tau, qi) => [
      qi[1]!,
      (um * Math.cos(wd * tau) - R * qi[1]! - qi[0]! / C) / L
    ]);
    return { t: s.t + h, q: next[0]!, i: next[1]! };
  };

  let cur: LcSubState = { t: state.t, q: state.chargeQ, i: state.currentI };
  let lastCross = state.lastUpwardCrossT;
  let measuredPeriod = state.measuredPeriod;
  const events: PhysicsEvent[] = [];

  for (let k = 0; k < nSub; k++) {
    const next = advSub(cur, subH);
    if (cur.q < 0 && next.q >= 0 && next.i > 0) {
      const hit = bisectEvent(cur, cur.t, subH, advSub, (s) => s.q, {
        timeTolerance: 1e-10,
        biasEndpoint: 'midpoint'
      });
      if (hit) {
        if (lastCross !== null && hit.time - lastCross > t0Natural * 0.25) {
          measuredPeriod = hit.time - lastCross;
        }
        lastCross = hit.time;
      }
    }
    cur = next;
  }

  const ee = (cur.q * cur.q) / (2 * C);
  const eb = 0.5 * L * cur.i * cur.i;

  return {
    nextState: {
      ...state,
      t: cur.t,
      chargeQ: cur.q,
      currentI: cur.i,
      energyElectricJ: ee,
      energyMagneticJ: eb,
      measuredPeriod,
      lastUpwardCrossT: lastCross
    },
    events
  };
}

export function computeObservables(state: LcRlcState): Record<string, number> {
  return {
    t: state.t,
    chargeQ: state.chargeQ,
    currentI: state.currentI,
    energyElectricJ: state.energyElectricJ,
    energyMagneticJ: state.energyMagneticJ,
    totalEmEnergyJ: state.energyElectricJ + state.energyMagneticJ,
    measuredPeriod: state.measuredPeriod ?? 0
  };
}

export function checkInvariants(
  state: LcRlcState,
  _initial: LcRlcState,
  params: LcRlcParams
): InvariantReport[] {
  const total = state.energyElectricJ + state.energyMagneticJ;
  if (params.mode === 'lc-undamped' && state.initialEnergyJ > 1e-12) {
    const err = Math.abs(total - state.initialEnergyJ) / state.initialEnergyJ;
    return [
      {
        name: '无阻尼 LC 电磁能量守恒 (E_E + E_B)',
        measuredError: err,
        tolerance: 1e-5,
        passed: Number.isFinite(err) && err < 1e-5
      }
    ];
  }
  return [
    {
      name: 'RLC 电路数值稳定性检定',
      measuredError: 0,
      tolerance: 1e-6,
      passed: Number.isFinite(total)
    }
  ];
}
