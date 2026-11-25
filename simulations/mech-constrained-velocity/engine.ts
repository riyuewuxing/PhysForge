import { bisectEvent, degToRad } from '@physforge/physics-core';
import type { InvariantReport, PhysicsEvent, StepResult } from '@physforge/sim-sdk';

export type ConstrainedMode = 'rope-pull-boat' | 'ladder-wall' | 'wedge-rod' | 'dual-rope-pull';
export type ConstrainedVelocityParams = {
  mode: ConstrainedMode;
  driveSpeed: number;
  heightOrLength: number;
  initialAngleDeg: number;
  secondarySpeedRatio?: number;
  /** Mass of the boat or dual-rope payload, used only for its actual weight. */
  payloadMassKg?:number;
};
export type Point = { x:number; y:number };
export interface VelocityProjection {
  readonly id:string;
  readonly label:string;
  readonly origin:Point;
  readonly velocity:Point;
  readonly unit:Point;
  readonly expected:number;
  readonly projected:number;
  readonly parallel:Point;
  readonly perpendicular:Point;
}
export interface ConstrainedVelocityState {
  readonly t:number;
  readonly mode:ConstrainedMode;
  readonly size:number;
  readonly driveSpeed:number;
  readonly secondarySpeed:number;
  readonly initialAngleDeg:number;
  readonly posA:Point;
  readonly posB:Point;
  readonly velA:Point;
  readonly velB:Point;
  readonly anchorRight?:Point;
  readonly ropeLength1M?:number;
  readonly ropeLength2M?:number;
  readonly accelBoatMag:number;
  readonly analyticalAccelBoatMag:number;
  readonly angleDeg:number;
  readonly projSpeedA:number;
  readonly projSpeedB:number;
  readonly projectionResidual:number;
  readonly geometryResidualM:number;
  readonly constraints:readonly VelocityProjection[];
  readonly terminal?:string;
  readonly events:readonly PhysicsEvent[];
}
const finite=(x:number|undefined,fallback:number)=>typeof x==='number'&&Number.isFinite(x)?x:fallback;
const clamp=(x:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,x));
const dot=(a:Point,b:Point)=>a.x*b.x+a.y*b.y;
const zero=():Point=>({x:0,y:0});
const norm=(p:Point)=>Math.hypot(p.x,p.y);
const sub=(a:Point,b:Point):Point=>({x:a.x-b.x,y:a.y-b.y});
export function normalizedParams(p:ConstrainedVelocityParams){
  return {mode:p.mode,driveSpeed:clamp(finite(p.driveSpeed,1.5),0,5),
    size:clamp(finite(p.heightOrLength,1.8),p.mode==='rope-pull-boat'?.5:1,4),
    initialAngleDeg:clamp(finite(p.initialAngleDeg,25),15,75),
    secondarySpeedRatio:clamp(finite(p.secondarySpeedRatio,.6),0,1.5)};
}
function project(id:string,label:string,origin:Point,velocity:Point,unit:Point,expected:number):VelocityProjection{
  const projected=dot(velocity,unit),parallel={x:projected*unit.x,y:projected*unit.y};
  return {id,label,origin,velocity,unit,expected,projected,parallel,perpendicular:sub(velocity,parallel)};
}
const BOAT_LIMIT_RAD=degToRad(80);
const DUAL_MARGIN=.02;
/** The guard is evaluated in exact material coordinates, before evaluating
 * any square root or dividing by a near-singular geometric determinant. */
function gap(p:ConstrainedVelocityParams,t:number):number{
  const {mode,driveSpeed:v,size:D,initialAngleDeg,secondarySpeedRatio:r}=normalizedParams(p),a=degToRad(initialAngleDeg);
  if(mode==='rope-pull-boat')return D/Math.sin(a)-v*t-D/Math.sin(BOAT_LIMIT_RAD);
  if(mode==='ladder-wall')return D*Math.sin(a)-v*t;
  if(mode==='wedge-rod')return .75*D-v*t;
  const L0=D/(2*Math.cos(a)),l1=L0-v*t,l2=L0-r*v*t;
  return Math.min(l1+l2-D-DUAL_MARGIN*D,D-Math.abs(l1-l2)-DUAL_MARGIN*D,l1,l2);
}
const terminalLabel:Record<ConstrainedMode,string>={
  'rope-pull-boat':'到达80°教学边界（未进入竖直奇异）',
  'ladder-wall':'上端到达地面（约束段结束）',
  'wedge-rod':'杆端到达斜面左端（约束段结束）',
  'dual-rope-pull':'到达双绳三角形安全边界（未进入共线奇异）'
};
/** Analytic kinematics at absolute physical time. No time-dependent
 * prescribed angle, finite-difference acceleration, or frozen moving state. */
