import {
  createScaleContext,
  integrateAdaptiveRK45,
  wavelengthToRgb
} from '@physforge/physics-core';
import type { InvariantReport, StepResult } from '@physforge/sim-sdk';

export const H_PLANCK = 6.62607015e-34;
export const E_CHARGE = 1.602176634e-19;
export const C_LIGHT = 299792458;
export const K_COULOMB = 8.9875517923e9;
export const M_ALPHA_KG = 6.6446573357e-27;
export const HC_EV_NM = ((H_PLANCK * C_LIGHT) / E_CHARGE) * 1e9;

export const NUCLEAR_SCALE = createScaleContext({
  lengthUnit: 1e-15, // 1 fm
  timeUnit: 1e-22,
  massUnit: M_ALPHA_KG,
  chargeUnit: E_CHARGE
});

export type AtomicMode = 'rutherford' | 'bohr';
export type BohrPopulation = 'ensemble' | 'single-atom';
export type ExcitationProbe = 'photon' | 'electron';

export type RutherfordBohrParams = {
  mode: AtomicMode;
  alphaEnergyMev: number;
  targetZ: number;
  impactParamFm: number;
  excitedLevelN: number;
  populationMode: BohrPopulation;
  probeKind: ExcitationProbe;
  probeEnergyEv: number;
};

export interface RutherfordSample {
  readonly x:number;readonly y:number;readonly vx:number;readonly vy:number;
  /** Elapsed physical time in units of 10^-22 s, from the visible incoming boundary. */
  readonly time22:number;
}
export interface RutherfordTrajectoryResult {
  readonly kappaDimless:number;
  readonly analyticalAngleDeg:number;
  readonly simulatedAngleDeg:number;
  readonly angleErrorRad:number;
  readonly energyDriftRel:number;
  readonly angularMomentumDriftRel:number;
  /** Exact closest approach in the fixed-center Coulomb model. */
  readonly minDistanceFm:number;
  readonly numericalClosestFm:number;
  readonly viewRadiusFm:number;
  readonly timeOfFlight22:number;
  readonly maxPositionErrorFm:number;
  readonly trajectoryFm:readonly RutherfordSample[];
}
export interface BohrLine {
  readonly upperN:number;readonly lowerN:number;readonly deltaEv:number;
  readonly wavelengthNm:number;readonly seriesName:string;readonly hex:string;
}
export interface BohrAnalysisResult {
  readonly totalCombinationLines:number;readonly maxSingleAtomLines:number;
  readonly excitationAccepted:boolean;readonly reachedLevel?:number;
  readonly residualElectronEv?:number;readonly ionizationExcessEv?:number;
  readonly transmittedPhotonEv?:number;readonly absorbedEnergyEv?:number;
  readonly resonanceMismatchEv?:number;
  readonly ionized:boolean;
  readonly spectralLines:readonly BohrLine[];
}
export type RutherfordBohrState =
  | {readonly mode:'rutherford';readonly t:number;readonly rutherford:RutherfordTrajectoryResult;readonly bohr:null;readonly animCursor:number;readonly sample:RutherfordSample}
  | {readonly mode:'bohr';readonly t:0;readonly rutherford:null;readonly bohr:BohrAnalysisResult;readonly animCursor:0;readonly sample:null};
export const RUTHERFORD_DEMO_DURATION_S=3;
export const PHOTON_INPUT_TOLERANCE_EV=.005;

export function bohrEnergyEv(n: number): number {
  const nSafe = Math.max(1, Math.round(n));
  return -13.6 / (nSafe * nSafe);
}

