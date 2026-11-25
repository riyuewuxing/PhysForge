import {
  bisectEvent,
  CLASSROOM_GRAVITY,
  degToRad,
  solveUdwadiaKalaba,
  stepRK4,
  type Vec2
} from '@physforge/physics-core';
import type { InvariantReport, PhysicsEvent, StepResult } from '@physforge/sim-sdk';

export type VerticalTrackMode = 'outer-dome' | 'inner-loop' | 'light-rod';

export type VerticalCircularParams = {
  trackMode: VerticalTrackMode;
  mass: number;
  radius: number;
  vLaunch: number;
  startAngleDeg: number;
};

export interface VerticalCircularState {
  readonly t: number;
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly normalForceN: number;
  readonly derailed: boolean;
  readonly derailAngleDeg: number | null;
  readonly initialEnergy: number;
  readonly release: Readonly<{t:number;x:number;y:number;vx:number;vy:number}> | null;
  readonly trailContactCount: number;
  readonly trail: readonly Vec2[];
  readonly events: readonly PhysicsEvent[];
}

function evaluateConstrainedReaction(
  x: number,
  y: number,
  vx: number,
  vy: number,
  mass: number,
  g: number,
  trackMode: VerticalTrackMode
): { ax: number; ay: number; radialScalarForce: number } {
  const uk = solveUdwadiaKalaba({
    massDiagonal: [mass, mass],
    unconstrainedAccel: [0, -g],
    constraintMatrixA: [[x, y]],
    constraintVectorB: [-(vx * vx + vy * vy)]
  });
  const fcX = uk.constraintForce[0]!;
  const fcY = uk.constraintForce[1]!;
  const r = Math.max(1e-6, Math.hypot(x, y));
  // outward radial projection for outer-dome (FN > 0 pushes outward), inward radial projection for inner-loop (FN > 0 pushes inward)
  const radOut = (fcX * x + fcY * y) / r;
  const radialScalarForce = trackMode === 'outer-dome' ? radOut : -radOut;
  return {
    ax: uk.acceleration[0]!,
    ay: uk.acceleration[1]!,
    radialScalarForce
  };
}

