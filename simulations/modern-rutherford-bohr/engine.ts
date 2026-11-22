import {
  createScaleContext,
  integrateAdaptiveRK45,
  wavelengthToRgb
} from '@physforge/physics-core';
import type { InvariantReport, StepResult } from '@physforge/sim-sdk';

export const H_PLANCK = 6.62607015e-34;
export const E_CHARGE = 1.602176634e-19;
export const C_LIGHT = 299792458;
export const K_COULOMB = 8.9875517923e9;
export const M_ALPHA_KG = 6.6446573357e-27;
export const HC_EV_NM = ((H_PLANCK * C_LIGHT) / E_CHARGE) * 1e9;

export const NUCLEAR_SCALE = createScaleContext({
  lengthUnit: 1e-15, // 1 fm
  timeUnit: 1e-22,
  massUnit: M_ALPHA_KG,
  chargeUnit: E_CHARGE
});

export type AtomicMode = 'rutherford' | 'bohr';
export type BohrPopulation = 'ensemble' | 'single-atom';
export type ExcitationProbe = 'photon' | 'electron';

export type RutherfordBohrParams = {
  mode: AtomicMode;
  alphaEnergyMev: number;
  targetZ: number;
  impactParamFm: number;
  excitedLevelN: number;
  populationMode: BohrPopulation;
  probeKind: ExcitationProbe;
  probeEnergyEv: number;
};

export interface RutherfordTrajectoryResult {
  readonly kappaDimless: number;
  readonly analyticalAngleDeg: number;
  readonly simulatedAngleDeg: number;
  readonly angleErrorRad: number;
  readonly energyDriftRel: number;
  readonly minDistanceFm: number;
  readonly trajectoryFm: readonly { x: number; y: number }[];
}

export interface BohrLine {
  readonly upperN: number;
  readonly lowerN: number;
  readonly deltaEv: number;
  readonly wavelengthNm: number;
  readonly seriesName: string;
  readonly hex: string;
}

export interface BohrAnalysisResult {
  readonly totalCombinationLines: number;
  readonly maxSingleAtomLines: number;
  readonly excitationAccepted: boolean;
  readonly reachedLevel: number;
  readonly residualElectronEv: number;
  readonly ionized: boolean;
  readonly spectralLines: readonly BohrLine[];
}

export interface RutherfordBohrState {
  readonly t: number;
  readonly rutherford: RutherfordTrajectoryResult;
  readonly bohr: BohrAnalysisResult;
  readonly animCursor: number;
}

export function bohrEnergyEv(n: number): number {
  const nSafe = Math.max(1, Math.round(n));
  return -13.6 / (nSafe * nSafe);
}

export function computeRutherfordAnalyticalAngleRad(
  alphaEnergyMev: number,
  targetZ: number,
  impactParamFm: number
): number {
  if (impactParamFm === 0) return Math.PI;
  const kJ = Math.max(0.2, alphaEnergyMev) * 1e6 * E_CHARGE;
  const bM = Math.abs(impactParamFm) * 1e-15;
  const z1 = 2;
  const z2 = Math.max(1, targetZ);
  const numerator = K_COULOMB * z1 * z2 * E_CHARGE * E_CHARGE;
  return 2 * Math.atan(numerator / (2 * kJ * bM));
}