function sample(p:ConstrainedVelocityParams,t:number):ConstrainedVelocityState{
  const n=normalizedParams(p),{mode,driveSpeed:v,size:D,initialAngleDeg,secondarySpeedRatio:r}=n;
  const a=degToRad(initialAngleDeg),secondarySpeed=r*v;
  let posA:Point,posB:Point,velA:Point,velB:Point,angleDeg=initialAngleDeg,geometryResidualM=0,accelBoatMag=0;
  let constraints:VelocityProjection[];
  let anchorRight:Point|undefined,ropeLength1M:number|undefined,ropeLength2M:number|undefined;
  if(mode==='rope-pull-boat'){
    const H=D,L=H/Math.sin(a)-v*t,x=Math.sqrt((L-H)*(L+H));
    posA={x,y:0};posB={x:0,y:H};velA={x:-v*L/x,y:0};velB=zero();
    const actualLength=norm(sub(posB,posA)),unit={x:-x/actualLength,y:H/actualLength};
    ropeLength1M=L;geometryResidualM=Math.abs(actualLength-L);
    angleDeg=Math.atan2(H,x)*180/Math.PI;accelBoatMag=v*v*H*H/(x*x*x);
    // A fixed pulley is not the moving end of the material rope.
    constraints=[project('boat','船沿绳投影（收绳速率）',posA,velA,unit,v)];
  }else if(mode==='ladder-wall'){
    const y=D*Math.sin(a)-v*t,x=Math.sqrt((D-y)*(D+y));
    posA={x:0,y};posB={x,y:0};velA={x:0,y:-v};velB={x:v*y/x,y:0};
    const delta=sub(posB,posA),len=norm(delta),unit={x:delta.x/len,y:delta.y/len};
    angleDeg=Math.atan2(y,x)*180/Math.PI;geometryResidualM=Math.abs(len-D);
    constraints=[project('ladder-a','上端沿杆投影',posA,velA,unit,dot(velB,unit)),
      project('ladder-b','下端沿杆投影',posB,velB,unit,dot(velA,unit))];
  }else if(mode==='wedge-rod'){
    const x0=v*t,rodX=.75*D,y=(D-rodX+x0)*Math.tan(a),unit={x:Math.sin(a),y:Math.cos(a)};
    posA={x:x0,y:0};posB={x:rodX,y};velA={x:v,y:0};velB={x:0,y:v*Math.tan(a)};
    geometryResidualM=Math.abs((posB.x-posA.x-D)*Math.sin(a)+posB.y*Math.cos(a));
    // The wedge's translating material point instantaneously at contact has vA.
    constraints=[project('wedge','斜面材料点法向投影',posB,velA,unit,dot(velB,unit)),
      project('rod','竖杆接触点法向投影',posB,velB,unit,dot(velA,unit))];
  }else{
    const L0=D/(2*Math.cos(a)),l1=L0-v*t,l2=L0-secondarySpeed*t;
    const x=(D*D+l1*l1-l2*l2)/(2*D),y=-Math.sqrt((l1-x)*(l1+x));
    posA={x,y};posB={x:0,y:0};anchorRight={x:D,y:0};velB=zero();
    const actual1=norm(sub(posB,posA)),actual2=norm(sub(anchorRight,posA));
    const u1={x:-x/actual1,y:-y/actual1},u2={x:(D-x)/actual2,y:-y/actual2};
    const det=u1.x*u2.y-u1.y*u2.x;
    velA={x:(v*u2.y-secondarySpeed*u1.y)/det,y:(u1.x*secondarySpeed-u2.x*v)/det};
    angleDeg=Math.atan2(-y,x)*180/Math.PI;
    ropeLength1M=l1;ropeLength2M=l2;
    geometryResidualM=Math.max(Math.abs(actual1-l1),Math.abs(actual2-l2));
    constraints=[project('left','左绳投影（左收绳速率）',posA,velA,u1,v),
      project('right','右绳投影（右收绳速率）',posA,velA,u2,secondarySpeed)];
  }
  const primary=constraints[0]!;
  return {t,mode,size:D,driveSpeed:v,secondarySpeed,initialAngleDeg,posA,posB,velA,velB,
    ...(anchorRight?{anchorRight}:{}),...(ropeLength1M!==undefined?{ropeLength1M}:{}),
    ...(ropeLength2M!==undefined?{ropeLength2M}:{}),angleDeg,accelBoatMag,analyticalAccelBoatMag:accelBoatMag,
    projSpeedA:primary.projected,projSpeedB:primary.expected,
    projectionResidual:Math.max(...constraints.map(c=>Math.abs(c.projected-c.expected))),
    geometryResidualM,constraints,events:[]};
}
export function createInitialState(params:ConstrainedVelocityParams):ConstrainedVelocityState{return sample(params,0);}
export function stepConstrainedVelocity(state:ConstrainedVelocityState,params:ConstrainedVelocityParams,dt:number):StepResult<ConstrainedVelocityState>{
  if(!Number.isFinite(dt)||dt<0)throw new Error('Invalid dt: '+dt);
  if(state.terminal)return {nextState:state,events:[],advancedTime:0,halt:true};
  if(dt===0)return {nextState:state,events:[]};
  const end=state.t+dt;
  if(gap(params,end)<=0){
    const hit=bisectEvent({t:state.t},state.t,dt,(s,h)=>({t:s.t+h}),s=>gap(params,s.t),
      {timeTolerance:1e-9,biasEndpoint:'positive',triggerOnStartZero:true});
    if(!hit)throw new Error('M03 failed to bracket terminal geometry');
    const last=sample(params,hit.time),terminal=terminalLabel[params.mode];
    const event:PhysicsEvent={id:'m03-boundary',time:hit.time,label:terminal,position:params.mode==='wedge-rod'?last.posB:last.posA,
      metrics:{angleDeg:last.angleDeg,bracketWidthS:hit.bracketWidth}};
    // Preserve the incoming one-sided velocity; no post-boundary trajectory
    // or artificial instantaneous stopping force is claimed.
    return {nextState:{...last,terminal,events:[...state.events,event]},events:[event],advancedTime:hit.timeOffset,halt:true};
  }
  return {nextState:{...sample(params,end),events:state.events},events:[],advancedTime:dt};
}
export function computeObservables(s:ConstrainedVelocityState):Record<string,number>{
  return {speedA:norm(s.velA),speedB:norm(s.velB),angleDeg:s.angleDeg,projSpeedDiff:s.projectionResidual,
    geometryResidualM:s.geometryResidualM,terminal:s.terminal?1:0,
    xA:s.posA.x,yA:s.posA.y,xB:s.posB.x,yB:s.posB.y,vAx:s.velA.x,vAy:s.velA.y,vBx:s.velB.x,vBy:s.velB.y,
    projection1:s.constraints[0]!.projected,target1:s.constraints[0]!.expected,
    ...(s.constraints[1]?{projection2:s.constraints[1].projected,target2:s.constraints[1].expected}:{}),
    ...(s.mode==='rope-pull-boat'?{accelBoatMag:s.accelBoatMag}:{}),
    ...(s.ropeLength1M!==undefined?{ropeLength1M:s.ropeLength1M}:{}),
    ...(s.ropeLength2M!==undefined?{ropeLength2M:s.ropeLength2M}:{})};
}
export function checkInvariants(s:ConstrainedVelocityState):InvariantReport[]{
  return [{name:'真实约束方向速度投影残差',measuredError:s.projectionResidual,tolerance:1e-10,passed:s.projectionResidual<1e-10,unit:'m/s'},
    {name:'实际约束几何残差',measuredError:s.geometryResidualM,tolerance:1e-10,passed:s.geometryResidualM<1e-10,unit:'m'}];
}
