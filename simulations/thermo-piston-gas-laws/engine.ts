import { CLASSROOM_GRAVITY, bisectEvent, degToRad } from '@physforge/physics-core';
import type { InvariantReport, PhysicsEvent, StepResult } from '@physforge/sim-sdk';

export const R_GAS = 8.31446261815324;
export const P_ATM = 101325;
export const CM_HG_TO_PA = P_ATM / 76;

export type ThermoGasMode = 'stop-pin-cylinder' | 'mercury-tube-tilt' | 'multi-stroke-pump';
export type ThermoGasParams = {
  mode: ThermoGasMode;
  molesN: number;
  initialTempK: number;
  targetTempK: number;
  heatingRateKPerS: number;
  pistonAreaCm2: number;
  pistonMassKg: number;
  pinVolumeL: number;
  tubeTiltDeg: number;
  mercuryCm: number;
  tubeLengthCm: number;
  tankVolumeL: number;
  pumpDeltaVL: number;
  pumpStrokesK: number;
  pumpDirection: 'extract' | 'inject';
};
export type PVPoint={vL:number;pKPa:number};
export type PumpStage={k:number;pressurePa:number;volumeM3:number;molesN:number;deltaMolesN:number};
export interface ThermoGasState {
  readonly t:number;
  readonly process:ThermoGasMode;
  readonly mode:'pinned'|'floating';
  readonly temperatureK:number;
  readonly pressurePa:number;
  readonly volumeM3:number;
  readonly molesN:number;
  readonly initialMolesN:number;
  readonly initialVolumeM3:number;
  readonly mercuryColumnCm:number;
  readonly airColumnCm:number;
  readonly referenceAirCm:number;
  readonly spilledMercuryCm:number;
  readonly overflowed:boolean;
  readonly detachTempK:number|null;
  readonly criticalTempK:number|null;
  readonly equilibriumPressurePa:number|null;
  readonly pinReactionN:number|null;
  readonly workByGasJ:number|null;
  readonly pvHistory:readonly PVPoint[];
  readonly pumpStages:readonly PumpStage[];
  readonly events:readonly PhysicsEvent[];
}

function positive(v:number,label:string):number{
  if(!Number.isFinite(v)||v<=0)throw new Error('Invalid '+label+': '+v);
  return v;
}
const areaM2=(p:ThermoGasParams)=>positive(p.pistonAreaCm2*1e-4,'cross section');
const pinM3=(p:ThermoGasParams)=>positive(p.pinVolumeL*1e-3,'pin volume');
const initialTemperature=(p:ThermoGasParams)=>positive(p.initialTempK??260,'initial temperature');
const targetTemperature=(p:ThermoGasParams)=>positive(p.targetTempK,'target temperature');

export function computeCylinderEquilibriumPressure(p:ThermoGasParams):number{
  if(!Number.isFinite(p.pistonMassKg)||p.pistonMassKg<0)throw new Error('Invalid piston mass');
  return P_ATM+p.pistonMassKg*CLASSROOM_GRAVITY/areaM2(p);
}
export function computeDetachCriticalTempK(p:ThermoGasParams):number{
  return computeCylinderEquilibriumPressure(p)*pinM3(p)/(positive(p.molesN,'amount')*R_GAS);
}