type AngularState={t:number;theta:number;omega:number};
type CartesianState={t:number;x:number;y:number;vx:number;vy:number};
const radius=(p:VerticalCircularParams)=>Math.max(.4,p.radius);
const toCartesian=(a:AngularState,R:number):CartesianState=>({t:a.t,x:R*Math.sin(a.theta),y:R*Math.cos(a.theta),vx:R*a.omega*Math.cos(a.theta),vy:-R*a.omega*Math.sin(a.theta)});
const angleDeg=(s:CartesianState)=>Math.atan2(Math.abs(s.x),s.y)*180/Math.PI;
function releaseEvent(s:CartesianState,bracketWidth=0):PhysicsEvent{
  return {id:'derail-'+s.t.toFixed(6),time:s.t,label:'脱轨切换自由抛体 (θ_d='+angleDeg(s).toFixed(2)+'°)',position:{x:s.x,y:s.y},metrics:{derailAngleDeg:angleDeg(s),vx:s.vx,vy:s.vy,bracketWidth}};
}
export function createInitialState(p:VerticalCircularParams):VerticalCircularState{
  const R=radius(p),g=CLASSROOM_GRAVITY,outer=p.trackMode==='outer-dome';
  const theta=outer?degToRad(Math.max(0,Math.min(80,p.startAngleDeg))):Math.PI;
  const a={t:0,theta,omega:(outer?1:-1)*p.vLaunch/R};
  const s=toCartesian(a,R);
  // Exact bottom is (0,-R), not a roundoff displacement.
  if(!outer){s.x=0;s.y=-R;s.vx=p.vLaunch;s.vy=0;}
  const react=evaluateConstrainedReaction(s.x,s.y,s.vx,s.vy,p.mass,g,p.trackMode);
  const eps=32*Number.EPSILON*Math.max(1,p.mass*g,p.mass*p.vLaunch**2/R);
  const released=outer&&react.radialScalarForce<=eps;
  const event=released?releaseEvent(s):null;
  return {...s,normalForceN:released?0:react.radialScalarForce,derailed:released,
    derailAngleDeg:released?angleDeg(s):null,release:released?s:null,
    initialEnergy:.5*p.mass*(s.vx*s.vx+s.vy*s.vy)+p.mass*g*s.y,
    trail:[{x:s.x,y:s.y}],trailContactCount:1,events:event?[event]:[]};
}
function advanceAngle(s:AngularState,p:VerticalCircularParams,h:number):AngularState{
  const [theta,omega]=stepRK4([s.theta,s.omega],s.t,h,(_t,v)=>[v[1]!,CLASSROOM_GRAVITY/radius(p)*Math.sin(v[0]!)]);
  return {t:s.t+h,theta:theta!,omega:omega!};
}
// The initial energy gives a reaction-zero angle independently of RK drift.
// At the side/top limiting cases N touches zero but does not cross into an
// inadmissible interval. Only the intermediate energy range has a true guard.
function releaseGuard(p:VerticalCircularParams):((s:AngularState)=>number)|null{
  const gR=CLASSROOM_GRAVITY*radius(p),ratio=p.vLaunch**2/gR;
  if(p.trackMode==='outer-dome'){
    const c=(2*Math.cos(degToRad(Math.max(0,Math.min(80,p.startAngleDeg))))+ratio)/3;
    const theta=Math.acos(Math.max(-1,Math.min(1,c)));
    return s=>theta-s.theta;
  }
  const eps=32*Number.EPSILON*Math.max(1,ratio);
  if(p.trackMode==='inner-loop'&&ratio>2+eps&&ratio<5-eps){
    const theta=Math.acos((ratio-2)/3);
    return s=>s.theta-theta;
  }
  return null;
}
function projectile(s:CartesianState,h:number):CartesianState{
  const g=CLASSROOM_GRAVITY;
  return {t:s.t+h,x:s.x+s.vx*h,y:s.y+s.vy*h-.5*g*h*h,vx:s.vx,vy:s.vy-g*h};
}
// Keep actual sampled points, not extrapolated history; preserve phase boundary
// index through bounded history eviction. Release metadata is retained separately.
function appendTrail(s:VerticalCircularState,points:readonly Vec2[],contactCount:number){
  const all=[...s.trail,...points],drop=Math.max(0,all.length-1201);
  return {trail:all.slice(drop),trailContactCount:Math.max(0,contactCount-drop)};
}
export function stepVerticalCircular(state:VerticalCircularState,p:VerticalCircularParams,dt:number):StepResult<VerticalCircularState>{
  if(!Number.isFinite(dt)||dt<0)throw Error('Invalid dt: '+dt);
  if(dt===0)return {nextState:state,events:[]};
  if(state.derailed){
    const next=projectile(state,dt);
    // The initial event is also exposed to hosts that collect step events only.
    const events=state.t===0&&state.release?.t===0?state.events.slice(0,1):[];
    return {nextState:{...state,...next,...appendTrail(state,[{x:next.x,y:next.y}],state.trailContactCount),normalForceN:0},events};
  }
  const R=radius(p),g=CLASSROOM_GRAVITY;
  // Exact bottom-launch separatrix of the bilateral rod. Ordinary RK can
  // preserve energy to 1e-10 and still eventually flip the unstable branch.
  // This is the closed form of the same pendulum ODE, not a visual animation.
  const ratio=p.vLaunch*p.vLaunch/(g*R);
  if(p.trackMode==='light-rod'&&Math.abs(ratio-4)<=32*Number.EPSILON*Math.max(1,ratio)){
    const t=state.t+dt,k=Math.sqrt(g/R),theta=4*Math.atan(Math.exp(-k*t)),omega=-2*k*Math.sin(theta/2);
    const next=toCartesian({t,theta,omega},R);
    const react=evaluateConstrainedReaction(next.x,next.y,next.vx,next.vy,p.mass,g,p.trackMode);
    return {nextState:{...state,...next,...appendTrail(state,[{x:next.x,y:next.y}],state.trail.length+1),normalForceN:react.radialScalarForce},events:[]};
  }
  let a:AngularState={t:state.t,theta:Math.atan2(state.x,state.y),omega:(state.vx*state.y-state.vy*state.x)/(R*R)};
  const end=state.t+dt,guard=releaseGuard(p);
  let count=0;
  while(a.t<end){
    if(++count>200000)throw Error('M06 constrained substep budget exceeded');
    const h=Math.min(end-a.t,.0015,.02/(1+Math.abs(a.omega)+Math.sqrt(g/R)));
    if(h<=0||a.t+h===a.t)break;
    const next=advanceAngle(a,p,h);
    if(guard&&guard(a)>=0&&guard(next)<=0){
      const hit=bisectEvent(a,a.t,h,(s,d)=>advanceAngle(s,p,d),guard,{timeTolerance:1e-11,triggerOnStartZero:true});
      if(!hit)throw Error('M06 release bracket failed');
      const b=toCartesian(hit.state,R),event=releaseEvent(b,hit.bracketWidth),free=projectile(b,end-b.t);
      const pts=[{x:b.x,y:b.y},...(end>b.t?[{x:free.x,y:free.y}]:[])];
      return {nextState:{...state,...free,...appendTrail(state,pts,state.trail.length+1),
        normalForceN:0,derailed:true,derailAngleDeg:angleDeg(b),release:b,events:[...state.events,event]},events:[event]};
    }
    a=next;
  }
  const next=toCartesian(a,R),react=evaluateConstrainedReaction(next.x,next.y,next.vx,next.vy,p.mass,g,p.trackMode);
  // In physically admissible zero-force tangencies, numerical roundoff must
  // not display a spurious pulling contact force. The energy audit is separate.
  if(p.trackMode!=='light-rod'&&react.radialScalarForce < -1e-8*Math.max(1,p.mass*g))throw Error('M06 inadmissible constrained reaction: '+react.radialScalarForce);
  const N=p.trackMode==='light-rod'?react.radialScalarForce:Math.max(0,react.radialScalarForce);
  return {nextState:{...state,...next,...appendTrail(state,[{x:next.x,y:next.y}],state.trail.length+1),normalForceN:N},events:[]};
}

