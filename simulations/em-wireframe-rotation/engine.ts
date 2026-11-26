import { bisectEvent, CLASSROOM_GRAVITY, stepRK4 } from '@physforge/physics-core';
import type { InvariantReport, PhysicsEvent, StepResult } from '@physforge/sim-sdk';

export type WireframeMode = 'wireframe-gravity-fall' | 'rotating-rod' | 'faraday-disk';
export type LoopShape = 'square' | 'triangle' | 'circle';
export type FieldProfile = 'single-zone' | 'dual-opposite' | 'linear-gradient';

export type WireframeParams = {
  mode: WireframeMode;
  loopShape: LoopShape;
  fieldProfile: FieldProfile;
  magneticB: number;
  loopSizeL: number;
  zoneHeightH: number;
  massM: number;
  resistanceR: number;
  initialVy: number;
  omegaRadS: number;
  gravityEnabled: boolean;
};


export interface WireframeState {
  readonly t:number;
  readonly centerY:number;
  readonly vy:number;
  readonly angleRad:number;
  readonly fluxWb:number;
  readonly dPhiDy:number;
  readonly sweptFluxWb:number;
  readonly emfV:number;
  readonly currentA:number;
  readonly ampereForceN:number;
  readonly emTorqueNm:number;
  readonly drivePowerW:number;
  readonly driveWorkJ:number;
  readonly jouleHeatJ:number;
  readonly initialY:number;
  readonly initialEnergy:number;
  readonly peakEmfV:number;
  readonly events:readonly PhysicsEvent[];
}
const size=(p:WireframeParams)=>Math.max(.2,p.loopSizeL);
const height=(p:WireframeParams)=>Math.max(.4,p.zoneHeightH);
const resistance=(p:WireframeParams)=>Math.max(.05,p.resistanceR);
const mass=(p:WireframeParams)=>Math.max(.05,p.massM);
interface FieldSegment{lo:number;hi:number;b:number;g:number}
interface FieldJump{y:number;delta:number}
function profile(p:WireframeParams):{segments:FieldSegment[];jumps:FieldJump[]}{
  const H=height(p),B=p.magneticB;
  if(p.fieldProfile==='single-zone')return {segments:[{lo:-H,hi:0,b:B,g:0}],jumps:[{y:0,delta:-B},{y:-H,delta:B}]};
  if(p.fieldProfile==='dual-opposite')return {segments:[{lo:-H,hi:0,b:B,g:0},{lo:-2*H,hi:-H,b:-B,g:0}],jumps:[{y:0,delta:-B},{y:-H,delta:2*B},{y:-2*H,delta:-B}]};
  return {segments:[{lo:-2*H,hi:0,b:B,g:-B/(2*H)}],jumps:[{y:0,delta:-B},{y:-2*H,delta:2*B}]};
}
export function fieldAtWorldY(y:number,p:WireframeParams){
  const s=profile(p).segments.find(s=>y<=s.hi&&y>=s.lo);
  return s?s.b+s.g*y:0;
}
function primitive(u:number,p:WireframeParams){
  const L=size(p),r=L/2,x=Math.max(-r,Math.min(r,u));
  if(p.loopShape==='square')return {a:L*x,m:L*x*x/2};
  if(p.loopShape==='triangle')return {a:L*x/2-x*x/2,m:L*x*x/4-x*x*x/3};
  const root=Math.sqrt(Math.max(0,r*r-x*x));
  return {a:x*root+r*r*Math.asin(x/r),m:-2*root**3/3};
}
function width(u:number,p:WireframeParams){
  const L=size(p),r=L/2,x=Math.max(-r,Math.min(r,u));
  return p.loopShape==='square'?L:p.loopShape==='triangle'?L/2-x:2*Math.sqrt(Math.max(0,r*r-x*x));
}
/** Exact area and first moment in the overlap. Derivative at a discontinuity
 * is the one-sided value for downward motion (u=-r included, u=r excluded).
 * A fixed branch anchor is used only for an event-bracketing extrapolation. */
