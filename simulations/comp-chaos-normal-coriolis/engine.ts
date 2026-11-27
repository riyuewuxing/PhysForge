import {
  CLASSROOM_GRAVITY,
  degToRad,
  bisectEvent,
  integrateAdaptiveRK45,
  stepVelocityVerlet,
  type VerletState
} from '@physforge/physics-core';
import type { InvariantReport, StepResult } from '@physforge/sim-sdk';

export type CompAdvancedMode = 'double-pendulum' | 'normal-modes' | 'coriolis-disk';
export type NormalModeExcite = 'symmetric' | 'antisymmetric' | 'single-beat';

export type ChaosNormalCoriolisParams = {
  mode: CompAdvancedMode;
  m1Kg: number;
  m2Kg: number;
  l1M: number;
  l2M: number;
  theta1Deg: number;
  theta2Deg: number;
  springKw: number;
  springKc: number;
  normalExcite: NormalModeExcite;
  diskOmegaRadps: number;
  puckSpeedMps: number;
};

export interface ChaosNormalCoriolisState {
  readonly t: number;
  // Double pendulum primary & perturbed
  readonly dpState: readonly [number, number, number, number];
  readonly dpShadow: readonly [number, number, number, number];
  readonly dpInitialEnergy: number;
  readonly dpCurrentEnergy: number;
  readonly dpMaxRelDrift: number;
  readonly poincarePts: readonly { t:number; th1:number; th2:number; w1:number; w2:number; bracketWidth:number }[];
  // Normal modes
  readonly nmVerlet: VerletState;
  readonly nmPrevX1: number;
  readonly nmCrossingTimes: readonly number[];
  readonly nmTrail: readonly { t: number; x1: number; x2: number }[];
  // Coriolis disk (lab trajectory vs direct rotating-frame ODE)
  readonly labPos: { x: number; y: number };
  readonly labVel: { x: number; y: number };
  readonly rotDirectState: readonly [number, number, number, number];
  readonly coriolisDeviation: number;
  readonly coriolisTrail: readonly { lx: number; ly: number; rx: number; ry: number }[];
}

function doublePendulumEnergy(y: readonly [number, number, number, number], p: ChaosNormalCoriolisParams): number {
  const [th1, th2, w1, w2] = y;
  const m1 = p.m1Kg;
  const m2 = p.m2Kg;
  const L1 = p.l1M;
  const L2 = p.l2M;
  const g = CLASSROOM_GRAVITY;
  const ke =
    0.5 * (m1 + m2) * L1 * L1 * w1 * w1 +
    0.5 * m2 * L2 * L2 * w2 * w2 +
    m2 * L1 * L2 * w1 * w2 * Math.cos(th1 - th2);
  const pe = -(m1 + m2) * g * L1 * Math.cos(th1) - m2 * g * L2 * Math.cos(th2);
  return ke + pe;
}

function makeDoublePendulumDeriv(p: ChaosNormalCoriolisParams) {
  const m1 = p.m1Kg;
  const m2 = p.m2Kg;
  const L1 = p.l1M;
  const L2 = p.l2M;
  const g = CLASSROOM_GRAVITY;
  return (_t: number, y: readonly number[]): number[] => {
    const th1 = y[0]!;
    const th2 = y[1]!;
    const w1 = y[2]!;
    const w2 = y[3]!;
    const delta = th1 - th2;
    const sinD = Math.sin(delta);
    const cosD = Math.cos(delta);
    const denom1 = (2 * m1 + m2 - m2 * Math.cos(2 * delta));
    const a1 =
      (-g * (2 * m1 + m2) * Math.sin(th1) -
        m2 * g * Math.sin(th1 - 2 * th2) -
        2 * sinD * m2 * (w2 * w2 * L2 + w1 * w1 * L1 * cosD)) /
      (L1 * denom1);
    const a2 =
      (2 *
        sinD *
        (w1 * w1 * L1 * (m1 + m2) +
          g * (m1 + m2) * Math.cos(th1) +
          w2 * w2 * L2 * m2 * cosD)) /
      (L2 * denom1);
    return [w1, w2, a1, a2];
  };
}

