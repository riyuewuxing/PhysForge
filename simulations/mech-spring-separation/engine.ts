import { bisectEvent, CLASSROOM_GRAVITY, degToRad } from '@physforge/physics-core';
import type { InvariantReport, PhysicsEvent, StepResult } from '@physforge/sim-sdk';

export type SpringSepParams={mass1:number;mass2:number;springK:number;inclineDeg:number;initialComp:number;externalForce:number};
type Release={t:number;s:number;v:number;requiredNormalForce:number};
export interface SpringSepState {
  readonly t:number; readonly s1:number; readonly v1:number; readonly s2:number; readonly v2:number;
  readonly normalForceN:number; readonly separated:boolean; readonly separationPosS:number|null; readonly separationTime:number|null;
  readonly release:Release|null; readonly terminal:'recontact'|null;
  readonly initialEnergy:number; readonly externalWork:number; readonly events:readonly PhysicsEvent[];
}
function physical(p:SpringSepParams){
  if(![p.mass1,p.mass2,p.springK].every(x=>Number.isFinite(x)&&x>0)||!Number.isFinite(p.initialComp)||p.initialComp<0||!Number.isFinite(p.externalForce)||!Number.isFinite(p.inclineDeg))throw Error('Invalid M08 parameters');
  const M=p.mass1+p.mass2,k=p.springK,gSin=CLASSROOM_GRAVITY*Math.sin(degToRad(p.inclineDeg)),s0=-p.initialComp;
  const eq=(p.externalForce-M*gSin)/k,crit=-p.mass1*p.externalForce/(p.mass2*k),w=Math.sqrt(k/M),w1=Math.sqrt(k/p.mass1),eq1=-p.mass1*gSin/k,a2=p.externalForce/p.mass2-gSin;
  const eps=32*Number.EPSILON*Math.max(1,Math.abs(eq),Math.abs(crit),Math.abs(s0));
  return {M,k,gSin,s0,eq,crit,w,w1,eq1,a2,eps,invMassSum:1/p.mass1+1/p.mass2};
}
type Physical=ReturnType<typeof physical>;
function coupled(t:number,p:SpringSepParams,q:Physical){
  const A=q.s0-q.eq,s=q.s0+A*(-2*Math.sin(q.w*t/2)**2),v=-A*q.w*Math.sin(q.w*t);
  return {s,v,N:(p.mass2*(-q.k*s)-p.mass1*p.externalForce)/q.M};
}
function firstRelease(p:SpringSepParams,q:Physical):Release|null{
  const s=q.s0,a0=q.w*q.w*(q.eq-s),N=coupled(0,p,q).N;
  // A force of zero is only a release if the subsequent constrained
  // motion would require attraction. At rest this is decided by a0.
  if(s>q.crit+q.eps)return {t:0,s,v:0,requiredNormalForce:N};
  if(Math.abs(s-q.crit)<=q.eps&&a0>q.eps*q.w*q.w)return {t:0,s,v:0,requiredNormalForce:0};
  if(a0<=0)return null;
  const max=2*q.eq-s;
  if(max<=q.crit+q.eps)return null; // zero-force turning point is not a crossing
  const A=s-q.eq,cos=(q.crit-q.eq)/A;
  const displacementSpeed=Math.sqrt(Math.max(0,(max-q.crit)*(q.crit-s))),sin=displacementSpeed/Math.abs(A);
  const t=Math.atan2(sin,cos)/q.w;
  return {t,s:q.crit,v:q.w*displacementSpeed,requiredNormalForce:0};
}
// Fixed anchor outside the complete ideal leftmost excursion, not a wall
// collision model. Its position depends only on the run parameters.
export function springAnchor(p:SpringSepParams){
  const q=physical(p),r=firstRelease(p,q);
  const low=r?Math.min(q.s0,q.eq1-Math.hypot(r.s-q.eq1,r.v/q.w1)):q.eq-Math.abs(q.s0-q.eq);
  return Math.min(-.9,low-.85);
}
function releaseEvent(r:Release):PhysicsEvent{
  return {id:'sep-'+r.t.toFixed(9),time:r.t,label:r.t===0&&r.requiredNormalForce<0?'初始接触不可行 · 立即分离':'临界分离 · 接触力归零',position:{x:r.s,y:0},metrics:{separationS:r.s,normalForceAtSep:0,requiredNormalForce:r.requiredNormalForce,velocity:r.v}};
}
export function createInitialState(p:SpringSepParams):SpringSepState{
  const q=physical(p),r=firstRelease(p,q),released=r?.t===0? r:null;
  return {t:0,s1:q.s0,s2:q.s0,v1:0,v2:0,normalForceN:released?0:Math.max(0,coupled(0,p,q).N),separated:Boolean(released),separationPosS:released?.s??null,separationTime:released?.t??null,release:released,terminal:null,initialEnergy:.5*q.k*q.s0*q.s0+q.M*q.gSin*q.s0,externalWork:0,events:released?[releaseEvent(released)]:[]};
}
// Stable small-angle remainders. This avoids subtracting almost-equal
// absolute positions at the initial cubic/quartic opening of the gap.
function remainders(x:number){
  const x2=x*x;
  if(Math.abs(x)<.05){
    return {c4:x2*x2*(1/24+x2*(-1/720+x2*(1/40320-x2/3628800))),s3:x*x2*(1/6+x2*(-1/120+x2*(1/5040-x2/362880)))};
  }
  return {c4:Math.cos(x)-1+.5*x2,s3:x-Math.sin(x)};
}
function freeAt(r:Release,u:number,q:Physical){
  const x=q.w1*u,A=r.s-q.eq1,openingAcceleration=-r.requiredNormalForce*q.invMassSum,co=-2*Math.sin(x/2)**2,si=Math.sin(x);
  const v1=r.v*Math.cos(x)-A*q.w1*si,v2=r.v+q.a2*u;
  const s1=r.s+A*co+r.v*si/q.w1,s2=r.s+r.v*u+.5*q.a2*u*u;
  // Exact zero initial gap/relative velocity; stable even if a1=a2.
  const rem=remainders(x);
  const gap=Math.abs(x)<.05? .5*openingAcceleration*u*u-A*rem.c4+r.v*rem.s3/q.w1:.5*q.a2*u*u-A*co+r.v*(u-si/q.w1);
  const gapV=Math.abs(x)<.05?openingAcceleration*u+A*q.w1*(-rem.s3)-r.v*co:q.a2*u+A*q.w1*si-r.v*co;
  return {s1,s2:gap>=0&&s2<s1?s1:s2,v1,v2,gap,gapV};
}
// Partition by every root of g''=a2+w1² A cos(w1 u)+w1 v sin(w1 u).
// On each partition g' is monotone; its roots partition g into monotone
// pieces. Thus a short negative excursion between positive endpoints
// cannot be missed, even for a coarse requested outer step.
function firstRecontact(r:Release,u0:number,u1:number,q:Physical){
  // For nonnegative a2 and v>=0, g>=0 globally by 1-cos x<=x²/2,
  // sin x<=x and the release inequality a1<=a2. No event search needed.
  if(q.a2>=0&&r.v>=0)return null;
  const A=r.s-q.eq1,B=Math.hypot(q.w1*q.w1*A,q.w1*r.v),phi=Math.atan2(q.w1*r.v,q.w1*q.w1*A);
  const cuts=[u0,u1];
  if(B>0&&Math.abs(q.a2)<B){
    const angle=Math.acos(-q.a2/B);
    for(const phase of [phi-angle,phi+angle]){
      const first=Math.ceil((q.w1*u0-phase)/(2*Math.PI));
      const last=Math.floor((q.w1*u1-phase)/(2*Math.PI));
      if(last-first>200000)throw Error('M08 recontact search budget exceeded');
      for(let n=first;n<=last;n++){const u=(phase+2*Math.PI*n)/q.w1;if(u>u0&&u<u1)cuts.push(u);}
    }
  }
  cuts.sort((a,b)=>a-b);
  const at=(u:number)=>freeAt(r,u,q),advance=(u:number,h:number)=>u+h;
  const roots=[...cuts];
  for(let i=1;i<cuts.length;i++){
    const a=cuts[i-1]!,b=cuts[i]!,va=at(a).gapV,vb=at(b).gapV;
    if(va*vb<0){
      const hit=bisectEvent(a,r.t+a,b-a,advance,u=>at(u).gapV,{timeTolerance:1e-13});
      if(hit)roots.push(hit.state);
    }
  }
  roots.sort((a,b)=>a-b);
  for(let i=1;i<roots.length;i++){
    const a=roots[i-1]!,b=roots[i]!,fa=at(a),fb=at(b);
    if(fa.gap>0&&fb.gap<=0&&fb.gapV<0){
      const hit=bisectEvent(a,r.t+a,b-a,advance,u=>at(u).gap,{timeTolerance:1e-12,biasEndpoint:'positive'});
      if(hit)return hit;
    }
    // A roundoff-sized negative minimum at a tangential touch is not a
    // closing collision. A truly negative minimum still brackets a hit.
    const eps=32*Number.EPSILON*Math.max(1,Math.abs(fb.s1),Math.abs(fb.s2));
    if(fa.gap>0&&fb.gap < -eps){
      const hit=bisectEvent(a,r.t+a,b-a,advance,u=>at(u).gap,{timeTolerance:1e-12,biasEndpoint:'positive'});
      if(hit)return hit;
    }
  }
  return null;
}
function freeStep(state:SpringSepState,r:Release,end:number,p:SpringSepParams,q:Physical,events:PhysicsEvent[]):StepResult<SpringSepState>{
  const u0=Math.max(0,state.t-r.t),u1=end-r.t,hit=firstRecontact(r,u0,u1,q),u=hit?.state??u1;
  const f=freeAt(r,u,q),t=hit?r.t+u:end;
  if(f.gap < -1e-9)throw Error('M08 nonpenetration failure: '+f.gap);
  const next:SpringSepState={...state,t,s1:f.s1,v1:f.v1,s2:f.s2,v2:f.v2,normalForceN:0,separated:true,release:r,separationPosS:r.s,separationTime:r.t,terminal:hit?'recontact':null,externalWork:p.externalForce*(f.s2-q.s0),events:state.events};
  if(hit){
    const ev:PhysicsEvent={id:'recontact-'+t.toFixed(9),time:t,label:'首次再接触 · 碰撞前停止',position:{x:(f.s1+f.s2)/2,y:0},metrics:{gap:f.gap,relativeVelocity:f.gapV,bracketWidth:hit.bracketWidth,v1:f.v1,v2:f.v2}};
    return {nextState:{...next,events:[...state.events,ev]},events:[...events,ev],halt:true,advancedTime:t-state.t};
  }
  return {nextState:next,events};
}
export function stepSpringSeparation(state:SpringSepState,p:SpringSepParams,dt:number):StepResult<SpringSepState>{
  if(!Number.isFinite(dt)||dt<0)throw Error('Invalid dt: '+dt);
  if(dt===0)return {nextState:state,events:[]};
  if(state.terminal)return {nextState:state,events:[],halt:true,advancedTime:0};
  const q=physical(p),end=state.t+dt;
  if(state.release)return freeStep(state,state.release,end,p,q,state.t===0?state.events.slice(0,1):[]);
  const r=firstRelease(p,q);
  if(r&&r.t<=end){
    const ev=releaseEvent(r);
    return freeStep({...state,events:[...state.events,ev]},r,end,p,q,[ev]);
  }
  const s=coupled(end,p,q);
  if(s.N<-1e-8*Math.max(1,p.mass2*CLASSROOM_GRAVITY))throw Error('M08 inadmissible coupled force');
  return {nextState:{...state,t:end,s1:s.s,s2:s.s,v1:s.v,v2:s.v,normalForceN:Math.max(0,s.N),externalWork:p.externalForce*(s.s-q.s0)},events:[]};
}
export function computeObservables(s:SpringSepState,p:SpringSepParams):Record<string,number>{
  const q=physical(p),kineticEnergy=.5*p.mass1*s.v1*s.v1+.5*p.mass2*s.v2*s.v2,springEnergy=.5*q.k*s.s1*s.s1,gravityEnergy=q.gSin*(p.mass1*s.s1+p.mass2*s.s2),E=kineticEnergy+springEnergy+gravityEnergy;
  const a1=(-q.k*s.s1-s.normalForceN)/p.mass1-q.gSin,a2=(p.externalForce+s.normalForceN)/p.mass2-q.gSin;
  const free=s.release?freeAt(s.release,s.t-s.release.t,q):null;
  return {s1:s.s1,s2:s.s2,v1:s.v1,v2:s.v2,a1,a2,normalForceN:s.normalForceN,gap:free?.gap??0,relativeVelocity:free?.gapV??0,kineticEnergy,springEnergy,gravityEnergy,energy:E,externalWork:s.externalWork,mechanicalEnergy:E-s.externalWork,energyResidual:E-s.externalWork-s.initialEnergy,centerOfMass:(p.mass1*s.s1+p.mass2*s.s2)/q.M,centerOfMassVelocity:(p.mass1*s.v1+p.mass2*s.v2)/q.M,separated:s.separated?1:0,terminal:s.terminal?1:0,...(s.release?{separationTime:s.release.t,separationS:s.release.s,separationV:s.release.v}:{})};
}
export function checkInvariants(s:SpringSepState,_init:SpringSepState,p:SpringSepParams):InvariantReport[]{
  const obs=computeObservables(s,p),abs=Math.abs(obs.energyResidual!),scale=Math.abs(s.initialEnergy),nearZero=scale<1e-8*Math.max(1,obs.springEnergy!,Math.abs(obs.gravityEnergy!));
  const report=(name:string,error:number,tolerance:number,unit?:string):InvariantReport=>({name,measuredError:Math.abs(error),tolerance,passed:Math.abs(error)<tolerance,...(unit?{unit}:{})});
  return [nearZero?report('机械能与外力功绝对残差',abs,1e-8,'J'):report('机械能与外力功相对残差',abs/scale,1e-6),
    report('单边接触不可穿透',Math.min(0,obs.gap!),1e-9,'m'),
    report('接触力非负',Math.min(0,s.normalForceN),1e-10,'N'),
    ...(!s.separated?[report('共动相相对速度',obs.relativeVelocity!,1e-10,'m/s')]:[report('自由相无接触力',s.normalForceN,1e-10,'N')])];
}
