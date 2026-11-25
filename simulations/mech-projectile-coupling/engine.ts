import { bisectEvent, CLASSROOM_GRAVITY, degToRad, stepRK4, type Vec2 } from '@physforge/physics-core';
import type { InvariantReport, PhysicsEvent, StepResult } from '@physforge/sim-sdk';

export type ProjectileCouplingMode = 'incline-flat' | 'semicircle-trough' | 'safety-envelope';

export type ProjectileCouplingParams = {
  mode: ProjectileCouplingMode;
  v0: number;
  launchAngleDeg: number;
  inclineDeg: number;
  troughRadius: number;
  dragCoeff: number;
  mass: number;
};

export interface ProjectileCouplingState {
  readonly t: number;
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly landed: boolean;
  readonly termination?: 'impact' | 'escaped';
  readonly impactTime: number | null;
  readonly initialEnergy: number;
  readonly trail: readonly Vec2[];
  readonly vacuumTrail: readonly Vec2[];
  readonly events: readonly PhysicsEvent[];
}

function surfaceSignedDistance(x: number, y: number, params: ProjectileCouplingParams): number {
  if (params.mode === 'incline-flat') {
    const theta = degToRad(params.inclineDeg);
    return y + x * Math.tan(theta);
  }
  if (params.mode === 'semicircle-trough') {
    const R = Math.max(0.5, params.troughRadius);
    // Lower semicircular wall only. The opening above y=0 is empty space.
    return y + Math.sqrt(Math.max(0, x * (2 * R - x)));
  }
  return y;
}

export function createInitialState(params: ProjectileCouplingParams): ProjectileCouplingState {
  const ang = params.mode === 'incline-flat' ? 0 : degToRad(params.launchAngleDeg);
  const vx = params.v0 * Math.cos(ang);
  const vy = params.v0 * Math.sin(ang);
  return {
    t: 0,
    x: 0,
    y: 0,
    vx,
    vy,
    landed: false,
    impactTime: null,
    initialEnergy: 0.5 * params.mass * (vx * vx + vy * vy),
    trail: [{ x: 0, y: 0 }],
    vacuumTrail: [{ x: 0, y: 0 }],
    events: []
  };
}

function advanceProjectile(
  s: { t: number; x: number; y: number; vx: number; vy: number },
  params: ProjectileCouplingParams,
  dt: number
): { t: number; x: number; y: number; vx: number; vy: number } {
  if (dt <= 0) return s;
  const g = CLASSROOM_GRAVITY;
  const m = Math.max(0.1, params.mass);
  const c = Math.max(0, params.dragCoeff);
  if(c===0)return {t:s.t+dt,x:s.x+s.vx*dt,y:s.y+s.vy*dt-.5*g*dt*dt,vx:s.vx,vy:s.vy-g*dt};
  const nextVec = stepRK4([s.x, s.y, s.vx, s.vy], s.t, dt, (_t, yv) => {
    const vx = yv[2]!;
    const vy = yv[3]!;
    const spd = Math.hypot(vx, vy);
    const dragFactor = (c * spd) / m;
    return [vx, vy, -dragFactor * vx, -g - dragFactor * vy];
  });
  return { t: s.t + dt, x: nextVec[0]!, y: nextVec[1]!, vx: nextVec[2]!, vy: nextVec[3]! };
}

type KinematicState={t:number;x:number;y:number;vx:number;vy:number};
const MAX_SUBSTEP=1/240;
const EVENT_TOLERANCE=1e-9;

/** Find the first returning root, not the launch point itself.
 * The bounded substep normally establishes the interior sample. Halving
 * also handles arbitrarily shallow positive launch angles within one step.
 */
function returningImpact(start:KinematicState,end:KinematicState,params:ProjectileCouplingParams):KinematicState|null{
  const gap=(s:KinematicState)=>surfaceSignedDistance(s.x,s.y,params);
  if(gap(end)>0)return null;
  let interior=start;
  if(gap(start)<=0){
    let h=(end.t-start.t)/2;
    for(let k=0;k<48;k++,h/=2){
      if(start.t+h===start.t)break;
      const probe=advanceProjectile(start,params,h);
      if(gap(probe)>0){interior=probe;break;}
    }
    // No departure into the physically valid domain.
    if(gap(interior)<=0)return start;
  }
  const hit=bisectEvent(interior,interior.t,end.t-interior.t,(s,h)=>advanceProjectile(s,params,h),gap,
    {timeTolerance:EVENT_TOLERANCE,biasEndpoint:'midpoint'});
  if(!hit)throw Error('M04 failed to bracket physical impact');
  return hit.state;
}

