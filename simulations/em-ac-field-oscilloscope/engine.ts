import { bisectEvent, CLASSROOM_GRAVITY, degToRad, stepRK4 } from '@physforge/physics-core';
import type { InvariantReport, PhysicsEvent, StepResult } from '@physforge/sim-sdk';

export type AcScopeMode =
  | 'ac-square-wave'
  | 'ac-sine-wave'
  | 'oscilloscope-lissajous'
  | 'equivalent-gravity';

export type AcScopeParams = {
  mode: AcScopeMode;
  periodT: number;
  accelA0: number;
  uAccelV: number;
  uXMaxV: number;
  uYMaxV: number;
  freqRatioYOverX: number;
  phaseDeltaDeg: number;
  eqFieldAccelX: number;
  eqFieldAccelY: number;
  pendulumLengthL: number;
  initialAngleDeg: number;
};


export const CRT_ETA=1.75882001076e11;
export const CRT_PLATE_LENGTH=.08;
export const CRT_PLATE_GAP=.02;
export const CRT_DRIFT_LENGTH=.16;
export const CRT_SCREEN_RADIUS=.06;
export const EQ_MASS=1;
export type BeamStatus='lit'|'no-acceleration'|'x-plate'|'y-plate'|'both-plates'|'screen-miss';
export interface GroupParticle {
  readonly t0Frac:number;
  readonly releaseT:number;
  readonly x:number;
  readonly v:number;
  readonly active:boolean;
}
export interface ScopeSample {readonly x:number;readonly y:number;readonly t:number;readonly breakBefore:boolean}
export interface AcScopeState {
  readonly t:number;
  readonly particles:readonly GroupParticle[];
  readonly scopeTrail:readonly ScopeSample[];
  readonly screenX:number|null;
  readonly screenY:number|null;
  readonly beamStatus:BeamStatus;
  readonly theta:number;
  readonly omega:number;
  readonly initialEqEnergy:number;
  readonly events:readonly PhysicsEvent[];
}
const RELEASE_FRACS=[0,.125,.25,.375] as const;
const period=(p:AcScopeParams)=>Math.max(.2,p.periodT);
const length=(p:AcScopeParams)=>Math.max(.4,p.pendulumLengthL);
const floorPhase=(x:number)=>Math.floor(x+Math.min(1e-8,8*Number.EPSILON*Math.max(1,Math.abs(x))));
function squarePrimitive(t:number,T:number,a:number){
  const n=floorPhase(t/T),r=Math.max(0,Math.min(T,t-n*T)),h=T/2,z=r-h;
  return {A:a*Math.min(r,T-r),B:a*(n*h*h+(r<=h?.5*r*r:.5*h*h+h*z-.5*z*z))};
}
export function sampleAlternatingParticle(p:GroupParticle,t:number,params:AcScopeParams):GroupParticle{
  const tau=t-p.releaseT;
  if(tau<-1e-13)return {...p,active:false,x:0,v:0};
  if(tau<=0)return {...p,active:true,x:0,v:0};
  const T=period(params),a=params.accelA0;
  if(params.mode==='ac-square-wave'){
    const u=squarePrimitive(p.releaseT,T,a),w=squarePrimitive(t,T,a);
    return {...p,active:true,x:w.B-u.B-u.A*tau,v:w.A-u.A};
  }
  const omega=2*Math.PI/T,phi0=omega*p.releaseT,phi=omega*t;
  return {...p,active:true,x:a/omega*(Math.cos(phi0)*tau-(Math.sin(phi)-Math.sin(phi0))/omega),
    v:a/omega*(Math.cos(phi0)-Math.cos(phi))};
}

