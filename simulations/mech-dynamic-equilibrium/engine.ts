import { CLASSROOM_GRAVITY, degToRad } from '@physforge/physics-core';
import type { InvariantReport, PhysicsEvent, StepResult } from '@physforge/sim-sdk';

export type EquilibriumMode = 'active-pulley-knot' | 'dead-knot-rotate' | 'hemisphere-similar' | 'hemisphere-suspension' | 'hinged-rod' | 'fixed-rod';
export type EquilibriumParams = {
  mode: EquilibriumMode;
  mass: number;
  baseAngleDeg: number;
  sweepAngleDeg: number;
  autoSweep: boolean;
  radiusM?: number;
  anchorHeightM?: number;
  rodLengthM?: number;
  pullForceN?: number;
};
export type Point = { x: number; y: number };
export type Force = Point & { mag: number };
export type EquilibriumStatus = 'balanced' | 'infeasible' | 'singular' | 'ill-conditioned';
export interface SphereGeometry {
  readonly radius: number;
  readonly height: number;
  readonly anchor: Point;
  readonly ropeLength: number;
}
export interface RodGeometry {
  readonly pivot: Point;
  readonly axis: Point;
  readonly lengthM: number;
  readonly axialForceN?: number;
  readonly supportMomentNm?: number;
  readonly momentResidualNm?: number;
  readonly prescribedPullN?: number;
}
export interface EquilibriumState {
  readonly t: number;
  readonly mode: EquilibriumMode;
  readonly activeAngleDeg: number;
  readonly requestedAngleDeg: number;
  readonly requestedInitialAngleDeg: number;
  readonly initialAngleDeg: number;
  readonly direction1: Point;
  readonly direction2: Point;
  readonly point: Point;
  readonly sphere?: SphereGeometry;
  readonly rod?: RodGeometry;
  readonly force1: Force;
  readonly force2: Force;
  readonly gravity: Force;
  readonly status: EquilibriumStatus;
  readonly netResidualN: number;
  readonly minPullForceN?: number;
  readonly events: readonly PhysicsEvent[];
}
type Solution = Omit<EquilibriumState, 't' | 'events'>;
const finite = (x: number | undefined, fallback: number): number =>
  typeof x === 'number' && Number.isFinite(x) ? x : fallback;
