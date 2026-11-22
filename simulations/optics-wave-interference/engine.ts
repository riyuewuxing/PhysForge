import { degToRad, wavelengthToRgb } from '@physforge/physics-core';
import type { InvariantReport, StepResult } from '@physforge/sim-sdk';

export type WaveOpticsMode = 'thin-film-wedge' | 'newtons-rings' | 'single-slit-grating';
export type FilmDefectMode = 'flat' | 'bump' | 'pit';

export type WaveOpticsParams = {
  mode: WaveOpticsMode;
  wavelengthNm: number;
  refractiveIndexN2: number;
  wedgeAngleDeg: number;
  defectMode: FilmDefectMode;
  lensRadiusR: number;
  slitWidthMicron: number;
  gratingPitchMicron: number;
  slitCountN: number;
  halfWaveLoss: boolean;
};

export interface WaveOpticsState {
  readonly t: number;
  readonly rgbHex: string;
  readonly wedgeFringeSpacingMm: number;
  readonly newtonFirstDarkMm: number;
  readonly missingOrderRatio: number;
}

export function evalWedgeThicknessMeters(xMm: number, params: WaveOpticsParams): number {
  const xM = Math.max(0, xMm) * 1e-3;
  const tanAlpha = Math.tan(degToRad(Math.max(0.005, params.wedgeAngleDeg)));
  let d = xM * tanAlpha;
  if (params.defectMode !== 'flat') {
    const dx = xMm - 10;
    const gaussianBump = 0.4e-6 * Math.exp(-(dx * dx) / 4.0);
    d = Math.max(0, d + (params.defectMode === 'bump' ? -gaussianBump : gaussianBump));
  }
  return d;
}

export function evalThinFilmIntensity(xMm: number, params: WaveOpticsParams): number {
  const lambdaM = Math.max(380, Math.min(760, params.wavelengthNm)) * 1e-9;
  const d = evalWedgeThicknessMeters(xMm, params);
  const opd = 2 * Math.max(1, params.refractiveIndexN2) * d + (params.halfWaveLoss ? 0.5 * lambdaM : 0);
  const phase = (2 * Math.PI * opd) / lambdaM;
  return 0.5 * (1 + Math.cos(phase));
}

export function evalNewtonRingIntensity(rMm: number, params: WaveOpticsParams): number {
  const lambdaM = Math.max(380, Math.min(760, params.wavelengthNm)) * 1e-9;
  const R = Math.max(0.2, params.lensRadiusR);
  const rM = Math.abs(rMm) * 1e-3;
  const d = rM < R ? R - Math.sqrt(R * R - rM * rM) : (rM * rM) / (2 * R);
  const opd = 2 * Math.max(1, params.refractiveIndexN2) * d + (params.halfWaveLoss ? 0.5 * lambdaM : 0);
  const phase = (2 * Math.PI * opd) / lambdaM;
  return 0.5 * (1 + Math.cos(phase));
}

export function evalFraunhoferGratingIntensity(sinTheta: number, params: WaveOpticsParams): number {
  const lambdaUm = Math.max(0.38, Math.min(0.76, params.wavelengthNm * 1e-3));
  const a = Math.max(0.5, params.slitWidthMicron);
  const d = Math.max(a, params.gratingPitchMicron);
  const N = Math.max(1, Math.round(params.slitCountN));

  const beta = (Math.PI * a * sinTheta) / lambdaUm;
  const singleEnv = Math.abs(beta) < 1e-9 ? 1 : Math.sin(beta) / beta;
  if (N === 1) return singleEnv * singleEnv;

  const gamma = (Math.PI * d * sinTheta) / lambdaUm;
  const sinG = Math.sin(gamma);
  const multiTerm = Math.abs(sinG) < 1e-9 ? 1 : Math.sin(N * gamma) / (N * sinG);
  return singleEnv * singleEnv * multiTerm * multiTerm;
}

export function computeKeyOpticsMetrics(params: WaveOpticsParams): {
  wedgeSpacingMm: number;
  newtonR1Mm: number;
  missingOrder: number;
} {
  const lambdaM = Math.max(380, Math.min(760, params.wavelengthNm)) * 1e-9;
  const tanAlpha = Math.tan(degToRad(Math.max(0.005, params.wedgeAngleDeg)));
  const n2 = Math.max(1, params.refractiveIndexN2);
  const wedgeSpacingMm = (lambdaM / (2 * n2 * tanAlpha)) * 1e3;
  const newtonR1Mm = Math.sqrt((1 * Math.max(0.2, params.lensRadiusR) * lambdaM) / n2) * 1e3;
  const missingOrder = params.gratingPitchMicron / Math.max(0.5, params.slitWidthMicron);
  return { wedgeSpacingMm, newtonR1Mm, missingOrder };
}

export function createInitialState(params: WaveOpticsParams): WaveOpticsState {
  const m = computeKeyOpticsMetrics(params);
  return {
    t: 0,
    rgbHex: wavelengthToRgb(params.wavelengthNm).hex,
    wedgeFringeSpacingMm: m.wedgeSpacingMm,
    newtonFirstDarkMm: m.newtonR1Mm,
    missingOrderRatio: m.missingOrder
  };
}

export function stepWaveOptics(
  state: WaveOpticsState,
  params: WaveOpticsParams,
  dt: number
): StepResult<WaveOpticsState> {
  if (!Number.isFinite(dt) || dt < 0) throw new Error(`Invalid dt: ${dt}`);
  const m = computeKeyOpticsMetrics(params);
  return {
    nextState: {
      t: state.t + dt,
      rgbHex: wavelengthToRgb(params.wavelengthNm).hex,
      wedgeFringeSpacingMm: m.wedgeSpacingMm,
      newtonFirstDarkMm: m.newtonR1Mm,
      missingOrderRatio: m.missingOrder
    },
    events: []
  };
}

export function computeObservables(state: WaveOpticsState): Record<string, number> {
  return {
    t: state.t,
    wedgeFringeSpacingMm: state.wedgeFringeSpacingMm,
    newtonFirstDarkMm: state.newtonFirstDarkMm,
    missingOrderRatio: state.missingOrderRatio
  };
}

export function checkInvariants(state: WaveOpticsState): InvariantReport[] {
  const ok = Number.isFinite(state.wedgeFringeSpacingMm) && Number.isFinite(state.newtonFirstDarkMm);
  return [{ name: '波动光学条纹尺度有限性检定', measuredError: 0, tolerance: 1e-6, passed: ok }];
}