export function computeObservables(state: VerticalCircularState, params: VerticalCircularParams): Record<string, number> {
  const g = CLASSROOM_GRAVITY;
  const speed = Math.hypot(state.vx, state.vy);
  const energy = 0.5 * params.mass * speed * speed + params.mass * g * state.y;
  return {
    x: state.x,
    y: state.y,
    speed,
    normalForceN: state.normalForceN,
    energy,
    thetaDeg:Math.atan2(Math.abs(state.x),state.y)*180/Math.PI,
    vx:state.vx,vy:state.vy,derailed:state.derailed?1:0,
    ...(state.release?{derailTime:state.release.t,derailAngleDeg:state.derailAngleDeg!}:{}),
    kineticEnergy:.5*params.mass*speed*speed,potentialEnergy:params.mass*g*state.y
  };
}

export function checkInvariants(state: VerticalCircularState, _init: VerticalCircularState, params: VerticalCircularParams): InvariantReport[] {
  const obs = computeObservables(state, params);
  const absoluteError=Math.abs(obs.energy!-state.initialEnergy);
  // At zero reference energy the relative error is undefined. Audit the
  // absolute SI residual as well, rather than normalize by an arbitrary 1e-6 J.
  if(Math.abs(state.initialEnergy)<1e-8*Math.max(1,params.mass*CLASSROOM_GRAVITY*radius(params)))return [{name:'机械能绝对残差（初始能量近零）',measuredError:absoluteError,tolerance:1e-8,passed:absoluteError<1e-8,unit:'J'}];
  const relErr = absoluteError / Math.max(Math.abs(state.initialEnergy), 1e-6);
  return [{ name: '竖直圆周机械能守恒 ΔE/E₀', measuredError: relErr, tolerance: 1e-6, passed: relErr < 1e-6 }];
}