export type DeflectionStatus='no-acceleration'|'plate-hit'|'screen-plane';
export interface AxisDeflection {
  status:DeflectionStatus;
  analyticalY:number|null;
  exitY:number|null;
  exitVy:number|null;
  contactTime:number|null;
  contactY:number|null;
  flightTime:number|null;
  vx:number;
}
/** One quasi-static axis. A mathematical extrapolation beyond a plate is not a screen hit. */
export function solveDeflectionAxis(uAccelV:number,uDeflectV:number,L1=CRT_PLATE_LENGTH,d=CRT_PLATE_GAP,L2=CRT_DRIFT_LENGTH,eta=CRT_ETA):AxisDeflection{
  if(![uAccelV,uDeflectV,L1,d,L2,eta].every(Number.isFinite)||L1<=0||d<=0||L2<0)throw Error('Invalid CRT geometry or voltage');
  if(uAccelV<=0||eta<=0)return {status:'no-acceleration',analyticalY:null,exitY:null,exitVy:null,contactTime:null,contactY:null,flightTime:null,vx:0};
  const vx=Math.sqrt(2*eta*uAccelV),ay=eta*uDeflectV/d,tP=L1/vx,tD=L2/vx;
  const yP=.5*ay*tP*tP,analyticalY=yP+ay*tP*tD;
  if(Math.abs(yP)>=d/2*(1-8*Number.EPSILON)){
    const contactY=Math.sign(ay)*d/2,exact=Math.sqrt(d/Math.abs(ay));
    const advance=(s:{y:number;v:number},h:number)=>({y:s.y+s.v*h+.5*ay*h*h,v:s.v+ay*h});
    const hit=bisectEvent({y:0,v:0},0,tP,advance,s=>Math.sign(ay)*s.y-d/2,{timeTolerance:1e-16,triggerOnStartZero:false});
    // Exact endpoint contact can differ by a few ulps from the bracket.
    return {status:'plate-hit',analyticalY,exitY:null,exitVy:null,contactTime:hit?.timeOffset??exact,contactY,flightTime:null,vx};
  }
  return {status:'screen-plane',analyticalY,exitY:yP,exitVy:ay*tP,contactTime:null,contactY:null,flightTime:tP+tD,vx};
}
export function integrateDeflectionTrajectory(uAccelV:number,uDeflectV:number,L1=CRT_PLATE_LENGTH,d=CRT_PLATE_GAP,L2=CRT_DRIFT_LENGTH,eta=CRT_ETA):AxisDeflection&{numericY:number|null}{
  const result=solveDeflectionAxis(uAccelV,uDeflectV,L1,d,L2,eta);
  if(result.status!=='screen-plane')return {...result,numericY:null};
  const tP=L1/result.vx,h=tP/40,ay=eta*uDeflectV/d;
  let yv=[0,0];
  for(let i=0;i<40;i++)yv=stepRK4(yv,i*h,h,(_t,s)=>[s[1]!,ay]);
  return {...result,numericY:yv[0]!+yv[1]!*L2/result.vx};
}
export function sampleCrt(t:number,p:AcScopeParams){
  const w=2*Math.PI/period(p),ux=p.uXMaxV*Math.sin(w*t),uy=p.uYMaxV*Math.sin(w*p.freqRatioYOverX*t+degToRad(p.phaseDeltaDeg));
  const X=solveDeflectionAxis(p.uAccelV,ux),Y=solveDeflectionAxis(p.uAccelV,uy);
  let status:BeamStatus='lit';
  if(X.status==='no-acceleration'||Y.status==='no-acceleration')status='no-acceleration';
  else if(X.status==='plate-hit'&&Y.status==='plate-hit')status='both-plates';
  else if(X.status==='plate-hit')status='x-plate';
  else if(Y.status==='plate-hit')status='y-plate';
  else if(Math.hypot(X.analyticalY!,Y.analyticalY!)>CRT_SCREEN_RADIUS)status='screen-miss';
  return {status,ux,uy,X,Y,x:status==='lit'?X.analyticalY!*100:null,y:status==='lit'?Y.analyticalY!*100:null};
}
/** Exact maximum of |sin| on a closed phase interval; includes interior extrema. */
function maxAbsSine(lo:number,hi:number){
  const a=Math.min(lo,hi),b=Math.max(lo,hi);
  if(b-a>=Math.PI)return 1;
  const k=Math.ceil((a-Math.PI/2)/Math.PI);
  if(Math.PI/2+k*Math.PI<=b)return 1;
  return Math.max(Math.abs(Math.sin(a)),Math.abs(Math.sin(b)));
}
/**
 * A connecting segment is permitted only when the ENTIRE signal-time interval
 * is certified lit. Plate maxima are analytical; screen radius uses conservative
 * interval bounds. Near a boundary an unresolved interval breaks the line,
 * never fabricates a continuous trace. This does not increase the sampling rate.
 */
