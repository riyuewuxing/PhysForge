import { CLASSROOM_GRAVITY as g, bisectEvent, type Vec2 } from '@physforge/physics-core';
import type { InvariantReport, PhysicsEvent, StepResult } from '@physforge/sim-sdk';
export type TurntableMode='turntable-dual'|'conical-pendulum';
export type ConicalTurntableParams={mode:TurntableMode;omega:number;massA:number;massB:number;radiusA:number;radiusB:number;mu:number;pendulumLength:number};
export type Termination='edge-a'|'edge-b'|'slack';
export const MAX_KINETIC_STEP_S=.0001;
export const diskRadius=(p:ConicalTurntableParams)=>Math.max(2.6,p.radiusA+.1,p.radiusB+.1);
type Critical={omega1:number;omega2:number|null;omega3:number|null};
export interface ConicalTurntableState extends Critical{
  readonly t:number;readonly angleRad:number;readonly rA:number;readonly rB:number;
  readonly tensionN:number;readonly frictionAN:number;readonly frictionBN:number;
  readonly slippingOut:boolean;readonly coneAngleDeg:number;
  readonly events:readonly PhysicsEvent[];
  readonly a:Vec2;readonly b:Vec2;readonly va:Vec2;readonly vb:Vec2;
  readonly fa:Vec2;readonly fb:Vec2;readonly direction:Vec2;
  readonly ropeLength:number;readonly body:readonly number[];
  readonly staticTMin:number;readonly staticTMax:number;
  readonly kineticEnergy:number;readonly initialEnergy:number;
  readonly heat:number;readonly diskWork:number;
  readonly terminal:Termination|null;readonly rotatingCone:boolean;
}
const v=(x:number,y:number):Vec2=>({x,y});
const add=(a:Vec2,b:Vec2)=>v(a.x+b.x,a.y+b.y);
const sub=(a:Vec2,b:Vec2)=>v(a.x-b.x,a.y-b.y);
const scale=(a:Vec2,k:number)=>v(a.x*k,a.y*k);
const dot=(a:Vec2,b:Vec2)=>a.x*b.x+a.y*b.y;
const norm=(a:Vec2)=>Math.hypot(a.x,a.y);
const perp=(a:Vec2)=>v(-a.y,a.x);
const signedInward=(f:Vec2,r:Vec2)=>norm(r)>1e-12?-dot(f,r)/norm(r):0;
const mass=(p:ConicalTurntableParams)=>p.massA+p.massB;
const length=(p:ConicalTurntableParams)=>p.radiusA+p.radiusB;
const delta=(p:ConicalTurntableParams)=>p.massB*p.radiusB-p.massA*p.radiusA;
const forceLimit=(m:number,p:ConicalTurntableParams)=>p.mu*m*g;
function validate(p:ConicalTurntableParams){
  if(![p.massA,p.massB,p.radiusA,p.radiusB,p.pendulumLength].every(x=>Number.isFinite(x)&&x>0)||!Number.isFinite(p.omega)||p.omega<0||!Number.isFinite(p.mu)||p.mu<0)throw Error('Invalid M07 physical parameters');
}
export function computeCriticalOmegas(p:ConicalTurntableParams):Critical{
  validate(p);
  if(p.mode==='conical-pendulum')return {omega1:Math.sqrt(g/p.pendulumLength),omega2:null,omega3:null};
  const D=delta(p),abs=Math.abs(D),balanced=abs<=16*Number.EPSILON*Math.max(p.massA*p.radiusA,p.massB*p.radiusB);
  return {omega1:Math.sqrt(p.mu*g/Math.max(p.radiusA,p.radiusB)),
    omega2:balanced||p.mu===0?null:Math.sqrt(forceLimit(D>0?p.massB:p.massA,p)/abs),
    omega3:balanced?null:Math.sqrt((forceLimit(p.massA,p)+forceLimit(p.massB,p))/abs)};
}
export function staticFeasibility(p:ConicalTurntableParams,omega=p.omega){
  const qa=p.massA*omega**2*p.radiusA,qb=p.massB*omega**2*p.radiusB,fa=forceLimit(p.massA,p),fb=forceLimit(p.massB,p);
  const lo=Math.max(0,qa-fa,qb-fb),hi=Math.min(qa+fa,qb+fb);
  const feasible=lo-hi<=32*Number.EPSILON*Math.max(1,lo,hi);
  const T=feasible?Math.min(lo,hi):null;
  return {lo,hi,feasible,tensionN:T,frictionAN:T===null?null:qa-T,frictionBN:T===null?null:qb-T};
}
const rotate=(q:Vec2,phi:number)=>v(q.x*Math.cos(phi)-q.y*Math.sin(phi),q.x*Math.sin(phi)+q.y*Math.cos(phi));
// Equal kinetic coefficients and initially equal relative velocities imply
// identical friction accelerations; relative motion is a uniform rigid
// rotation at Ω, and the common relative velocity belongs to the center.
// Body coordinates are now in the disk frame: X,Y,Ux,Uy,phase,spin,Q,W.
export function initialBody(p:ConicalTurntableParams,angle=0){
  return [delta(p)/mass(p),0,0,0,angle,p.omega,0,0];
}
export function pairGeometry(body:readonly number[],p:ConicalTurntableParams){
  const X=v(body[0]!,body[1]!),U=v(body[2]!,body[3]!),phi=body[4]!,w=body[5]!,L=length(p);
  const C=rotate(X,phi),V=rotate(add(U,scale(perp(X),p.omega)),phi),e=v(Math.cos(phi),Math.sin(phi)),ep=perp(e);
  const da=-p.massB*L/mass(p),db=p.massA*L/mass(p);
  const a=add(C,scale(e,da)),b=add(C,scale(e,db)),va=add(V,scale(ep,da*w)),vb=add(V,scale(ep,db*w));
  return {a,b,va,vb,e,ep,L,w,V,C,X,U,phi};
}
export function kineticEvaluation(body:readonly number[],p:ConicalTurntableParams){
  const q=pairGeometry(body,p),speed=norm(q.U);
  // At the initial instant the exact incipient sliding direction is radial
  // outward from the center of the pair; there is no fictitious zero drag.
  const dir=speed>0?scale(q.U,1/speed):norm(q.X)>0?scale(q.X,1/norm(q.X)):v(0,0);
  const force=rotate(scale(dir,-p.mu*g),q.phi);
  const fa=scale(force,p.massA),fb=scale(force,p.massB);
  const tensionN=p.massA*p.massB/mass(p)*q.L*q.w*q.w;
  return {...q,fa,fb,tensionN};
}
const energy=(a:Vec2,b:Vec2,p:ConicalTurntableParams)=>.5*(p.massA*dot(a,a)+p.massB*dot(b,b));
function pairSample(body:readonly number[],p:ConicalTurntableParams,slip:boolean){
  const q=pairGeometry(body,p),st=staticFeasibility(p);
  const d=slip?kineticEvaluation(body,p):null;
  const tensionN=d?Math.max(0,d.tensionN):st.tensionN!;
  const fa=d?d.fa:scale(q.e,st.frictionAN!),fb=d?d.fb:scale(q.e,-st.frictionBN!);
  return {a:q.a,b:q.b,va:q.va,vb:q.vb,fa,fb,direction:q.e,rA:norm(q.a),rB:norm(q.b),ropeLength:q.L,
    tensionN,frictionAN:signedInward(fa,q.a),frictionBN:signedInward(fb,q.b),
    staticTMin:st.lo,staticTMax:st.hi,kineticEnergy:energy(q.va,q.vb,p),heat:body[6]!,diskWork:body[7]!,body};
}
function coneSample(p:ConicalTurntableParams,t:number){
  const rotatingCone=p.omega>Math.sqrt(g/p.pendulumLength),L=p.pendulumLength;
  const cos=rotatingCone?g/(p.omega**2*L):1,theta=Math.acos(Math.min(1,cos)),R=L*Math.sin(theta),phi=rotatingCone?p.omega*t:0;
  const a=v(R*Math.cos(phi),1.1-L*cos),va=v(rotatingCone?-R*p.omega*Math.sin(phi):0,0);
  return {a,b:v(0,1.1),va,vb:v(0,0),fa:v(0,0),fb:v(0,0),direction:v(0,1),rA:R,rB:0,ropeLength:L,body:[],
    tensionN:rotatingCone?p.massA*p.omega**2*L:p.massA*g,frictionAN:0,frictionBN:0,
    staticTMin:0,staticTMax:0,kineticEnergy:.5*p.massA*(p.omega*R)**2,heat:0,diskWork:0,
    rotatingCone,coneAngleDeg:theta*180/Math.PI,angleRad:phi};
}
export function createInitialState(p:ConicalTurntableParams):ConicalTurntableState{
  const critical=computeCriticalOmegas(p);
  if(p.mode==='conical-pendulum'){
    const s=coneSample(p,0);
    return {...critical,...s,t:0,slippingOut:false,events:[],terminal:null,initialEnergy:s.kineticEnergy};
  }
  const slippingOut=!staticFeasibility(p).feasible;
  const s=pairSample(initialBody(p),p,slippingOut);
  const events:PhysicsEvent[]=slippingOut?[{id:'static-loss-0',time:0,label:'初始共转静摩擦不可行 · 二维滑移开始',metrics:{tensionMin:s.staticTMin,tensionMax:s.staticTMax}}]:[];
  return {...critical,...s,t:0,angleRad:0,slippingOut,coneAngleDeg:0,rotatingCone:false,terminal:null,events,initialEnergy:s.kineticEnergy};
}
type TimedBody={t:number;body:readonly number[]};
function advance(s:TimedBody,p:ConicalTurntableParams,h:number):TimedBody{
  const X=v(s.body[0]!,s.body[1]!),U=v(s.body[2]!,s.body[3]!),w=p.omega,phi=w*(s.t+h),Q=s.body[6]!,W=s.body[7]!;
  if(p.mu===0){
    // Analytic frictionless center motion in the inertial frame.
    const q=pairGeometry(s.body,p),X1=rotate(add(q.C,scale(q.V,h)),-phi),U1=sub(rotate(q.V,-phi),scale(perp(X1),w));
    return {t:s.t+h,body:[X1.x,X1.y,U1.x,U1.y,phi,w,Q,W]};
  }
  // Exact nonsmooth Coulomb force at the implicit midpoint, no velocity
  // regularization. Let z=(U0+U1)/2. The rotating-frame equations give
  // (A I+B J)z + h μg z/|z| = b. Solve its scalar norm quadratic using
  // a cancellation-resistant positive root, then reconstruct direction.
  const A=2-.5*h*h*w*w,B=2*h*w,ha=h*p.mu*g,b=add(scale(U,2),scale(X,h*w*w)),n=norm(b),disc=(n-ha)*(n+ha);
  let z:Vec2,acc:Vec2;
  if(disc<=0){
    // Midpoint stick inclusion. The initial infeasible branch has
    // |X|>=|X0| by rotating energy dissipation, so it cannot regain a
    // physically feasible static state merely from the rounding of z.
    z=v(0,0);acc=scale(b,-1/h);
  }else{
    const r=disc/(A*ha+Math.sqrt((A*ha)**2+(A*A+B*B)*disc)),D=A*r+ha,E=B*r;
    z=scale(sub(scale(b,D),scale(perp(b),E)),r/(D*D+E*E));
    acc=scale(z,-p.mu*g/r);
  }
  const Xm=add(X,scale(z,.5*h)),X1=add(X,scale(z,h)),U1=sub(scale(z,2),U);
  const Q1=Q-h*mass(p)*dot(acc,z),W1=W+h*mass(p)*dot(acc,scale(perp(Xm),w));
  return {t:s.t+h,body:[X1.x,X1.y,U1.x,U1.y,phi,w,Q1,W1]};
}
function guard(s:TimedBody,p:ConicalTurntableParams,id:Termination){
  const q=kineticEvaluation(s.body,p);
  return id==='slack'?q.tensionN:diskRadius(p)-norm(id==='edge-a'?q.a:q.b);
}
export function stepConicalTurntable(state:ConicalTurntableState,p:ConicalTurntableParams,dt:number):StepResult<ConicalTurntableState>{
  if(!Number.isFinite(dt)||dt<0)throw Error('Invalid dt: '+dt);
  if(dt===0)return {nextState:state,events:[]};
  if(state.terminal)return {nextState:state,events:[],halt:true,advancedTime:0};
  const end=state.t+dt;
  if(p.mode==='conical-pendulum')return {nextState:{...state,...coneSample(p,end),t:end},events:[]};
  if(!state.slippingOut)return {nextState:{...state,...pairSample(initialBody(p,p.omega*end),p,false),t:end,angleRad:p.omega*end},events:[]};
  let s:TimedBody={t:state.t,body:state.body};
  const events:PhysicsEvent[]=state.t===0?state.events.slice(0,1):[];
  // Implicit midpoint remains stable at vanishing slip; guard bisection
  // uses the same integrator, with the same fixed physical coefficients.
  const maxH=Math.min(MAX_KINETIC_STEP_S,.02/(1+p.omega));
  let count=0;
  while(s.t<end){
    if(++count>200000)throw Error('M07 kinetic substep budget exceeded');
    const h=Math.min(end-s.t,maxH);
    if(h<=0||s.t+h===s.t)break;
    const next=advance(s,p,h);
    let first:{timeOffset:number;state:TimedBody;id:Termination;bracketWidth:number}|null=null;
    for(const id of ['edge-a','edge-b','slack'] as const){
      const g0=guard(s,p,id),g1=guard(next,p,id);
      if(g0>=0&&g1<=0){
        const hit=bisectEvent(s,s.t,h,(a,d)=>advance(a,p,d),a=>guard(a,p,id),{timeTolerance:1e-10,biasEndpoint:'positive',triggerOnStartZero:true});
        if(hit&&(!first||hit.timeOffset<first.timeOffset))first={...hit,id};
      }
    }
    if(first){
      s=first.state;const sample=pairSample(s.body,p,true);
      const event:PhysicsEvent={id:first.id+'-'+s.t.toFixed(9),time:s.t,label:first.id==='slack'?'张力降为零 · 松绳边界':'到达圆盘边缘 · 接触模型结束',position:first.id==='edge-a'?sample.a:first.id==='edge-b'?sample.b:scale(add(sample.a,sample.b),.5),metrics:{bracketWidth:first.bracketWidth,tensionN:sample.tensionN,ropeLength:sample.ropeLength}};
      return {nextState:{...state,...sample,t:s.t,angleRad:p.omega*s.t,terminal:first.id,events:[...state.events,event]},events:[...events,event],halt:true,advancedTime:s.t-state.t};
    }
    s=next;
  }
  return {nextState:{...state,...pairSample(s.body,p,true),t:s.t,angleRad:p.omega*s.t},events};
}
export function computeObservables(s:ConicalTurntableState):Record<string,number>{
  return {tensionN:s.tensionN,frictionAN:s.frictionAN,frictionBN:s.frictionBN,rA:s.rA,rB:s.rB,coneAngleDeg:s.coneAngleDeg,
    xA:s.a.x,yA:s.a.y,xB:s.b.x,yB:s.b.y,vxA:s.va.x,vyA:s.va.y,vxB:s.vb.x,vyB:s.vb.y,
    frictionAMagnitude:norm(s.fa),frictionBMagnitude:norm(s.fb),ropeLength:s.ropeLength,
    actualSeparation:s.rotatingCone||s.body.length===0?s.ropeLength:norm(sub(s.b,s.a)),staticTMin:s.staticTMin,staticTMax:s.staticTMax,
    omega1:s.omega1,...(s.omega2===null?{}:{omega2:s.omega2}),...(s.omega3===null?{}:{omega3:s.omega3}),
    kineticEnergy:s.kineticEnergy,heat:s.heat,diskWork:s.diskWork,energyResidual:s.kineticEnergy-s.initialEnergy+s.heat-s.diskWork,
    slippingOut:s.slippingOut?1:0,terminal:s.terminal?1:0,rotatingCone:s.rotatingCone?1:0,
    ...(s.rotatingCone?{period:2*Math.PI*Math.sqrt(s.ropeLength*Math.cos(s.coneAngleDeg*Math.PI/180)/g)}:{}),phaseRad:s.angleRad,relativeSpeed:s.body.length?Math.hypot(s.body[2]!,s.body[3]!):0,
    ...(s.body.length===0?{coneTensionY:s.tensionN*(1.1-s.a.y)/s.ropeLength,coneNetY:s.tensionN*(1.1-s.a.y)/s.ropeLength-s.tensionN*Math.cos(s.coneAngleDeg*Math.PI/180)}:{})};
}
export function checkInvariants(s:ConicalTurntableState,_init:ConicalTurntableState,p:ConicalTurntableParams):InvariantReport[]{
  const report=(name:string,err:number,tolerance:number,unit?:string):InvariantReport=>({name,measuredError:Math.abs(err),tolerance,passed:Math.abs(err)<tolerance,...(unit?{unit}:{})});
  if(p.mode==='conical-pendulum')return [report('竖直方向力平衡',s.tensionN*Math.cos(s.coneAngleDeg*Math.PI/180)-p.massA*g,1e-8,'N'),
    report('水平向心力',s.tensionN*Math.sin(s.coneAngleDeg*Math.PI/180)-p.massA*p.omega**2*s.rA,1e-8,'N')];
  const out=[report('真实绳长',norm(sub(s.b,s.a))-length(p),1e-10,'m'),
    report('动能-盘功-热账本',s.kineticEnergy-s.initialEnergy+s.heat-s.diskWork,1e-7*Math.max(1,s.initialEnergy),'J'),
    report('A 摩擦上限',Math.max(0,norm(s.fa)-forceLimit(p.massA,p)),1e-9,'N'),
    report('B 摩擦上限',Math.max(0,norm(s.fb)-forceLimit(p.massB,p)),1e-9,'N')];
  if(!s.slippingOut)out.push(report('A 向心力平衡',s.frictionAN+s.tensionN-p.massA*p.omega**2*s.rA,1e-8,'N'),report('B 向心力平衡',s.frictionBN+s.tensionN-p.massB*p.omega**2*s.rB,1e-8,'N'));
  else out.push(report('热非负',Math.min(0,s.heat),1e-10,'J'));
  return out;
}
