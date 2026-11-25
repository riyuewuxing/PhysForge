import {
  bisectEvent,
  createScaleContext,
  extractIsolines,
  findRootBrent,
  stepVelocityVerlet,
  integrateAdaptiveRK45,
  type IsolineContour,
  type ScaleContext
} from '@physforge/physics-core';
import type { InvariantReport, PhysicsEvent, StepResult } from '@physforge/sim-sdk';

export const G_SI = 6.6743e-11;
export const EARTH_MASS_KG = 5.972e24;
export const SOLAR_MASS_KG = 1.989e30;
export const EARTH_ORBIT_REF_M = 7.0e6;
export const AU_METERS = 1.495978707e11;

export type AstroMode = 'kepler-ellipse' | 'hohmann-transfer' | 'binary-lagrange';
export type AstroScaleRegime = 'earth-orbit' | 'solar-au';

export type AstroOrbitalParams = {
  mode: AstroMode;
  scaleRegime: AstroScaleRegime;
  r1Ratio: number;
  r2OverR1: number;
  v0Ratio: number;
  massRatioQ: number;
  simSpeed: number;
};

export interface OrbitTrailPoint { readonly x:number; readonly y:number; readonly tNorm:number; }

export interface SweptSector {
  readonly startTNorm:number;
  readonly endTNorm:number;
  readonly vertices: readonly { x: number; y: number }[];
  readonly areaDimless: number;
}

export interface LagrangePoint {
  readonly id: 'L1' | 'L2' | 'L3' | 'L4' | 'L5';
  readonly x: number;
  readonly y: number;
}

export interface AstroOrbitalState {
  readonly tSim: number;
  readonly tNorm: number;
  readonly xNorm: number;
  readonly yNorm: number;
  readonly vxNorm: number;
  readonly vyNorm: number;
  readonly trailNorm: readonly OrbitTrailPoint[];
  readonly sectors: readonly SweptSector[];
  readonly currentSectorVerts: readonly { x: number; y: number }[];
  readonly sectorStartTNorm: number;
  readonly hohmannPhase: 'parking' | 'transfer' | 'circularized';
  readonly deltaV1SI: number;
  readonly deltaV2SI: number;
  readonly energyNorm0: number;
  readonly angularMomNorm0: number;
  readonly semiMajorAxisNorm0: number | null;
  readonly jacobi0?:number;
  readonly events: readonly PhysicsEvent[];
}

const CBRT_2 = Math.cbrt(2);
const YOSHIDA_W1 = 1 / (2 - CBRT_2);
const YOSHIDA_W0 = -CBRT_2 / (2 - CBRT_2);

export function buildAstroScaleContext(params: AstroOrbitalParams): {
  scale: ScaleContext;
  centralMassKg: number;
  muSI: number;
  r1SI: number;
} {
  const isSolar = params.scaleRegime === 'solar-au';
  const centralMassKg = isSolar ? SOLAR_MASS_KG : EARTH_MASS_KG;
  const baseLength = isSolar ? AU_METERS : EARTH_ORBIT_REF_M;
  const r1SI = Math.max(0.2, params.r1Ratio) * baseLength;
  const muSI = G_SI * centralMassKg;
  const timeUnit = Math.sqrt((r1SI * r1SI * r1SI) / muSI);
  const scale = createScaleContext({
    lengthUnit: r1SI,
    timeUnit,
    massUnit: 1000,
    chargeUnit: 1
  });
  return { scale, centralMassKg, muSI, r1SI };
}

function twoBodyAccelNorm(positions: readonly number[]): number[] {
  const x = positions[0]!;
  const y = positions[1]!;
  const r2 = x * x + y * y;
  const invR3 = r2 > 1e-12 ? 1 / (r2 * Math.sqrt(r2)) : 0;
  return [-x * invR3, -y * invR3];
}

export const BINARY_CORE_RADIUS_NORM=.001;
export const binaryMassRatio=(q:number)=>Math.max(.01,Math.min(.49,q));