export function createInitialState(params: ChaosNormalCoriolisParams): ChaosNormalCoriolisState {
  const th1 = degToRad(params.theta1Deg);
  const th2 = degToRad(params.theta2Deg);
  const dpState: [number, number, number, number] = [th1, th2, 0, 0];
  const dpShadow: [number, number, number, number] = [th1 + 1e-4, th2, 0, 0];
  const e0 = doublePendulumEnergy(dpState, params);

  const nmPos =
    params.normalExcite === 'symmetric'
      ? [0.6, 0.6]
      : params.normalExcite === 'antisymmetric'
        ? [0.6, -0.6]
        : [0.8, 0];

  const labPos = { x: 0, y: 0 };
  const labVel = { x: Math.max(0, params.puckSpeedMps), y: 0 };

  return {
    t: 0,
    dpState,
    dpShadow,
    dpInitialEnergy: e0,
    dpCurrentEnergy: e0,
    dpMaxRelDrift: 0,
    poincarePts: [],
    nmVerlet: { positions: nmPos, velocities: [0, 0], t: 0 },
    nmPrevX1: nmPos[0]!,
    nmCrossingTimes: [],
    nmTrail: [{ t: 0, x1: nmPos[0]!, x2: nmPos[1]! }],
    labPos,
    labVel,
    rotDirectState: [labPos.x, labPos.y, labVel.x, labVel.y],
    coriolisDeviation: 0,
    coriolisTrail: [{ lx: labPos.x, ly: labPos.y, rx: labPos.x, ry: labPos.y }]
  };
}