const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));
const scaled = (v: Point, mag: number): Force => ({ x: v.x * mag, y: v.y * mag, mag });
const zero = (): Force => ({ x: 0, y: 0, mag: 0 });
const RESIDUAL_TOLERANCE = 1e-10;
const cross=(a:Point,b:Point):number=>a.x*b.y-a.y*b.x;
export const isRodMode=(mode:EquilibriumMode)=>mode==='hinged-rod'||mode==='fixed-rod';
export function sphereDimensions(p?: Partial<EquilibriumParams>) {
  return {radius:clamp(finite(p?.radiusM,1),0.5,1.5),height:clamp(finite(p?.anchorHeightM,0.6),0.2,1.2)};
}
export function angleRange(mode: EquilibriumMode,p?: Partial<EquilibriumParams>): readonly [number, number] {
  if (isRodMode(mode)) return [-30,150];
  if (mode === 'dead-knot-rotate') return [-30, 75];
  if (mode === 'active-pulley-knot') return [10, 85];
  if (mode === 'hemisphere-suspension') {
    const {radius,height}=sphereDimensions(p);
    // A straight rope must remain outside the sphere. At the pole the force split is nonunique.
    return [1, Math.floor(Math.acos(radius/(radius+height))*180/Math.PI)];
  }
  return [10, 75];
}
export function boundedAngle(mode: EquilibriumMode, angle: number,p?:Partial<EquilibriumParams>): number {
  const [lo, hi] = angleRange(mode,p);
  return clamp(finite(angle, 37), lo, hi);
}
export function solveEquilibriumAtAngle(params: EquilibriumParams, angleDeg: number): Solution {
  const mg = Math.max(0.1, finite(params.mass, 2)) * CLASSROOM_GRAVITY;
  const gravity: Force = { x: 0, y: -mg, mag: mg };
  const actual = boundedAngle(params.mode, angleDeg,params);
  const theta = degToRad(actual);
  const c = Math.cos(theta), sn = Math.sin(theta);
  const base = { mode: params.mode, activeAngleDeg: actual, requestedAngleDeg: finite(angleDeg, actual),
    requestedInitialAngleDeg: finite(params.sweepAngleDeg,actual), initialAngleDeg: boundedAngle(params.mode,params.sweepAngleDeg,params), gravity };
  let direction1: Point, direction2: Point, minPullForceN: number|undefined=undefined;
  let point: Point = { x: 0, y: 0 };
  let sphere: SphereGeometry | undefined;
  let rod: RodGeometry | undefined;
  let mag1: number, mag2: number;
  let status: EquilibriumStatus = 'balanced';
  if (params.mode === 'active-pulley-knot') {
    direction1 = { x: -c, y: sn }; direction2 = { x: c, y: sn };
    mag1 = mag2 = mg / (2 * sn); minPullForceN = mg / 2;
  } else if (params.mode === 'dead-knot-rotate') {
    const alpha = degToRad(clamp(finite(params.baseAngleDeg, 37), 15, 75));
    direction1 = { x: -Math.sin(alpha), y: Math.cos(alpha) }; direction2 = { x: c, y: sn };
    minPullForceN = mg * Math.sin(alpha);
    const cosine = Math.cos(alpha - theta);
    if (Math.abs(cosine) <= 1e-12) { status = 'singular'; mag1 = mag2 = 0; }
    else if (cosine < 0) { status = 'infeasible'; mag1 = mag2 = 0; }
    else { mag1 = mg * c / cosine; mag2 = minPullForceN / cosine; }
  } else if (isRodMode(params.mode)) {
    const alpha=degToRad(clamp(finite(params.baseAngleDeg,30),15,75));
    const axis={x:Math.cos(alpha),y:Math.sin(alpha)};
    const lengthM=clamp(finite(params.rodLengthM,1.2),.6,1.5);
    const pivot={x:-lengthM*axis.x,y:-lengthM*axis.y};
    const lever={x:-pivot.x,y:-pivot.y};
    direction2={x:-c,y:sn};
    rod={pivot,axis,lengthM};
    if(params.mode==='hinged-rod'){
      direction1=axis;
      minPullForceN=mg*Math.cos(alpha);
      const D=Math.sin(alpha+theta);
      if(Math.abs(D)<=1e-12){status='singular';mag1=mag2=0;}
      else if(D<0){status='infeasible';mag1=mag2=0;}
      else {
        const C=mg*c/D;
        mag1=Math.abs(C);mag2=minPullForceN/D;
        direction1=C<0?{x:-axis.x,y:-axis.y}:axis;
        rod={...rod,axialForceN:C};
      }
    }else{
      mag2=clamp(finite(params.pullForceN,8),0,40);
      const R={x:mag2*c,y:mg-mag2*sn};
      mag1=Math.hypot(R.x,R.y);
      direction1=mag1>0?{x:R.x/mag1,y:R.y/mag1}:{x:0,y:0};
      rod={...rod,prescribedPullN:mag2,supportMomentNm:cross(lever,R)};
    }
  } else if (params.mode === 'hemisphere-suspension') {
    const {radius,height}=sphereDimensions(params);
    point = { x: -radius * sn, y: radius * c };
    const anchor = { x: 0, y: radius + height };
    const rope = { x: anchor.x - point.x, y: anchor.y - point.y };
    const ropeLength = Math.hypot(rope.x, rope.y);
    direction1 = { x: -sn, y: c }; direction2 = { x: rope.x / ropeLength, y: rope.y / ropeLength };
    mag1 = mg * radius / (radius + height); mag2 = mg * ropeLength / (radius + height);
    minPullForceN = mg * height / (radius + height);
    sphere = { radius, height, anchor, ropeLength };
  } else {
    direction1 = { x: -sn, y: c }; direction2 = { x: 1, y: 0 };
    mag1 = mg / c; mag2 = mg * Math.tan(theta); minPullForceN = 0;
  }
  let force1 = scaled(direction1, mag1), force2 = scaled(direction2, mag2);
  let netResidualN = Math.hypot(force1.x + force2.x, force1.y + force2.y - mg);
  if (status === 'balanced' && (!Number.isFinite(netResidualN) || netResidualN >= RESIDUAL_TOLERANCE || mag1 < 0 || mag2 < 0)) {
    status = 'ill-conditioned';
  }
  if(rod&&status==='balanced'){
    const lever={x:-rod.pivot.x,y:-rod.pivot.y};
    // Evaluate the moment from the actual external loads; do not merely
    // return the negative of the same scalar used to define the support.
    const momentResidualNm=Math.abs((rod.supportMomentNm??0)+cross(lever,force2)+cross(lever,gravity));
    rod={...rod,momentResidualNm};
    if(!Number.isFinite(momentResidualNm)||momentResidualNm>=RESIDUAL_TOLERANCE)status='ill-conditioned';
  }
  if (status !== 'balanced') {
    if(rod)rod={pivot:rod.pivot,axis:rod.axis,lengthM:rod.lengthM,...(rod.prescribedPullN!==undefined?{prescribedPullN:rod.prescribedPullN}:{})};
    force1 = zero(); force2 = zero();
    // Residual of the available vectors only, NOT a predicted acceleration.
    netResidualN = mg;
  }
  return { ...base, point, ...(sphere ? { sphere } : {}), ...(rod?{rod}:{}), direction1, direction2, force1, force2, status, netResidualN, ...(minPullForceN!==undefined?{minPullForceN}:{}) };
}
export function createInitialState(params: EquilibriumParams): EquilibriumState {
  return { t: 0, ...solveEquilibriumAtAngle(params, params.sweepAngleDeg), events: [] };
}
export function stepEquilibrium(state: EquilibriumState, params: EquilibriumParams, dt: number): StepResult<EquilibriumState> {
  if (!Number.isFinite(dt) || dt < 0) throw new Error('Invalid dt: ' + dt);
  if (dt === 0) return { nextState: state, events: [] };
  const nextT = state.t + dt;
  const [lo, hi] = angleRange(params.mode,params);
  const mid = (lo + hi) / 2, amplitude = (hi - lo) / 2;
  const initial = boundedAngle(params.mode, params.sweepAngleDeg,params);
  const phase = Math.asin(clamp((initial - mid) / amplitude, -1, 1));
  const angle = params.autoSweep ? mid + amplitude * Math.sin(nextT * 0.9 + phase) : params.sweepAngleDeg;
  return { nextState: { t: nextT, ...solveEquilibriumAtAngle(params, angle), events: state.events }, events: [] };
}
export function computeObservables(state: EquilibriumState): Record<string, number> {
  return {
    angleDeg: state.activeAngleDeg,
    initialAngleDeg: state.initialAngleDeg,
    requestedInitialAngleDeg: state.requestedInitialAngleDeg,
    solutionDefined: state.status === 'balanced' ? 1 : 0,
    ...(state.minPullForceN!==undefined?{minPullForceN:state.minPullForceN}:{}),
    ...(state.rod?.axialForceN!==undefined?{rodAxialForceN:state.rod.axialForceN}:{}),
    ...(state.rod?.supportMomentNm!==undefined?{supportMomentNm:state.rod.supportMomentNm,reactionXN:state.force1.x,reactionYN:state.force1.y}:{}),
    ...(state.rod?.momentResidualNm!==undefined?{momentResidualNm:state.rod.momentResidualNm}:{}),
    ...(state.status === 'balanced' ? { force1: state.force1.mag, force2: state.force2.mag, netResidualN: state.netResidualN } : {}),
    ...(state.sphere ? { ropeLengthM: state.sphere.ropeLength } : {})
  };
}
export function checkInvariants(state: EquilibriumState): InvariantReport[] {
  return [{ name: '矢量闭合静力平衡残差 ||ΣF||', measuredError: state.netResidualN,
    tolerance: RESIDUAL_TOLERANCE, passed: state.status === 'balanced' && state.netResidualN < RESIDUAL_TOLERANCE },
    ...(state.rod?.momentResidualNm!==undefined?[{name:'关于杆支点的力矩残差 |ΣM| (N·m)',measuredError:state.rod.momentResidualNm,tolerance:RESIDUAL_TOLERANCE,passed:state.rod.momentResidualNm<RESIDUAL_TOLERANCE}]:[])];
}

// Analytical sampling for an angle-function view. Missing forces are null,
// never zero. Each interval is sampled from the physical model, not time history.
export interface EquilibriumAngleSample {angleDeg:number;force1:number|null;force2:number|null}
export function equilibriumAngleSamples(params:EquilibriumParams):EquilibriumAngleSample[]{
  const [lo,hi]=angleRange(params.mode,params);
  const angles=new Set(Array.from({length:Math.floor(hi-lo)+1},(_,i)=>lo+i));
  angles.add(hi);
  // Include exact singular and minimum landmarks even for noninteger α.
  const a=clamp(finite(params.baseAngleDeg,37),15,75);
  const landmarks=params.mode==='dead-knot-rotate'?[a-90,a]:params.mode==='hinged-rod'?[-a,90-a,180-a]:[];
  for(const x of landmarks)if(x>=lo&&x<=hi)angles.add(x);
  return [...angles].sort((a,b)=>a-b).map(angleDeg=>{
    const s=solveEquilibriumAtAngle(params,angleDeg);
    return {angleDeg,force1:s.status==='balanced'?s.force1.mag:null,force2:s.status==='balanced'?s.force2.mag:null};
  });
}