export function isCrtContinuouslyLit(t0:number,t1:number,p:AcScopeParams):boolean{
  if(p.uAccelV<=0||!Number.isFinite(t0)||!Number.isFinite(t1)||t1<t0)return false;
  const w=2*Math.PI/period(p),wy=w*p.freqRatioYOverX,phase=degToRad(p.phaseDeltaDeg);
  const gain=CRT_PLATE_LENGTH*(CRT_PLATE_LENGTH/2+CRT_DRIFT_LENGTH)/(2*CRT_PLATE_GAP*p.uAccelV);
  const plateLimit=2*CRT_PLATE_GAP**2*p.uAccelV/CRT_PLATE_LENGTH**2;
  const ax=Math.abs(p.uXMaxV),ay=Math.abs(p.uYMaxV);
  if(ax*maxAbsSine(w*t0,w*t1)>=plateLimit*(1-8*Number.EPSILON)||
     ay*maxAbsSine(wy*t0+phase,wy*t1+phase)>=plateLimit*(1-8*Number.EPSILON))return false;
  const radius2=CRT_SCREEN_RADIUS**2;
  const screen2=(t:number)=>(gain*ax*Math.sin(w*t))**2+(gain*ay*Math.sin(wy*t+phase))**2;
  // A sum of independent maxima is a safe upper bound even for unequal frequencies.
  const pending:[number,number,number][]=[[t0,t1,0]];
  let visited=0;
  while(pending.length){
    const [a,b,depth]=pending.pop()!;
    if(++visited>1024)return false;
    const bound=(gain*ax*maxAbsSine(w*a,w*b))**2+(gain*ay*maxAbsSine(wy*a+phase,wy*b+phase))**2;
    if(bound<=radius2*(1-16*Number.EPSILON))continue;
    const mid=(a+b)/2;
    if(screen2(a)>radius2||screen2(b)>radius2||screen2(mid)>radius2)return false;
    if(depth>=16||mid===a||mid===b)return false;
    pending.push([a,mid,depth+1],[mid,b,depth+1]);
  }
  return true;
}