// Each tilt is an independent, isothermal equilibrium from the same
// horizontal reference; a spill is not a reversible dynamic trajectory.
export interface MercuryEquilibrium {
  pressurePa:number;airCm:number;mercCm:number;overflowed:boolean;
  referenceAirCm:number;spilledCm:number;
}
export function solveMercuryTiltState(p:ThermoGasParams):MercuryEquilibrium{
  const L=positive(p.tubeLengthCm,'tube length'),h0=positive(p.mercuryCm,'reference mercury length');
  const L0=positive(Math.min(30,L-h0-2),'horizontal reference air column');
  if(!Number.isFinite(p.tubeTiltDeg)||Math.abs(p.tubeTiltDeg)>90||h0>=76)throw new Error('Invalid mercury reference geometry');
  const sine=Math.sin(degToRad(p.tubeTiltDeg));
  const pressureRatio=(h:number)=>1+h*sine/76;
  const airFull=L0/pressureRatio(h0);
  if(airFull+h0<=L+1e-12)return {pressurePa:P_ATM*pressureRatio(h0),airCm:airFull,mercCm:h0,overflowed:false,referenceAirCm:L0,spilledCm:0};
  // On the legal overflow branch sine<0, f is strictly decreasing
  // in h, with f(0)>0 and f(h0)<0. No mass is created by the root solve.
  let lo=0,hi=h0;
  for(let i=0;i<60;i++){
    const h=(lo+hi)/2;
    if((L-h)*pressureRatio(h)>L0)lo=h;else hi=h;
  }
  const h=(lo+hi)/2;
  return {pressurePa:P_ATM*pressureRatio(h),airCm:L-h,mercCm:h,overflowed:true,referenceAirCm:L0,spilledCm:h0-h};
}

export function computePumpStages(p:ThermoGasParams):PumpStage[]{
  const V=positive(p.tankVolumeL*1e-3,'tank volume'),dV=positive(p.pumpDeltaVL*1e-3,'pump displacement');
  const T=targetTemperature(p);
  if(!Number.isFinite(p.pumpStrokesK)||p.pumpStrokesK<0||p.pumpStrokesK>10)throw new Error('Invalid pump stroke count');
  const k=Math.round(p.pumpStrokesK),out:PumpStage[]=[];
  let pressure=P_ATM,previousN=pressure*V/(R_GAS*T);
  out.push({k:0,pressurePa:pressure,volumeM3:V,molesN:previousN,deltaMolesN:0});
  for(let j=1;j<=k;j++){
    pressure=p.pumpDirection==='extract'?pressure*V/(V+dV):pressure+P_ATM*dV/V;
    const n=pressure*V/(R_GAS*T);
    out.push({k:j,pressurePa:pressure,volumeM3:V,molesN:n,deltaMolesN:n-previousN});
    previousN=n;
  }
  return out;
}
export function computeMultiStrokePressure(p:ThermoGasParams):number{return computePumpStages(p).at(-1)!.pressurePa;}
const pv=(volumeM3:number,pressurePa:number):PVPoint=>({vL:volumeM3*1000,pKPa:pressurePa/1000});

function baseState(p:ThermoGasParams,T:number,P:number,V:number,n:number):ThermoGasState{
  return {t:0,process:p.mode,mode:'pinned',temperatureK:T,pressurePa:P,volumeM3:V,molesN:n,initialMolesN:n,initialVolumeM3:V,
    mercuryColumnCm:0,airColumnCm:0,referenceAirCm:0,spilledMercuryCm:0,overflowed:false,
    detachTempK:null,criticalTempK:null,equilibriumPressurePa:null,pinReactionN:null,workByGasJ:null,
    pvHistory:[pv(V,P)],pumpStages:[],events:[]};
}
function cylinderAt(T:number,n:number,p:ThermoGasParams){
  const peq=computeCylinderEquilibriumPressure(p),vPin=pinM3(p),tc=peq*vPin/(n*R_GAS);
  const V=T>tc?n*R_GAS*T/peq:vPin,P=T>=tc?peq:n*R_GAS*T/vPin;
  return {pressurePa:P,volumeM3:V,criticalTempK:tc,equilibriumPressurePa:peq,pinReactionN:Math.max(0,(peq-P)*areaM2(p))};
}
export function createInitialState(p:ThermoGasParams):ThermoGasState{
  if(p.mode==='mercury-tube-tilt'){
    const m=solveMercuryTiltState(p),T=targetTemperature(p),A=areaM2(p);
    const V=m.airCm*.01*A,n=P_ATM*m.referenceAirCm*.01*A/(R_GAS*T);
    return {...baseState(p,T,m.pressurePa,V,n),mode:'floating',mercuryColumnCm:m.mercCm,airColumnCm:m.airCm,
      referenceAirCm:m.referenceAirCm,spilledMercuryCm:m.spilledCm,overflowed:m.overflowed};
  }
  if(p.mode==='multi-stroke-pump'){
    const stages=computePumpStages(p),first=stages[0]!,last=stages.at(-1)!;
    return {...baseState(p,targetTemperature(p),last.pressurePa,last.volumeM3,last.molesN),initialMolesN:first.molesN,
      pvHistory:stages.map(s=>pv(s.volumeM3,s.pressurePa)),pumpStages:stages};
  }
  const T=initialTemperature(p),n=positive(p.molesN,'amount'),c=cylinderAt(T,n,p);
  return {...baseState(p,T,c.pressurePa,c.volumeM3,n),...c,mode:T>c.criticalTempK?'floating':'pinned',workByGasJ:0};
}

