import { bisectEvent, CLASSROOM_GRAVITY, degToRad, radToDeg, stepRK4 } from '@physforge/physics-core';
import type { InvariantReport, PhysicsEvent, StepResult } from '@physforge/sim-sdk';

export type EddyMode = 'betatron-vortex' | 'eddy-damping-compare';

export type EddyVortexParams = {
  mode: EddyMode;
  cylinderRadiusR: number;
  bDotRate: number;
  bField0: number;
  particleChargeRatio: number;
  particleInitRadius: number;
  pendulumLengthL: number;
  solidDampingGamma: number;
  slottedDampingGamma: number;
  initialAngleDeg: number;
};


export interface EddyVortexState {
  readonly t:number;
  readonly bCurrent:number;
  readonly px:number;readonly py:number;
  readonly vx:number;readonly vy:number;
  readonly trail:readonly {x:number;y:number}[];
  readonly particleInCore:boolean;
  readonly specificElectricWork:number;
  readonly initialSpecificKinetic:number;
  readonly solidTheta:number;readonly solidOmega:number;
  readonly slottedTheta:number;readonly slottedOmega:number;
  readonly solidHeatSpecific:number;readonly slottedHeatSpecific:number;
  readonly initialPendulumEnergySpecific:number;
  readonly boundaryAmbiguous:boolean;
  readonly events:readonly PhysicsEvent[];
}
const radius=(p:EddyVortexParams)=>Math.max(.2,p.cylinderRadiusR);
const length=(p:EddyVortexParams)=>Math.max(.4,p.pendulumLengthL);
const magnetic=(p:EddyVortexParams,t:number)=>p.bField0+p.bDotRate*t;
export function evalVortexField(x:number,y:number,Rc:number,bDot:number){
  const r2=x*x+y*y,R=Math.max(0,Rc);
  if(r2===0||R===0||bDot===0)return {Ex:0,Ey:0};
  const coefficient=.5*bDot*(r2<=R*R?1:R*R/r2);
  return {Ex:coefficient*y,Ey:-coefficient*x};
}
const clampCos=(v:number)=>Math.max(-1,Math.min(1,v));
function segmentArea(r:number,theta:number){
  // Stable at an external tangency where theta-sin(theta)cos(theta) cancels.
  return r*r*(theta<1e-3?theta**3*(2/3-theta**2*(2/15-theta**2*4/315)):theta-Math.sin(theta)*Math.cos(theta));
}
export function circleOverlapArea(r:number,R:number,d:number){
  r=Math.max(0,r);R=Math.max(0,R);d=Math.abs(d);
  if(r===0||R===0||d>=r+R)return 0;
  if(d<=Math.abs(r-R))return Math.PI*Math.min(r,R)**2;
  const a=Math.acos(clampCos((d*d+r*r-R*R)/(2*d*r))),b=Math.acos(clampCos((d*d+R*R-r*r)/(2*d*R)));
  return segmentArea(r,a)+segmentArea(R,b);
}
function integrateSmooth(f:(x:number)=>number,a:number,b:number,tol:number,depth=22):number{
  const m=(a+b)/2,fa=f(a),fm=f(m),fb=f(b),s=(b-a)*(fa+4*fm+fb)/6;
  const recurse=(lo:number,hi:number,fl:number,fc:number,fr:number,whole:number,eps:number,n:number):number=>{
    const c=(lo+hi)/2,l=(lo+c)/2,r=(c+hi)/2,vl=f(l),vr=f(r);
    const sl=(c-lo)*(fl+4*vl+fc)/6,sr=(hi-c)*(fc+4*vr+fr)/6,delta=sl+sr-whole;
    if(Math.abs(delta)<=15*eps)return sl+sr+delta/15;
    if(n<=0)throw Error('E06 circulation quadrature did not converge');
    return recurse(lo,c,fl,vl,fc,sl,eps/2,n-1)+recurse(c,hi,fc,vr,fr,sr,eps/2,n-1);
  };
  return recurse(a,b,fa,fm,fb,s,tol,depth);
}
export function computeClosedLoopCirculation(loopRadius:number,Rc:number,bDot:number,centerOffsetX=0){
  const r=Math.max(0,loopRadius),R=Math.max(0,Rc),d=Math.abs(centerOffsetX);
  const negDPhiDt=-bDot*circleOverlapArea(r,R,d);
  if(r===0||R===0||bDot===0)return {lineIntegral:0,negDPhiDt:0};
  // By rotational symmetry offset -d and +d have identical circulation.
  const integrand=(th:number)=>{
    const c=Math.cos(th),s=Math.sin(th),x=d+r*c,y=r*s,e=evalVortexField(x,y,R,bDot);
    return e.Ex*(-r*s)+e.Ey*(r*c);
  };
  const cuts=[0,Math.PI,2*Math.PI];
  if(d>0&&d<r+R&&d>Math.abs(r-R)){
    const theta=Math.acos(clampCos((R*R-d*d-r*r)/(2*d*r)));
    cuts.push(theta,2*Math.PI-theta);cuts.sort((a,b)=>a-b);
  }
  let lineIntegral=0;
  // Absolute tolerance based on maximum natural flux scale, not the unknown answer.
  const tol=2e-13*Math.max(1,Math.abs(bDot)*Math.PI*Math.max(r,R)**2);
  for(let i=1;i<cuts.length;i++)if(cuts[i]!>cuts[i-1]!)lineIntegral+=integrateSmooth(integrand,cuts[i-1]!,cuts[i]!,tol/(cuts.length-1));
  return {lineIntegral,negDPhiDt};
}
export function dampingOverlap(theta:number){
  const a=Math.abs(theta);
  if(a<=.35)return 1;
  if(a>=.45)return .05;
  const u=(a-.35)/.1;
  return 1-.95*u*u*(3-2*u);
}
const pendulumEnergy=(theta:number,omega:number,L:number)=>.5*L*L*omega*omega+CLASSROOM_GRAVITY*L*(1-Math.cos(theta));
export function createInitialState(p:EddyVortexParams):EddyVortexState{
  const r=Math.max(.2,p.particleInitRadius),th=degToRad(p.initialAngleDeg);
  return {t:0,bCurrent:p.bField0,px:r,py:0,vx:0,vy:-.6,trail:[{x:r,y:0}],particleInCore:r<radius(p),specificElectricWork:0,initialSpecificKinetic:.18,
    solidTheta:th,solidOmega:0,slottedTheta:th,slottedOmega:0,solidHeatSpecific:0,slottedHeatSpecific:0,
    initialPendulumEnergySpecific:pendulumEnergy(th,0,length(p)),boundaryAmbiguous:false,events:[]};
}
type Particle=readonly number[];
const radialRate=(s:Particle)=>s[0]!*s[2]!+s[1]!*s[3]!;
function particleAdvance(s:Particle,t:number,h:number,inside:boolean,p:EddyVortexParams):number[]{
  const eta=p.particleChargeRatio,R=radius(p);
  if(eta===0||(p.bDotRate===0&&(!inside||p.bField0===0)))return [s[0]!+h*s[2]!,s[1]!+h*s[3]!,s[2]!,s[3]!,s[4]!];
  // Exact constant B flow in each homogeneous side, including zero field.
  if(p.bDotRate===0){
    const w=eta*p.bField0,z=w*h,c=Math.cos(z),sn=Math.sin(z);
    const A=z===0?h:h*Math.sin(z)/z;
    const B=z===0?0:h*2*Math.sin(z/2)**2/z;
    return [s[0]!+s[2]!*A+s[3]!*B,s[1]!+s[3]!*A-s[2]!*B,
      s[2]!*c+s[3]!*sn,s[3]!*c-s[2]!*sn,s[4]!];
  }
  // One side of the field is fixed throughout this trial step and event replay.
  return stepRK4(s,t,h,(tau,y)=>{
    const e=evalVortexField(y[0]!,y[1]!,R,p.bDotRate),vx=y[2]!,vy=y[3]!,B=inside?magnetic(p,tau):0;
    return [vx,vy,eta*(e.Ex+vy*B),eta*(e.Ey-vx*B),eta*(e.Ex*vx+e.Ey*vy)];
  });
}
interface Probe{offset:number;v:number[]}
function firstCrossing(start:Particle,t:number,h:number,inside:boolean,p:EddyVortexParams){
  const R=radius(p),sign=inside?1:-1,side=(s:Particle)=>sign*(Math.hypot(s[0]!,s[1]!)-R);
  const probe=(offset:number):Probe=>({offset,v:particleAdvance(start,t,offset,inside,p)});
  const replay=(s:Probe,d:number)=>probe(s.offset+d);
  const rate=(s:Probe)=>sign*radialRate(s.v);
  const cuts=[probe(0),probe(h/2),probe(h)];
  // Include an interior outward radial extremum: endpoints on the same
  // side alone cannot certify absence of a short excursion through the boundary.
  for(let i=1;i<3;i++){
    const a=cuts[i-1]!,b=cuts[i]!;
    if(rate(a)>0&&rate(b)<0){
      const e=bisectEvent(a,t+a.offset,b.offset-a.offset,replay,rate,{timeTolerance:1e-12});
      if(e)cuts.push(e.state);
    }
  }
  cuts.sort((a,b)=>a.offset-b.offset);
  for(let i=1;i<cuts.length;i++){
    const a=cuts[i-1]!,b=cuts[i]!;
    if(side(b.v)<=0)continue;
    if(side(a.v)===0&&rate(a)>0&&a.offset>0)return {ambiguous:false as const,hit:a};
    if(side(a.v)>=0){
      // Starting exactly on a grazing boundary or unable to resolve a
      // return from it: expose the ideal discontinuity rather than choose
      // an arbitrary force, silently penetrate, or loop indefinitely.
      return {ambiguous:true as const,hit:a};
    }
    const hit=bisectEvent(a,t+a.offset,b.offset-a.offset,replay,q=>side(q.v),{timeTolerance:1e-12,biasEndpoint:'positive'});
    if(!hit)throw Error('E06 crossing bracket failed');
    return {ambiguous:false as const,hit:hit.state};
  }
  // A step ending exactly on the boundary while pointing across it.
  const last=cuts.at(-1)!;
  if(side(last.v)===0&&rate(last)>0)return {ambiguous:false as const,hit:last};
  return null;
}
export function stepEddyVortex(s:EddyVortexState,p:EddyVortexParams,dt:number):StepResult<EddyVortexState>{
  if(!Number.isFinite(dt)||dt<0)throw Error('Invalid dt: '+dt);
  if(s.boundaryAmbiguous)return {nextState:s,events:[],halt:true,advancedTime:0};
  if(dt===0)return {nextState:s,events:[]};
  const tEnd=s.t+dt;
  if(!Number.isFinite(tEnd))throw Error('Invalid resulting time');
  if(p.mode==='eddy-damping-compare'){
    const L=length(p),g=CLASSROOM_GRAVITY/L,gs=Math.max(0,p.solidDampingGamma),gl=Math.max(0,p.slottedDampingGamma);
    const n=Math.max(1,Math.ceil(dt/Math.min(.002,.04/Math.max(1,gs,gl,Math.sqrt(g))))),h=dt/n;
    let v=[s.solidTheta,s.solidOmega,s.solidHeatSpecific,s.slottedTheta,s.slottedOmega,s.slottedHeatSpecific];
    for(let i=0;i<n;i++)v=stepRK4(v,s.t+i*h,h,(_t,y)=>{
      const a=y[0]!,w=y[1]!,b=y[3]!,z=y[4]!,ks=2*gs*dampingOverlap(a),kl=2*gl*dampingOverlap(b);
      return [w,-g*Math.sin(a)-ks*w,ks*L*L*w*w,z,-g*Math.sin(b)-kl*z,kl*L*L*z*z];
    });
    return {nextState:{...s,t:tEnd,solidTheta:v[0]!,solidOmega:v[1]!,solidHeatSpecific:v[2]!,slottedTheta:v[3]!,slottedOmega:v[4]!,slottedHeatSpecific:v[5]!},events:[]};
  }
  let cur=[s.px,s.py,s.vx,s.vy,s.specificElectricWork],inside=s.particleInCore,elapsed=0,ambiguous=false;
  const events:PhysicsEvent[]=[],R=radius(p),eta=Math.abs(p.particleChargeRatio);
  while(elapsed<dt){
    const rem=dt-elapsed,t=s.t+elapsed;
    if(rem<=Math.max(1e-15,Number.EPSILON*dt)){elapsed=dt;break;}
    const omega=eta*(Math.abs(magnetic(p,t))+Math.abs(p.bDotRate)*.002),speed=Math.hypot(cur[2]!,cur[3]!);
    const Eacc=eta*Math.abs(p.bDotRate)*R/2;
    const h=Math.min(rem,.002,.025/Math.max(1,omega),.025*R/Math.max(.01,speed+Eacc*.002));
    if(!(h>0)||elapsed+h===elapsed)throw Error('E06 step cannot progress');
    // Since magnetic force does no work, speed cannot grow faster than max |eta E|.
    // Far from the edge this is an independent no-crossing certificate.
    const dist=Math.abs(Math.hypot(cur[0]!,cur[1]!)-R);
    const contact=dist>(speed+Eacc*h)*h+1e-12?null:firstCrossing(cur,t,h,inside,p);
    if(contact){
      cur=contact.hit.v;elapsed+=contact.hit.offset;
      const time=s.t+elapsed,position={x:cur[0]!,y:cur[1]!};
      if(contact.ambiguous||contact.hit.offset<=0){
        ambiguous=true;events.push({id:'vortex-boundary-ambiguous',label:'理想突变磁场边界切向不适定 · 暂停',time,position});break;
      }
      inside=!inside;
      events.push({id:'vortex-boundary-'+(inside?'entry':'exit')+'-'+time,label:inside?'试探粒子进入磁区':'试探粒子离开磁区',time,position,
        metrics:{radius:Math.hypot(cur[0]!,cur[1]!),radialVelocity:radialRate(cur)/Math.max(1e-30,Math.hypot(cur[0]!,cur[1]!))}});
    }else{cur=particleAdvance(cur,t,h,inside,p);elapsed+=h;}
  }
  const nx=cur[0]!,ny=cur[1]!,last=s.trail.at(-1);
  const trail=!last||Math.hypot(nx-last.x,ny-last.y)>.025?[...s.trail.slice(-399),{x:nx,y:ny}]:s.trail;
  const nt=ambiguous?s.t+elapsed:tEnd;
  return {nextState:{...s,t:nt,bCurrent:magnetic(p,nt),px:nx,py:ny,vx:cur[2]!,vy:cur[3]!,specificElectricWork:cur[4]!,particleInCore:inside,
    trail,boundaryAmbiguous:ambiguous,events:[...s.events,...events]},events,...(ambiguous?{halt:true,advancedTime:elapsed}:{})};
}
export function computeObservables(s:EddyVortexState,p:EddyVortexParams):Record<string,number>{
  if(p.mode==='eddy-damping-compare'){
    const L=length(p),solidEnergySpecific=pendulumEnergy(s.solidTheta,s.solidOmega,L),slottedEnergySpecific=pendulumEnergy(s.slottedTheta,s.slottedOmega,L);
    return {t:s.t,solidAngleDeg:radToDeg(s.solidTheta),slottedAngleDeg:radToDeg(s.slottedTheta),solidOmega:s.solidOmega,slottedOmega:s.slottedOmega,
      solidEnergySpecific,slottedEnergySpecific,solidHeatSpecific:s.solidHeatSpecific,slottedHeatSpecific:s.slottedHeatSpecific,
      solidResidualSpecific:solidEnergySpecific+s.solidHeatSpecific-s.initialPendulumEnergySpecific,slottedResidualSpecific:slottedEnergySpecific+s.slottedHeatSpecific-s.initialPendulumEnergySpecific,
      solidDampingOverlap:dampingOverlap(s.solidTheta),slottedDampingOverlap:dampingOverlap(s.slottedTheta)};
  }
  const e=evalVortexField(s.px,s.py,radius(p),p.bDotRate),specificKineticEnergy=.5*(s.vx*s.vx+s.vy*s.vy);
  return {t:s.t,bCurrent:s.bCurrent,bLocal:s.particleInCore?s.bCurrent:0,eVortexMag:Math.hypot(e.Ex,e.Ey),Ex:e.Ex,Ey:e.Ey,
    particleSpeed:Math.hypot(s.vx,s.vy),particleRadius:Math.hypot(s.px,s.py),px:s.px,py:s.py,vx:s.vx,vy:s.vy,
    specificKineticEnergy,specificElectricWork:s.specificElectricWork,specificEnergyResidual:specificKineticEnergy-s.initialSpecificKinetic-s.specificElectricWork,
    inCore:s.particleInCore?1:0,boundaryAmbiguous:s.boundaryAmbiguous?1:0};
}
export function checkInvariants(s:EddyVortexState,initial:EddyVortexState,p:EddyVortexParams):InvariantReport[]{
  const o=computeObservables(s,p),report=(name:string,error:number,tolerance:number):InvariantReport=>({name,measuredError:error,tolerance,passed:Number.isFinite(error)&&error<=tolerance});
  if(p.mode==='eddy-damping-compare'){
    const scale=Math.max(1,Math.abs(initial.initialPendulumEnergySpecific));
    return [report('整块板单位质量能量与耗散热',Math.abs(o.solidResidualSpecific!)/scale,1e-6),
      report('开槽板单位质量能量与耗散热',Math.abs(o.slottedResidualSpecific!)/scale,1e-6),
      report('阻尼耗散非负',Math.max(0,-s.solidHeatSpecific,-s.slottedHeatSpecific),1e-12)];
  }
  const R=radius(p);
  const {lineIntegral,negDPhiDt}=computeClosedLoopCirculation(R*.7,R,p.bDotRate);
  return [report('涡旋电场闭合环流定律 ∮E·dl = -dΦ/dt',Math.abs(lineIntegral-negDPhiDt)/Math.max(1e-9,Math.abs(negDPhiDt)),1e-8),
    report('试探粒子单位质量功—能关系',Math.abs(o.specificEnergyResidual!)/Math.max(1,Math.abs(o.specificKineticEnergy!),Math.abs(initial.initialSpecificKinetic)),1e-6)];
}
