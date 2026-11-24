import { wavelengthToRgb } from '@physforge/physics-core';
import type { InvariantReport, StepResult } from '@physforge/sim-sdk';

export const H_PLANCK = 6.62607015e-34;
export const E_CHARGE = 1.602176634e-19;
export const C_LIGHT = 299792458;
export const M_ELECTRON = 9.1093837015e-31;
export const H_OVER_E = H_PLANCK / E_CHARGE;
export const COMPTON_WAVELENGTH_NM = (H_PLANCK / (M_ELECTRON * C_LIGHT)) * 1e9;
export const HC_EV_NM = ((H_PLANCK * C_LIGHT) / E_CHARGE) * 1e9;

export type QuantumLightMode = 'photoelectric' | 'compton';
export type CathodeMetal = 'Cs' | 'Na' | 'Zn' | 'Pt' | 'custom';

export const METAL_WORK_FUNCTIONS_EV: Record<Exclude<CathodeMetal, 'custom'>, number> = {
  Cs: 2.14,
  Na: 2.36,
  Zn: 4.31,
  Pt: 5.65
};

export type PhotoelectricComptonParams = {
  mode: QuantumLightMode;
  cathodeMetal: CathodeMetal;
  customWorkFunctionEv: number;
  wavelengthNm: number;
  intensityRel: number;
  anodeVoltageV: number;
  freezeRefEnabled: boolean;
  refWavelengthNm: number;
  refIntensityRel: number;
  xrayWavelengthNm: number;
  scatterAngleDeg: number;
};

export interface ComptonSolution {
  readonly incidentWavelengthNm: number;
  readonly scatteredWavelengthNm: number;
  readonly deltaLambdaNm: number;
  readonly incidentEnergyKev: number;
  readonly scatteredEnergyKev: number;
  readonly electronKineticKev: number;
  readonly pIncident: number;
  readonly pScattered: number;
  readonly pElectron: number;
  readonly recoilAngleDeg: number;
  readonly pxResidualRel: number;
  readonly pyResidualRel: number;
  readonly energyResidualRel: number;
}

export interface PhotoelectricSolution {
  readonly workFunctionEv: number;
  readonly cutoffFreqHz: number;
  readonly cutoffWavelengthNm: number;
  readonly incidentFreqHz: number;
  readonly photonEnergyEv: number;
  readonly maxKineticEv: number;
  readonly stoppingVoltageV: number;
  readonly thresholdPassed: boolean;
  readonly saturationCurrentMa: number;
  readonly currentMa: number;
}

export interface PhotoelectricComptonState {
  readonly t: number;
  readonly photoelectric: PhotoelectricSolution;
  readonly compton: ComptonSolution;
  readonly beamHex: string;
  readonly phaseWave: number;
}

export function getWorkFunctionEv(params: PhotoelectricComptonParams): number {
  if (params.cathodeMetal === 'custom') {
    return Math.max(0.5, params.customWorkFunctionEv);
  }
  return METAL_WORK_FUNCTIONS_EV[params.cathodeMetal];
}

/** Empirical asymptote shared by the observable and plotted response. */
export function photoelectricSaturationCurrentMa(intensityRel: number, maxKineticEv: number): number {
  return 2.4 * Math.max(0.05, intensityRel) * (1 - 0.15 * Math.exp(-maxKineticEv));
}

export function computePhotocurrentMa(voltageV: number, pe: PhotoelectricSolution, intensityRel: number): number {
  if (!pe.thresholdPassed) return 0;
  if (voltageV <= -pe.stoppingVoltageV) return 0;
  const iSat = photoelectricSaturationCurrentMa(intensityRel, pe.maxKineticEv);
  const vAboveStop = voltageV + pe.stoppingVoltageV;
  const scaleV = Math.max(0.6, 0.75 * pe.stoppingVoltageV + 0.5);
  return iSat * (1 - Math.exp((-2.8 * vAboveStop) / scaleV));
}

export function solvePhotoelectric(params: PhotoelectricComptonParams): PhotoelectricSolution {
  const workFunctionEv = getWorkFunctionEv(params);
  const lambdaNm = Math.max(100, params.wavelengthNm);
  const workJ = workFunctionEv * E_CHARGE;
  const cutoffFreqHz = workJ / H_PLANCK;
  const cutoffWavelengthNm = HC_EV_NM / workFunctionEv;
  const incidentFreqHz = C_LIGHT / (lambdaNm * 1e-9);
  const photonEnergyEv = (H_PLANCK * incidentFreqHz) / E_CHARGE;
  const thresholdPassed = photonEnergyEv > workFunctionEv;
  const maxKineticEv = thresholdPassed ? photonEnergyEv - workFunctionEv : 0;
  const stoppingVoltageV = maxKineticEv; // E_km (eV) = e * U_c => numerical equality in V
  const saturationCurrentMa = thresholdPassed ? photoelectricSaturationCurrentMa(params.intensityRel, maxKineticEv) : 0;

  const baseSol: PhotoelectricSolution = {
    workFunctionEv,
    cutoffFreqHz,
    cutoffWavelengthNm,
    incidentFreqHz,
    photonEnergyEv,
    maxKineticEv,
    stoppingVoltageV,
    thresholdPassed,
    saturationCurrentMa,
    currentMa: 0
  };
  return {
    ...baseSol,
    currentMa: computePhotocurrentMa(params.anodeVoltageV, baseSol, params.intensityRel)
  };
}

