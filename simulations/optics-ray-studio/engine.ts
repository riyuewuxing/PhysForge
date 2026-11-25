import { degToRad, radToDeg, vec2, type Vec2 } from '@physforge/physics-core';
import type { InvariantReport, PhysicsEvent, StepResult } from '@physforge/sim-sdk';

export type OpticsSceneMode =
  | 'tir-interface'
  | 'parallel-slab'
  | 'prism-dispersion'
  | 'optical-fiber'
  | 'double-slit'
  | 'thin-lens-imaging';

export type OpticsParams = {
  sceneMode: OpticsSceneMode;
  incidentAngleDeg: number;
  n1: number;
  n2: number;
  slabThickness: number;
  prismApexDeg: number;
  fiberHalfWidth: number;
  wavelengthNm: number;
  slitSeparationMm: number;
  screenDistanceM: number;
  animateSweep: boolean;
  focalLengthM?: number;
  objectDistanceM?: number;
};

export interface RaySegment {
  readonly from: Vec2;
  readonly to: Vec2;
  readonly color: string;
  readonly intensity: number;
  readonly dashed?: boolean;
  readonly label?: string;
}

export interface OpticsState {
  readonly t: number;
  readonly activeAngleDeg: number;
  readonly rays: readonly RaySegment[];
  readonly criticalAngleDeg: number | null;
  readonly isTotalInternalReflection: boolean;
  readonly refractedAngleDeg: number | null;
  /** Power fractions for a lossless, nonmagnetic, unpolarized interface. */
  readonly interfaceReflectance?: number;
  readonly interfaceTransmittance?: number;
  readonly lateralShift: number;
  readonly slabDirectTransmittance?: number;
  readonly prismDeviationDeg?: number;
  /** Air launch angle limit for a positive-index step fiber. */
  readonly fiberAcceptanceDeg?: number;
  /** No finite conjugate when the object lies at the front focus. */
  readonly imageAtInfinity?: boolean;
  readonly fringeSpacingMm: number;
  readonly imageDistanceM?: number;
  readonly magnification?: number;
  readonly events: readonly PhysicsEvent[];
}

export function refractVector2D(
  dir: Vec2,
  normalIntoIncoming: Vec2,
  nFrom: number,
  nTo: number
): { refracted: Vec2 | null; reflected: Vec2; sinI: number; sinT: number } {
  const dLen = Math.hypot(dir.x, dir.y) || 1;
  const dx = dir.x / dLen;
  const dy = dir.y / dLen;

  const nLen = Math.hypot(normalIntoIncoming.x, normalIntoIncoming.y) || 1;
  let nx = normalIntoIncoming.x / nLen;
  let ny = normalIntoIncoming.y / nLen;

  // 确保法向与入射方向点积 <= 0（指向入射介质一侧）
  let cosI = -(dx * nx + dy * ny);
  if (cosI < 0) {
    nx = -nx;
    ny = -ny;
    cosI = -cosI;
  }

  const eta = nFrom / Math.max(nTo, 1e-6);
  const sinISq = Math.max(0, 1 - cosI * cosI);
  const sinT = eta * Math.sqrt(sinISq);
  const reflected = vec2(dx + 2 * cosI * nx, dy + 2 * cosI * ny);

  if (sinT >= 1 - 1e-12) {
    return { refracted: null, reflected, sinI: Math.sqrt(sinISq), sinT: 1 };
  }

  const cosT = Math.sqrt(Math.max(0, 1 - sinT * sinT));
  const rx = eta * dx + (eta * cosI - cosT) * nx;
  const ry = eta * dy + (eta * cosI - cosT) * ny;
  const rLen = Math.hypot(rx, ry) || 1;

  return {
    refracted: vec2(rx / rLen, ry / rLen),
    reflected,
    sinI: Math.sqrt(sinISq),
    sinT
  };
}

