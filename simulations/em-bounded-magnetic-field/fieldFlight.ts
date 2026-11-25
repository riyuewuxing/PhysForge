import { bisectEvent, vec3, type ChargedParticleState } from '@physforge/physics-core';
import type { BoundedMagneticParams } from './engine.js';

/** Exact constant-field flow: dvx/dt=omega*vy, dvy/dt=a-omega*vx.
 * Stable at zero and tiny B; no subtraction of two divergent E/B velocities. */
export function advanceUniformField(
  state:ChargedParticleState,dt:number,omega:number,a:number
):ChargedParticleState {
  const theta=omega*dt;
  if(!Number.isFinite(theta))throw new RangeError('Uniform-field phase is not finite');
  const s=Math.sin(theta),c=Math.cos(theta);
  const sinc=theta===0?1:s/theta;
  const h=theta/2,halfSinc=h===0?1:Math.sin(h)/h;
  const cos2=.5*halfSinc*halfSinc;
  const cosc=theta*cos2;
  const sin2=Math.abs(theta)<1e-3?theta*(1/6-theta*theta/120+theta**4/5040):(1-sinc)/theta;
  const {x,y,z}=state.position,{x:vx,y:vy,z:vz}=state.velocity;
  return {position:vec3(x+dt*(vx*sinc+vy*cosc)+a*dt*dt*sin2,
    y+dt*(vy*sinc-vx*cosc)+a*dt*dt*cos2,z+vz*dt),
    velocity:vec3(c*vx+s*vy+a*dt*cosc,c*vy-s*vx+a*dt*sinc,vz),t:state.t+dt};
}

const EVENT_TIME_TOL=1e-10;
type Distance=(state:ChargedParticleState)=>number;
type Advance=(state:ChargedParticleState,dt:number)=>ChargedParticleState;

/** For a free ray and convex field domain, choose a strictly interior probe
 * if one exists. The probe is a bracket, not the reported event time. */
function freeRayProbe(state:ChargedParticleState,p:BoundedMagneticParams,dt:number):number|null {
  const {x,y}=state.position,{x:vx,y:vy}=state.velocity;
  const speed2=vx*vx+vy*vy;
  if(speed2===0)return null;
  if(p.mode==='half-space')return vx>0?dt:null;
  if(p.mode==='circular'){
    const nearest=Math.max(0,Math.min(dt,-(x*vx+y*vy)/speed2));
    return nearest>0?nearest:null;
  }
  if(p.mode==='rectangular'){
    let lo=0,hi=dt;
    const w=Math.max(p.fieldScale,.1),h=Math.max(1.6*p.fieldScale,.2)/2;
    for(const [pos,vel,min,max] of [[x,vx,0,w],[y,vy,-h,h]] as const){
      if(vel===0){if(pos<=min||pos>=max)return null;continue;}
      const a=(min-pos)/vel,b=(max-pos)/vel;
      lo=Math.max(lo,Math.min(a,b));hi=Math.min(hi,Math.max(a,b));
      if(hi<=lo)return null;
    }
    return (lo+hi)/2;
  }
  return null;
}

/** In B, x/y or |r| extrema partition an exact circular path into
 * intervals on which relevant boundary coordinates are monotone.
 * A complete revolution without exit proves that later revolutions
 * cannot contain an exit. No fixed sample count can miss a thin arc. */
function magneticProbes(state:ChargedParticleState,p:BoundedMagneticParams,dt:number,omega:number):number[]{
  if(omega===0)return [dt];
  const {x,y}=state.position,{x:vx,y:vy}=state.velocity;
  const rate=Math.abs(omega),limit=Math.min(dt,2*Math.PI/rate);
  const probes=[limit];
  const addExtrema=(A:number,B:number)=>{
    if(A===0&&B===0)return;
    // A cos(theta)+B sin(theta)=0, theta may have either sign.
    const offset=Math.atan2(B*Math.sign(omega),A)+Math.PI/2;
    const phase=((offset%Math.PI)+Math.PI)%Math.PI;
    for(let k=0;k<3;k++){
      const t=(phase+k*Math.PI)/rate;
      if(t>0&&t<limit)probes.push(t);
    }
  };
  if(p.mode==='circular'){
    // Radial derivative C dot v, scaled by omega to avoid a large center.
    addExtrema(omega*(x*vx+y*vy),omega*(x*vy-y*vx)+vx*vx+vy*vy);
  }else{
    addExtrema(vx,vy);
    if(p.mode==='rectangular')addExtrema(vy,-vx);
  }
  return probes.sort((a,b)=>a-b);
}

export function firstBoundaryCrossing(
  start:ChargedParticleState,p:BoundedMagneticParams,dt:number,inField:boolean,
  omega:number,distance:Distance,advance:Advance
):{state:ChargedParticleState;time:number;timeOffset:number}|null {
  if(dt<=0)return null;
  const opposite=(g:number)=>inField?g>0:g<0;
  // Suppress only roundoff-sized false crossings at a geometric tangency.
  const epsilon=64*Number.EPSILON*Math.max(1,Math.abs(p.fieldScale),
    Math.abs(start.position.x),Math.abs(start.position.y));
  const strictOpposite=(g:number)=>inField?g>epsilon:g< -epsilon;
  const probes=inField?magneticProbes(start,p,dt,omega):[freeRayProbe(start,p,dt)];
  let lo=0;
  const at=(t:number)=>advance(start,t);
  for(const hi of probes){
    if(hi===null||hi<=lo)continue;
    const g=distance(at(hi));
    if(!strictOpposite(g)){
      if(!opposite(g))lo=hi;
      continue;
    }
    let bracketState=at(lo),gLo=distance(bracketState);
    if(gLo===0||opposite(gLo)){
      // On a face one can first move inward and leave via another face.
      // Search backward from the opposite-side probe for a genuine initial-side
      // sample. Only an immediate boundary departure is a zero-time event.
      let found=false;
      for(let k=0;k<64;k++){
        const t=lo+(hi-lo)*2**(-k-1);
        if(t<=lo)break;
        const s=at(t),v=distance(s);
        if(!opposite(v)&&v!==0){lo=t;bracketState=s;gLo=v;found=true;break;}
        if(t-lo<=EVENT_TIME_TOL/4)break;
      }
      if(!found){
        if(Math.abs(gLo)>epsilon)throw new Error('Boundary state and region flag disagree');
        const hit=bisectEvent(bracketState,bracketState.t,hi-lo,
          (_s,h)=>at(lo+h),s=>s===bracketState?0:distance(s),
          {triggerOnStartZero:true,timeTolerance:EVENT_TIME_TOL});
        if(!hit)throw new Error('Failed immediate boundary event');
        return {...hit,timeOffset:lo+hit.timeOffset};
      }
    }
    const hit=bisectEvent(bracketState,bracketState.t,hi-lo,(_s,h)=>at(lo+h),distance,
      {timeTolerance:EVENT_TIME_TOL,biasEndpoint:inField?'positive':'negative'});
    if(!hit)throw new Error('Failed bracketed boundary event');
    return {...hit,timeOffset:lo+hit.timeOffset};
  }
  return null;
}