export function solveRutherfordScattering(
  alphaEnergyMev: number,
  targetZ: number,
  impactParamFm: number
): RutherfordTrajectoryResult {
  const kMev = Math.max(0.2, alphaEnergyMev);
  const z1 = 2;
  const z2 = Math.max(1, Math.round(targetZ));
  const bAbs = Math.abs(impactParamFm);
  const bSign = impactParamFm >= 0 ? 1 : -1;

  const kJ = kMev * 1e6 * E_CHARGE;
  const kDimless = NUCLEAR_SCALE.toDimless(kJ, 'energy');
  const kappaDimless =
    (K_COULOMB * z1 * z2 * E_CHARGE * E_CHARGE) / (NUCLEAR_SCALE.energyUnit * NUCLEAR_SCALE.lengthUnit);

  if (bAbs < 1e-6) {
    const rMin = kappaDimless / kDimless;
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i <= 20; i++) {
      pts.push({ x: -160 + (i / 20) * (rMin + 160), y: 0 });
    }
    return {
      kappaDimless,
      analyticalAngleDeg: 180,
      simulatedAngleDeg: 180,
      angleErrorRad: 0,
      energyDriftRel: 0,
      minDistanceFm: rMin,
      trajectoryFm: pts
    };
  }

  // Start far upstream at r0 ~ 2e6 fm so incoming/outgoing finite-radius Coulomb truncation O(d/R0) < 2e-5 rad
  const xStart = -2_000_000;
  const yStart = impactParamFm;
  const rStart = Math.hypot(xStart, yStart);
  const speed0 = Math.sqrt(Math.max(1e-9, 2 * (kDimless - kappaDimless / rStart)));
  const e0 = 0.5 * speed0 * speed0 + kappaDimless / rStart;

  const derivative = (_t: number, y: readonly number[]): number[] => {
    const px = y[0]!;
    const py = y[1]!;
    const r2 = Math.max(1e-8, px * px + py * py);
    const invR3 = kappaDimless / (r2 * Math.sqrt(r2));
    return [y[2]!, y[3]!, px * invR3, py * invR3];
  };

  let stateVec: readonly number[] = [xStart, yStart, speed0, 0];
  let simT = 0;
  let minDistanceFm = rStart;
  const viewPoints: { x: number; y: number }[] = [];

  // Phase 1: fast approach from -2e6 fm to -250 fm
  const approachDt = (Math.abs(xStart) - 250) / speed0;
  const p1 = integrateAdaptiveRK45(stateVec, simT, approachDt, derivative, {
    absTol: 1e-11,
    relTol: 1e-10,
    maxSubsteps: 10000
  });
  stateVec = p1.state;
  simT = p1.t;

  // Phase 2: close encounter sampling within view region (-250 fm .. +250 fm)
  const chunkDt = Math.max(1.5, 4.5 / speed0);
  for (let step = 0; step < 260; step++) {
    const rNow = Math.hypot(stateVec[0]!, stateVec[1]!);
    if (rNow < minDistanceFm) minDistanceFm = rNow;
    if (Math.abs(stateVec[0]!) <= 180 && Math.abs(stateVec[1]!) <= 180) {
      viewPoints.push({ x: stateVec[0]!, y: stateVec[1]! });
    }
    const outwardV = stateVec[0]! * stateVec[2]! + stateVec[1]! * stateVec[3]!;
    if (rNow > 260 && outwardV > 0 && stateVec[0]! > 0) break;
    const res = integrateAdaptiveRK45(stateVec, simT, chunkDt, derivative, {
      absTol: 1e-11,
      relTol: 1e-10,
      maxSubsteps: 2000
    });
    stateVec = res.state;
    simT = res.t;
  }

  // Phase 3: coast far out to R ~ 25000 fm to extract true asymptotic scattering angle
  const p3 = integrateAdaptiveRK45(stateVec, simT, approachDt, derivative, {
    absTol: 1e-11,
    relTol: 1e-10,
    maxSubsteps: 10000
  });
  stateVec = p3.state;

  const vxOut = stateVec[2]!;
  const vyOut = stateVec[3]!;
  const rEnd = Math.hypot(stateVec[0]!, stateVec[1]!);
  const eEnd = 0.5 * (vxOut * vxOut + vyOut * vyOut) + kappaDimless / rEnd;
  const energyDriftRel = Math.abs(eEnd - e0) / Math.abs(e0);

  const simAngleRad = Math.atan2(bSign * vyOut, vxOut);
  const simPosAngle = Math.abs(simAngleRad);
  const anaAngleRad = computeRutherfordAnalyticalAngleRad(kMev, z2, impactParamFm);

  return {
    kappaDimless,
    analyticalAngleDeg: (anaAngleRad * 180) / Math.PI,
    simulatedAngleDeg: (simPosAngle * 180) / Math.PI,
    angleErrorRad: Math.abs(simPosAngle - anaAngleRad),
    energyDriftRel,
    minDistanceFm,
    trajectoryFm: viewPoints
  };
}