/** Fresnel power fractions, not electric-field amplitudes or display brightness. */
function fresnelPolarized(n1: number, n2: number, angleDeg: number): { Rs: number; Rp: number } {
  const theta = degToRad(Math.max(0, Math.min(90, angleDeg)));
  if (n1 === n2) return { Rs: 0, Rp: 0 };
  const sinT = n1 / n2 * Math.sin(theta);
  if (sinT >= 1 - 1e-12) return { Rs: 1, Rp: 1 };
  const ci = Math.cos(theta), ct = Math.sqrt(Math.max(0, 1 - sinT * sinT));
  const rs = (n1 * ci - n2 * ct) / (n1 * ci + n2 * ct);
  const rp = (n2 * ci - n1 * ct) / (n2 * ci + n1 * ct);
  return { Rs: Math.max(0,Math.min(1,rs*rs)), Rp: Math.max(0,Math.min(1,rp*rp)) };
}
export function fresnelPowerUnpolarized(n1: number, n2: number, angleDeg: number): { R: number; T: number } {
  const {Rs,Rp}=fresnelPolarized(n1,n2,angleDeg),R=(Rs+Rp)/2;
  return {R,T:1-R};
}

export function prismVertices(apexDeg:number): readonly Vec2[] {
  const h=1.6,b=h*Math.tan(degToRad(apexDeg)/2);
  return [vec2(0,.6*h),vec2(-b,-.4*h),vec2(b,-.4*h)];
}
const cross=(a:Vec2,b:Vec2)=>a.x*b.y-a.y*b.x;
const minus=(a:Vec2,b:Vec2)=>vec2(a.x-b.x,a.y-b.y);
const along=(a:Vec2,d:Vec2,t:number)=>vec2(a.x+d.x*t,a.y+d.y*t);
/** First intersection with an actual finite prism face, never its infinite extension. */
function nextPrismFace(origin:Vec2,dir:Vec2,vertices:readonly Vec2[]) {
  let best:{point:Vec2;normal:Vec2;face:number;t:number}|undefined;
  for(let i=0;i<vertices.length;i++){
    const a=vertices[i]!,b=vertices[(i+1)%vertices.length]!,e=minus(b,a),d=cross(dir,e);
    if(Math.abs(d)<1e-12)continue;
    const q=minus(a,origin),t=cross(q,e)/d,u=cross(q,dir)/d;
    if(t<=1e-9||u< -1e-10||u>1+1e-10||best&&t>=best.t)continue;
    const len=Math.hypot(e.x,e.y);
    best={point:along(origin,dir,t),normal:vec2(-e.y/len,e.x/len),face:i,t};
  }
  return best;
}
/** Illustrative normal Cauchy dispersion anchored at the yellow band, not material metrology. */
export function prismIndex(nYellow:number,wavelengthNm:number):number {
  const lambda=wavelengthNm/1000;
  return nYellow+.016*(nYellow-1)*(1/(lambda*lambda)-1/(.589*.589));
}
/** Near-axis, equal-amplitude, coherent narrow slits; normalized intensity. */
export function slitIntensity(yMm:number,spacingMm:number):number {
  return Math.cos(Math.PI*yMm/spacingMm)**2;
}
/** Fixed physical y/x geometry; no unbounded drawing coordinates near focus. */
function lensEndpoint(from:Vec2,slope:number,direction:1|-1,maxX:number):Vec2 {
  const boundary=direction>0?2.8:-2.8;
  let distance=Math.min(Math.abs(boundary-from.x),Math.abs(maxX-from.x));
  const dy=slope*direction;
  if(dy!==0)distance=Math.min(distance,((dy>0?1.85:-1.85)-from.y)/dy);
  return vec2(from.x+direction*distance,from.y+dy*distance);
}