/** Newtonian outside a tiny finite spherical core. The acceleration and
 * potential are from the same C1 function; no all-space Plummer drift at L4. */
export function binaryGravityAt(x:number,y:number,t:number,massRatioQ:number){
  const q=binaryMassRatio(massRatioQ),ct=Math.cos(t),st=Math.sin(t);
  return [{x:-q*ct,y:-q*st,mass:1-q},{x:(1-q)*ct,y:(1-q)*st,mass:q}].map(primary=>{
    const dx=primary.x-x,dy=primary.y-y,r=Math.hypot(dx,dy),R=BINARY_CORE_RADIUS_NORM;
    const f=primary.mass/Math.max(r,R)**3;
    const potential=primary.mass*(r>=R?1/r:(3-(r/R)**2)/(2*R));
    return {...primary,ax:dx*f,ay:dy*f,potential};
  });
}
function restricted3BodyAccelNorm(positions: readonly number[], t: number, q: number): number[] {
  const g=binaryGravityAt(positions[0]!,positions[1]!,t,q);
  return [g[0]!.ax+g[1]!.ax,g[0]!.ay+g[1]!.ay];
}
export function binaryEffectivePotential(x:number,y:number,q:number):number{
  const g=binaryGravityAt(x,y,0,q);
  return -g[0]!.potential-g[1]!.potential-.5*(x*x+y*y);
}
export function binaryJacobi(x:number,y:number,vx:number,vy:number,t:number,q:number):number{
  const g=binaryGravityAt(x,y,t,q);
  return 2*(g[0]!.potential+g[1]!.potential)+x*x+y*y-(vx+y)**2-(vy-x)**2;
}

function stepYoshida4Verlet(
  pos: readonly number[],
  vel: readonly number[],
  t: number,
  h: number
): { positions: readonly number[]; velocities: readonly number[]; t: number } {
  const accelFn=(p:readonly number[])=>twoBodyAccelNorm(p);

  const s1 = stepVelocityVerlet({ positions: pos, velocities: vel, t }, YOSHIDA_W1 * h, accelFn);
  const s2 = stepVelocityVerlet(s1, YOSHIDA_W0 * h, accelFn);
  return stepVelocityVerlet(s2, YOSHIDA_W1 * h, accelFn);
}

export function computeLagrangePoints(massRatioQ: number): LagrangePoint[] {
  const q = binaryMassRatio(massRatioQ);
  const x1 = -q;
  const x2 = 1 - q;

  const dPhiDx = (x: number): number => {
    const g=binaryGravityAt(x,0,0,q);
    return x+g[0]!.ax+g[1]!.ax;
  };

  const l1x = findRootBrent(dPhiDx, x1 + 0.02, x2 - 0.02, { tolerance: 1e-11 }).root;
  const l2x = findRootBrent(dPhiDx, x2 + 0.02, 2.5, { tolerance: 1e-11 }).root;
  const l3x = findRootBrent(dPhiDx, -2.5, x1 - 0.02, { tolerance: 1e-11 }).root;

  return [
    { id: 'L1', x: l1x, y: 0 },
    { id: 'L2', x: l2x, y: 0 },
    { id: 'L3', x: l3x, y: 0 },
    { id: 'L4', x: 0.5 - q, y: Math.sqrt(3) / 2 },
    { id: 'L5', x: 0.5 - q, y: -Math.sqrt(3) / 2 }
  ];
}

let rocheCache:{q:number;contours:IsolineContour[]}|null=null;
export function extractRocheIsolines(massRatioQ: number): IsolineContour[] {
  const q = binaryMassRatio(massRatioQ);
  if(rocheCache?.q===q)return rocheCache.contours;
  const nx = 44;
  const ny = 44;
  const bounds = { xMin: -1.8, xMax: 1.8, yMin: -1.8, yMax: 1.8 };
  const grid = new Float64Array(nx * ny);

  for (let j = 0; j < ny; j++) {
    const y = bounds.yMin + (j / (ny - 1)) * (bounds.yMax - bounds.yMin);
    for (let i = 0; i < nx; i++) {
      const x = bounds.xMin + (i / (nx - 1)) * (bounds.xMax - bounds.xMin);
      grid[j * nx + i] = binaryEffectivePotential(x,y,q);
    }
  }
  const contours=extractIsolines(grid, nx, ny, bounds, [-2.4, -2.0, -1.75, -1.55]);
  rocheCache={q,contours};return contours;
}