export function solveBohrTransitions(params: RutherfordBohrParams): BohrAnalysisResult {
  const nMax = Math.max(2, Math.min(8, Math.round(params.excitedLevelN)));
  const spectralLines: BohrLine[] = [];

  for (let upper = nMax; upper >= 2; upper--) {
    for (let lower = upper - 1; lower >= 1; lower--) {
      const deltaEv = bohrEnergyEv(upper) - bohrEnergyEv(lower);
      const wavelengthNm = HC_EV_NM / deltaEv;
      const seriesName = lower === 1 ? '赖曼系(UV)' : lower === 2 ? '巴耳末系(可见光)' : '帕邢系(IR)';
      const color =
        wavelengthNm >= 380 && wavelengthNm <= 780
          ? wavelengthToRgb(wavelengthNm).hex
          : wavelengthNm < 380
            ? '#a855f7'
            : '#ef4444';
      spectralLines.push({
        upperN: upper,
        lowerN: lower,
        deltaEv,
        wavelengthNm,
        seriesName,
        hex: color
      });
    }
  }

  // Excitation from ground state n=1 with probeEnergyEv
  const eProbe = Math.max(0, params.probeEnergyEv);
  let excitationAccepted = false;
  let reachedLevel = 1;
  let residualElectronEv = 0;
  let ionized = false;

  if (eProbe >= 13.6) {
    excitationAccepted = true;
    ionized = true;
    reachedLevel = nMax;
    residualElectronEv = eProbe - 13.6;
  } else if (params.probeKind === 'photon') {
    for (let target = 2; target <= 8; target++) {
      const needEv = bohrEnergyEv(target) - bohrEnergyEv(1);
      if (Math.abs(eProbe - needEv) <= 0.03) {
        excitationAccepted = true;
        reachedLevel = target;
        break;
      }
    }
  } else {
    for (let target = 8; target >= 2; target--) {
      const needEv = bohrEnergyEv(target) - bohrEnergyEv(1);
      if (eProbe >= needEv) {
        excitationAccepted = true;
        reachedLevel = target;
        residualElectronEv = eProbe - needEv;
        break;
      }
    }
  }

  return {
    totalCombinationLines: (nMax * (nMax - 1)) / 2,
    maxSingleAtomLines: nMax - 1,
    excitationAccepted,
    reachedLevel,
    residualElectronEv,
    ionized,
    spectralLines
  };
}

export function createInitialState(params: RutherfordBohrParams): RutherfordBohrState {
  return {
    t: 0,
    rutherford: solveRutherfordScattering(params.alphaEnergyMev, params.targetZ, params.impactParamFm),
    bohr: solveBohrTransitions(params),
    animCursor: 0
  };
}

export function stepRutherfordBohr(
  state: RutherfordBohrState,
  params: RutherfordBohrParams,
  dt: number
): StepResult<RutherfordBohrState> {
  if (!Number.isFinite(dt) || dt < 0) throw new Error(`Invalid dt: ${dt}`);
  if (dt === 0) return { nextState: state, events: [] };
  const rutherford = solveRutherfordScattering(params.alphaEnergyMev, params.targetZ, params.impactParamFm);
  const bohr = solveBohrTransitions(params);
  return {
    nextState: {
      t: state.t + dt,
      rutherford,
      bohr,
      animCursor: (state.animCursor + dt * 0.45) % 1
    },
    events: []
  };
}

export function computeObservables(state: RutherfordBohrState): Record<string, number> {
  const hAlpha = state.bohr.spectralLines.find((l) => l.upperN === 3 && l.lowerN === 2);
  return {
    t: state.t,
    rutherfordAngleDeg: state.rutherford.simulatedAngleDeg,
    minDistanceFm: state.rutherford.minDistanceFm,
    energyDriftRel: state.rutherford.energyDriftRel,
    bohrLinesCount: state.bohr.totalCombinationLines,
    hAlphaNm: hAlpha ? hAlpha.wavelengthNm : 0,
    residualElectronEv: state.bohr.residualElectronEv
  };
}

export function checkInvariants(state: RutherfordBohrState): InvariantReport[] {
  return [
    {
      name: 'Rutherford Coulomb ODE Scattering Angle vs Analytic Formula (rad)',
      measuredError: state.rutherford.angleErrorRad,
      tolerance: 1e-4,
      passed: state.rutherford.angleErrorRad < 1e-4,
      unit: 'rad'
    },
    {
      name: 'Nuclear ScaleContext RK45 Mechanical Energy Relative Drift',
      measuredError: state.rutherford.energyDriftRel,
      tolerance: 1e-6,
      passed: state.rutherford.energyDriftRel < 1e-6
    }
  ];
}