function fluxAt(yc:number,p:WireframeParams,model:ReturnType<typeof profile>,branchY=yc){
  const r=size(p)/2;
  let fluxWb=0,dPhiDy=0;
  for(const s of model.segments){
    const lo=Math.max(-r,s.lo-yc),hi=Math.min(r,s.hi-yc);
    if(hi<=lo)continue;
    const a=primitive(lo,p),b=primitive(hi,p),area=b.a-a.a;
    fluxWb+=(s.b+s.g*yc)*area+s.g*(b.m-a.m);
    dPhiDy+=s.g*area;
  }
  for(const b of model.jumps){
    if(branchY<=b.y+r&&branchY>b.y-r)dPhiDy+=b.delta*width(b.y-yc,p);
  }
  return {fluxWb,dPhiDy};
}
export function computeFluxAndCuttingFactor(yc:number,p:WireframeParams){
  return fluxAt(yc,p,profile(p));
}
export function rotatingMetrics(p:WireframeParams,angle:number){
  const L=size(p),c=.5*p.magneticB*L*L,emfV=c*p.omegaRadS,currentA=emfV/resistance(p),emTorqueNm=-c*currentA,drivePowerW=emfV*currentA;
  return {fluxWb:p.mode==='faraday-disk'?p.magneticB*Math.PI*L*L:0,sweptFluxWb:c*angle,emfV,currentA,emTorqueNm,drivePowerW};
}
function fallMetrics(y:number,v:number,p:WireframeParams){
  const {fluxWb,dPhiDy}=computeFluxAndCuttingFactor(y,p),emfV=-dPhiDy*v,currentA=emfV/resistance(p);
  return {fluxWb,dPhiDy,emfV,currentA,ampereForceN:dPhiDy*currentA};
}
export function createInitialState(p:WireframeParams):WireframeState{
  const fall=p.mode==='wireframe-gravity-fall',centerY=fall?size(p)/2+.25:0,vy=fall?-Math.abs(p.initialVy):0;
  const g=fall&&p.gravityEnabled?CLASSROOM_GRAVITY:0;
  const common={t:0,centerY,vy,angleRad:0,dPhiDy:0,sweptFluxWb:0,ampereForceN:0,emTorqueNm:0,drivePowerW:0,driveWorkJ:0,jouleHeatJ:0,
    initialY:centerY,initialEnergy:.5*mass(p)*vy*vy+mass(p)*g*centerY,events:[]};
  const fields=fall?fallMetrics(centerY,vy,p):rotatingMetrics(p,0);
  return {...common,...fields,peakEmfV:Math.abs(fields.emfV)};
}
interface FallState{y:number;v:number;q:number}
function constantDrag(s:FallState,h:number,g:number,k:number,m:number):FallState{
  if(k===0)return {y:s.y+s.v*h-.5*g*h*h,v:s.v-g*h,q:s.q};
  const z=k*h;
  const A=z<1e-4?h*(1-z/2+z*z/6-z*z*z/24):(-Math.expm1(-z))/k;
  const B=z<1e-4?h*h*(.5-z/6+z*z/24-z*z*z/120):(h-A)/k;
  const vel=(t:number)=>s.v*Math.exp(-k*t)-g*(-Math.expm1(-k*t))/k;
  // Independent Gauss integration of dissipated power; not a residual of energy.
  // Caller keeps k*h <= .1, so the smooth integrand is well resolved.
  const c=Math.sqrt(3/5),h2=h/2,heat=m*k*h2*(5/9*vel(h2*(1-c))**2+8/9*vel(h2)**2+5/9*vel(h2*(1+c))**2);
  return {y:s.y+s.v*A-g*B,v:s.v*Math.exp(-z)-g*A,q:s.q+heat};
}
export function stepWireframeRotation(state:WireframeState,p:WireframeParams,dt:number):StepResult<WireframeState>{
  if(!Number.isFinite(dt)||dt<0)throw Error('Invalid dt: '+dt);
  if(dt===0)return {nextState:state,events:[]};
  const t=state.t+dt;
  if(!Number.isFinite(t))throw Error('Invalid resulting time');
  const R=resistance(p),m=mass(p);
  if(p.mode!=='wireframe-gravity-fall'){
    const angleRad=state.angleRad+p.omegaRadS*dt,o=rotatingMetrics(p,angleRad);
    const driveWorkJ=state.driveWorkJ+o.drivePowerW*dt;
    return {nextState:{...state,...o,t,angleRad,ampereForceN:0,driveWorkJ,jouleHeatJ:state.jouleHeatJ+o.currentA**2*R*dt,
      peakEmfV:Math.max(state.peakEmfV,Math.abs(o.emfV))},events:[]};
  }
  const g=p.gravityEnabled?CLASSROOM_GRAVITY:0,model=profile(p),r=size(p)/2;
  const boundaries=[...new Set(model.jumps.flatMap(b=>[b.y+r,b.y-r]))].sort((a,b)=>b-a);
  const exact=p.loopShape==='square'&&p.fieldProfile!=='linear-gradient';
  // G bound from signed jumps plus bulk gradient, independent of numerical flux.
  const pos=model.jumps.reduce((n,b)=>n+Math.max(0,b.delta),0),neg=model.jumps.reduce((n,b)=>n+Math.max(0,-b.delta),0);
  const bulk=model.segments.reduce((n,s)=>n+Math.abs(s.g)*size(p)**2,0);
  const Gbound=Math.max(pos,neg)*size(p)+bulk,kBound=Gbound*Gbound/(m*R);
  let cur:FallState={y:state.centerY,v:state.vy,q:state.jouleHeatJ},elapsed=0,peak=state.peakEmfV;
  const events:PhysicsEvent[]=[];
  // The initial velocity is downward and gravity/drag cannot reverse it.
  // For every monotone segment, integrate using one fixed side of the discontinuity.
  while(elapsed<dt){
    const rem=dt-elapsed;
    if(rem<=Math.max(1e-15,Number.EPSILON*dt))break;
    if(cur.v===0&&g===0)break;
    const anchor=cur.y,entry=fluxAt(anchor,p,model),k=entry.dPhiDy**2/(m*R);
    const belowAll=anchor<=(boundaries.at(-1)??-Infinity);
    const step=belowAll?rem:Math.min(rem,exact?(k>0?Math.min(.05,.1/k):.05):Math.min(.002,kBound>0?.1/kBound:.002));
    if(!(step>0)||elapsed+step===elapsed)throw Error('E05 step cannot progress');
    const advance=(s:FallState,h:number):FallState=>{
      if(exact||belowAll)return constantDrag(s,h,g,k,m);
      const z=stepRK4([s.y,s.v,s.q],state.t+elapsed,h,(_t,v)=>{
        const G=fluxAt(v[0]!,p,model,anchor).dPhiDy,I=-G*v[1]!/R;
        return [v[1]!,-g+G*I/m,I*I*R];
      });
      return {y:z[0]!,v:z[1]!,q:z[2]!};
    };
    const next=advance(cur,step),target=boundaries.find(y=>y<cur.y&&next.y<=y);
    if(target!==undefined){
      const hit=bisectEvent(cur,state.t+elapsed,step,advance,s=>s.y-target,{timeTolerance:1e-12,triggerOnStartZero:false});
      if(!hit)throw Error('E05 boundary bracket failed');
      const h=hit.timeOffset;
      if(h<=0)throw Error('E05 boundary did not advance');
      cur={...hit.state,y:target};elapsed+=h;
      const before=fluxAt(target,p,model,anchor).dPhiDy,after=fluxAt(target,p,model).dPhiDy;
      peak=Math.max(peak,Math.abs(before*cur.v),Math.abs(after*cur.v));
      events.push({id:'wire-boundary-'+target,label:'线框边缘通过磁场边界',time:state.t+elapsed,position:{x:0,y:target},
        metrics:{velocityMps:cur.v,cuttingBefore:before,cuttingAfter:after}});
    }else{cur=next;elapsed+=step;peak=Math.max(peak,Math.abs(fluxAt(cur.y,p,model).dPhiDy*cur.v));}
  }
  const o=fallMetrics(cur.y,cur.v,p);
  return {nextState:{...state,...o,t,centerY:cur.y,vy:cur.v,jouleHeatJ:cur.q,peakEmfV:Math.max(peak,Math.abs(o.emfV)),events:[...state.events,...events]},events};
}
export function computeObservables(s:WireframeState,p:WireframeParams):Record<string,number>{
  const m=mass(p),fall=p.mode==='wireframe-gravity-fall',g=fall&&p.gravityEnabled?CLASSROOM_GRAVITY:0;
  const common={t:s.t,emfV:s.emfV,currentA:s.currentA,jouleHeatJ:s.jouleHeatJ};
  if(!fall)return {...common,...(p.mode==='faraday-disk'?{fluxWb:s.fluxWb}:{}),sweptFluxWb:s.sweptFluxWb,angleRad:s.angleRad,
    emTorqueNm:s.emTorqueNm,drivePowerW:s.drivePowerW,driveWorkJ:s.driveWorkJ,omegaRadS:p.omegaRadS,energyResidualJ:s.driveWorkJ-s.jouleHeatJ};
  const kineticEnergy=.5*m*s.vy*s.vy,potentialEnergy=m*g*s.centerY,totalEnergyJ=kineticEnergy+potentialEnergy+s.jouleHeatJ;
  return {...common,centerY:s.centerY,vy:s.vy,fluxWb:s.fluxWb,cuttingFactorWbPerM:s.dPhiDy,ampereForceN:s.ampereForceN,
    kineticEnergy,potentialEnergy,totalEnergyJ,energyResidualJ:totalEnergyJ-s.initialEnergy};
}
export function checkInvariants(s:WireframeState,initial:WireframeState,p:WireframeParams):InvariantReport[]{
  const o=computeObservables(s,p),report=(name:string,err:number,tolerance:number)=>({name,measuredError:err,tolerance,passed:Number.isFinite(err)&&err<=tolerance});
  if(p.mode!=='wireframe-gravity-fall')return [
    report('恒速驱动功与焦耳热',Math.abs(s.driveWorkJ-s.jouleHeatJ)/Math.max(1,s.driveWorkJ),1e-10),
    report('制动力矩与电功率',Math.abs(-s.emTorqueNm*p.omegaRadS-s.currentA*s.emfV)/Math.max(1,s.drivePowerW),1e-10)];
  return [
    report('重力势能、动能与焦耳热能量守恒 (mgΔh = ΔEk + Q)',Math.abs(o.totalEnergyJ!-initial.initialEnergy)/Math.max(1,Math.abs(initial.initialEnergy)),1e-5),
    report('安培力机械功率与焦耳热',Math.abs(s.ampereForceN*s.vy+s.currentA**2*resistance(p))/Math.max(1,s.currentA**2*resistance(p)),1e-10)];
}