export function stepChaosNormalCoriolis(
  state: ChaosNormalCoriolisState,
  params: ChaosNormalCoriolisParams,
  dt: number
): StepResult<ChaosNormalCoriolisState> {
  if (!Number.isFinite(dt) || dt < 0) throw new Error(`Invalid dt: ${dt}`);
  if (dt === 0) return { nextState: state, events: [] };

  const events: StepResult<ChaosNormalCoriolisState>['events']=[];
  // 1. Double pendulum RK45
  let dpState = state.dpState;
  let dpShadow = state.dpShadow;
  let dpCurE = state.dpCurrentEnergy;
  let dpMaxRelDrift = state.dpMaxRelDrift;
  let poincarePts = state.poincarePts;
  if (params.mode === 'double-pendulum') {
    const deriv = makeDoublePendulumDeriv(params);
    const opts={absTol:1e-11,relTol:1e-10,maxSubsteps:4000};
    type DP=ChaosNormalCoriolisState['dpState'];
    const advance=(y:DP,t:number,h:number):DP=>{
      const r=integrateAdaptiveRK45(y,t,h,deriv,opts).state;
      return [r[0]!,r[1]!,r[2]!,r[3]!];
    };
    // Small search brackets; locate upward theta1=2pi*k crossings by re-integrating, not endpoint interpolation.
    const n=Math.max(1,Math.ceil(dt/.01)),h=dt/n;
    for(let j=0;j<n;j++){
      const t=state.t+j*h,before=dpState,after=advance(before,t,h);
      const turn=2*Math.PI;
      // A section can be crossed upward and back downward within one search
      // bracket. Isolate a bracketed extremum of theta1 before testing roots.
      const cut=before[2]*after[2]<0?bisectEvent(before,t,h,(y,sub)=>advance(y,t,sub),y=>y[2],{timeTolerance:1e-9}):null;
      const segments=cut&&cut.timeOffset>0&&cut.timeOffset<h?
        [{a:before,b:cut.state,t0:t,dt:cut.timeOffset},{a:cut.state,b:after,t0:cut.time,dt:h-cut.timeOffset}]:
        [{a:before,b:after,t0:t,dt:h}];
      for(const part of segments){
        for(let k=Math.floor(part.a[0]/turn)+1;k<=Math.floor(part.b[0]/turn);k++){
          const target=k*turn;
          const hit=bisectEvent(part.a,part.t0,part.dt,(y,sub)=>advance(y,part.t0,sub),y=>y[0]-target,{timeTolerance:1e-8});
          if(hit&&hit.state[2]>0){
            const y=hit.state;
            const point={t:hit.time,th1:y[0],th2:principalAngle(y[1]),w1:y[2],w2:y[3],bracketWidth:hit.bracketWidth};
            if(!poincarePts.length||point.t-poincarePts[poincarePts.length-1]!.t>1e-7){
              poincarePts=[...poincarePts.slice(-119),point];
              events.push({id:'poincare-'+point.t.toFixed(8),time:point.t,label:'θ₁=2πk，ω₁>0',metrics:{theta2:point.th2,omega2:point.w2}});
            }
          }
        }
      }
      dpState=after;
      dpShadow=advance(dpShadow,t,h);
      dpCurE=doublePendulumEnergy(dpState,params);
      dpMaxRelDrift=Math.max(dpMaxRelDrift,Math.abs(dpCurE-state.dpInitialEnergy)/dpEnergyScale(state.dpInitialEnergy,params));
    }
  }

  // 2. Normal modes Verlet
  let nmVerlet = state.nmVerlet;
  let nmCrossings = state.nmCrossingTimes;
  let nmPrev = state.nmPrevX1;
  let nmTrail = state.nmTrail;
  if (params.mode === 'normal-modes') {
    const m = Math.max(0.2, params.m1Kg);
    const kw = Math.max(1, params.springKw);
    const kc = Math.max(0.1, params.springKc);
    const sub = Math.max(8, Math.ceil(dt / 0.0005));
    const h = dt / sub;
    const accel = (pos: readonly number[]): number[] => {
      const x1 = pos[0]!;
      const x2 = pos[1]!;
      return [(-kw * x1 - kc * (x1 - x2)) / m, (-kw * x2 - kc * (x2 - x1)) / m];
    };
    for (let i = 0; i < sub; i++) {
      const prevT = nmVerlet.t;
      const prevX1 = nmVerlet.positions[0]!;
      nmVerlet = stepVelocityVerlet(nmVerlet, h, accel);
      const curX1 = nmVerlet.positions[0]!;
      if (prevX1 < 0 && curX1 >= 0) {
        const frac = -prevX1 / (curX1 - prevX1);
        nmCrossings = [...nmCrossings.slice(-20), prevT + frac * h];
      }
      nmPrev = curX1;
    }
    nmTrail = [...nmTrail.slice(-160), { t: nmVerlet.t, x1: nmVerlet.positions[0]!, x2: nmVerlet.positions[1]! }];
  }

  // 3. Coriolis disk
  let labPos = state.labPos;
  let rotDirect = state.rotDirectState;
  let corDev = state.coriolisDeviation;
  let corTrail = state.coriolisTrail;
  if (params.mode === 'coriolis-disk') {
    const Om = params.diskOmegaRadps;
    const nextT = state.t + dt;
    labPos = {
      x: state.labPos.x + state.labVel.x * dt,
      y: state.labPos.y + state.labVel.y * dt
    };
    const rotDeriv = (_t: number, y: readonly number[]): number[] => {
      const rx = y[0]!;
      const ry = y[1]!;
      const vx = y[2]!;
      const vy = y[3]!;
      // -2*(Omega x v) - Omega x (Omega x r) for Omega = (0, 0, Om)
      const ax = 2 * Om * vy + Om * Om * rx;
      const ay = -2 * Om * vx + Om * Om * ry;
      return [vx, vy, ax, ay];
    };
    const resRot = integrateAdaptiveRK45(state.rotDirectState, state.t, dt, rotDeriv, {
      absTol: 1e-11,
      relTol: 1e-10,
      maxSubsteps: 2000
    });
    rotDirect = [resRot.state[0]!, resRot.state[1]!, resRot.state[2]!, resRot.state[3]!];
    const cosOt = Math.cos(-Om * nextT);
    const sinOt = Math.sin(-Om * nextT);
    const rxFromLab = labPos.x * cosOt - labPos.y * sinOt;
    const ryFromLab = labPos.x * sinOt + labPos.y * cosOt;
    corDev = Math.hypot(rotDirect[0]! - rxFromLab, rotDirect[1]! - ryFromLab);
    corTrail = [...corTrail.slice(-180), { lx: labPos.x, ly: labPos.y, rx: rotDirect[0]!, ry: rotDirect[1]! }];
  }

  return {
    nextState: {
      t: state.t + dt,
      dpState,
      dpShadow,
      dpInitialEnergy: state.dpInitialEnergy,
      dpCurrentEnergy: dpCurE,
      dpMaxRelDrift,
      poincarePts,
      nmVerlet,
      nmPrevX1: nmPrev,
      nmCrossingTimes: nmCrossings,
      nmTrail,
      labPos,
      labVel: state.labVel,
      rotDirectState: rotDirect,
      coriolisDeviation: corDev,
      coriolisTrail: corTrail
    },
    events
  };
}

