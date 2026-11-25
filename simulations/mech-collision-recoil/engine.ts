import { bisectEvent } from '@physforge/physics-core';
import type { InvariantReport, PhysicsEvent, StepResult } from '@physforge/sim-sdk';
export type CollisionRecoilMode='collision-1d'|'collision-2d-oblique'|'bullet-block'|'boat-recoil';
export type CollisionRecoilParams={mode:CollisionRecoilMode;mass1:number;mass2:number;v10:number;v20:number;restitutionE:number;impactParamB:number;radius1:number;radius2:number;dragForceF:number;blockLength:number};
type Vec={x:number;y:number};
export type SphereImpact={t:number;center1:Vec;center2:Vec;normal:Vec;before1:Vec;before2:Vec;after1:Vec;after2:Vec;impulse:number;approachNormal:number;contact:Vec;bracketWidth:number};
export interface CollisionRecoilState{
  readonly t:number;readonly x1:number;readonly y1:number;readonly vx1:number;readonly vy1:number;
  readonly x2:number;readonly y2:number;readonly vx2:number;readonly vy2:number;readonly collided:boolean;
  readonly bulletPhase:'approach'|'penetrating'|'comoving'|'exited';
  readonly heatLostJ:number;readonly penetrationDist:number;readonly xCm0:number;readonly yCm0:number;
  readonly pInitX:number;readonly pInitY:number;readonly kInit:number;readonly events:readonly PhysicsEvent[];
  readonly impact:SphereImpact|null;readonly entryTime:number|null;readonly phaseEndTime:number|null;
}
const v=(x:number,y:number):Vec=>({x,y});
const dot=(a:Vec,b:Vec)=>a.x*b.x+a.y*b.y;
const norm=(a:Vec)=>Math.hypot(a.x,a.y);
const sub=(a:Vec,b:Vec)=>v(a.x-b.x,a.y-b.y);
const add=(a:Vec,b:Vec)=>v(a.x+b.x,a.y+b.y);
const scale=(a:Vec,k:number)=>v(a.x*k,a.y*k);
const mass=(p:CollisionRecoilParams)=>p.mass1+p.mass2;
const reduced=(p:CollisionRecoilParams)=>p.mass1*p.mass2/mass(p);
const eps=(...x:number[])=>32*Number.EPSILON*Math.max(1,...x.map(Math.abs));
function validate(p:CollisionRecoilParams){
  if(![p.mass1,p.mass2,p.radius1,p.radius2,p.blockLength].every(x=>Number.isFinite(x)&&x>0)||
     ![p.v10,p.v20,p.impactParamB,p.restitutionE,p.dragForceF].every(Number.isFinite)||
     p.restitutionE<0||p.restitutionE>1||p.dragForceF<0||((p.mode==='boat-recoil'||p.mode==='bullet-block')&&p.v10<0))
    throw Error('Invalid M09 physical parameters');
}
export function createInitialState(p:CollisionRecoilParams):CollisionRecoilState{
  validate(p);
  const M=mass(p),boat=p.mode==='boat-recoil',bullet=p.mode==='bullet-block',oblique=p.mode==='collision-2d-oblique';
  const x1=boat?-.45*p.blockLength:bullet?-Math.max(2.4,p.blockLength/2+.2):-Math.max(2.6,p.radius1+p.radius2+.2);
  const y1=boat?.35:oblique?p.impactParamB:0,x2=0,y2=0,vx1=boat?0:p.v10,vx2=boat||bullet||oblique?0:p.v20;
  return {t:0,x1,y1,x2,y2,vx1,vy1:0,vx2,vy2:0,collided:false,bulletPhase:'approach',heatLostJ:0,penetrationDist:0,
    xCm0:p.mass1*x1/M,yCm0:p.mass1*y1/M,pInitX:p.mass1*vx1+p.mass2*vx2,pInitY:0,kInit:.5*(p.mass1*vx1**2+p.mass2*vx2**2),events:[],impact:null,entryTime:null,phaseEndTime:null};
}
function linear(s:CollisionRecoilState,h:number):CollisionRecoilState{
  return {...s,t:s.t+h,x1:s.x1+s.vx1*h,y1:s.y1+s.vy1*h,x2:s.x2+s.vx2*h,y2:s.y2+s.vy2*h};
}
// In uniform relative motion solve |r-u h|=R analytically. The
// transverse distance is calculated without a subtractive discriminant.
// The rationalized entry root remains stable just before contact.
type LocatedEvent={timeOffset:number;bracketWidth:number};
// The analytic domain determines whether a root exists and brackets the
// FIRST event; the shared event locator then bisects the exact trajectory.
// Never rely on the sign of the gap at the requested outer-step endpoint.
function sphereEvent(s:CollisionRecoilState,p:CollisionRecoilParams,maxDt=Infinity):LocatedEvent|null{
  const R=p.radius1+p.radius2,r=v(s.x2-s.x1,s.y2-s.y1),u=v(s.vx1-s.vx2,s.vy1-s.vy2),speed=norm(u),distance=norm(r);
  if(speed===0)return null;
  const dir=scale(u,1/speed),projection=dot(r,dir),b=Math.abs(r.x*dir.y-r.y*dir.x);
  if(projection<=0||b>=R-eps(R,b))return null;
  if(distance<R-eps(distance,R))throw Error('M09 invalid initial sphere overlap');
  if(distance<=R+eps(distance,R))return {timeOffset:0,bracketWidth:0};
  const chord=Math.sqrt((R-b)*(R+b)),den=speed*(projection+chord);
  const estimate=(distance-R)*(distance+R)/den;
  if(estimate<0||estimate>maxDt)return null;
  // On the approaching branch, r_parallel-chord has precisely the same
  // zero/sign as the physical surface gap, without grazing cancellation.
  const hit=bisectEvent(projection,s.t,projection/speed,(x,h)=>x-speed*h,x=>x-chord,{timeTolerance:1e-13,biasEndpoint:'positive'});
  if(!hit)throw Error('M09 analytic approach bracket did not locate contact');
  return {timeOffset:Math.min(hit.timeOffset,maxDt),bracketWidth:hit.bracketWidth};
}
export function sphereTimeOfImpact(s:CollisionRecoilState,p:CollisionRecoilParams):number|null{
  return sphereEvent(s,p)?.timeOffset??null;
}
function stepSphere(s:CollisionRecoilState,p:CollisionRecoilParams,dt:number):StepResult<CollisionRecoilState>{
  if(s.collided)return {nextState:linear(s,dt),events:[]};
  const located=sphereEvent(s,p,dt);
  if(!located)return {nextState:linear(s,dt),events:[]};
  const hit=located.timeOffset,at=linear(s,hit),a=v(at.x1,at.y1),b=v(at.x2,at.y2),r=sub(b,a),n=scale(r,1/norm(r));
  const before1=v(s.vx1,s.vy1),before2=v(s.vx2,s.vy2),un=dot(sub(before1,before2),n);
  if(un<=0)return {nextState:linear(s,dt),events:[]};
  const J=(1+p.restitutionE)*reduced(p)*un,after1=sub(before1,scale(n,J/p.mass1)),after2=add(before2,scale(n,J/p.mass2));
  const Q=.5*reduced(p)*(1-p.restitutionE)*(1+p.restitutionE)*un*un;
  const impact:SphereImpact={t:at.t,center1:a,center2:b,normal:n,before1,before2,after1,after2,impulse:J,approachNormal:un,contact:add(a,scale(n,p.radius1)),bracketWidth:located.bracketWidth};
  const ev:PhysicsEvent={id:'impact-'+s.events.length,time:at.t,label:p.mode==='collision-2d-oblique'?'二维球体瞬时冲量':'一维对心碰撞',position:impact.contact,metrics:{heatLostJ:Q,normalImpulse:J,normalBefore:un,normalAfter:dot(sub(after1,after2),n),separation:norm(r),bracketWidth:located.bracketWidth}};
  const post={...at,vx1:after1.x,vy1:after1.y,vx2:after2.x,vy2:after2.y,collided:true,heatLostJ:Q,impact,events:[...s.events,ev]};
  return {nextState:linear(post,dt-hit),events:[ev]};
}
// The projectile is a material point in this teaching model; the
// drawn marker has no independent contact radius. Internal resistance
// is constant only during forward penetration, not after common speed.
function penetrate(s:CollisionRecoilState,p:CollisionRecoilParams,h:number,d:number,u:number):CollisionRecoilState{
  const M=mass(p),V=s.pInitX/M,X=s.xCm0+V*(s.t+h),relative=d-p.blockLength/2;
  return {...s,t:s.t+h,x1:X+p.mass2/M*relative,x2:X-p.mass1/M*relative,vx1:V+p.mass2/M*u,vx2:V-p.mass1/M*u,penetrationDist:d,heatLostJ:p.dragForceF*d};
}
function locateKnownEvent(t0:number,estimate:number,guard:(u:number)=>number,horizon:number):LocatedEvent{
  const hit=bisectEvent<number>(0,t0,horizon,(u,h)=>u+h,guard,{timeTolerance:1e-13,biasEndpoint:'positive'});
  if(!hit||Math.abs(hit.timeOffset-estimate)>Math.max(1e-9,eps(estimate)*8))throw Error('M09 analytic event and bisection disagree');
  return {timeOffset:hit.timeOffset,bracketWidth:hit.bracketWidth};
}
function stepBullet(s:CollisionRecoilState,p:CollisionRecoilParams,dt:number):StepResult<CollisionRecoilState>{
  const L=p.blockLength,f=p.dragForceF,end=s.t+dt,events:PhysicsEvent[]=[];
  let cur=s;
  if(cur.bulletPhase==='approach'){
    if(p.v10===0)return {nextState:linear(cur,dt),events};
    const initialGap=Math.max(2.4,L/2+.2)-L/2,estimate=initialGap/p.v10;
    if(estimate>end)return {nextState:linear(cur,dt),events};
    const located=locateKnownEvent(0,estimate,h=>initialGap-p.v10*h,estimate+Math.max(1e-9,eps(estimate)*4)),entry=located.timeOffset;
    cur=penetrate({...cur,t:entry},p,0,0,p.v10);
    const ev:PhysicsEvent={id:'entry-'+cur.events.length,time:entry,label:'质点进入木块左端',position:{x:cur.x1,y:0},metrics:{relativeSpeed:p.v10,penetrationDist:0,bracketWidth:located.bracketWidth}};
    cur={...cur,collided:true,bulletPhase:'penetrating',entryTime:entry,events:[...cur.events,ev]};events.push(ev);
  }
  if(cur.bulletPhase==='penetrating'){
    // Determine the ordering ONCE from the immutable entry conditions.
    // Do not reclassify an exact exit/common-speed tie due to accumulated
    // per-step rounding of the remaining depth or relative speed.
    const t0=cur.entryTime!,u=p.v10,a=f/reduced(p),stop=a===0?Infinity:u/a,stopDistance=a===0?Infinity:u*u/(2*a);
    const canExit=L<stopDistance-eps(L,Number.isFinite(stopDistance)?stopDistance:L);
    const tie=Number.isFinite(stopDistance)&&Math.abs(L-stopDistance)<=eps(L,stopDistance);
    const hExit=canExit?(a===0?L/u:2*L/(u+Math.sqrt(Math.max(0,u*u-2*a*L)))):Infinity,h=Math.min(stop,hExit);
    if(t0+h<=end){
      const isExit=hExit<stop,disp=isExit||tie?L:stopDistance,speed=isExit?(a===0?u:Math.sqrt(Math.max(0,u*u-2*a*L))):0;
      // For exit bracket only the increasing-depth branch; for common speed
      // the signed relative velocity is the physical event guard.
      const located=isExit?locateKnownEvent(t0,h,uTime=>L-u*uTime+.5*a*uTime*uTime,a===0?h+Math.max(1e-9,eps(h)*4):stop):locateKnownEvent(t0,h,uTime=>u-a*uTime,stop+Math.max(1e-9,eps(stop)*4));
      cur=penetrate({...cur,t:t0+located.timeOffset},p,0,disp,speed);
      const ev:PhysicsEvent={id:(isExit?'exit-':'covel-')+cur.events.length,time:cur.t,label:isExit?'质点穿出木块右端':tie?'恰在右端共速':'质点与木块共速',position:{x:cur.x1,y:0},metrics:{heatLostJ:cur.heatLostJ,penetrationDist:disp,relativeSpeed:speed,vCommon:cur.pInitX/mass(p),bracketWidth:located.bracketWidth}};
      cur={...cur,bulletPhase:isExit?'exited':'comoving',phaseEndTime:cur.t,events:[...cur.events,ev]};events.push(ev);
    }else{
      const elapsed=end-t0;
      cur=penetrate({...cur,t:end},p,0,u*elapsed-.5*a*elapsed*elapsed,u-a*elapsed);
      return {nextState:cur,events};
    }
  }
  return {nextState:linear(cur,end-cur.t),events};
}
export const boatWalkDuration=(p:CollisionRecoilParams)=>p.v10===0?null:1.8*p.blockLength/p.v10;
function smoothProgress(u:number){
  const x=2*Math.PI*u;
  if(Math.abs(x)<.01)return x*x*x*(1/6-x*x/120+x**4/5040)/(2*Math.PI);
  return u-Math.sin(x)/(2*Math.PI);
}
function stepBoat(s:CollisionRecoilState,p:CollisionRecoilParams,dt:number):StepResult<CollisionRecoilState>{
  const end=s.t+dt,T=boatWalkDuration(p),span=.9*p.blockLength,M=mass(p);
  if(T===null)return {nextState:{...s,t:end},events:[]};
  const u=Math.min(1,end/T),relative=-span/2+span*(u===1?1:smoothProgress(u)),speed=u===1?0:p.v10*Math.sin(Math.PI*u)**2;
  const x1=s.xCm0+p.mass2/M*relative,x2=s.xCm0-p.mass1/M*relative;
  const events:PhysicsEvent[]=[];
  if(end>=T&&s.bulletPhase!=='comoving')events.push({id:'boat-stop-'+s.events.length,time:T,label:'到达船右端 · 双体平滑静止',position:{x:x1,y:s.y1},metrics:{xCm:s.xCm0,relativeDisplacement:span}});
  return {nextState:{...s,t:end,x1,x2,vx1:p.mass2/M*speed,vx2:speed===0?0:-p.mass1/M*speed,bulletPhase:u===1?'comoving':'approach',events:[...s.events,...events]},events};
}
export function stepCollisionRecoil(s:CollisionRecoilState,p:CollisionRecoilParams,dt:number):StepResult<CollisionRecoilState>{
  if(!Number.isFinite(dt)||dt<0)throw Error('Invalid dt: '+dt);
  if(dt===0)return {nextState:s,events:[]};
  switch(p.mode){case 'boat-recoil':return stepBoat(s,p,dt);case 'bullet-block':return stepBullet(s,p,dt);default:return stepSphere(s,p,dt);}
}
export function computeObservables(s:CollisionRecoilState,p:CollisionRecoilParams):Record<string,number>{
  const M=mass(p),px=p.mass1*s.vx1+p.mass2*s.vx2,py=p.mass1*s.vy1+p.mass2*s.vy2,ek=.5*(p.mass1*(s.vx1**2+s.vy1**2)+p.mass2*(s.vx2**2+s.vy2**2));
  const xCm=(p.mass1*s.x1+p.mass2*s.x2)/M,yCm=(p.mass1*s.y1+p.mass2*s.y2)/M,boat=p.mode==='boat-recoil',bullet=p.mode==='bullet-block';
  const T=boat?boatWalkDuration(p):null;
  return {t:s.t,x1:s.x1,y1:s.y1,x2:s.x2,y2:s.y2,vx1:s.vx1,vy1:s.vy1,vx2:s.vx2,vy2:s.vy2,px,py,ek,heatLostJ:s.heatLostJ,xCm,yCm,
    vDotProduct:s.vx1*s.vx2+s.vy1*s.vy2,relativeSpeed:s.vx1-s.vx2,relativePosition:s.x1-s.x2,
    px1:p.mass1*s.vx1,py1:p.mass1*s.vy1,px2:p.mass2*s.vx2,py2:p.mass2*s.vy2,
    momentumResidual:Math.hypot(px-s.pInitX,py-s.pInitY),cmResidual:Math.hypot(xCm-s.xCm0-s.pInitX/M*s.t,yCm-s.yCm0-s.pInitY/M*s.t),
    collided:s.collided?1:0,phase:s.bulletPhase==='penetrating'?1:s.bulletPhase==='comoving'?2:s.bulletPhase==='exited'?3:0,
    ...(!boat?{energyResidual:ek+s.heatLostJ-s.kInit}:{}),
    ...(bullet?{penetrationDist:s.penetrationDist,remainingDepth:p.blockLength-s.penetrationDist,...(s.entryTime!==null?{entryTime:s.entryTime}:{}),...(s.phaseEndTime!==null?{phaseEndTime:s.phaseEndTime}:{})}:{}),
    ...(boat?{walkProgress:(s.x1-s.x2+.45*p.blockLength)/(.9*p.blockLength),...(T===null?{}:{walkDuration:T})}:{}),
    ...(!boat&&!bullet?{gap:Math.hypot(s.x2-s.x1,s.y2-s.y1)-p.radius1-p.radius2}:{}),
    ...(s.impact?{impactTime:s.impact.t,normalImpulse:s.impact.impulse,normalBefore:s.impact.approachNormal,impactBracketWidth:s.impact.bracketWidth,normalAfter:dot(sub(s.impact.after1,s.impact.after2),s.impact.normal)}:{})};
}
export function checkInvariants(s:CollisionRecoilState,_initial:CollisionRecoilState,p:CollisionRecoilParams):InvariantReport[]{
  const o=computeObservables(s,p),report=(name:string,value:number,tolerance:number,unit:string):InvariantReport=>({name,measuredError:Math.abs(value),tolerance,passed:Number.isFinite(value)&&Math.abs(value)<tolerance,unit});
  const out=[report('系统二维动量守恒',o.momentumResidual!,1e-10,'kg·m/s'),report('质心惯性运动',o.cmResidual!,1e-10*Math.max(1,Math.abs(o.xCm!)),'m')];
  if(p.mode!=='boat-recoil')out.push(report('动能与内能损耗总和守恒',o.energyResidual!,1e-9,'J'));
  if(p.mode==='bullet-block'){
    out.push(report('穿行深度范围',Math.max(0,-s.penetrationDist,s.penetrationDist-p.blockLength),1e-9,'m'),report('阻力功等于内能损耗',s.heatLostJ-p.dragForceF*s.penetrationDist,1e-10,'J'));
  }else if(p.mode!=='boat-recoil'){
    out.push(report('球体不可穿透',Math.min(0,o.gap!),1e-9,'m'));
    if(s.impact)out.push(report('法向恢复系数',o.normalAfter!+p.restitutionE*o.normalBefore!,1e-10,'m/s'));
  }
  return out;
}
