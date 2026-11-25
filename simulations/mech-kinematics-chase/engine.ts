import type { InvariantReport, PhysicsEvent, StepResult } from '@physforge/sim-sdk';

export type ChaseScenario='accelerate-chase'|'brake-collision-avoid'|'two-stage-overtake';
export type KinematicsChaseParams={scenario:ChaseScenario;vA0:number;aA:number;reactionTime:number;xB0:number;vB0:number;aB:number;massA?:number;massB?:number};
export interface KinematicsChaseState {
  readonly t:number;
  readonly xA:number;readonly vA:number;readonly aACurrent:number;readonly aLockedZero:boolean;
  readonly xB:number;readonly vB:number;readonly aBCurrent:number;readonly bLockedZero:boolean;
  readonly minGap:number;readonly events:readonly PhysicsEvent[];
}
type Sample=Omit<KinematicsChaseState,'minGap'|'events'>;
type Car={x:number;v:number;a:number;locked:boolean};
const closeTime=(a:number,b:number)=>Math.abs(a-b)<=64*Number.EPSILON*Math.max(1,Math.abs(a),Math.abs(b));
function checkParams(p:KinematicsChaseParams){
  if(![p.vA0,p.aA,p.reactionTime,p.xB0,p.vB0,p.aB].every(Number.isFinite)||p.vA0<0||p.vB0<0||p.reactionTime<0)
    throw new Error('Chase requires finite parameters, nonnegative initial speeds and reaction time.');
}
function stopTime(v:number,a:number,delay:number):number{return a<0?delay+v/(-a):Infinity;}
function carAt(t:number,x0:number,v0:number,a:number,delay:number):Car{
  const coast=Math.min(t,delay),elapsed=Math.max(0,t-delay),duration=a<0?Math.min(elapsed,v0/(-a)):elapsed;
  const locked=a<0&&(v0===0||t>=stopTime(v0,a,delay));
  return {x:x0+v0*coast+v0*duration+.5*a*duration*duration,v:locked?0:Math.max(0,v0+a*duration),a:locked||t<delay?0:a,locked};
}
function sample(p:KinematicsChaseParams,t:number):Sample{
  const A=carAt(t,0,p.vA0,p.aA,p.reactionTime),B=carAt(t,p.xB0,p.vB0,p.aB,0);
  return {t,xA:A.x,vA:A.v,aACurrent:A.a,aLockedZero:A.locked,xB:B.x,vB:B.v,aBCurrent:B.a,bLockedZero:B.locked};
}
/** Stable quadratic roots in local segment time. A persistent equality is not a point event. */
function roots(a:number,b:number,c:number):number[]{
  if(a===0)return b===0?[]:[-c/b];
  const d=b*b-4*a*c,eps=32*Number.EPSILON*(b*b+Math.abs(4*a*c));
  if(d<0&&Math.abs(d)>eps)return [];
  if(Math.abs(d)<=eps)return [-b/(2*a)];
  const q=-.5*(b+(b>=0?1:-1)*Math.sqrt(d));
  return q===0?[-b/(2*a)]:[q/a,c/q].sort((x,y)=>x-y);
}
function phaseStarts(p:KinematicsChaseParams):number[]{
  return [...new Set([0,p.reactionTime,stopTime(p.vA0,p.aA,p.reactionTime),stopTime(p.vB0,p.aB,0)].filter(Number.isFinite))].sort((a,b)=>a-b);
}
type EventKind='stop-a'|'stop-b'|'co-vel'|'meet';
const labels:Record<EventKind,string>={'stop-a':'A车刹停锁止 (vA=0)','stop-b':'B车刹停锁止 (vB=0)','co-vel':'A、B 共速 (vA=vB)','meet':'A、B 相遇 (xA=xB)'};
function makeEvent(kind:EventKind,t:number,p:KinematicsChaseParams):PhysicsEvent{
  const s=sample(p,t);
  return {id:kind+'-'+t.toPrecision(15),time:t,label:labels[kind],position:{x:kind==='stop-b'?s.xB:s.xA,y:0},
    metrics:{deltaX:kind==='meet'?0:s.xB-s.xA,vA:s.vA,vB:s.vB,xA:s.xA,xB:s.xB}};
}
export function createInitialState(p:KinematicsChaseParams):KinematicsChaseState{
  checkParams(p);return {...sample(p,0),minGap:Math.abs(p.xB0),events:[]};
}
/** Exact piecewise kinematics. Parameters are fixed within a run; edits create a new initial state. */
export function stepKinematicsChase(state:KinematicsChaseState,p:KinematicsChaseParams,dt:number):StepResult<KinematicsChaseState>{
  if(!Number.isFinite(dt)||dt<0||!Number.isFinite(state.t+dt))throw new Error('Time step must be nonnegative and finite.');
  if(dt===0)return {nextState:state,events:[]};
  checkParams(p);
  const start=state.t,end=start+dt,events:PhysicsEvent[]=[];
  let minGap=state.minGap;
  const seen=new Set(state.events.map(e=>e.id));
  const inStep=(t:number)=>t>0&&(t>start||closeTime(t,start))&&(t<end||closeTime(t,end));
  function add(kind:EventKind,t:number){
    if(!Number.isFinite(t)||!inStep(t))return;
    // A root at a prior step boundary is deduplicated by its absolute analytic time.
    const ev=makeEvent(kind,t,p);
    if(seen.has(ev.id))return;
    seen.add(ev.id);events.push(ev);
  }
  const sa=stopTime(p.vA0,p.aA,p.reactionTime),sb=stopTime(p.vB0,p.aB,0);
  if(p.vA0>0)add('stop-a',sa);
  if(p.vB0>0)add('stop-b',sb);
  const starts=phaseStarts(p);
  for(let i=0;i<starts.length;i++){
    const left=starts[i]!,right=starts[i+1]??Infinity;
    if(left>end||right<start)continue;
    const s=sample(p,left),A=.5*(s.aBCurrent-s.aACurrent),B=s.vB-s.vA,C=s.xB-s.xA;
    const lo=Math.max(start,left)-left,hi=Math.min(end,right)-left;
    if(hi<lo)continue;
    const gap=(u:number)=>Math.abs((A*u+B)*u+C);
    minGap=Math.min(minGap,gap(lo),gap(hi));
    // Positive local roots belong to the segment on their left, including its endpoint.
    // A root leaving an interval of persistent equality is not a new point event.
    const phaseRoot=(u:number):number|null=>{
      if(!(u>0)||!Number.isFinite(u))return null;
      const t=left+u;
      if(Number.isFinite(right)&&closeTime(t,right))return right;
      return t<=right?t:null;
    };
    if(A!==0){
      const u=-B/(2*A),t=phaseRoot(u);
      if(t!==null){
        add('co-vel',t);
        if(inStep(t))minGap=Math.min(minGap,gap(t-left));
      }
    }
    for(const u of roots(A,B,C)){
      const t=phaseRoot(u);
      if(t!==null){add('meet',t);if(inStep(t))minGap=0;}
    }
  }
  events.sort((a,b)=>a.time-b.time||a.id.localeCompare(b.id));
  const next=sample(p,end);
  return {nextState:{...next,minGap:Math.min(minGap,Math.abs(next.xB-next.xA)),events:[...state.events,...events]},events};
}
export function computeObservables(s:KinematicsChaseState):Record<string,number>{
  const meet=s.events.filter(e=>e.id.startsWith('meet-')),co=s.events.filter(e=>e.id.startsWith('co-vel-'));
  return {xA:s.xA,xB:s.xB,vA:s.vA,vB:s.vB,aA:s.aACurrent,aB:s.aBCurrent,deltaX:s.xB-s.xA,deltaV:s.vA-s.vB,gap:Math.abs(s.xB-s.xA),minGap:s.minGap,
    meetCount:meet.length,coVelocityCount:co.length,aStopped:s.aLockedZero?1:0,bStopped:s.bLockedZero?1:0,
    ...(meet[0]?{firstMeetTime:meet[0].time}:{}),...(co[0]?{firstCoVelocityTime:co[0].time}:{})};
}
export function checkInvariants(s:KinematicsChaseState):InvariantReport[]{
  const err=Math.max(0,-s.vA,-s.vB,s.aLockedZero?Math.abs(s.vA)+Math.abs(s.aACurrent):0,s.bLockedZero?Math.abs(s.vB)+Math.abs(s.aBCurrent):0);
  return [{name:'单向刹车零速锁止不倒车校验',measuredError:err,tolerance:1e-10,passed:err<1e-10}];
}