function twoBodyMetricsNorm(x: number, y: number, vx: number, vy: number): {
  r: number;
  energy: number;
  lz: number;
  a: number | null;
  ecc: number;
} {
  const r = Math.hypot(x, y);
  const v2 = vx * vx + vy * vy;
  const energy = 0.5 * v2 - 1 / Math.max(1e-9, r);
  const lz = x * vy - y * vx;
  const a = Math.abs(energy)>1e-12 ? -0.5 / energy : null;
  const rDotV = x * vx + y * vy;
  const ex = (v2 - 1 / r) * x - rDotV * vx;
  const ey = (v2 - 1 / r) * y - rDotV * vy;
  const ecc = Math.hypot(ex, ey);
  return { r, energy, lz, a, ecc };
}

export function createInitialState(params: AstroOrbitalParams): AstroOrbitalState {
  const { scale, muSI, r1SI } = buildAstroScaleContext(params);

  if (params.mode === 'binary-lagrange') {
    const q = binaryMassRatio(params.massRatioQ);
    const x0 = 0.5 - q + 0.025;
    const y0 = Math.sqrt(3) / 2 - 0.02;
    const vx0 = -y0;
    const vy0 = x0;
    return {
      tSim: 0,
      tNorm: 0,
      xNorm: x0,
      yNorm: y0,
      vxNorm: vx0,
      vyNorm: vy0,
      trailNorm: [{ x: x0, y: y0,tNorm:0 }],
      sectors: [],
      currentSectorVerts: [{ x: x0, y: y0 }],
      sectorStartTNorm: 0,
      hohmannPhase: 'parking',
      deltaV1SI: 0,
      deltaV2SI: 0,
      energyNorm0: .5*(vx0*vx0+vy0*vy0)+binaryEffectivePotential(x0,y0,q)+.5*(x0*x0+y0*y0),
      angularMomNorm0: x0 * vy0 - y0 * vx0,
      semiMajorAxisNorm0: null,
      jacobi0:binaryJacobi(x0,y0,vx0,vy0,0,q),
      events: []
    };
  }

  const vCircSI = Math.sqrt(muSI / r1SI);

  if (params.mode === 'hohmann-transfer') {
    const rho = Math.max(1.1, params.r2OverR1);
    const dv1Factor = Math.sqrt((2 * rho) / (1 + rho)) - 1;
    const vTransferSI = vCircSI * (1 + dv1Factor);
    const dv1SI = vCircSI * dv1Factor;

    const xNorm = scale.toDimless(r1SI, 'length');
    const yNorm = scale.toDimless(0, 'length');
    const vyNorm = scale.toDimless(vTransferSI, 'velocity');
    const m = twoBodyMetricsNorm(xNorm, yNorm, 0, vyNorm);

    const burn1Event: PhysicsEvent = {
      id: 'hohmann-burn-1',
      time: 0,
      label: '近地点点火 Δv₁ 进入霍曼转移椭圆',
      position: { x: xNorm, y: yNorm },
      metrics: { deltaV1SI: dv1SI }
    };

    return {
      tSim: 0,
      tNorm: 0,
      xNorm,
      yNorm,
      vxNorm: 0,
      vyNorm,
      trailNorm: [{ x: xNorm, y: yNorm,tNorm:0 }],
      sectors: [],
      currentSectorVerts: [{ x: xNorm, y: yNorm }],
      sectorStartTNorm: 0,
      hohmannPhase: 'transfer',
      deltaV1SI: dv1SI,
      deltaV2SI: 0,
      energyNorm0: m.energy,
      angularMomNorm0: m.lz,
      semiMajorAxisNorm0: m.a,
      events: [burn1Event]
    };
  }

  const v0SI = Math.max(0.5, params.v0Ratio) * vCircSI;
  const xNorm = scale.toDimless(r1SI, 'length');
  const yNorm = scale.toDimless(0, 'length');
  const vyNorm = scale.toDimless(v0SI, 'velocity');
  const m = twoBodyMetricsNorm(xNorm, yNorm, 0, vyNorm);

  return {
    tSim: 0,
    tNorm: 0,
    xNorm,
    yNorm,
    vxNorm: 0,
    vyNorm,
    trailNorm: [{ x: xNorm, y: yNorm,tNorm:0 }],
    sectors: [],
    currentSectorVerts: [{ x: xNorm, y: yNorm }],
    sectorStartTNorm: 0,
    hohmannPhase: 'parking',
    deltaV1SI: 0,
    deltaV2SI: 0,
    energyNorm0: m.energy,
    angularMomNorm0: m.lz,
    semiMajorAxisNorm0: m.a,
    events: []
  };
}

