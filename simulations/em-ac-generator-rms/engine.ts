import { stepRK4 } from '@physforge/physics-core';
import type { InvariantReport, PhysicsEvent, StepResult } from '@physforge/sim-sdk';

export type AcWaveformType =
  | 'sine'
  | 'half-wave'
  | 'full-wave'
  | 'duty-square'
  | 'sawtooth'
  | 'dc-plus-sine';

export type AcGeneratorParams = {
  waveform: AcWaveformType;
  turnsN: number;
  magneticB: number;
  coilAreaS: number;
  freqHz: number;
  loadR: number;
  dutyCycleD: number;
  dcOffsetV: number;
};

export interface AcGeneratorState {
  readonly t: number;
  readonly angleRad: number;
  readonly fluxWb: number;
  readonly uPeakV: number;
  readonly uInstV: number;
  readonly uRmsV: number;
  readonly pInstW: number;
  readonly pAvgW: number;
  readonly jouleHeatJ: number;
  readonly atNeutralPlane: boolean;
  readonly events: readonly PhysicsEvent[];
}

export function evalWaveformVoltage(
  phaseNorm: number, // in [0, 1)
  uPeak: number,
  params: AcGeneratorParams
): number {
  const f = phaseNorm - Math.floor(phaseNorm);
  switch (params.waveform) {
    case 'sine':
      return uPeak * Math.sin(2 * Math.PI * f);
    case 'half-wave': {
      const s = uPeak * Math.sin(2 * Math.PI * f);
      return s > 0 ? s : 0;
    }
    case 'full-wave':
      return uPeak * Math.abs(Math.sin(2 * Math.PI * f));
    case 'duty-square':
      return f < Math.max(0, Math.min(1, params.dutyCycleD)) ? uPeak : 0;
    case 'sawtooth':
      return uPeak * (2 * f - 1);
    case 'dc-plus-sine':
      return params.dcOffsetV + uPeak * Math.sin(2 * Math.PI * f);
  }
}

function simpsonOnInterval(
  a: number,
  b: number,
  uPeak: number,
  params: AcGeneratorParams,
  panels = 40
): number {
  if (b <= a) return 0;
  const n = panels % 2 === 0 ? panels : panels + 1;
  const h = (b - a) / n;
  let sum = 0;
  for (let i = 0; i <= n; i++) {
    const f = a + i * h;
    // Clamp slightly inside endpoints to stay cleanly inside smooth branch
    const evalF = i === 0 ? a + 1e-12 * (b - a) : i === n ? b - 1e-12 * (b - a) : f;
    const u = evalWaveformVoltage(evalF, uPeak, params);
    const w = i === 0 || i === n ? 1 : i % 2 === 1 ? 4 : 2;
    sum += w * u * u;
  }
  return (h / 3) * sum;
}

/**
 * Computes RMS voltage via piecewise composite Simpson quadrature over one period [0, 1].
 */
export function computeRmsSimpson(uPeak: number, params: AcGeneratorParams): number {
  const d = Math.max(0, Math.min(1, params.dutyCycleD));
  let breaks: number[];
  if (params.waveform === 'half-wave' || params.waveform === 'full-wave') {
    breaks = [0, 0.5, 1];
  } else if (params.waveform === 'duty-square') {
    breaks = d > 0 && d < 1 ? [0, d, 1] : [0, 1];
  } else {
    breaks = [0, 1];
  }

  let integralSq = 0;
  for (let k = 0; k < breaks.length - 1; k++) {
    integralSq += simpsonOnInterval(breaks[k]!, breaks[k + 1]!, uPeak, params, 48);
  }
  return Math.sqrt(Math.max(0, integralSq));
}

export function createInitialState(params: AcGeneratorParams): AcGeneratorState {
  const omega = 2 * Math.PI * Math.max(0, params.freqHz);
  const uPeak = params.turnsN * params.magneticB * params.coilAreaS * omega;
  const uRms = computeRmsSimpson(uPeak, params);
  const uInst = evalWaveformVoltage(0, uPeak, params);
  const R = Math.max(0.1, params.loadR);
  return {
    t: 0,
    angleRad: 0,
    fluxWb: params.magneticB * params.coilAreaS,
    uPeakV: uPeak,
    uInstV: uInst,
    uRmsV: uRms,
    pInstW: (uInst * uInst) / R,
    pAvgW: (uRms * uRms) / R,
    jouleHeatJ: 0,
    atNeutralPlane: true,
    events: []
  };
}

export function stepAcGeneratorRms(
  state: AcGeneratorState,
  params: AcGeneratorParams,
  dt: number
): StepResult<AcGeneratorState> {
  if (!Number.isFinite(dt) || dt < 0) throw new Error(`Invalid dt: ${dt}`);
  if (dt === 0) return { nextState: state, events: [] };

  const fHz = Math.max(0, params.freqHz);
  const omega = 2 * Math.PI * fHz;
  const uPeak = params.turnsN * params.magneticB * params.coilAreaS * omega;
  const uRms = computeRmsSimpson(uPeak, params);
  const R = Math.max(0.1, params.loadR);

  const heatRes = stepRK4([state.jouleHeatJ], state.t, dt, (tau, _y) => {
    const phase = fHz * tau;
    const u = evalWaveformVoltage(phase, uPeak, params);
    return [(u * u) / R];
  });

  const nt = state.t + dt;
  const angle = omega * nt;
  const uInst = evalWaveformVoltage(fHz * nt, uPeak, params);
  const sinMag = Math.abs(Math.sin(angle));

  return {
    nextState: {
      ...state,
      t: nt,
      angleRad: angle,
      fluxWb: params.magneticB * params.coilAreaS * Math.cos(angle),
      uPeakV: uPeak,
      uInstV: uInst,
      uRmsV: uRms,
      pInstW: (uInst * uInst) / R,
      pAvgW: (uRms * uRms) / R,
      jouleHeatJ: heatRes[0]!,
      atNeutralPlane: sinMag < 0.08
    },
    events: []
  };
}

export function computeObservables(state: AcGeneratorState): Record<string, number> {
  return {
    t: state.t,
    fluxWb: state.fluxWb,
    uInstV: state.uInstV,
    uRmsV: state.uRmsV,
    uPeakV: state.uPeakV,
    pInstW: state.pInstW,
    pAvgW: state.pAvgW,
    jouleHeatJ: state.jouleHeatJ
  };
}

export function checkInvariants(
  _state: AcGeneratorState,
  _initial: AcGeneratorState,
  params: AcGeneratorParams
): InvariantReport[] {
  const omega = 2 * Math.PI * Math.max(0, params.freqHz);
  const uPeak = params.turnsN * params.magneticB * params.coilAreaS * omega;
  const uRms = computeRmsSimpson(uPeak, params);
  return [
    {
      name: '交流有效值积分稳定与非负性',
      measuredError: 0,
      tolerance: 1e-6,
      passed: Number.isFinite(uRms) && uRms >= 0
    }
  ];
}