export function solveComptonScattering(xrayWavelengthNm: number, scatterAngleDeg: number): ComptonSolution {
  const lamNm = Math.max(0.002, xrayWavelengthNm);
  const theta = (scatterAngleDeg * Math.PI) / 180;
  const deltaLambdaNm = COMPTON_WAVELENGTH_NM * (1 - Math.cos(theta));
  const lamPrimeNm = lamNm + deltaLambdaNm;

  const lamM = lamNm * 1e-9;
  const lamPrimeM = lamPrimeNm * 1e-9;
  const pIncident = H_PLANCK / lamM;
  const pScattered = H_PLANCK / lamPrimeM;

  const eIncidentJ = pIncident * C_LIGHT;
  const eScatteredJ = pScattered * C_LIGHT;
  const eKineticJ = eIncidentJ - eScatteredJ;
  const restEnergyJ = M_ELECTRON * C_LIGHT * C_LIGHT;
  const totalElectronEnergyJ = restEnergyJ + eKineticJ;
  const pElectron = Math.sqrt(Math.max(0, totalElectronEnergyJ * totalElectronEnergyJ - restEnergyJ * restEnergyJ)) / C_LIGHT;

  const pxScatter = pScattered * Math.cos(theta);
  const pyScatter = pScattered * Math.sin(theta);
  const phiRad = pElectron === 0 ? 0 : Math.atan2(-pyScatter, pIncident - pxScatter);

  const pxSum = pxScatter + pElectron * Math.cos(phiRad);
  const pySum = pyScatter + pElectron * Math.sin(phiRad);

  return {
    incidentWavelengthNm: lamNm,
    scatteredWavelengthNm: lamPrimeNm,
    deltaLambdaNm,
    incidentEnergyKev: eIncidentJ / E_CHARGE / 1000,
    scatteredEnergyKev: eScatteredJ / E_CHARGE / 1000,
    electronKineticKev: eKineticJ / E_CHARGE / 1000,
    pIncident,
    pScattered,
    pElectron,
    recoilAngleDeg: (phiRad * 180) / Math.PI,
    pxResidualRel: Math.abs(pxSum - pIncident) / pIncident,
    pyResidualRel: Math.abs(pySum) / pIncident,
    energyResidualRel: Math.abs(eScatteredJ + eKineticJ - eIncidentJ) / eIncidentJ
  };
}

export function createInitialState(params: PhotoelectricComptonParams): PhotoelectricComptonState {
  const pe = solvePhotoelectric(params);
  const compton = solveComptonScattering(params.xrayWavelengthNm, params.scatterAngleDeg);
  const rgb = wavelengthToRgb(Math.max(380, Math.min(780, params.wavelengthNm)));
  return {
    t: 0,
    photoelectric: pe,
    compton,
    beamHex: params.wavelengthNm < 380 ? '#a855f7' : rgb.hex,
    phaseWave: 0
  };
}

export function stepPhotoelectricCompton(
  state: PhotoelectricComptonState,
  params: PhotoelectricComptonParams,
  dt: number
): StepResult<PhotoelectricComptonState> {
  if (!Number.isFinite(dt) || dt < 0) throw new Error(`Invalid dt: ${dt}`);
  const pe = solvePhotoelectric(params);
  const compton = solveComptonScattering(params.xrayWavelengthNm, params.scatterAngleDeg);
  const rgb = wavelengthToRgb(Math.max(380, Math.min(780, params.wavelengthNm)));
  if (dt === 0) return { nextState: state, events: [] };
  return {
    nextState: {
      t: state.t + dt,
      photoelectric: pe,
      compton,
      beamHex: params.wavelengthNm < 380 ? '#a855f7' : rgb.hex,
      phaseWave: (state.phaseWave + dt * 5.0) % (2 * Math.PI)
    },
    events: []
  };
}

export function computeObservables(state: PhotoelectricComptonState): Record<string, number> {
  return {
    t: state.t,
    photonEnergyEv: state.photoelectric.photonEnergyEv,
    workFunctionEv: state.photoelectric.workFunctionEv,
    stoppingVoltageV: state.photoelectric.stoppingVoltageV,
    currentMa: state.photoelectric.currentMa,
    cutoffWavelengthNm: state.photoelectric.cutoffWavelengthNm,
    deltaLambdaPm: state.compton.deltaLambdaNm * 1000,
    electronKineticKev: state.compton.electronKineticKev,
    recoilAngleDeg: state.compton.recoilAngleDeg
  };
}

export function checkInvariants(state: PhotoelectricComptonState): InvariantReport[] {
  const pe = state.photoelectric;
  const einsteinErr = pe.thresholdPassed
    ? Math.abs(pe.photonEnergyEv - pe.workFunctionEv - pe.stoppingVoltageV)
    : Math.abs(pe.stoppingVoltageV);
  const momResidual = Math.max(state.compton.pxResidualRel, state.compton.pyResidualRel);
  const comptonErr = Math.max(momResidual, state.compton.energyResidualRel);
  return [
    {
      name: 'Einstein Photoelectric Equation Residual |hν - W₀ - eU_c| (eV)',
      measuredError: einsteinErr,
      tolerance: 1e-10,
      passed: einsteinErr < 1e-10,
      unit: 'eV'
    },
    {
      name: 'Compton Relativistic 4-Momentum Closure Relative Error',
      measuredError: comptonErr,
      tolerance: 1e-10,
      passed: comptonErr < 1e-10
    }
  ];
}