function solveRayTrace(
  activeAngleDeg: number,
  params: OpticsParams
): Omit<OpticsState, 't' | 'events'> {
  const rays: RaySegment[] = [];
  const criticalAngleDeg =
    params.n1 > params.n2 ? radToDeg(Math.asin(Math.min(1, params.n2 / params.n1))) : null;

  if (params.sceneMode === 'tir-interface') {
    const theta1 = degToRad(Math.max(0, Math.min(89, activeAngleDeg)));
    const origin = vec2(0, 0);
    const incDir = vec2(Math.sin(theta1), -Math.cos(theta1));
    const startPt = vec2(-2.2 * incDir.x, -2.2 * incDir.y);
    rays.push({ from: startPt, to: origin, color: '#fbbf24', intensity: 1, label: '入射光' });

    const { refracted, reflected } = refractVector2D(
      incDir,
      vec2(0, 1),
      params.n1,
      params.n2
    );
    const isTir = refracted === null;
    const power = isTir ? { R: 1, T: 0 } : fresnelPowerUnpolarized(params.n1, params.n2, radToDeg(theta1));
    if (power.R > 1e-12) rays.push({
      from: origin,
      to: vec2(reflected.x * 2.2, reflected.y * 2.2),
      color: '#fbbf24',
      intensity: power.R,
      label: isTir ? '全反射光' : '反射光'
    });

    let refractedAngleDeg: number | null = null;
    if (refracted) {
      refractedAngleDeg = radToDeg(Math.acos(Math.min(1, Math.max(-1, -refracted.y))));
      rays.push({
        from: origin,
        to: vec2(refracted.x * 2.4, refracted.y * 2.4),
        color: '#38bdf8',
        intensity: power.T,
        label: '折射光'
      });
    }

    return {
      activeAngleDeg,
      rays,
      criticalAngleDeg,
      isTotalInternalReflection: isTir,
      refractedAngleDeg,
      interfaceReflectance: power.R,
      interfaceTransmittance: power.T,
      lateralShift: 0,
      prismDeviationDeg: 0,
      fringeSpacingMm: 0
    };
  }

  if (params.sceneMode === 'parallel-slab') {
    const theta1 = degToRad(Math.max(0, Math.min(85, activeAngleDeg)));
    const d = Math.max(0.2, params.slabThickness);
    const nAir = 1.0;
    const nGlass = Math.max(1.0, params.n1);
    const incDir = vec2(Math.sin(theta1), -Math.cos(theta1));
    const topHit = vec2(-0.5, 0.5 * d);
    rays.push({
      from: vec2(topHit.x - incDir.x * 1.6, topHit.y - incDir.y * 1.6),
      to: topHit,
      color: '#fbbf24',
      intensity: 1
    });

    const first = refractVector2D(incDir, vec2(0, 1), nAir, nGlass);
    const innerDir = first.refracted ?? first.reflected;
    const {Rs,Rp}=fresnelPolarized(nAir,nGlass,radToDeg(theta1));
    const internalPower=1-(Rs+Rp)/2;
    // Direct, incoherent primary beam only; retain polarization through both faces.
    const directPower=((1-Rs)**2+(1-Rp)**2)/2;
    // 玻璃内底面 y = -0.5 * d
    const tToBottom = d / Math.max(1e-9, -innerDir.y);
    const botHit = vec2(topHit.x + innerDir.x * tToBottom, -0.5 * d);
    rays.push({ from: topHit, to: botHit, color: '#38bdf8', intensity: internalPower });

    const second = refractVector2D(innerDir, vec2(0, 1), nGlass, nAir);
    const outDir = second.refracted ?? second.reflected;
    rays.push({
      from: botHit,
      to: vec2(botHit.x + outDir.x * 1.8, botHit.y + outDir.y * 1.8),
      color: '#4ade80',
      intensity: directPower,
      label: '出射光'
    });

    const sinT2 = Math.sin(theta1) / nGlass;
    const theta2 = Math.asin(Math.min(1, sinT2));
    const lateralShift = (d * Math.sin(theta1 - theta2)) / Math.max(Math.cos(theta2), 1e-9);

    return {
      activeAngleDeg,
      rays,
      criticalAngleDeg: null,
      isTotalInternalReflection: false,
      refractedAngleDeg: radToDeg(theta2),
      lateralShift,
      slabDirectTransmittance: directPower,
      prismDeviationDeg: 0,
      fringeSpacingMm: 0
    };
  }

  if (params.sceneMode === 'prism-dispersion') {
    const vertices=prismVertices(params.prismApexDeg);
    const halfA=degToRad(params.prismApexDeg)/2;
    const apex=vertices[0]!,left=vertices[1]!;
    const hitLeft=vec2((apex.x+left.x)/2,(apex.y+left.y)/2);
    const leftNormal=vec2(-Math.cos(halfA),Math.sin(halfA));
    const angle=degToRad(activeAngleDeg)-halfA,dir0=vec2(Math.cos(angle),Math.sin(angle));
    rays.push({from:along(hitLeft,dir0,-1.6),to:hitLeft,color:'#f8fafc',intensity:1,label:'复色白光'});
    const spectrum=[
      {nm:650,color:'#ef4444'},{nm:610,color:'#f97316'},{nm:589,color:'#eab308'},
      {nm:530,color:'#22c55e'},{nm:470,color:'#3b82f6'},{nm:420,color:'#a855f7'}
    ];
    let yellowDeviation:number|undefined;
    let anyTir=false;
    for(const band of spectrum){
      const n=prismIndex(params.n1,band.nm);
      const entry=refractVector2D(dir0,leftNormal,1,n).refracted;
      if(!entry)continue;
      let origin=hitLeft,dir=entry,reflections=0;
      // A bounded principal path: follow TIR; partial reflected branches are
      // omitted. If the bounce budget ends, do not fabricate an outgoing ray.
      for(let bounce=0;bounce<24;bounce++){
        const face=nextPrismFace(origin,dir,vertices);
        if(!face)break;
        rays.push({from:origin,to:face.point,color:band.color,intensity:1,...(reflections?{label:'全反射光'}:{})});
        const result=refractVector2D(dir,face.normal,n,1);
        if(result.refracted){
          rays.push({from:face.point,to:along(face.point,result.refracted,1.6),color:band.color,intensity:1,label:'出射光'});
          if(band.nm===589&&face.face===2&&reflections===0)
            yellowDeviation=radToDeg(Math.acos(Math.max(-1,Math.min(1,dir0.x*result.refracted.x+dir0.y*result.refracted.y))));
          break;
        }
        anyTir=true;reflections++;origin=face.point;dir=result.reflected;
      }
    }
    return {activeAngleDeg,rays,criticalAngleDeg:null,isTotalInternalReflection:anyTir,refractedAngleDeg:null,
      lateralShift:0,prismDeviationDeg:yellowDeviation,fringeSpacingMm:0};
  }

  if (params.sceneMode === 'optical-fiber') {
    const hw=params.fiberHalfWidth,nCore=params.n1,nClad=params.n2;
    const positive=nCore>nClad,critDeg=positive?radToDeg(Math.asin(nClad/nCore)):null;
    const acceptance=positive?radToDeg(Math.asin(Math.min(1,Math.sqrt(nCore*nCore-nClad*nClad)))):undefined;
    const thetaAir=degToRad(activeAngleDeg),entryPt=vec2(-2.4,0);
    const extDir=vec2(Math.cos(thetaAir),Math.sin(thetaAir));
    rays.push({from:along(entryPt,extDir,-.9),to:entryPt,color:'#fbbf24',intensity:1,label:'入射光'});
    let origin=entryPt,dir=refractVector2D(extDir,vec2(-1,0),1,nCore).refracted??extDir;
    const guided=acceptance!==undefined&&activeAngleDeg<=acceptance+1e-10;
    for(let bounce=0;bounce<64;bounce++){
      const wallY=dir.y>0?hw:-hw;
      const wallT=Math.abs(dir.y)<1e-12?Infinity:(wallY-origin.y)/dir.y;
      const endT=(2.4-origin.x)/dir.x;
      if(endT<=wallT+1e-10){
        const end=along(origin,dir,endT);
        rays.push({from:origin,to:end,color:'#38bdf8',intensity:1});
        const out=refractVector2D(dir,vec2(-1,0),nCore,1).refracted;
        if(out)rays.push({from:end,to:along(end,out,.75),color:'#4ade80',intensity:1,label:'端面出射'});
        break;
      }
      const hit=along(origin,dir,wallT);
      rays.push({from:origin,to:hit,color:'#38bdf8',intensity:1});
      const result=refractVector2D(dir,vec2(0,dir.y>0?-1:1),nCore,nClad);
      if(result.refracted){
        // Show only the first transmitted segment in the finite cladding window.
        const d=result.refracted,cladY=dir.y>0?hw+.25:-hw-.25;
        const tClad=Math.abs(d.y)>1e-12?(cladY-hit.y)/d.y:Infinity;
        const tEnd=d.x>1e-12?(2.4-hit.x)/d.x:Infinity;
        rays.push({from:hit,to:along(hit,d,Math.min(.9,tClad,tEnd)),color:'#f87171',intensity:1,label:'进入包层'});
        break;
      }
      origin=hit;dir=result.reflected;
    }
    return {activeAngleDeg,rays,criticalAngleDeg:critDeg,isTotalInternalReflection:guided,
      fiberAcceptanceDeg:acceptance,refractedAngleDeg:null,lateralShift:0,prismDeviationDeg:0,fringeSpacingMm:0};
  }

  if (params.sceneMode === 'thin-lens-imaging') {
    const f=params.focalLengthM??.65,u=params.objectDistanceM??1.2,h=.55;
    const object=vec2(-u,h),parallel=vec2(0,h),center=vec2(0,0);
    const infinity=Math.abs(u-f)<=Number.EPSILON*Math.max(u,f)*4;
    const v=infinity?undefined:u*f/(u-f),magnification=v===undefined?undefined:-v/u;
    for(const [hit,slope,color] of [[parallel,-h/f,'#38bdf8'],[center,-h/u,'#4ade80']] as const){
      rays.push({from:object,to:hit,color:'#fbbf24',intensity:1});
      rays.push({from:hit,to:lensEndpoint(hit,slope,1,2.8),color,intensity:1});
      if(v!==undefined&&v<0)rays.push({from:hit,to:lensEndpoint(hit,slope,-1,v),color,intensity:.6,dashed:true});
    }
    return {activeAngleDeg,rays,criticalAngleDeg:null,isTotalInternalReflection:false,refractedAngleDeg:null,
      lateralShift:0,prismDeviationDeg:0,fringeSpacingMm:0,imageDistanceM:v,magnification,imageAtInfinity:infinity};
  }

  // double-slit 双缝干涉解析：Delta x = (L * lambda) / d
  const lambdaM = Math.max(380, params.wavelengthNm) * 1e-9;
  const dM = Math.max(0.05, params.slitSeparationMm) * 1e-3;
  const L = Math.max(0.2, params.screenDistanceM);
  const fringeSpacingMm = ((L * lambdaM) / dM) * 1e3;

  return {
    activeAngleDeg,
    rays: [],
    criticalAngleDeg: null,
    isTotalInternalReflection: false,
    refractedAngleDeg: null,
    lateralShift: 0,
    prismDeviationDeg: 0,
    fringeSpacingMm
  };
}

