import { CLASSROOM_GRAVITY, bisectEvent } from '@physforge/physics-core';
import type { InvariantReport, PhysicsEvent, StepResult } from '@physforge/sim-sdk';

export const EPSILON_0 = 8.8541878128e-12;
export const BASE_AREA_M2 = 0.04;

export type CapSwitchMode = 'closed-const-u' | 'open-const-q';
export type GroundMode = 'bottom' | 'top' | 'none';

export type CapacitorMillikanParams = {
  switchMode: CapSwitchMode;
  groundMode: GroundMode;
  sourceVoltageU0: number;
  distanceMm: number;
  refDistanceMm: number;
  areaRatioS: number;
  refAreaRatioS: number;
  dielectricEr: number;
  refDielectricEr: number;
  probeFracP: number;
  oilDropEnabled: boolean;
  dropChargeSteps: number; // number of excess electrons
  dropMassScale: number;
  stokesDrag: number;
};


export const ELEMENTARY_CHARGE=1.602176634e-19;
export const DROP_MASS_BASE=2*ELEMENTARY_CHARGE*10000/CLASSROOM_GRAVITY;
export const DISPLAY_LENGTH_PER_M=70;

export interface CapacitorMillikanState {
  readonly t:number;
  readonly dropYFrac:number;
  readonly dropVy:number;
  readonly capacitanceF:number;
  readonly chargeC:number;
  readonly voltageV:number;
  readonly fieldE:number;
  readonly phiPV:number;
  readonly electrometerAngleDeg:number;
  readonly terminal:'bottom'|'top'|null;
  readonly events:readonly PhysicsEvent[];
}

export function computeCapacitorMetrics(p:CapacitorMillikanParams){
  const dMeters=Math.max(.002,p.distanceMm*1e-3);
  const area=Math.max(.05,p.areaRatioS)*BASE_AREA_M2;
  const er=Math.max(1,p.dielectricEr);
  const capacitanceF=EPSILON_0*er*area/dMeters;
  const referenceCapacitanceF=EPSILON_0*Math.max(1,p.refDielectricEr)*Math.max(.05,p.refAreaRatioS)*BASE_AREA_M2/Math.max(.002,p.refDistanceMm*1e-3);
  const referenceChargeC=referenceCapacitanceF*p.sourceVoltageU0;
  const open=p.switchMode==='open-const-q';
  const chargeC=open?referenceChargeC:capacitanceF*p.sourceVoltageU0;
  const voltageV=open?chargeC/capacitanceF:p.sourceVoltageU0;
  const gradient=open?chargeC/(EPSILON_0*er*area):voltageV/dMeters;
  const fieldEy=gradient===0?0:-gradient,fieldE=Math.abs(fieldEy);
  const phiBottomV=p.groundMode==='bottom'?0:p.groundMode==='top'?-voltageV:-voltageV/2;
  const phiTopV=phiBottomV+voltageV;
  const phiPV=phiBottomV+voltageV*Math.max(0,Math.min(1,p.probeFracP));
  return {capacitanceF,chargeC,voltageV,fieldE,fieldEy,phiPV,phiBottomV,phiTopV,dMeters,referenceChargeC,referenceCapacitanceF,area,energyJ:.5*capacitanceF*voltageV**2};
}

export function getDropPhysicalParams(p:CapacitorMillikanParams){
  const n=Math.max(0,Math.round(p.dropChargeSteps));
  return {mass:Math.max(.1,p.dropMassScale)*DROP_MASS_BASE,charge:n===0?0:-n*ELEMENTARY_CHARGE,beta:Math.max(0,p.stokesDrag),n};
}

/** Shared geometry used by canvas, diagram export, handles and reference frame. */
export function capacitorGeometry(p:CapacitorMillikanParams){
  const halfD=computeCapacitorMetrics(p).dMeters*DISPLAY_LENGTH_PER_M/2;
  const shift=3*(1-Math.max(.05,Math.min(1,p.areaRatioS)));
  const left=-1.5+shift,right=1.5;
  return {halfD,left,right,topLeft:left,topRight:1.5+shift,dropX:left+.65*(right-left),probeX:left+.25*(right-left)};
}

function stateMetrics(p:CapacitorMillikanParams){
  const m=computeCapacitorMetrics(p);
  return {capacitanceF:m.capacitanceF,chargeC:m.chargeC,voltageV:m.voltageV,fieldE:m.fieldE,phiPV:m.phiPV,
    electrometerAngleDeg:Math.min(82,Math.abs(m.voltageV)*.16)};
}

export function createInitialState(p:CapacitorMillikanParams):CapacitorMillikanState{
  return {t:0,dropYFrac:.5,dropVy:0,...stateMetrics(p),terminal:null,events:[]};
}

