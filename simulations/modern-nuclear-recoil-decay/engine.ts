import {
  createScaleContext,
  createSeededPrng,
  stepBorisPusher,
  type ChargedParticleState
} from '@physforge/physics-core';
import type { InvariantReport, StepResult } from '@physforge/sim-sdk';

export const E_CHARGE = 1.602176634e-19;
export const C_LIGHT = 299792458;
export const AMU_KG = 1.6605390666e-27;
export const AMU_MEV = (AMU_KG * C_LIGHT * C_LIGHT) / (E_CHARGE * 1e6);
export const M_ALPHA_U = 4.001506179127;
export const M_ELECTRON_U = 0.000548579909;

export const CLOUD_CHAMBER_SCALE = createScaleContext({
  lengthUnit: 0.01,
  timeUnit: 1e-8,
  massUnit: AMU_KG,
  chargeUnit: E_CHARGE
});

export type NuclearMode = 'cloud-chamber-recoil' | 'half-life-mc' | 'chain-fission';
export type DecayKind = 'alpha' | 'beta-minus';

export type NuclearRecoilDecayParams = {
  mode: NuclearMode;
  decayKind: DecayKind;
  parentZ: number;
  parentMassU: number;
  massDefectU: number;
  magneticFieldT: number;
  nucleiCountN0: number;
  halfLifeS: number;
  seed: number;
  kEffectiveRaw: number;
  controlRodAbsorption: number;
};

export interface RecoilAnalysis {
  readonly qValueMev: number;
  readonly momentumSi: number;
  readonly radiusEmittedM: number;
  readonly radiusDaughterM: number;
  readonly radiusRatioMeasured: number;
  readonly chargeRatioExpected: number;
  readonly ratioRelError: number;
  readonly tangentGeometry: 'external' | 'internal';
  readonly emittedTrackCm: readonly { x: number; y: number }[];
  readonly daughterTrackCm: readonly { x: number; y: number }[];
}

export interface ChainGenerationPoint {
  readonly generation: number;
  readonly neutrons: number;
}

export interface NuclearRecoilDecayState {
  readonly t: number;
  readonly recoil: RecoilAnalysis;
  readonly initialFlags: readonly boolean[];
  readonly decayedFlags: readonly boolean[];
  readonly remainingCount: number;
  readonly halfLifeS: number;
  readonly prngCalls: number;
  readonly decayLifetimesS: readonly number[];
  readonly decayCurve: readonly { t: number; fraction: number; theory: number }[];
  readonly kEff: number;
  readonly chainGenerations: readonly ChainGenerationPoint[];
}

function fitCircleRadius(pts: readonly { x: number; y: number }[]): number {
  if (pts.length < 3) return 0;
  const p1 = pts[0]!;
  const p2 = pts[Math.floor(pts.length / 2)]!;
  const p3 = pts[pts.length - 1]!;
  const d = 2 * (p1.x * (p2.y - p3.y) + p2.x * (p3.y - p1.y) + p3.x * (p1.y - p2.y));
  if (Math.abs(d) < 1e-18) return 0;
  const p1s = p1.x * p1.x + p1.y * p1.y;
  const p2s = p2.x * p2.x + p2.y * p2.y;
  const p3s = p3.x * p3.x + p3.y * p3.y;
  const cx = (p1s * (p2.y - p3.y) + p2s * (p3.y - p1.y) + p3s * (p1.y - p2.y)) / d;
  const cy = (p1s * (p3.x - p2.x) + p2s * (p1.x - p3.x) + p3s * (p2.x - p1.x)) / d;
  return Math.hypot(p1.x - cx, p1.y - cy);
}