// Only remove collinear intermediate points in the same direction. Keep
// exact phase-boundary corners and reversal vertices, including large steps.
function appendPV(history:readonly PVPoint[],point:PVPoint):readonly PVPoint[]{
  const b=history.at(-1),a=history.at(-2);
  if(b&&Math.abs(point.vL-b.vL)<1e-12&&Math.abs(point.pKPa-b.pKPa)<1e-12)return history;
  if(a&&b){
    const dv1=b.vL-a.vL,dv2=point.vL-b.vL,dp1=b.pKPa-a.pKPa,dp2=point.pKPa-b.pKPa;
    const vertical=Math.abs(dv1)<1e-10&&Math.abs(dv2)<1e-10&&dp1*dp2>=0;
    const horizontal=Math.abs(dp1)<1e-9&&Math.abs(dp2)<1e-9&&dv1*dv2>=0;
    if(vertical||horizontal)return [...history.slice(0,-1),point];
  }
  return [...history.slice(-150),point];
}
export function stepThermoGasLaws(s:ThermoGasState,p:ThermoGasParams,dt:number):StepResult<ThermoGasState>{
  if(!Number.isFinite(dt)||dt<0)throw new Error('Invalid dt: '+dt);
  if(dt===0)return {nextState:s,events:[]};
  if(p.mode!=='stop-pin-cylinder')return {nextState:createInitialState(p),events:[]};
  const n=s.molesN,T0=s.temperatureK,target=targetTemperature(p),rate=positive(p.heatingRateKPerS,'temperature rate');
  const tc=computeCylinderEquilibriumPressure(p)*pinM3(p)/(n*R_GAS);
  const diff=target-T0,direction=Math.sign(diff),duration=Math.min(dt,Math.abs(diff)/rate);
  const advance=(T:number,h:number)=>h>=Math.abs(target-T)/rate?target:T+Math.sign(target-T)*rate*h;
  const nextT=advance(T0,duration),c=cylinderAt(nextT,n,p);
  const detach=direction>0&&s.mode==='pinned'&&nextT>=tc;
  const hit=direction<0&&s.mode==='floating'&&nextT<=tc;
  let history=s.pvHistory,events:PhysicsEvent[]=[],mode=s.mode,detachTempK=s.detachTempK;
  if((detach||hit)&&duration>0){
    const boundary=bisectEvent(T0,s.t,duration,advance,T=>T-tc,{timeTolerance:1e-11,triggerOnStartZero:true});
    if(!boundary)throw new Error('Expected pin transition without a physical bracket');
    const key=detach?'detach-pin':'hit-pin';
    const peq=computeCylinderEquilibriumPressure(p),V=pinM3(p);
    history=appendPV(history,pv(V,peq));
    events=[{id:key+'-'+boundary.time.toFixed(9),time:boundary.time,label:detach?'脱离下卡口 · 转为等压膨胀':'触及下卡口 · 转为等容降温',
      metrics:{criticalTempK:tc,pressureKPa:peq/1000,volumeL:V*1000,bracketWidth:boundary.bracketWidth,...(detach?{detachTempK:tc}:{hitTempK:tc})}}];
    mode=detach?'floating':'pinned';if(detach)detachTempK=tc;
  }else if(nextT>tc)mode='floating';else if(nextT<tc)mode='pinned';
  history=appendPV(history,pv(c.volumeM3,c.pressurePa));
  const W=(s.workByGasJ??0)+c.equilibriumPressurePa*(c.volumeM3-s.volumeM3);
  return {nextState:{...s,...c,t:s.t+dt,temperatureK:nextT,mode,detachTempK,workByGasJ:W,
    pvHistory:history,events:[...s.events,...events]},events};
}