export function createInitialState(params: OpticsParams): OpticsState {
  const solved = solveRayTrace(params.incidentAngleDeg, params);
  return {
    t: 0,
    ...solved,
    events: []
  };
}

export function stepOptics(
  state: OpticsState,
  params: OpticsParams,
  dt: number
): StepResult<OpticsState> {
  if (!Number.isFinite(dt) || dt < 0) {
    throw new Error(`Time step dt must be non-negative finite, got ${dt}.`);
  }
  if (dt === 0) {
    return { nextState: state, events: [] };
  }

  const nextT = state.t + dt;
  const phase0 = Math.asin(Math.max(-1, Math.min(1, (params.incidentAngleDeg - 42.5) / 37.5)));
  const angle = params.animateSweep
    ? 42.5 + 37.5 * Math.sin(phase0 + nextT * 0.65)
    : params.incidentAngleDeg;

  const solved = solveRayTrace(angle, params);
  const events: PhysicsEvent[] = [];

  if (
    params.sceneMode === 'tir-interface' &&
    !state.isTotalInternalReflection &&
    solved.isTotalInternalReflection &&
    solved.criticalAngleDeg !== null
  ) {
    events.push({
      id: `tir-${nextT.toFixed(5)}`,
      time: nextT,
      label: `发生全反射 (C=${solved.criticalAngleDeg.toFixed(1)}°)`
    });
  }

  return {
    nextState: {
      t: nextT,
      ...solved,
      events: [...state.events, ...events]
    },
    events
  };
}