export function solveRecoilCloudChamber(params: NuclearRecoilDecayParams): RecoilAnalysis {
  const Z = Math.max(4, Math.min(100, Math.round(params.parentZ)));
  const dmU = Math.max(1e-5, params.massDefectU);
  const qValueMev = dmU * AMU_MEV;
  const bField = Math.max(0.05, Math.abs(params.magneticFieldT));

  const m1U = params.decayKind === 'alpha' ? M_ALPHA_U : M_ELECTRON_U;
  const z1 = params.decayKind === 'alpha' ? 2 : -1;
  const z2 = params.decayKind === 'alpha' ? Z - 2 : Z + 1;
  const m2U = Math.max(1, params.parentMassU - m1U - dmU);

  const m1Mev = m1U * AMU_MEV;
  const m2Mev = m2U * AMU_MEV;
  const bigMMev = m1Mev + m2Mev + qValueMev;

  const e1TotalMev = (bigMMev * bigMMev + m1Mev * m1Mev - m2Mev * m2Mev) / (2 * bigMMev);
  const pcMev = Math.sqrt(Math.max(0, e1TotalMev * e1TotalMev - m1Mev * m1Mev));
  const momentumSi = (pcMev * 1e6 * E_CHARGE) / C_LIGHT;

  const gamma1 = e1TotalMev / m1Mev;
  const e2TotalMev = Math.sqrt(pcMev * pcMev + m2Mev * m2Mev);
  const gamma2 = e2TotalMev / m2Mev;

  const mEff1Kg = gamma1 * m1U * AMU_KG;
  const mEff2Kg = gamma2 * m2U * AMU_KG;
  const v1 = momentumSi / mEff1Kg;
  const v2 = momentumSi / mEff2Kg;

  const q1Si = z1 * E_CHARGE;
  const q2Si = z2 * E_CHARGE;

  // Step both particles via stepBorisPusher at small cyclotron phase angle dPhi = 0.002 rad
  const fieldFn = () => ({ E: { x: 0, y: 0, z: 0 }, B: { x: 0, y: 0, z: bField } });
  const omega1 = (Math.abs(q1Si) * bField) / mEff1Kg;
  const omega2 = (Math.abs(q2Si) * bField) / mEff2Kg;
  const dPhi = 0.002;
  const dt1 = dPhi / omega1;
  const dt2 = dPhi / omega2;

  let p1: ChargedParticleState = { position: { x: 0, y: 0, z: 0 }, velocity: { x: v1, y: 0, z: 0 }, t: 0 };
  let p2: ChargedParticleState = { position: { x: 0, y: 0, z: 0 }, velocity: { x: -v2, y: 0, z: 0 }, t: 0 };

  const p1PtsM: { x: number; y: number }[] = [{ x: 0, y: 0 }];
  const p2PtsM: { x: number; y: number }[] = [{ x: 0, y: 0 }];

  const totalSteps = 1570; // ~ pi radians (~ half circle)
  for (let i = 0; i < totalSteps; i++) {
    p1 = stepBorisPusher(p1, fieldFn, q1Si, mEff1Kg, dt1);
    p2 = stepBorisPusher(p2, fieldFn, q2Si, mEff2Kg, dt2);
    if (i % 15 === 14) {
      p1PtsM.push({ x: p1.position.x, y: p1.position.y });
      p2PtsM.push({ x: p2.position.x, y: p2.position.y });
    }
  }

  const r1Fit = fitCircleRadius(p1PtsM);
  const r2Fit = fitCircleRadius(p2PtsM);
  const radiusEmittedM = r1Fit > 0 ? r1Fit : momentumSi / (Math.abs(q1Si) * bField);
  const radiusDaughterM = r2Fit > 0 ? r2Fit : momentumSi / (Math.abs(q2Si) * bField);
  const radiusRatioMeasured = radiusEmittedM / Math.max(1e-18, radiusDaughterM);
  const chargeRatioExpected = Math.abs(q2Si) / Math.abs(q1Si);
  const ratioRelError = Math.abs(radiusRatioMeasured - chargeRatioExpected) / chargeRatioExpected;

  return {
    qValueMev,
    momentumSi,
    radiusEmittedM,
    radiusDaughterM,
    radiusRatioMeasured,
    chargeRatioExpected,
    ratioRelError,
    tangentGeometry: z1 * z2 > 0 ? 'external' : 'internal',
    emittedTrackCm: p1PtsM.map((p) => ({
      x: CLOUD_CHAMBER_SCALE.toDimless(p.x, 'length'),
      y: CLOUD_CHAMBER_SCALE.toDimless(p.y, 'length')
    })),
    daughterTrackCm: p2PtsM.map((p) => ({
      x: CLOUD_CHAMBER_SCALE.toDimless(p.x, 'length'),
      y: CLOUD_CHAMBER_SCALE.toDimless(p.y, 'length')
    }))
  };
}