export function stepProjectileCoupling(
  state:ProjectileCouplingState,params:ProjectileCouplingParams,dt:number
):StepResult<ProjectileCouplingState>{
  if(!Number.isFinite(dt)||dt<0)throw new Error('Invalid dt: '+dt);
  if(state.landed||state.termination)return {nextState:state,events:[],advancedTime:0,halt:true};
  if(dt===0)return {nextState:state,events:[]};
  let cur:KinematicState={t:state.t,x:state.x,y:state.y,vx:state.vx,vy:state.vy};
  const endT=state.t+dt,points:Vec2[]=[],vacuumPoints:Vec2[]=[];
  let termination:'impact'|'escaped'|undefined;
  const g=CLASSROOM_GRAVITY,angle=params.mode==='incline-flat'?0:degToRad(params.launchAngleDeg);
  const append=(s:KinematicState)=>{
    points.push({x:s.x,y:s.y});
    vacuumPoints.push({x:params.v0*Math.cos(angle)*s.t,y:params.v0*Math.sin(angle)*s.t-.5*g*s.t*s.t});
  };
  // A horizontal launch exactly at the flat ground has no free-flight segment.
  if(params.mode==='safety-envelope'&&state.t===0&&state.vy<=0)termination='impact';
  while(!termination&&cur.t<endT){
    const h=Math.min(MAX_SUBSTEP,endT-cur.t);
    if(cur.t+h===cur.t)break;
    let candidate=advanceProjectile(cur,params,h),rim=false;
    if(params.mode==='semicircle-trough'){
      const R=Math.max(.5,params.troughRadius),right=(s:KinematicState)=>2*R-s.x;
      if(right(candidate)<=0){
        const hit=bisectEvent(cur,cur.t,h,(s,t)=>advanceProjectile(s,params,t),right,
          {timeTolerance:EVENT_TOLERANCE,biasEndpoint:'positive',triggerOnStartZero:true});
        if(!hit)throw Error('M04 failed to bracket right rim');
        candidate=hit.state;rim=true;
      }
    }
    const impact=returningImpact(cur,candidate,params);
    if(impact){cur=impact;termination='impact';}
    else{cur=candidate;if(rim)termination=cur.y<=EVENT_TOLERANCE?'impact':'escaped';}
    append(cur);
  }
  const landed=termination==='impact',advancedTime=Math.max(0,cur.t-state.t);
  const events:PhysicsEvent[]=termination?[{
    id:termination==='impact'?'m04-impact':'m04-escaped',
    time:cur.t,label:landed?'撞击物理表面（保留撞前瞬时值）':'飞出半圆槽口（后续未建模）',
    position:{x:cur.x,y:cur.y},metrics:{speed:Math.hypot(cur.vx,cur.vy)}
  }]:[];
  return {nextState:{...state,...cur,landed,impactTime:landed?cur.t:null,
    ...(termination?{termination}:{}),trail:[...state.trail,...points],
    vacuumTrail:[...state.vacuumTrail,...vacuumPoints],events:[...state.events,...events]},
    events,advancedTime,...(termination?{halt:true}:{})};
}

export function computeObservables(state: ProjectileCouplingState, params: ProjectileCouplingParams): Record<string, number> {
  const m = Math.max(0.1, params.mass);
  const ke = 0.5 * m * (state.vx * state.vx + state.vy * state.vy);
  const pe = m * CLASSROOM_GRAVITY * state.y;
  return {
    x: state.x,
    y: state.y,
    vx: state.vx,
    vy: state.vy,
    kineticEnergy: ke,
    totalMechanicalEnergy: ke + pe,
    speed:Math.hypot(state.vx,state.vy),terminal:state.termination||state.landed?1:0,landed:state.landed?1:0,
    ...(state.impactTime!==null?{impactTime:state.impactTime}:{})
  };
}

export function checkInvariants(state: ProjectileCouplingState, _init: ProjectileCouplingState, params: ProjectileCouplingParams): InvariantReport[] {
  if (params.dragCoeff === 0) {
    const m = Math.max(0.1, params.mass);
    const eNow = 0.5 * m * (state.vx * state.vx + state.vy * state.vy) + m * CLASSROOM_GRAVITY * state.y;
    const err = Math.abs(eNow - state.initialEnergy) / Math.max(state.initialEnergy, 1e-9);
    return [{ name: '无阻力抛体机械能守恒', measuredError: err, tolerance: 1e-6, passed: err < 1e-6 }];
  }
  return [];
}