export function computeObservables(state: OpticsState): Record<string, number> {
  return {
    incidentAngleDeg: state.activeAngleDeg,
    refractedAngleDeg: state.refractedAngleDeg ?? 0,
    criticalAngleDeg: state.criticalAngleDeg ?? 0,
    lateralShift: state.lateralShift,
    ...(state.slabDirectTransmittance===undefined?{}:{slabDirectTransmittance:state.slabDirectTransmittance}),
    ...(state.prismDeviationDeg===undefined?{}:{prismDeviationDeg:state.prismDeviationDeg}),
    fringeSpacingMm: state.fringeSpacingMm,
    ...(state.imageDistanceM===undefined?{}:{imageDistanceM:state.imageDistanceM}),
    ...(state.magnification===undefined?{}:{magnification:state.magnification}),
    ...(state.imageAtInfinity===undefined?{}:{imageAtInfinity:state.imageAtInfinity?1:0}),
    ...(state.fiberAcceptanceDeg===undefined?{}:{fiberAcceptanceDeg:state.fiberAcceptanceDeg}),
    ...(state.fiberAcceptanceDeg!==undefined?{fiberGuided:state.isTotalInternalReflection?1:0}:{}),
    ...(state.interfaceReflectance !== undefined && state.interfaceTransmittance !== undefined
      ? { interfaceReflectance: state.interfaceReflectance, interfaceTransmittance: state.interfaceTransmittance } : {})
  };
}

