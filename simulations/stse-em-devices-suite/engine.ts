import type { InvariantReport, StepResult } from '@physforge/sim-sdk';
import { advanceBeamFlight, beamDisplayVelocity, beamTrail, isBeamDevice, sampleBeamFlight, BEAM_LENGTH_M, type ParticleFlight } from './particleFlight.js';

import { getCyclotronPlan, sampleCyclotron, advanceCyclotron, cyclotronDisplayVelocity, cyclotronTrail, C_LIGHT, type CyclotronFlight } from './cyclotronFlight.js';

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
  readonly hallCurrentA: number;
  readonly mhdEmfV: number;
  readonly mhdInternalOhm: number;
  readonly mhdLoadCurrentA: number;
  readonly mhdTerminalVoltageV: number;
  readonly mhdInternalLossWatt: number;
  readonly mhdOutputWatt: number;
  readonly mhdMaxPowerWatt: number;
  readonly flowRateM3ps: number;
  readonly flowVoltageV: number;
  readonly particlePos: { x: number; y: number };
  readonly particleVel: { x: number; y: number };
  readonly trail: readonly { x: number; y: number }[];
  readonly flight: ParticleFlight | null;
  readonly cyclotron: CyclotronFlight | null;
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
  loadCurrentA: number;
  terminalVoltageV: number;
  internalLossWatt: number;
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
  return { emfV, internalOhm: rInt, loadCurrentA:current, terminalVoltageV:current*rLoad,
    internalLossWatt:current*current*rInt, outputWatt, maxPowerWatt };
}

export function computeCyclotronExitMetrics(params: EmDevicesParams): {
  analyticalMaxJ: number;
  discreteMaxJ: number;
  relError: number;
  turnsCompleted: number;
} {
  const plan=getCyclotronPlan(params);
  const discreteMaxJ=plan.arcs.at(-1)?.energyJ??0;
  const analyticalMaxJ=plan.analyticalMaxJ;
  return {analyticalMaxJ,discreteMaxJ,
    relError:analyticalMaxJ>0?Math.abs(discreteMaxJ-analyticalMaxJ)/analyticalMaxJ:0,
    turnsCompleted:plan.completedHalfTurns/2};
}

export function solveAllDeviceMetrics(params: EmDevicesParams): Omit<
  EmDevicesState,
  't' | 'particlePos' | 'particleVel' | 'trail' | 'flight' | 'cyclotron'
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
    hallCurrentA: params.hallCurrentA,
    mhdEmfV: mhd.emfV,
    mhdInternalOhm: mhd.internalOhm,
    mhdLoadCurrentA: mhd.loadCurrentA,
    mhdTerminalVoltageV: mhd.terminalVoltageV,
    mhdInternalLossWatt: mhd.internalLossWatt,
    mhdOutputWatt: mhd.outputWatt,
    mhdMaxPowerWatt: mhd.maxPowerWatt,
    flowRateM3ps,
    flowVoltageV
  };
}

