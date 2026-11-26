import { bisectEvent, stepRK4 } from '@physforge/physics-core';
import type { InvariantReport, PhysicsEvent, StepResult } from '@physforge/sim-sdk';

export type LcRlcMode = 'lc-undamped' | 'rlc-damped' | 'rlc-ac-resonance';

export type LcRlcParams = {
  mode: LcRlcMode;
  inductanceH: number;
  capacitanceF: number;
  resistanceR: number;
  initialChargeC: number;
  driveVoltAmpUm: number;
  driveOmega: number;
};


/** 0 inactive; 1 attracting steady response; 2 lossless particular only;
 * 3 lossless exact resonance (nonzero drive, no bounded periodic response);
 * 4 lossless exact resonance with zero drive (degenerate, no excitation). */
export type ResponseKind=0|1|2|3|4;
/** Homogeneous circuit: 0 undamped, 1 underdamped, 2 critical, 3 overdamped. */
export type DampingRegime=0|1|2|3;
export interface ImpedanceSummary {
  readonly rOhm:number;
  readonly xl:number;
  readonly xc:number;
  readonly zMag:number;
  readonly responseKind:ResponseKind;
  readonly phaseRad?:number;
  readonly referenceCurrentPeak?:number;
  readonly steadyCurrentPeak?:number;
}
export interface LcRlcState {
  readonly t:number;
  readonly chargeQ:number;
  readonly currentI:number;
  readonly energyElectricJ:number;
  readonly energyMagneticJ:number;
  readonly initialEnergyJ:number;
  readonly jouleHeatJ:number;
  readonly sourceWorkJ:number;
  readonly energyResidualJ:number;
  readonly uCapV:number;
  readonly uResV:number;
  readonly uIndV:number;
  readonly uDriveV:number;
  readonly lossPowerW:number;
  readonly drivePowerW:number;
  readonly naturalPeriod:number;
  readonly dampingRegime:DampingRegime;
  readonly dampedPeriod?:number;
  readonly reference:ImpedanceSummary;
  readonly measuredPeriod:number|null;
  readonly lastUpwardCrossT:number|null;
  readonly events:readonly PhysicsEvent[];
}
function physicalParams(p:LcRlcParams){
  return {L:Math.max(1e-4,p.inductanceH),C:Math.max(1e-6,p.capacitanceF),
    R:p.mode==='lc-undamped'?0:Math.max(0,p.resistanceR),
    Um:p.mode==='rlc-ac-resonance'?Math.max(0,p.driveVoltAmpUm):0,
    w:Math.max(.1,p.driveOmega)};
}
export function computeLcNaturalOmega(p:LcRlcParams):number{
  const {L,C}=physicalParams(p);return 1/Math.sqrt(L*C);
}
export function computeImpedanceSummary(p:LcRlcParams):ImpedanceSummary{
  const {L,C,R,Um,w}=physicalParams(p),xl=w*L,xc=1/(w*C),delta=xl-xc;
  const singular=R===0&&Math.abs(delta)<=1e-12*Math.max(1,xl,xc);
  const zMag=singular?0:Math.hypot(R,delta);
  const common={rOhm:R,xl,xc,zMag};
  if(p.mode!=='rlc-ac-resonance')return {...common,responseKind:0};
  if(singular)return {...common,responseKind:Um>0?3:4};
  const referenceCurrentPeak=Um/zMag,phaseRad=Math.atan2(delta,R);
  return R>0?{...common,responseKind:1,referenceCurrentPeak,phaseRad,steadyCurrentPeak:referenceCurrentPeak}:
    {...common,responseKind:2,referenceCurrentPeak,phaseRad};
}
function damping(p:LcRlcParams):{naturalPeriod:number;dampingRegime:DampingRegime;dampedPeriod?:number}{
  const {L,C,R}=physicalParams(p),w0=1/Math.sqrt(L*C),alpha=R/(2*L),naturalPeriod=2*Math.PI/w0;
  if(R===0)return {naturalPeriod,dampingRegime:0,dampedPeriod:naturalPeriod};
  if(Math.abs(alpha-w0)<=1e-12*Math.max(1,alpha,w0))return {naturalPeriod,dampingRegime:2};
  if(alpha>w0)return {naturalPeriod,dampingRegime:3};
  return {naturalPeriod,dampingRegime:1,dampedPeriod:2*Math.PI/Math.sqrt(w0*w0-alpha*alpha)};
}
interface SubState {t:number;q:number;i:number;heat:number;work:number}
function actualValues(s:SubState,p:LcRlcParams,E0:number){
  const {L,C,R,Um,w}=physicalParams(p),energyElectricJ=s.q*s.q/(2*C),energyMagneticJ=L*s.i*s.i/2,
    uCapV=s.q/C,uResV=R*s.i,uDriveV=Um*Math.cos(w*s.t),uIndV=uDriveV-uResV-uCapV;
  return {energyElectricJ,energyMagneticJ,jouleHeatJ:s.heat,sourceWorkJ:s.work,
    energyResidualJ:energyElectricJ+energyMagneticJ+s.heat-E0-s.work,
    uCapV,uResV,uDriveV,uIndV,lossPowerW:R*s.i*s.i,drivePowerW:uDriveV*s.i};
}
export function createInitialState(p:LcRlcParams):LcRlcState{
  const q=p.mode==='rlc-ac-resonance'?0:p.initialChargeC,{C}=physicalParams(p),E0=q*q/(2*C);
  return {t:0,chargeQ:q,currentI:0,initialEnergyJ:E0,
    ...actualValues({t:0,q,i:0,heat:0,work:0},p,E0),...damping(p),reference:computeImpedanceSummary(p),
    measuredPeriod:null,lastUpwardCrossT:null,events:[]};
}
export function stepLcRlcOscillation(s:LcRlcState,p:LcRlcParams,dt:number):StepResult<LcRlcState>{
  if(!Number.isFinite(dt)||dt<0)throw Error(`Invalid dt: ${dt}`);
  if(dt===0)return {nextState:s,events:[]};
  const {L,C,R,Um,w}=physicalParams(p),d=damping(p);
  // Respect the fastest natural, drive and resistive relaxation timescales.
  const maxSub=Math.min(.002,d.naturalPeriod/250,Um!==0?2*Math.PI/(250*w):Infinity,R>0?.05*L/R:Infinity),
    n=Math.max(1,Math.ceil(dt/maxSub)),h=dt/n;
  const advance=(z:SubState,delta:number):SubState=>{
    // Integrate heat and signed source work using the same independent RK4
    // stage currents/voltages. Do not reconstruct either from E conservation.
    const v=stepRK4([z.q,z.i,z.heat,z.work],z.t,delta,(t,y)=>{
      const q=y[0]!,i=y[1]!,u=Um*Math.cos(w*t);
      return [i,(u-R*i-q/C)/L,R*i*i,u*i];
    });
    return {t:z.t+delta,q:v[0]!,i:v[1]!,heat:v[2]!,work:v[3]!};
  };
  let cur:SubState={t:s.t,q:s.chargeQ,i:s.currentI,heat:s.jouleHeatJ,work:s.sourceWorkJ};
  let measuredPeriod=s.measuredPeriod,lastUpwardCrossT=s.lastUpwardCrossT;
  const events:PhysicsEvent[]=[];
  const canCross=p.mode==='rlc-ac-resonance'||d.dampingRegime<2;
  const currentFloor=1e-12*Math.max(1,Math.abs(p.initialChargeC)*computeLcNaturalOmega(p),Um);
  for(let k=0;k<n;k++){
    const next=advance(cur,h);
    if(canCross&&cur.q<0&&next.q>=0&&next.i>currentFloor){
      const hit=bisectEvent(cur,cur.t,h,advance,z=>z.q,{timeTolerance:1e-10,biasEndpoint:'midpoint'});
      if(hit){
        if(lastUpwardCrossT!==null&&hit.time-lastUpwardCrossT>1e-9)measuredPeriod=hit.time-lastUpwardCrossT;
        lastUpwardCrossT=hit.time;
      }
    }
    cur=next;
  }
  cur={...cur,t:s.t+dt};
  return {nextState:{t:cur.t,initialEnergyJ:s.initialEnergyJ,chargeQ:cur.q,currentI:cur.i,...actualValues(cur,p,s.initialEnergyJ),
    ...d,reference:computeImpedanceSummary(p),measuredPeriod,lastUpwardCrossT,events:[]},events};
}
export function computeObservables(s:LcRlcState):Record<string,number>{
  const r=s.reference;
  return {t:s.t,chargeQ:s.chargeQ,currentI:s.currentI,energyElectricJ:s.energyElectricJ,energyMagneticJ:s.energyMagneticJ,
    initialEnergyJ:s.initialEnergyJ,totalEmEnergyJ:s.energyElectricJ+s.energyMagneticJ,jouleHeatJ:s.jouleHeatJ,
    sourceWorkJ:s.sourceWorkJ,energyResidualJ:s.energyResidualJ,uCapV:s.uCapV,uResV:s.uResV,uIndV:s.uIndV,
    uDriveV:s.uDriveV,lossPowerW:s.lossPowerW,drivePowerW:s.drivePowerW,naturalPeriod:s.naturalPeriod,
    dampingRegime:s.dampingRegime,responseKind:r.responseKind,
    ...(s.dampedPeriod!==undefined?{dampedPeriod:s.dampedPeriod}:{}),
    ...(s.measuredPeriod!==null?{measuredPeriod:s.measuredPeriod}:{}),
    ...(r.responseKind!==0?{impedanceR:r.rOhm,reactanceL:r.xl,reactanceC:r.xc,impedanceMag:r.zMag}:{}),
    ...(r.referenceCurrentPeak!==undefined?{referenceCurrentPeak:r.referenceCurrentPeak}:{}),
    ...(r.phaseRad!==undefined?{referencePhaseRad:r.phaseRad}:{})};
}
export function checkInvariants(s:LcRlcState,initial:LcRlcState,p:LcRlcParams):InvariantReport[]{
  const {L,C,R,Um,w}=physicalParams(p),E0=initial.energyElectricJ+initial.energyMagneticJ;
  const report=(name:string,a:number,b:number,scale=0,tolerance=1e-5):InvariantReport=>{
    const e=Math.abs(a-b)/Math.max(1e-9,Math.abs(a),Math.abs(b),scale);
    return {name,measuredError:Number.isFinite(e)?e:Number.MAX_VALUE,tolerance,passed:Number.isFinite(e)&&e<=tolerance};
  };
  const E=s.energyElectricJ+s.energyMagneticJ,ledger=E+s.jouleHeatJ-E0-s.sourceWorkJ,
    scale=Math.max(E0,Math.abs(s.sourceWorkJ),Math.abs(E)+Math.abs(s.jouleHeatJ),1e-9);
  const reports=[
    report('电场能由实际极板电荷确定',s.energyElectricJ,s.chargeQ*s.chargeQ/(2*C)),
    report('磁场能由实际电流确定',s.energyMagneticJ,L*s.currentI*s.currentI/2),
    report('电磁能 + 累计焦耳热 = 初始能 + 有符号源功',E+s.jouleHeatJ,E0+s.sourceWorkJ,scale),
    report('公开能量残差与实际账本一致',s.energyResidualJ,ledger,scale),
    report('焦耳热非负',Math.min(0,s.jouleHeatJ),0,scale),
    report('电容电压 q/C',s.uCapV,s.chargeQ/C),
    report('电阻电压 Ri',s.uResV,R*s.currentI),
    report('实际驱动电压',s.uDriveV,Um*Math.cos(w*s.t)),
    report('回路电压代数和',s.uDriveV,s.uCapV+s.uResV+s.uIndV,Math.max(Math.abs(s.uCapV),Math.abs(s.uIndV),Math.abs(s.uResV))),
    report('瞬时电阻功率 Ri²',s.lossPowerW,R*s.currentI*s.currentI),
    report('瞬时有符号源功率 ui',s.drivePowerW,s.uDriveV*s.currentI)
  ];
  if(R===0)reports.push(report('理想无阻回路不产生焦耳热',s.jouleHeatJ,0,scale));
  if(Um===0)reports.push(report('无外驱动源功为零',s.sourceWorkJ,0,scale));
  return reports;
}