function coulombInputs(KMev:number,Z:number,bFm:number){
  if(![KMev,Z,bFm].every(Number.isFinite)||KMev<=0||Z<1)throw Error('Rutherford requires finite K>0, Z>=1 and b');
  const K=NUCLEAR_SCALE.toDimless(KMev*1e6*E_CHARGE,'energy'),z=Math.round(Z);
  const kappa=K_COULOMB*2*z*E_CHARGE**2/(NUCLEAR_SCALE.energyUnit*NUCLEAR_SCALE.lengthUnit);
  const a=kappa/(2*K),D=Math.hypot(a,bFm),ecc=D/a,vInfinity=Math.sqrt(2*K);
  return {K,kappa,a,D,ecc,vInfinity,b:bFm};
}
export function computeRutherfordAnalyticalAngleRad(KMev:number,Z:number,bFm:number):number{
  const q=coulombInputs(KMev,Z,bFm);
  return 2*Math.atan2(q.a,Math.abs(bFm));
}

// Incoming asymptote is +x at y=b. For repulsive hyperbola, a=κ/(2K),
// periapsis basis e1=(-a,b)/D and e2=(-b,-a)/D. The hyperbolic anomaly u
// gives x'=a(e+cosh u), y'=-b sinh u, and dt/du=a(1+e cosh u)/v∞.
// This is a finite-radius exact initial condition, not a far-line approximation.
function exactCoulomb(q:ReturnType<typeof coulombInputs>,u:number){
  const {a,D,ecc,b,vInfinity}=q,sh=Math.sinh(u),ch=Math.cosh(u),x=a*(ecc+ch),y=-b*sh;
  const dtdU=a*(1+ecc*ch)/vInfinity;
  const vx=a*sh/dtdU,vy=-b*ch/dtdU;
  return {x:(-a*x-b*y)/D,y:(b*x-a*y)/D,
    vx:(-a*vx-b*vy)/D,vy:(b*vx-a*vy)/D,time:a*(ecc*sh+u)/vInfinity};
}
export function solveRutherfordScattering(KMev:number,Z:number,bFm:number):RutherfordTrajectoryResult{
  const q=coulombInputs(KMev,Z,bFm),{K,kappa,a,D,ecc,vInfinity,b}=q;
  const minDistanceFm=a+D,viewRadiusFm=Math.max(180,2*minDistanceFm,1.8*Math.abs(b));
  const uView=Math.acosh((viewRadiusFm/a-1)/ecc);
  const uFar=Math.acosh((Math.max(2e6,viewRadiusFm*100)/a-1)/ecc);
  const init=exactCoulomb(q,-uView);
  const derivative=(_t:number,y:readonly number[]):number[]=>{
    const r2=y[0]!**2+y[1]!**2;
    if(!(r2>0))throw Error('Point-charge singularity reached in Rutherford integration');
    const g=kappa/(r2*Math.sqrt(r2));return [y[2]!,y[3]!,g*y[0]!,g*y[1]!];
  };
  let y:readonly number[]=[init.x,init.y,init.vx,init.vy],t=init.time;
  let energyDriftRel=0,angularMomentumDriftRel=0,maxPositionErrorFm=0,numericalClosestFm=Infinity;
  const L=-b*vInfinity;
  const audit=(state:readonly number[])=>{
    const [x,y,vx,vy]=state as readonly [number,number,number,number];
    const r=Math.hypot(x,y),E=(vx*vx+vy*vy)/2+kappa/r,ell=x*vy-y*vx;
    energyDriftRel=Math.max(energyDriftRel,Math.abs(E-K)/K);
    angularMomentumDriftRel=Math.max(angularMomentumDriftRel,Math.abs(ell-L)/Math.max(1,Math.abs(L)));
    numericalClosestFm=Math.min(numericalClosestFm,r);
  };
  const advance=(to:number)=>{
    if(to<=t)return;
    const result=integrateAdaptiveRK45(y,t,to-t,derivative,{absTol:1e-12,relTol:1e-12,maxSubsteps:10000});
    y=result.state;t=result.t;audit(y);
  };
  const trajectoryFm:RutherfordSample[]=[];
  // Includes u=0 exactly, so closest approach is not inferred from a
  // sparse arbitrary time grid. RK45 states remain independent of the conic.
  const N=200;
  for(let i=0;i<=N;i++){
    const u=(2*i/N-1)*uView,expected=exactCoulomb(q,u);
    advance(expected.time);audit(y);
    const x=y[0]!,p=y[1]!,vx=y[2]!,vy=y[3]!;
    maxPositionErrorFm=Math.max(maxPositionErrorFm,Math.hypot(x-expected.x,p-expected.y));
    trajectoryFm.push({x,y:p,vx,vy,time22:expected.time-init.time});
  }
  const timeOfFlight22=trajectoryFm.at(-1)!.time22;
  // Independently propagate to a far outgoing radius before comparing angles.
  // The finite-distance angle is labeled as a numerical approximation.
  advance(exactCoulomb(q,uFar).time);
  const simulatedAngleRad=Math.atan2(Math.abs(y[3]!),y[2]!),analyticalAngleRad=2*Math.atan2(a,Math.abs(b));
  return {kappaDimless:kappa,analyticalAngleDeg:analyticalAngleRad*180/Math.PI,simulatedAngleDeg:simulatedAngleRad*180/Math.PI,
    angleErrorRad:Math.abs(simulatedAngleRad-analyticalAngleRad),energyDriftRel,angularMomentumDriftRel,
    minDistanceFm,numericalClosestFm,viewRadiusFm,timeOfFlight22,maxPositionErrorFm,trajectoryFm};
}
export function sampleRutherfordAtTime(r:RutherfordTrajectoryResult,time22:number):RutherfordSample{
  const points=r.trajectoryFm;
  if(time22<=0)return points[0]!;
  if(time22>=r.timeOfFlight22)return points.at(-1)!;
  let lo=0,hi=points.length-1;
  while(hi-lo>1){const m=(lo+hi)>>1;if(points[m]!.time22<=time22)lo=m;else hi=m;}
  const a=points[lo]!,b=points[hi]!,h=b.time22-a.time22,u=(time22-a.time22)/h,u2=u*u,u3=u2*u;
  // Hermite interpolation uses actual numerical position and velocity at
  // both endpoints; this is an interpolated sample, not another integration.
  const pos=(x:number,y:number,v:number,w:number)=>(2*u3-3*u2+1)*x+(u3-2*u2+u)*h*v+(-2*u3+3*u2)*y+(u3-u2)*h*w;
  const vel=(x:number,y:number,v:number,w:number)=>((6*u2-6*u)*x+(3*u2-4*u+1)*h*v+(-6*u2+6*u)*y+(3*u2-2*u)*h*w)/h;
  return {x:pos(a.x,b.x,a.vx,b.vx),y:pos(a.y,b.y,a.vy,b.vy),vx:vel(a.x,b.x,a.vx,b.vx),vy:vel(a.y,b.y,a.vy,b.vy),time22};
}
function spectralLine(upperN:number,lowerN:number):BohrLine{
  const deltaEv=bohrEnergyEv(upperN)-bohrEnergyEv(lowerN),wavelengthNm=HC_EV_NM/deltaEv;
  const region=wavelengthNm<380?'UV':wavelengthNm>780?'IR':'可见';
  const name=['','赖曼','巴耳末','帕邢','布喇开','普丰德','汉弗莱'][lowerN]??'高阶';
  return {upperN,lowerN,deltaEv,wavelengthNm,seriesName:name+'系('+region+')',
    hex:region==='可见'?wavelengthToRgb(wavelengthNm).hex:region==='UV'?'#a855f7':'#ef4444'};
}
export function solveBohrTransitions(p:RutherfordBohrParams):BohrAnalysisResult{
  const nMax=Math.max(2,Math.min(8,Math.round(p.excitedLevelN))),spectralLines:BohrLine[]=[];
  for(let upper=nMax;upper>=2;upper--){
    if(p.populationMode==='single-atom')spectralLines.push(spectralLine(upper,upper-1));
    else for(let lower=upper-1;lower>=1;lower--)spectralLines.push(spectralLine(upper,lower));
  }
  const eProbe=Math.max(0,p.probeEnergyEv),base={totalCombinationLines:nMax*(nMax-1)/2,maxSingleAtomLines:nMax-1,spectralLines};
  if(eProbe>=13.6){
    const excess=eProbe-13.6;
    return {...base,excitationAccepted:true,ionized:true,ionizationExcessEv:excess,...(p.probeKind==='photon'?{residualElectronEv:excess}:{})};
  }
  if(p.probeKind==='photon'){
    let best:{level:number;need:number;mismatch:number}|null=null;
    for(let target=2;target<=8;target++){
      const need=bohrEnergyEv(target)-bohrEnergyEv(1),mismatch=eProbe-need;
      if(Math.abs(mismatch)<=PHOTON_INPUT_TOLERANCE_EV+1e-12&&(!best||Math.abs(mismatch)<Math.abs(best.mismatch)))best={level:target,need,mismatch};
    }
    return best?{...base,excitationAccepted:true,ionized:false,reachedLevel:best.level,absorbedEnergyEv:best.need,resonanceMismatchEv:best.mismatch}:
      {...base,excitationAccepted:false,ionized:false,reachedLevel:1,transmittedPhotonEv:eProbe};
  }
  for(let target=8;target>=2;target--){
    const need=bohrEnergyEv(target)-bohrEnergyEv(1);
    if(eProbe>=need)return {...base,excitationAccepted:true,ionized:false,reachedLevel:target,absorbedEnergyEv:need,residualElectronEv:eProbe-need};
  }
  return {...base,excitationAccepted:false,ionized:false,reachedLevel:1,residualElectronEv:eProbe};
}
export function createInitialState(p:RutherfordBohrParams):RutherfordBohrState{
  if(p.mode==='bohr')return {mode:'bohr',t:0,rutherford:null,bohr:solveBohrTransitions(p),animCursor:0,sample:null};
  const r=solveRutherfordScattering(p.alphaEnergyMev,p.targetZ,p.impactParamFm);
  return {mode:'rutherford',t:0,rutherford:r,bohr:null,animCursor:0,sample:r.trajectoryFm[0]!};
}
export function stepRutherfordBohr(s:RutherfordBohrState,p:RutherfordBohrParams,dt:number):StepResult<RutherfordBohrState>{
  if(!Number.isFinite(dt)||dt<0)throw Error('Invalid dt: '+dt);
  if(p.mode!==s.mode)return {nextState:createInitialState(p),events:[],advancedTime:0,halt:true};
  if(s.mode==='bohr')return {nextState:s,events:[],advancedTime:0,halt:true};
  if(dt===0)return {nextState:s,events:[]};
  // t is demonstration seconds, explicitly mapped to elapsed nuclear time.
  // The physical trajectory is solved once; no recomputation or cyclic teleport.
  const t=Math.min(RUTHERFORD_DEMO_DURATION_S,s.t+dt),animCursor=t/RUTHERFORD_DEMO_DURATION_S;
  return {nextState:{...s,t,animCursor,sample:sampleRutherfordAtTime(s.rutherford,animCursor*s.rutherford.timeOfFlight22)},events:[],advancedTime:t-s.t,halt:t===RUTHERFORD_DEMO_DURATION_S};
}
export function computeObservables(s:RutherfordBohrState):Record<string,number>{
  if(s.mode==='rutherford'){
    const r=s.rutherford,p=s.sample,radius=Math.hypot(p.x,p.y),force=NUCLEAR_SCALE.forceUnit*r.kappaDimless/(radius*radius);
    return {t:s.t,rutherfordAngleDeg:r.simulatedAngleDeg,analyticalAngleDeg:r.analyticalAngleDeg,minDistanceFm:r.minDistanceFm,numericalClosestFm:r.numericalClosestFm,
      angleErrorRad:r.angleErrorRad,energyDriftRel:r.energyDriftRel,angularMomentumDriftRel:r.angularMomentumDriftRel,maxPositionErrorFm:r.maxPositionErrorFm,
      sampleXfm:p.x,sampleYfm:p.y,sampleTime22:p.time22,timeOfFlight22:r.timeOfFlight22,currentDistanceFm:radius,speedMps:NUCLEAR_SCALE.velocityUnit*Math.hypot(p.vx,p.vy),forceN:force};
  }
  const b=s.bohr,ha=b.spectralLines.find(l=>l.upperN===3&&l.lowerN===2);
  return {t:0,bohrLinesCount:b.spectralLines.length,totalCombinationLines:b.totalCombinationLines,maxSingleAtomLines:b.maxSingleAtomLines,
    excitationAccepted:Number(b.excitationAccepted),ionized:Number(b.ionized),
    ...(ha?{hAlphaNm:ha.wavelengthNm}:{}),...(b.reachedLevel!==undefined?{reachedLevel:b.reachedLevel}:{}),
    ...(b.residualElectronEv!==undefined?{residualElectronEv:b.residualElectronEv}:{}),...(b.ionizationExcessEv!==undefined?{ionizationExcessEv:b.ionizationExcessEv}:{}),
    ...(b.transmittedPhotonEv!==undefined?{transmittedPhotonEv:b.transmittedPhotonEv}:{}),...(b.absorbedEnergyEv!==undefined?{absorbedEnergyEv:b.absorbedEnergyEv}:{}),
    ...(b.resonanceMismatchEv!==undefined?{resonanceMismatchEv:b.resonanceMismatchEv}:{})};
}
export function checkInvariants(s:RutherfordBohrState,_initial?:RutherfordBohrState,p?:RutherfordBohrParams):InvariantReport[]{
  const inv=(name:string,error:number,tolerance:number,unit?:string):InvariantReport=>({name,measuredError:Math.abs(error),tolerance,passed:Number.isFinite(error)&&Math.abs(error)<=tolerance,...(unit?{unit}:{})});
  if(s.mode==='rutherford'){
    const r=s.rutherford;
    return [inv('卢瑟福远区数值散射角与解析角',r.angleErrorRad,1e-4,'rad'),inv('RK45 采样机械能相对漂移',r.energyDriftRel,1e-6),
      inv('RK45 采样角动量漂移',r.angularMomentumDriftRel,1e-8),inv('数值与解析最近距离',r.numericalClosestFm-r.minDistanceFm,1e-5,'fm'),
      inv('独立数值轨迹与双曲线',r.maxPositionErrorFm,1e-5,'fm')];
  }
  const b=s.bohr;let err=0;
  for(const l of b.spectralLines)err=Math.max(err,Math.abs(HC_EV_NM/l.wavelengthNm-(bohrEnergyEv(l.upperN)-bohrEnergyEv(l.lowerN))));
  const out=[inv('氢原子谱线能量账本',err,1e-10,'eV'),inv('静态能级比较无物理时间',s.t,0)];
  if(p){
    const budget=b.ionized?13.6+(b.ionizationExcessEv??0):p.probeKind==='electron'?(b.absorbedEnergyEv??0)+(b.residualElectronEv??0):
      b.excitationAccepted?(b.absorbedEnergyEv??0)+(b.resonanceMismatchEv??0):(b.transmittedPhotonEv??0);
    out.push(inv('探针能量账本（输入舍入单列）',budget-p.probeEnergyEv,1e-10,'eV'));
    if(p.populationMode==='single-atom'){
      const n=Math.max(2,Math.min(8,Math.round(p.excitedLevelN)));
      out.push(inv('单原子示例级联能量',b.spectralLines.reduce((v,l)=>v+l.deltaEv,0)-(bohrEnergyEv(n)-bohrEnergyEv(1)),1e-10,'eV'));
    }
  }
  return out;
}