export function equivalentMetrics(s:Pick<AcScopeState,'theta'|'omega'>,p:AcScopeParams){
  const L=length(p),gx=p.eqFieldAccelX,gy=p.eqFieldAccelY-CLASSROOM_GRAVITY,mag=Math.hypot(gx,gy);
  const rx=Math.sin(s.theta),ry=-Math.cos(s.theta),tx=Math.cos(s.theta),ty=Math.sin(s.theta);
  const rodForce=EQ_MASS*(L*s.omega*s.omega+gx*rx+gy*ry);
  return {L,gx,gy,mag,x:L*rx,y:L*ry,rx,ry,tx,ty,rodForce,thetaEq:mag===0?null:Math.atan2(gx,-gy),
    thetaDDot:(gx*tx+gy*ty)/L,energy:EQ_MASS*(.5*L*L*s.omega*s.omega-L*(gx*rx+gy*ry))};
}
export function createInitialState(p:AcScopeParams):AcScopeState{
  const T=period(p),theta=degToRad(p.initialAngleDeg),omega=0;
  const crt=p.mode==='oscilloscope-lissajous'?sampleCrt(0,p):null;
  return {t:0,particles:RELEASE_FRACS.map(frac=>({t0Frac:frac,releaseT:frac*T,x:0,v:0,active:frac===0})),
    scopeTrail:crt?.status==='lit'?[{x:crt.x!,y:crt.y!,t:0,breakBefore:true}]:[],
    screenX:crt?.x??null,screenY:crt?.y??null,beamStatus:crt?.status??'no-acceleration',
    theta,omega,initialEqEnergy:equivalentMetrics({theta,omega},p).energy,events:[]};
}
export function stepAcScope(s:AcScopeState,p:AcScopeParams,dt:number):StepResult<AcScopeState>{
  if(!Number.isFinite(dt)||dt<0)throw Error('Invalid dt: '+dt);
  if(dt===0)return {nextState:s,events:[]};
  const nt=s.t+dt,events:PhysicsEvent[]=[];
  if(!Number.isFinite(nt))throw Error('Invalid resulting time');
  if(p.mode==='ac-square-wave'||p.mode==='ac-sine-wave'){
    if(p.mode==='ac-square-wave'){
      const h=period(p)/2,first=floorPhase(s.t/h)+1,last=floorPhase(nt/h),count=Math.max(0,last-first+1);
      // Scheduled discontinuities have exact analytical times. For unusually
      // large external steps, retain explicit aggregate count, not lost motion.
      const emit=(k:number,skipped=0)=>events.push({id:'ac-flip-'+k,time:k*h,label:skipped?'方波换向 · 其余 '+skipped+' 次归并':'方波交变电场换向',
        metrics:{polarity:(k%2?-1:1)*p.accelA0,...(skipped?{aggregatedFlips:skipped}:{} )}});
      if(count<=4096)for(let k=first;k<=last;k++)emit(k);
      else{for(let k=first;k<first+4095;k++)emit(k);emit(last,count-4096);}
    }
    return {nextState:{...s,t:nt,particles:s.particles.map(q=>sampleAlternatingParticle(q,nt,p)),events:[...s.events,...events]},events};
  }
  if(p.mode==='oscilloscope-lissajous'){
    const crt=sampleCrt(nt,p),trail=s.scopeTrail.filter(q=>q.t>=nt-2*period(p));
    if(crt.status==='lit'){
      const discontinuity=s.beamStatus!=='lit'||dt>period(p)/Math.max(1,p.freqRatioYOverX)/16||!isCrtContinuouslyLit(s.t,nt,p);
      trail.push({x:crt.x!,y:crt.y!,t:nt,breakBefore:discontinuity});
    }
    return {nextState:{...s,t:nt,screenX:crt.x,screenY:crt.y,beamStatus:crt.status,scopeTrail:trail.slice(-4096)},events};
  }
  const L=length(p),gx=p.eqFieldAccelX,gy=p.eqFieldAccelY-CLASSROOM_GRAVITY,n=Math.max(1,Math.ceil(dt/.004)),h=dt/n;
  let y=[s.theta,s.omega];
  for(let i=0;i<n;i++)y=stepRK4(y,s.t+i*h,h,(_t,z)=>[z[1]!, (gx*Math.cos(z[0]!)+gy*Math.sin(z[0]!))/L]);
  return {nextState:{...s,t:nt,theta:y[0]!,omega:y[1]!},events};
}
export function computeObservables(s:AcScopeState,p:AcScopeParams):Record<string,number>{
  if(p.mode==='ac-square-wave'||p.mode==='ac-sine-wave'){
    const a=p.mode==='ac-square-wave'?(floorPhase(s.t/(period(p)/2))%2?-1:1)*p.accelA0:p.accelA0*Math.sin(2*Math.PI*s.t/period(p));
    const out:Record<string,number>={t:s.t,fieldAcceleration:a};
    const suffix=['0','Eighth','Quarter','ThreeEighths'];
    s.particles.forEach((q,i)=>{out['released'+suffix[i]]=q.active?1:0;if(q.active){out['x'+suffix[i]]=q.x;out['v'+suffix[i]]=q.v;}});
    return out;
  }
  if(p.mode==='oscilloscope-lissajous'){
    const crt=sampleCrt(s.t,p);
    const code:Record<BeamStatus,number>={lit:0,'no-acceleration':1,'x-plate':2,'y-plate':3,'both-plates':4,'screen-miss':5};
    return {t:s.t,signalUxV:crt.ux,signalUyV:crt.uy,beamOn:s.beamStatus==='lit'?1:0,beamStatus:code[s.beamStatus],
      ...(s.screenX!==null&&s.screenY!==null?{screenXCm:s.screenX,screenYCm:s.screenY}:{}),
      ...(crt.X.contactTime!==null?{xContactNs:crt.X.contactTime*1e9}:{}),
      ...(crt.Y.contactTime!==null?{yContactNs:crt.Y.contactTime*1e9}:{}),
      ...(crt.X.analyticalY!==null?{predictedXCm:crt.X.analyticalY*100}:{}),
      ...(crt.Y.analyticalY!==null?{predictedYCm:crt.Y.analyticalY*100}:{})};
  }
  const g=equivalentMetrics(s,p);
  return {t:s.t,gEffX:g.gx,gEffY:g.gy,gEffMag:g.mag,eqThetaDeg:s.theta*180/Math.PI,eqOmega:s.omega,eqTotalEnergy:g.energy,rodForceN:g.rodForce,
    eqX:g.x,eqY:g.y,eqThetaDDot:g.thetaDDot,...(g.thetaEq!==null?{eqLowestAngleDeg:g.thetaEq*180/Math.PI}:{})};
}
export function checkInvariants(s:AcScopeState,initial:AcScopeState,p:AcScopeParams):InvariantReport[]{
  const report=(name:string,err:number,tolerance:number):InvariantReport=>({name,measuredError:err,tolerance,passed:Number.isFinite(err)&&err<=tolerance});
  if(p.mode==='equivalent-gravity'){
    const e=equivalentMetrics(s,p),e0=equivalentMetrics(initial,p).energy;
    return [report('固定等效场内刚性杆摆总能量',Math.abs(e.energy-e0)/Math.max(1,Math.abs(e0)),1e-5)];
  }
  if(p.mode==='oscilloscope-lissajous'){
    const valid=s.scopeTrail.every(q=>Number.isFinite(q.x)&&Number.isFinite(q.y)&&Math.hypot(q.x,q.y)<=CRT_SCREEN_RADIUS*100+1e-8);
    const beam=(s.beamStatus==='lit')===(s.screenX!==null&&s.screenY!==null);
    return [report('屏幕真实命中与断光一致性',valid&&beam?0:1,0)];
  }
  const a=Math.abs(p.accelA0),T=period(p),vBound=p.mode==='ac-square-wave'?a*T/2:a*T/Math.PI;
  const err=Math.max(0,...s.particles.map(q=>Math.max(Math.abs(q.v)-vBound,Math.abs(q.x)-.5*a*Math.max(0,s.t-q.releaseT)**2,
    !q.active?Math.abs(q.x)+Math.abs(q.v):0)));
  return [report('四相位运动学速度与位移界',err,1e-7)];
}