type Drop={y:number;v:number};
function advanceDrop(s:Drop,h:number,a:number,b:number):Drop{
  if(b===0)return {y:s.y+s.v*h+.5*a*h*h,v:s.v+a*h};
  const z=b*h;
  // expm1 and series avoid loss of the acceleration displacement for tiny beta*h.
  const f=-Math.expm1(-z);
  const A=z<1e-4?h*(1-z/2+z*z/6-z*z*z/24):f/b;
  const B=z<1e-4?h*h*(.5-z/6+z*z/24-z*z*z/120):(h-A)/b;
  return {y:s.y+s.v*A+a*B,v:s.v*Math.exp(-z)+a*A};
}
export function stepCapacitorMillikan(state:CapacitorMillikanState,p:CapacitorMillikanParams,dt:number):StepResult<CapacitorMillikanState>{
  if(!Number.isFinite(dt)||dt<0)throw Error('Invalid dt: '+dt);
  if(state.terminal)return {nextState:state,events:[],halt:true,advancedTime:0};
  const metrics=stateMetrics(p);
  if(dt===0||!p.oilDropEnabled)return {nextState:{...state,...metrics,t:state.t+dt},events:[]};
  const m=computeCapacitorMetrics(p),q=getDropPhysicalParams(p);
  const a=q.charge*m.fieldEy/q.mass-CLASSROOM_GRAVITY,b=q.beta;
  const start:Drop={y:state.dropYFrac*m.dMeters,v:state.dropVy};
  const advance=(s:Drop,h:number)=>advanceDrop(s,h,a,b);
  const cuts=[0,dt];
  // Velocity can cross zero at most once; bracket each monotonic part separately.
  if(start.v*a<0){
    const turn=b===0?-start.v/a:Math.log1p(-b*start.v/a)/b;
    if(turn>0&&turn<dt)cuts.splice(1,0,turn);
  }
  for(let i=1;i<cuts.length;i++){
    const lo=cuts[i-1]!,hi=cuts[i]!,s0=advance(start,lo),s1=advance(start,hi);
    const boundary=s1.y<=0?'bottom':s1.y>=m.dMeters?'top':null;
    if(!boundary)continue;
    const y=boundary==='bottom'?0:m.dMeters;
    const hit=bisectEvent(s0,state.t+lo,hi-lo,advance,s=>s.y-y,{timeTolerance:1e-12,triggerOnStartZero:true});
    if(!hit)throw Error('E02 first contact could not be bracketed');
    const t=state.t+lo+hit.timeOffset,geom=capacitorGeometry(p);
    const ev:PhysicsEvent={id:'drop-contact-'+boundary,label:boundary==='bottom'?'首次触及下板 · 碰撞前停止':'首次触及上板 · 碰撞前停止',time:t,
      position:{x:geom.dropX,y:boundary==='bottom'?-geom.halfD:geom.halfD},metrics:{heightM:y,velocityMps:hit.state.v}};
    return {nextState:{...state,...metrics,t,dropYFrac:boundary==='bottom'?0:1,dropVy:hit.state.v,terminal:boundary,events:[...state.events,ev]},events:[ev],halt:true,advancedTime:t-state.t};
  }
  const end=advance(start,dt);
  return {nextState:{...state,...metrics,t:state.t+dt,dropYFrac:end.y/m.dMeters,dropVy:end.v},events:[]};
}

export function computeObservables(s:CapacitorMillikanState,p:CapacitorMillikanParams):Record<string,number>{
  const m=computeCapacitorMetrics(p),q=getDropPhysicalParams(p);
  const force=q.charge*m.fieldEy,weight=q.mass*CLASSROOM_GRAVITY,drag=-q.mass*q.beta*s.dropVy;
  const height=s.dropYFrac*m.dMeters;
  return {t:s.t,capacitancePF:m.capacitanceF*1e12,chargeNC:m.chargeC*1e9,voltageV:m.voltageV,fieldE:m.fieldE,fieldEy:m.fieldEy,
    phiPV:m.phiPV,phiTopV:m.phiTopV,phiBottomV:m.phiBottomV,storedEnergyUJ:m.energyJ*1e6,
    ...(p.switchMode==='open-const-q'?{referenceChargeNC:m.referenceChargeC*1e9}:{}),
    electrometerAngleDeg:Math.min(82,Math.abs(m.voltageV)*.16),
    ...(p.oilDropEnabled?{dropHeightMm:height*1e3,dropVyMmS:s.dropVy*1e3,dropChargeC:q.charge,dropMassKg:q.mass,dropChargeSteps:q.n,dropElectricForceN:force,dropWeightN:weight,dropDragForceN:drag,dropAcceleration:(force-weight+drag)/q.mass,
      terminal:s.terminal?1:0,dropContact:s.terminal==='bottom'?-1:s.terminal==='top'?1:0,
      ...(q.beta>0?{terminalVelocityMmS:(force-weight)/(q.mass*q.beta)*1e3}:{})}:{})};
}

export function checkInvariants(s:CapacitorMillikanState,initial:CapacitorMillikanState,p:CapacitorMillikanParams):InvariantReport[]{
  const m=computeCapacitorMetrics(p);
  const report=(name:string,err:number,tolerance=1e-10):InvariantReport=>({name,measuredError:err,tolerance,passed:Number.isFinite(err)&&err<=tolerance});
  const qScale=Math.max(1e-18,Math.abs(m.chargeC));
  const reports=[report('电容基本定义式 Q = C·U',Math.abs(s.chargeC-s.capacitanceF*s.voltageV)/qScale),
    report('有向场强与电势梯度',Math.abs(m.fieldEy*m.dMeters+m.voltageV)/Math.max(1,Math.abs(m.voltageV)))];
  if(p.switchMode==='open-const-q')reports.push(report('固定参考电荷 Q=Qref',Math.abs(s.chargeC-m.referenceChargeC)/qScale));
  if(p.oilDropEnabled){
    const q=getDropPhysicalParams(p);
    reports.push(report('油滴板间非穿透',Math.max(0,-s.dropYFrac,s.dropYFrac-1)));
    if(q.beta===0){
      const energy=(x:CapacitorMillikanState)=>.5*q.mass*x.dropVy**2+(q.mass*CLASSROOM_GRAVITY-q.charge*m.fieldEy)*x.dropYFrac*m.dMeters;
      const scale=Math.max(1e-30,q.mass*CLASSROOM_GRAVITY*m.dMeters,Math.abs(energy(initial)));
      reports.push(report('固定场内无阻尼油滴总能量',Math.abs(energy(s)-energy(initial))/scale,1e-8));
    }
  }
  return reports;
}