interface VerletSubState {
  readonly positions: readonly number[];
  readonly velocities: readonly number[];
  readonly t: number;
}

export function stepAstroOrbital(
  state: AstroOrbitalState,
  params: AstroOrbitalParams,
  dt: number
): StepResult<AstroOrbitalState> {
  if (!Number.isFinite(dt) || dt < 0) throw new Error(`Invalid dt: ${dt}`);
  if (dt === 0) return { nextState: state, events: [] };

  const { scale } = buildAstroScaleContext(params);
  const q = binaryMassRatio(params.massRatioQ);
  const simRate = Math.max(0.2, params.simSpeed);
  const dtNormTotal = dt * simRate;

  const maxSub = 0.015;
  const nSub = Math.max(1, Math.ceil(dtNormTotal / maxSub));
  const nominalSubH = dtNormTotal / nSub;
  const endT=state.tNorm+dtNormTotal;
  const sectorInterval=.55;
  let sectors=state.sectors;
  let currentSectorVerts=state.currentSectorVerts.slice();
  let sectorStartTNorm=state.sectorStartTNorm;
  const trailNorm=state.trailNorm.slice();
  const appendTrail=(v:VerletSubState,force=false)=>{
    const x=v.positions[0]!,y=v.positions[1]!,last=trailNorm.at(-1);
    if(last&&v.t<=last.tNorm+1e-12)return;
    if(force||!last||Math.hypot(x-last.x,y-last.y)>.04)trailNorm.push({x,y,tNorm:v.t});
  };

  let curSub: VerletSubState = {
    positions: [state.xNorm, state.yNorm],
    velocities: [state.vxNorm, state.vyNorm],
    t: state.tNorm
  };
  let phase = state.hohmannPhase;
  let deltaV2SI = state.deltaV2SI;
  const newEvents: PhysicsEvent[] = [];

  const advSub=(s:VerletSubState,h:number):VerletSubState=>{
    if(params.mode!=='binary-lagrange')return stepYoshida4Verlet(s.positions,s.velocities,s.t,h);
    // A fixed symplectic step that works for the two-body ellipse can fail
    // catastrophically when a test particle grazes a moving primary. Use the
    // shared adaptive Dormand-Prince solver with local error control for the
    // time-dependent restricted-three-body system; never renormalize C.
    const result=integrateAdaptiveRK45([...s.positions,...s.velocities],s.t,h,(t,v)=>{
      const a=restricted3BodyAccelNorm(v,t,q);
      return [v[2]!,v[3]!,a[0]!,a[1]!];
    },{absTol:1e-13,relTol:1e-12,minStep:1e-14,maxSubsteps:10000});
    return {positions:result.state.slice(0,2),velocities:result.state.slice(2,4),t:result.t};
  };
  const radialVelFn = (s: VerletSubState) => s.positions[0]! * s.velocities[0]! + s.positions[1]! * s.velocities[1]!;

  // Split at the actual .55 normalized-time boundaries, including multiple
  // complete sectors in one caller step. The integrator, not interpolation,
  // supplies each boundary point and the polygon's interior samples.
  while(endT-curSub.t>1e-12){
    const nextBoundary=sectorStartTNorm+sectorInterval;
    const remaining=endT-curSub.t;
    const toBoundary=params.mode==='kepler-ellipse'?nextBoundary-curSub.t:Infinity;
    const subH=Math.min(nominalSubH,remaining,toBoundary);
    const startT=curSub.t;
    const next = advSub(curSub, subH);

    if (params.mode === 'hohmann-transfer' && phase === 'transfer') {
      if (radialVelFn(curSub) > 0 && radialVelFn(next) <= 0) {
        const hit = bisectEvent(curSub, curSub.t, subH, advSub, radialVelFn, {
          timeTolerance: 1e-10,
          biasEndpoint: 'midpoint'
        });
        if (hit) {
          const atApo = hit.state;
          const rx = atApo.positions[0]!;
          const ry = atApo.positions[1]!;
          const vx = atApo.velocities[0]!;
          const vy = atApo.velocities[1]!;
          const rApo = Math.hypot(rx, ry);
          const vCircApoNorm = 1 / Math.sqrt(rApo);
          const vApoNorm = Math.hypot(vx, vy);
          deltaV2SI = scale.toSI(vCircApoNorm - vApoNorm, 'velocity');

          const ux = vApoNorm > 1e-12 ? vx / vApoNorm : -ry / rApo;
          const uy = vApoNorm > 1e-12 ? vy / vApoNorm : rx / rApo;
          const postBurnSub: VerletSubState = {
            positions: atApo.positions,
            velocities: [ux * vCircApoNorm, uy * vCircApoNorm],
            t: atApo.t
          };

          const ev: PhysicsEvent = {
            id: `hohmann-burn-2-${state.events.length + newEvents.length}`,
            time: state.tSim + (startT-state.tNorm + hit.timeOffset) / simRate,
            label: '远地点二次点火 Δv₂ 圆化轨道',
            position: { x: rx, y: ry },
            metrics: { rApoNorm: rApo, deltaV2SI,tNorm:atApo.t,bracketWidth:hit.bracketWidth/simRate }
          };
          newEvents.push(ev);
          phase = 'circularized';

          appendTrail(atApo,true);
          curSub = advSub(postBurnSub, subH - hit.timeOffset);
          appendTrail(curSub);
          continue;
        }
      }
    }

    curSub = next;
    appendTrail(curSub);
    if(params.mode==='kepler-ellipse'){
      const vertex={x:curSub.positions[0]!,y:curSub.positions[1]!};
      currentSectorVerts.push(vertex);
      if(curSub.t>=nextBoundary-1e-11){
        let area=0;
        for(let k=1;k<currentSectorVerts.length;k++){
          const a=currentSectorVerts[k-1]!,b=currentSectorVerts[k]!;
          area+=.5*(a.x*b.y-a.y*b.x);
        }
        sectors=[...sectors.slice(-5),{vertices:currentSectorVerts,areaDimless:Math.abs(area),startTNorm:sectorStartTNorm,endTNorm:nextBoundary}];
        currentSectorVerts=[vertex];sectorStartTNorm=nextBoundary;
      }
    }
  }

  const nx = curSub.positions[0]!;
  const ny = curSub.positions[1]!;
  const nvx = curSub.velocities[0]!;
  const nvy = curSub.velocities[1]!;

  return {
    nextState: {
      ...state,
      tSim: state.tSim + dt,
      tNorm: curSub.t,
      xNorm: nx,
      yNorm: ny,
      vxNorm: nvx,
      vyNorm: nvy,
      trailNorm:trailNorm.slice(-421),
      sectors,
      currentSectorVerts,
      sectorStartTNorm,
      hohmannPhase: phase,
      deltaV2SI,
      events: newEvents.length > 0 ? [...state.events, ...newEvents] : state.events
    },
    events: newEvents
  };
}