export function checkInvariants(
  state: OpticsState,
  _initial: OpticsState,
  params: OpticsParams
): InvariantReport[] {
  if (params.sceneMode === 'tir-interface' && state.refractedAngleDeg !== null) {
    const lhs = params.n1 * Math.sin(degToRad(state.activeAngleDeg));
    const rhs = params.n2 * Math.sin(degToRad(state.refractedAngleDeg));
    const err = Math.abs(lhs - rhs);
    return [
      {
        name: '斯涅尔定律 (n₁sinθ₁ = n₂sinθ₂)',
        measuredError: err,
        tolerance: 1e-6,
        passed: err < 1e-6
      }
    ];
  }
  const residual=(name:string,value:number,tolerance:number):InvariantReport=>({name,measuredError:Math.abs(value),tolerance,passed:Number.isFinite(value)&&Math.abs(value)<tolerance});
  if(params.sceneMode==='parallel-slab'){
    const a=state.rays[0]!,b=state.rays.find(r=>r.label==='出射光')!;
    const d1=minus(a.to,a.from),d2=minus(b.to,b.from);
    return [residual('两平行界面出射方向',cross(d1,d2)/(Math.hypot(d1.x,d1.y)*Math.hypot(d2.x,d2.y)),1e-9),
      residual('侧移量与光路垂距',Math.abs(cross(minus(b.from,a.from),d1))/Math.hypot(d1.x,d1.y)-state.lateralShift,1e-9)];
  }
  if(params.sceneMode==='thin-lens-imaging'){
    const u=params.objectDistanceM??1.2,f=params.focalLengthM??.65;
    return [residual('薄透镜高斯公式',1/u+(state.imageDistanceM===undefined?0:1/state.imageDistanceM)-1/f,1e-9)];
  }
  return [];
}