export function computeObservables(s:ThermoGasState):Record<string,number>{
  const o:Record<string,number>={t:s.t,temperatureK:s.temperatureK,pressureKPa:s.pressurePa/1000,volumeL:s.volumeM3*1000,molesN:s.molesN,
    pvOverNrt:s.pressurePa*s.volumeM3/(s.molesN*R_GAS*s.temperatureK),initialMolesN:s.initialMolesN};
  if(s.process==='stop-pin-cylinder'){
    o.floating=s.mode==='floating'?1:0;o.workByGasJ=s.workByGasJ!;o.criticalTempK=s.criticalTempK!;o.equilibriumPressureKPa=s.equilibriumPressurePa!/1000;o.pinReactionN=s.pinReactionN!;
    if(s.detachTempK!==null)o.detachTempK=s.detachTempK;
    const last=s.events.at(-1);if(last)o.lastEventTime=last.time;
  }else if(s.process==='mercury-tube-tilt'){
    o.airColumnCm=s.airColumnCm;o.mercuryColumnCm=s.mercuryColumnCm;o.referenceAirCm=s.referenceAirCm;o.spilledMercuryCm=s.spilledMercuryCm;o.overflowed=s.overflowed?1:0;
    o.referenceMassRelativeError=s.molesN/s.initialMolesN-1;
  }else{
    o.completedStrokes=s.pumpStages.at(-1)!.k;o.transferredMolesN=s.molesN-s.initialMolesN;
  }
  return o;
}
export function checkInvariants(s:ThermoGasState,_initial?:ThermoGasState,p?:ThermoGasParams):InvariantReport[]{
  const inv=(name:string,error:number,tolerance=1e-10):InvariantReport=>({name,measuredError:Math.abs(error),tolerance,passed:Number.isFinite(error)&&Math.abs(error)<=tolerance});
  const reports=[inv('理想气体状态方程相对残差',s.pressurePa*s.volumeM3/(s.molesN*R_GAS*s.temperatureK)-1)];
  if(s.process==='stop-pin-cylinder'){
    reports.push(inv('封闭气体物质的量守恒',s.molesN/s.initialMolesN-1),
      inv('有符号边界功账本 (J)',s.workByGasJ!-s.equilibriumPressurePa!*(s.volumeM3-s.initialVolumeM3),1e-7));
    if(p)reports.push(inv('下卡口与压强平衡 (相对)',Math.max(0,pinM3(p)-s.volumeM3)/pinM3(p)+Math.max(0,s.pressurePa-s.equilibriumPressurePa!)/s.equilibriumPressurePa!));
  }else if(s.process==='mercury-tube-tilt'){
    reports.push(inv('等温封闭气体 p·l / (p₀·l₀)',s.pressurePa*s.airColumnCm/(P_ATM*s.referenceAirCm)-1),inv('无虚假时间',s.t));
    if(p)reports.push(inv('液柱静力平衡 (相对)',s.pressurePa/P_ATM-1-s.mercuryColumnCm*Math.sin(degToRad(p.tubeTiltDeg))/76),
      inv('管长约束 (cm)',Math.max(0,s.airColumnCm+s.mercuryColumnCm-p.tubeLengthCm)));
  }else{
    reports.push(inv('无虚假时间',s.t));
    if(p){const ratio=p.tankVolumeL/(p.tankVolumeL+p.pumpDeltaVL);
      let max=0;for(const j of s.pumpStages){const expected=P_ATM*(p.pumpDirection==='extract'?ratio**j.k:1+j.k*p.pumpDeltaVL/p.tankVolumeL);max=Math.max(max,Math.abs(j.pressurePa/expected-1));}
      reports.push(inv('各冲程独立解析压强相对残差',max));}
  }
  return reports;
}