export function computeObservables(
  state: AstroOrbitalState,
  params: AstroOrbitalParams
): Record<string, number> {
  const { scale } = buildAstroScaleContext(params);
  const speedNorm = Math.hypot(state.vxNorm, state.vyNorm);
  if(params.mode==='binary-lagrange'){
    const {xNorm:x,yNorm:y,vxNorm:vx,vyNorm:vy,tNorm:t}=state;
    const g=binaryGravityAt(x,y,t,params.massRatioQ),r=Math.hypot(x,y);
    return {tSim:state.tSim,tNorm:t,tPhysicalS:scale.toSI(t,'time'),rNorm:r,speedNorm,
      rSI:scale.toSI(r,'length'),speedSI:scale.toSI(speedNorm,'velocity'),
      energyNorm:.5*speedNorm**2-g[0]!.potential-g[1]!.potential,angularMomNorm:x*vy-y*vx,
      jacobiConstant:binaryJacobi(x,y,vx,vy,t,params.massRatioQ),
      rotatingSpeedNorm:Math.hypot(vx+y,vy-x),deltaV1SI:0,deltaV2SI:0};
  }
  const m = twoBodyMetricsNorm(state.xNorm, state.yNorm, state.vxNorm, state.vyNorm);
  return {
    tSim: state.tSim,
    tNorm: state.tNorm,
    tPhysicalS:scale.toSI(state.tNorm,'time'),
    rNorm: m.r,
    speedNorm,
    rSI: scale.toSI(m.r, 'length'),
    speedSI: scale.toSI(speedNorm, 'velocity'),
    eccentricity: m.ecc,
    ...(m.a===null?{}:{semiMajorAxisNorm:m.a,aSI:scale.toSI(m.a,'length')}),
    energyNorm: m.energy,
    angularMomNorm: m.lz,
    deltaV1SI: state.deltaV1SI,
    deltaV2SI: state.deltaV2SI
  };
}