export function principalAngle(theta:number):number{return Math.atan2(Math.sin(theta),Math.cos(theta));}
function dpEnergyScale(initial:number,p:ChaosNormalCoriolisParams):number{
  return Math.max(1,Math.abs(initial),CLASSROOM_GRAVITY*((p.m1Kg+p.m2Kg)*p.l1M+p.m2Kg*p.l2M));
}
export function normalQuantities(s:ChaosNormalCoriolisState,p:ChaosNormalCoriolisParams){
  const m=Math.max(.2,p.m1Kg),kw=Math.max(1,p.springKw),kc=Math.max(.1,p.springKc);
  const [x1=0,x2=0]=s.nmVerlet.positions,[v1=0,v2=0]=s.nmVerlet.velocities;
  const K=.5*m*(v1*v1+v2*v2),Uwall=.5*kw*(x1*x1+x2*x2),Ucoupling=.5*kc*(x1-x2)**2;
  const Es=.25*m*(v1+v2)**2+.25*kw*(x1+x2)**2;
  const Ea=.25*m*(v1-v2)**2+.25*(kw+2*kc)*(x1-x2)**2;
  return {x1,x2,v1,v2,K,Uwall,Ucoupling,E:K+Uwall+Ucoupling,Es,Ea,w1:Math.sqrt(kw/m),w2:Math.sqrt((kw+2*kc)/m)};
}
export function coriolisQuantities(s:ChaosNormalCoriolisState,p:ChaosNormalCoriolisParams){
  const [x,y,vx,vy]=s.rotDirectState,w=p.diskOmegaRadps,c=Math.cos(w*s.t),sn=Math.sin(w*s.t);
  const labX=s.labPos.x*c+s.labPos.y*sn,labY=-s.labPos.x*sn+s.labPos.y*c;
  const labVx=s.labVel.x*c+s.labVel.y*sn+w*labY,labVy=-s.labVel.x*sn+s.labVel.y*c-w*labX;
  return {x,y,vx,vy,axC:2*w*vy,ayC:-2*w*vx,axF:w*w*x,ayF:w*w*y,
    positionError:Math.hypot(x-labX,y-labY),velocityError:Math.hypot(vx-labVx,vy-labVy),
    r:Math.hypot(x,y),labR:Math.hypot(s.labPos.x,s.labPos.y)};
}
export function computeObservables(s: ChaosNormalCoriolisState,p:ChaosNormalCoriolisParams): Record<string, number> {
  if(p.mode==='normal-modes'){
    const q=normalQuantities(s,p);
    return {t:s.t,x1Nm:q.x1,x2Nm:q.x2,v1Nm:q.v1,v2Nm:q.v2,normalEnergyJ:q.E,normalSymEnergyJ:q.Es,normalAntiEnergyJ:q.Ea,kineticEnergy:q.K,potentialEnergy:q.Uwall+q.Ucoupling};
  }
  if(p.mode==='coriolis-disk'){
    const q=coriolisQuantities(s,p);
    return {t:s.t,coriolisDeviation:q.positionError,coriolisVelocityError:q.velocityError,labRadius:q.labR,rotRadius:q.r,rotX:q.x,rotY:q.y,coriolisAccel:Math.hypot(q.axC,q.ayC),centrifugalAccel:Math.hypot(q.axF,q.ayF)};
  }
  return {t:s.t,dpEnergyDriftRel:s.dpMaxRelDrift,dpDivergenceRad:Math.hypot(principalAngle(s.dpState[0]-s.dpShadow[0]),principalAngle(s.dpState[1]-s.dpShadow[1])),
    dpTheta1:principalAngle(s.dpState[0]),dpTheta2:principalAngle(s.dpState[1]),dpOmega1:s.dpState[2],dpOmega2:s.dpState[3],dpEnergyJ:s.dpCurrentEnergy,poincareCount:s.poincarePts.length};
}
export function checkInvariants(s: ChaosNormalCoriolisState,initial: ChaosNormalCoriolisState,p: ChaosNormalCoriolisParams): InvariantReport[] {
  const report=(name:string,e:number,tolerance:number,unit?:string):InvariantReport=>({name,measuredError:e,tolerance,passed:Number.isFinite(e)&&e<tolerance,...(unit?{unit}:{})});
  if(p.mode==='normal-modes'){
    const q=normalQuantities(s,p),a=normalQuantities(initial,p),scale=Math.max(1e-12,a.E);
    return [report('等质量双振子真实机械能相对误差',Math.abs(q.E-a.E)/scale,3e-5),
      report('同相模能量相对总初能误差',Math.abs(q.Es-a.Es)/scale,3e-5),
      report('反相模能量相对总初能误差',Math.abs(q.Ea-a.Ea)/scale,3e-5)];
  }
  if(p.mode==='coriolis-disk'){
    const q=coriolisQuantities(s,p);
    return [report('旋转系直接积分与坐标变换位置偏差',q.positionError,1e-6,'m'),report('旋转系速度变换偏差',q.velocityError,1e-6,'m/s')];
  }
  const e=doublePendulumEnergy(initial.dpState,p),scale=dpEnergyScale(e,p);
  return [report('双摆 RK45 机械能最大相对漂移',Math.max(s.dpMaxRelDrift,Math.abs(doublePendulumEnergy(s.dpState,p)-e)/scale),1e-6),
    report('邻近双摆独立机械能误差',Math.abs(doublePendulumEnergy(s.dpShadow,p)-doublePendulumEnergy(initial.dpShadow,p))/scale,1e-6)];
}