function buildChain(params: NuclearRecoilDecayParams): { kEff: number; chainGenerations: ChainGenerationPoint[] } {
  const rodAbs = Math.max(0, Math.min(0.95, params.controlRodAbsorption));
  const kEff = Math.max(0, params.kEffectiveRaw * (1 - rodAbs));
  const chainGenerations: ChainGenerationPoint[] = [];
  let n = 1;
  for (let g = 0; g <= 8; g++) {
    chainGenerations.push({ generation: g, neutrons: Math.min(10000, n) });
    n *= kEff;
  }
  return { kEff, chainGenerations };
}

export function createInitialState(params: NuclearRecoilDecayParams): NuclearRecoilDecayState {
  const n0 = Math.max(16, Math.min(4000, Math.round(params.nucleiCountN0)));
  const flags = new Array<boolean>(n0).fill(false);
  const { kEff, chainGenerations } = buildChain(params);
  const halfLifeS = Math.max(0.2, params.halfLifeS);
  const prng = createSeededPrng(Math.round(params.seed) >>> 0);
  const decayLifetimesS = params.mode === 'half-life-mc'
    ? flags.map(() => -halfLifeS * Math.log1p(-Math.min(1 - Number.EPSILON, Math.max(Number.EPSILON, prng.next()))) / Math.LN2)
    : [];
  return {
    t: 0,
    recoil: solveRecoilCloudChamber(params),
    initialFlags: flags,
    decayedFlags: flags,
    remainingCount: n0,
    halfLifeS,
    prngCalls: decayLifetimesS.length,
    decayLifetimesS,
    decayCurve: [{ t: 0, fraction: 1, theory: 1 }],
    kEff,
    chainGenerations
  };
}

export function stepNuclearRecoilDecay(
  state: NuclearRecoilDecayState,
  params: NuclearRecoilDecayParams,
  dt: number
): StepResult<NuclearRecoilDecayState> {
  if (!Number.isFinite(dt) || dt < 0) throw new Error(`Invalid dt: ${dt}`);
  if (dt === 0) return { nextState: state, events: [] };

  if (params.mode !== 'half-life-mc') {
    return { nextState: state, events: [], advancedTime: 0, halt: true };
  }
  const halfLifeS = state.halfLifeS;
  const nextT = state.t + dt;
  if (!Number.isFinite(nextT)) throw new Error('Non-finite decay time');
  const nextFlags = [...state.decayedFlags];
  const newlyDecayed: number[] = [];
  for (let i = 0; i < nextFlags.length; i++) {
    const lifetime = state.decayLifetimesS[i];
    if (!nextFlags[i] && lifetime !== undefined && lifetime <= nextT) {
      nextFlags[i] = true;
      newlyDecayed.push(lifetime);
    }
  }
  newlyDecayed.sort((a, b) => a - b);
  const n0 = nextFlags.length;
  // Preserve actual event history and one replaceable current cursor sample.
  const decayCurve = state.t === 0 ? [...state.decayCurve] : state.decayCurve.slice(0, -1);
  let remainingCount = state.remainingCount;
  for (const lifetime of newlyDecayed) {
    remainingCount--;
    decayCurve.push({ t: lifetime, fraction: remainingCount / n0, theory: 2 ** (-lifetime / halfLifeS) });
  }
  decayCurve.push({ t: nextT, fraction: remainingCount / n0, theory: 2 ** (-nextT / halfLifeS) });
  return {
    nextState: { ...state, t: nextT, decayedFlags: nextFlags, remainingCount, decayCurve },
    events: []
  };
}

export function computeObservables(state: NuclearRecoilDecayState): Record<string, number> {
  return {
    t: state.t,
    qValueMev: state.recoil.qValueMev,
    radiusRatio: state.recoil.radiusRatioMeasured,
    ratioRelError: state.recoil.ratioRelError,
    remainingCount: state.remainingCount,
    remainingFraction: state.remainingCount / Math.max(1, state.decayedFlags.length),
    kEff: state.kEff
  };
}

export function checkInvariants(state: NuclearRecoilDecayState): InvariantReport[] {
  return [
    {
      name: 'Boris Magnetic Recoil Radius Ratio R₁/R₂ = |q₂/q₁| Relative Error',
      measuredError: state.recoil.ratioRelError,
      tolerance: 1e-6,
      passed: state.recoil.ratioRelError < 1e-6
    }
  ];
}