/** Sensor motion is explicitly a schematic steady-state tracer, not a microscopic trajectory. */
export function sensorDisplayVelocity(params: EmDevicesParams): number {
  if(params.device==='hall-sensor')return 1.2*Math.sign(params.hallCurrentA)*(params.carrierType==='electron'?-1:1);
  return 1.2*Math.sign(params.particleSpeedMps);
}
export function isSensorDevice(device: EmDeviceKind): boolean {
  return device==='hall-sensor'||device==='mhd-generator'||device==='em-flowmeter';
}
/** In the displayed xy plane: +x conventional current/flow, +z B, U=V_lower−V_upper. */
export function sensorReadout(state:EmDevicesState,params:EmDevicesParams):string {
  const reference='U=V下−V上';
  if(params.device==='hall-sensor')return `I→ · ${params.carrierType==='electron'?'电子漂移←':'空穴漂移→'} · ${reference}=${(state.hallVoltageV*1000).toFixed(4)} mV`;
  if(params.device==='mhd-generator')return `开路 ℰ=${state.mhdEmfV.toFixed(2)} V · ${reference}=${state.mhdTerminalVoltageV.toFixed(2)} V · I外=${state.mhdLoadCurrentA.toFixed(2)} A`;
  return `开路 ${reference}=${state.flowVoltageV.toFixed(3)} V · Q=${state.flowRateM3ps.toExponential(3)} m³/s`;
}
export function createInitialState(params: EmDevicesParams): EmDevicesState {
  const metrics = solveAllDeviceMetrics(params);
  const flight=isBeamDevice(params)?sampleBeamFlight(params,0):null;
  const cyclotron=params.device==='cyclotron'?sampleCyclotron(params,0):null;
  const vx=sensorDisplayVelocity(params);
  const pos0=flight?.position??cyclotron?.position??{x:vx<0?1.35:vx>0?-1.35:0,y:0};
  const vel0=flight?beamDisplayVelocity(flight):cyclotron?cyclotronDisplayVelocity(params,cyclotron):{x:vx,y:0};
  return {
    t: 0,
    ...metrics,
    particlePos: pos0,
    particleVel: vel0,
    trail: [pos0],
    flight,
    cyclotron
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
    return {nextState:{...state,...metrics,t:state.t+dt,flight,cyclotron:null,particlePos:flight.position,particleVel:beamDisplayVelocity(flight),
      trail:flight===previous?state.trail:beamTrail(params,flight)},events};
  }
  if(params.device==='cyclotron'){
    const previous=state.cyclotron??sampleCyclotron(params,0);
    const {flight,events}=advanceCyclotron(params,previous,dt,state.t);
    return {nextState:{...state,...metrics,t:state.t+dt,flight:null,cyclotron:flight,particlePos:flight.position,
      particleVel:cyclotronDisplayVelocity(params,flight),trail:flight===previous?state.trail:cyclotronTrail(params,flight)},events};
  }
  // Periodic schematic tracer; wrapping must not draw a fictitious crossing line.
  const vx=sensorDisplayVelocity(params),half=1.35,span=2*half;
  const raw=state.particlePos.x+vx*dt;
  const wrapped=raw>half||raw< -half;
  const x=wrapped?((raw+half)%span+span)%span-half:raw;
  const nextPos={x,y:0};
  const trail=wrapped?[nextPos]:vx===0?state.trail:[...state.trail.slice(-120),nextPos];
  return {
    nextState: {
      t: state.t + dt,
      ...metrics,
      particlePos: nextPos,
      particleVel: { x: vx, y: 0 },
      trail,
      flight:null,
      cyclotron:null
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
    cyclotronEnergyJ:state.cyclotron?.energyJ??0,
    cyclotronGapCount:state.cyclotron?.gapCount??0,
    cyclotronPhaseSlipRad:state.cyclotron?.phaseSlip??0,
    hallVoltageMv: state.hallVoltageV * 1000,
    hallCurrentA: state.hallCurrentA,
    particleSpeedMps:state.flight?Math.hypot(state.flight.velocityMps.x,state.flight.velocityMps.y):0,
    mhdLoadCurrentA:state.mhdLoadCurrentA,
    mhdTerminalVoltageV:state.mhdTerminalVoltageV,
    flowRateM3ps:state.flowRateM3ps,
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
  if(state.cyclotron){
    const f=state.cyclotron,m=params.massKg,q=Math.abs(params.chargeC),B=params.bFieldT;
    const gamma=params.relativisticDetune&&m>0?1+f.energyJ/(m*C_LIGHT*C_LIGHT):1;
    const speed=Math.hypot(f.velocityMps.x,f.velocityMps.y);
    const momentum=m*gamma*speed;
    const expectedRadius=q*B>0?momentum/(q*B):0;
    const expectedK=params.relativisticDetune&&m>0?momentum*momentum/(m*(gamma+1)):0.5*m*speed*speed;
    const workErr=Math.abs(f.energyJ-f.totalWorkJ)/Math.max(Math.abs(f.energyJ),1e-40);
    const radiusErr=Math.abs(f.radiusM-expectedRadius)/Math.max(f.radiusM,1e-20);
    const kineticErr=Math.abs(f.energyJ-expectedK)/Math.max(f.energyJ,1e-40);
    return [{name:'实际过缝RF功与动能一致',measuredError:workErr,tolerance:1e-8,passed:workErr<1e-8},
      {name:'磁场轨道半径与动量一致',measuredError:radiusErr,tolerance:1e-8,passed:radiusErr<1e-8},
      {name:'速度与动能一致',measuredError:kineticErr,tolerance:1e-8,passed:kineticErr<1e-8}];
  }
  if(params.device==='mhd-generator'){
    const input=state.mhdEmfV*state.mhdLoadCurrentA,loss=state.mhdOutputWatt+state.mhdInternalLossWatt;
    const error=Math.abs(input-loss)/Math.max(Math.abs(input),1e-30);
    return [{name:'等效电源输入功率=负载功率+内耗',measuredError:error,tolerance:1e-8,passed:error<1e-8}];
  }
  return [];
}