export function checkInvariants(
  state: AstroOrbitalState,
  _initial: AstroOrbitalState,
  params: AstroOrbitalParams
): InvariantReport[] {
  const obs = computeObservables(state, params);
  if(params.mode==='binary-lagrange'){
    const c0=state.jacobi0??binaryJacobi(_initial.xNorm,_initial.yNorm,_initial.vxNorm,_initial.vyNorm,_initial.tNorm,params.massRatioQ);
    const error=Math.abs(obs.jacobiConstant!-c0);
    return [{name:'圆型限制性三体雅可比积分 C 绝对漂移',measuredError:error,tolerance:1e-6,passed:Number.isFinite(error)&&error<1e-6}];
  }
  const circularized=params.mode==='hohmann-transfer'&&state.hohmannPhase==='circularized';
  const rho=Math.max(1.1,params.r2OverR1);
  const targetEnergy=circularized?-.5/rho:state.energyNorm0;
  const targetLz=circularized?Math.sqrt(rho):state.angularMomNorm0;
  const nearParabolic=Math.abs(targetEnergy)<1e-9;
  const relEnergyErr = Math.abs(obs.energyNorm! - targetEnergy) / (nearParabolic?1:Math.abs(targetEnergy));
  const relLzErr = Math.abs(obs.angularMomNorm! - targetLz) / Math.max(1e-9, Math.abs(targetLz));

  return [
    {
      name: nearParabolic?'抛物线临界比机械能绝对漂移':'分段比机械能辛积分相对漂移',
      measuredError: relEnergyErr,
      tolerance: 1e-6,
      passed: Number.isFinite(relEnergyErr) && relEnergyErr < 1e-6
    },
    {
      name: '比角动量相对漂移',
      measuredError: relLzErr,
      tolerance: 1e-7,
      passed: Number.isFinite(relLzErr) && relLzErr < 1e-7
    }
  ];
}
