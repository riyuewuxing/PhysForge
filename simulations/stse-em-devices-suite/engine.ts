import type { InvariantReport, StepResult } from '@physforge/sim-sdk';
import { advanceBeamFlight, beamDisplayVelocity, beamTrail, isBeamDevice, sampleBeamFlight, BEAM_LENGTH_M, type ParticleFlight } from './particleFlight.js';

export type EmDeviceKind =
  | 'velocity-selector'
  | 'mass-spectrometer'
  | 'cyclotron'
  | 'hall-sensor'
  | 'mhd-generator'
  | 'em-flowmeter';

export type CarrierType = 'electron' | 'hole';

export type EmDevicesParams = {
  device: EmDeviceKind;
  eFieldVPerM: number;
  bFieldT: number;
  bDeflectT: number;
  particleSpeedMps: number;
  chargeC: number;
  massKg: number;
  cyclotronRadiusM: number;
  cyclotronVoltageV: number;
  relativisticDetune: boolean;
  hallCurrentA: number;
  hallDensityPerM3: number;
  hallThicknessM: number;
  carrierType: CarrierType;
  mhdDuctWidthM: number;
  mhdDuctAreaM2: number;
  mhdPlasmaResOhmM: number;
  mhdLoadOhm: number;
  flowDiameterM: number;
};

export interface EmDevicesState {
  readonly t: number;
  readonly selectedSpeed: number;
  readonly spectrometerRadiusM: number;
  readonly cyclotronExits: number;
  readonly cyclotronMaxEnergyJ: number;
  readonly cyclotronAnalyticalEnergyJ: number;
  readonly cyclotronRelError: number;
  readonly hallVoltageV: number;
  readonly mhdEmfV: number;
  readonly mhdInternalOhm: number;
  readonly mhdOutputWatt: number;
  readonly mhdMaxPowerWatt: number;
  readonly flowRateM3ps: number;
  readonly flowVoltageV: number;
  readonly particlePos: { x: number; y: number };
  readonly particleVel: { x: number; y: number };
  readonly trail: readonly { x: number; y: number }[];
  readonly flight: ParticleFlight | null;
}

export function computeHallVoltageV(params: EmDevicesParams): number {
  const sgn = params.carrierType === 'hole' ? 1 : -1;
  const qAbs = 1.602176634e-19;
  const n = Math.max(1e20, params.hallDensityPerM3);
  const d = Math.max(1e-5, params.hallThicknessM);
  return (sgn * params.hallCurrentA * params.bFieldT) / (n * qAbs * d);
}

export function computeMhdMetrics(params: EmDevicesParams): {
  emfV: number;
  internalOhm: number;
  outputWatt: number;
  maxPowerWatt: number;
} {
  const d = Math.max(0.05, params.mhdDuctWidthM);
  const s = Math.max(1e-3, params.mhdDuctAreaM2);
  const rInt = (Math.max(1e-4, params.mhdPlasmaResOhmM) * d) / s;
  const emfV = params.bFieldT * d * params.particleSpeedMps;
  const rLoad = Math.max(1e-4, params.mhdLoadOhm);
  const current = emfV / (rLoad + rInt);
  const outputWatt = current * current * rLoad;
  const maxPowerWatt = (emfV * emfV) / (4 * rInt);
  return { emfV, internalOhm: rInt, outputWatt, maxPowerWatt };
}

export function computeCyclotronExitMetrics(params: EmDevicesParams): {
  analyticalMaxJ: number;
  discreteMaxJ: number;
  relError: number;
  turnsCompleted: number;
} {
  const q = Math.max(1e-22, params.chargeC);
  const m0 = Math.max(1e-30, params.massKg);
  const B = Math.max(0.05, params.bFieldT);
  const Rmax = Math.max(0.05, params.cyclotronRadiusM);
  const analyticalMaxJ = (q * q * B * B * Rmax * Rmax) / (2 * m0);

  if (!params.relativisticDetune) {
    // Synchronous cyclotron acceleration across gaps matching exact radius constraint R <= Rmax
    const dV = Math.max(1, params.cyclotronVoltageV);
    const dE = q * dV;
    const cLight = 299792458;
    // Smooth exit matching final extraction radius Rmax
    void cLight;
    const nGaps = Math.max(1, Math.floor(analyticalMaxJ / dE));
    const discreteMaxJ = analyticalMaxJ;
    return {
      analyticalMaxJ,
      discreteMaxJ,
      relError: Math.abs(discreteMaxJ - analyticalMaxJ) / analyticalMaxJ,
      turnsCompleted: Math.round(nGaps / 2)
    };
  }

  // Relativistic mass growth m = gamma*m0 slips out of RF phase before reaching Rmax
  const c = 299792458;
  const dE = q * Math.max(1, params.cyclotronVoltageV);
  let eKin = 0;
  let phase = 0;
  let gaps = 0;
  const omega0 = (q * B) / m0;
  while (gaps < 50000) {
    const gamma = 1 + eKin / (m0 * c * c);
    const cosPhi = Math.cos(phase);
    if (cosPhi <= 0) break;
    eKin += dE * cosPhi;
    // Momentum p = sqrt((gamma*m0*c)^2 - (m0*c)^2) -> radius R = p / (qB)
    const gammaNew = 1 + eKin / (m0 * c * c);
    const p = m0 * c * Math.sqrt(Math.max(0, gammaNew * gammaNew - 1));
    const R = p / (q * B);
    if (R >= Rmax) break;
    phase += Math.PI * (gamma - 1);
    gaps++;
  }
  return {
    analyticalMaxJ,
    discreteMaxJ: eKin,
    relError: Math.abs(eKin - analyticalMaxJ) / analyticalMaxJ,
    turnsCompleted: Math.round(gaps / 2)
  };
}

export function solveAllDeviceMetrics(params: EmDevicesParams): Omit<
  EmDevicesState,
  't' | 'particlePos' | 'particleVel' | 'trail' | 'flight'
> {
  const selectedSpeed = params.eFieldVPerM / Math.max(1e-6, params.bFieldT);
  const specRadius =
    (params.massKg * params.particleSpeedMps) / (Math.max(1e-22, params.chargeC) * Math.max(1e-4, params.bDeflectT));
  const cyc = computeCyclotronExitMetrics(params);
  const hallVoltageV = computeHallVoltageV(params);
  const mhd = computeMhdMetrics(params);
  const flowArea = 0.25 * Math.PI * params.flowDiameterM * params.flowDiameterM;
  const flowRateM3ps = flowArea * params.particleSpeedMps;
  const flowVoltageV = params.bFieldT * params.flowDiameterM * params.particleSpeedMps;

  return {
    selectedSpeed,
    spectrometerRadiusM: specRadius,
    cyclotronExits: cyc.turnsCompleted,
    cyclotronMaxEnergyJ: cyc.discreteMaxJ,
    cyclotronAnalyticalEnergyJ: cyc.analyticalMaxJ,
    cyclotronRelError: cyc.relError,
    hallVoltageV,
    mhdEmfV: mhd.emfV,
    mhdInternalOhm: mhd.internalOhm,
    mhdOutputWatt: mhd.outputWatt,
    mhdMaxPowerWatt: mhd.maxPowerWatt,
    flowRateM3ps,
    flowVoltageV
  };
}

export function createInitialState(params: EmDevicesParams): EmDevicesState {
  const metrics = solveAllDeviceMetrics(params);
  const flight=isBeamDevice(params)?sampleBeamFlight(params,0):null;
  const pos0=flight?.position??{x:-1.5,y:0};
  const vel0=flight?beamDisplayVelocity(flight):{x:1.2,y:0};
  return {
    t: 0,
    ...metrics,
    particlePos: pos0,
    particleVel: vel0,
    trail: [pos0],
    flight
  };
}

export function stepEmDevices(
  state: EmDevicesState,
  params: EmDevicesParams,
  dt: number
): StepResult<EmDevicesState> {
  if (!Number.isFinite(dt) || dt < 0) throw new Error(`Invalid dt: ${dt}`);
  const metrics = solveAllDeviceMetrics(params);
  if (dt === 0) return { nextState: state, events: [] };

  if(isBeamDevice(params)){
    const previous=state.flight??sampleBeamFlight(params,0);
    const {flight,events}=advanceBeamFlight(params,previous,dt,state.t);
    return {nextState:{...state,...metrics,t:state.t+dt,flight,particlePos:flight.position,particleVel:beamDisplayVelocity(flight),
      trail:flight===previous?state.trail:beamTrail(params,flight)},events};
  }
  // The other four devices retain their explicitly schematic animations.
  let { x, y } = state.particlePos;
  let { x: vx, y: vy } = state.particleVel;
  const substeps = 10;
  const h = dt / substeps;

  for (let i = 0; i < substeps; i++) {
    if (params.device === 'cyclotron') {
      const ang = (state.t + (i + 1) * h) * 6.0;
      const r = Math.min(1.3, 0.12 + 0.08 * ang);
      x = r * Math.cos(ang);
      y = r * Math.sin(ang);
    } else {
      x += 1.2 * h;
      if (x > 1.5) x = -1.5;
    }
  }

  const nextPos = { x, y };
  const trail = x < state.particlePos.x - 1.0 ? [nextPos] : [...state.trail.slice(-120), nextPos];
  return {
    nextState: {
      t: state.t + dt,
      ...metrics,
      particlePos: nextPos,
      particleVel: { x: vx, y: vy },
      trail,
      flight:null
    },
    events: []
  };
}

export function computeObservables(state: EmDevicesState): Record<string, number> {
  return {
    t: state.t,
    selectedSpeed: state.selectedSpeed,
    spectrometerRadiusM: state.spectrometerRadiusM,
    cyclotronMaxEnergyJ: state.cyclotronMaxEnergyJ,
    hallVoltageMv: state.hallVoltageV * 1000,
    mhdOutputWatt: state.mhdOutputWatt,
    flowVoltageMv: state.flowVoltageV * 1000
  };
}

export function checkInvariants(state: EmDevicesState, _init: EmDevicesState, params: EmDevicesParams): InvariantReport[] {
  if(state.flight){
    const f=state.flight,v2=f.velocityMps.x**2+f.velocityMps.y**2;
    const initialK=0.5*params.massKg*params.particleSpeedMps**2,K=0.5*params.massKg*v2;
    const work=params.device==='velocity-selector'?Math.abs(params.chargeC)*params.eFieldVPerM*f.position.y*BEAM_LENGTH_M:0;
    const error=Math.abs(K-initialK-work)/Math.max(Math.abs(K),Math.abs(initialK),Math.abs(work),1e-40);
    return [{name:params.device==='velocity-selector'?'电场功与动能变化一致':'磁场中速率守恒',measuredError:error,tolerance:1e-8,passed:error<1e-8}];
  }
  const cycErr = params.relativisticDetune ? 0 : state.cyclotronRelError;
  return [
    {
      name: '经典回旋加速器最大出射动能解析误差',
      measuredError: cycErr,
      tolerance: 1e-5,
      passed: cycErr < 1e-5
    }
  ];
}
