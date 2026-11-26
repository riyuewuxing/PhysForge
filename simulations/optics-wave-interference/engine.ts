import { degToRad, wavelengthToRgb } from '@physforge/physics-core';
import type { InvariantReport, StepResult } from '@physforge/sim-sdk';

export type WaveOpticsMode = 'thin-film-wedge' | 'newtons-rings' | 'single-slit-grating';
export type FilmDefectMode = 'flat' | 'bump' | 'pit';

export type WaveOpticsParams = {
  mode: WaveOpticsMode;
  wavelengthNm: number;
  refractiveIndexN2: number;
  wedgeAngleDeg: number;
  defectMode: FilmDefectMode;
  lensRadiusR: number;
  slitWidthMicron: number;
  gratingPitchMicron: number;
  slitCountN: number;
  halfWaveLoss: boolean;
};

export interface OpticsMetrics {
  wedgeSpacingMm: number | undefined;
  newtonR1Mm: number | undefined;
  missingOrder: number | undefined;
  gratingValid: boolean;
  gratingMaxOrder: number | undefined;
  missingOrders: number[];
}
export interface WaveOpticsState {
  readonly t: number;
  readonly rgbHex: string;
  readonly mode: WaveOpticsMode;
  readonly metrics: OpticsMetrics;
  readonly centerIntensity: number | undefined;
}
const lambdaM = (p: WaveOpticsParams) => p.wavelengthNm * 1e-9;
const validFilm = (p: WaveOpticsParams) => Number.isFinite(lambdaM(p)) && lambdaM(p)>0 && Number.isFinite(p.refractiveIndexN2) && p.refractiveIndexN2>0;
const validWedge = (p: WaveOpticsParams) => validFilm(p) && Number.isFinite(p.wedgeAngleDeg) && p.wedgeAngleDeg>=0 && p.wedgeAngleDeg<90;
const validGrating = (p: WaveOpticsParams) => Number.isFinite(lambdaM(p)) && lambdaM(p)>0 &&
  Number.isFinite(p.slitWidthMicron) && p.slitWidthMicron>0 && Number.isInteger(p.slitCountN) && p.slitCountN>=1 &&
  (p.slitCountN===1 || (Number.isFinite(p.gratingPitchMicron) && p.gratingPitchMicron>=p.slitWidthMicron));
export function evalWedgeThicknessMeters(xMm: number, p: WaveOpticsParams, yMm=0): number | undefined {
  if(!validWedge(p)||!Number.isFinite(xMm)||xMm<0||!Number.isFinite(yMm))return undefined;
  const h=xMm*1e-3*Math.tan(degToRad(p.wedgeAngleDeg));
  const defect=0.4e-6*Math.exp(-((xMm-10)**2+yMm*yMm)/4);
  return Math.max(0,h+(p.defectMode==='bump'?-defect:p.defectMode==='pit'?defect:0));
}
function reflectedIntensity(h: number,p: WaveOpticsParams): number {
  const z=2*Math.PI*p.refractiveIndexN2*h/lambdaM(p);
  return (p.halfWaveLoss?Math.sin(z):Math.cos(z))**2;
}
export function evalThinFilmIntensity(xMm: number,p: WaveOpticsParams,yMm=0): number | undefined {
  const h=evalWedgeThicknessMeters(xMm,p,yMm);
  return h===undefined?undefined:reflectedIntensity(h,p);
}
export function evalNewtonRingIntensity(rMm: number,p: WaveOpticsParams): number | undefined {
  const r=Math.abs(rMm)*1e-3,R=p.lensRadiusR;
  if(!validFilm(p)||!Number.isFinite(r)||!Number.isFinite(R)||R<=0||r>=R)return undefined;
  return reflectedIntensity(r*r/(R+Math.sqrt((R-r)*(R+r))),p);
}
function sinc(z:number):number { return z===0?1:Math.sin(z)/z; }
export function evalFraunhoferGratingIntensity(q:number,p:WaveOpticsParams):number|undefined {
  if(!Number.isFinite(q)||Math.abs(q)>1||!validGrating(p))return undefined;
  const lambdaUm=p.wavelengthNm*1e-3;
  const beta=Math.PI*p.slitWidthMicron*q/lambdaUm;
  const envelope=sinc(beta)**2;
  if(p.slitCountN===1)return envelope;
  const gamma=Math.PI*p.gratingPitchMicron*q/lambdaUm;
  const reduced=gamma-Math.round(gamma/Math.PI)*Math.PI;
  return envelope*(sinc(p.slitCountN*reduced)/sinc(reduced))**2;
}
export function computeKeyOpticsMetrics(p:WaveOpticsParams):OpticsMetrics {
  const n=p.refractiveIndexN2,R=p.lensRadiusR;
  const h=lambdaM(p)/(p.halfWaveLoss?2*n:4*n);
  const wedgeSpacingMm=validWedge(p)&&p.wedgeAngleDeg>0?1000*lambdaM(p)/(2*n*Math.tan(degToRad(p.wedgeAngleDeg))):undefined;
  const newtonR1Mm=validFilm(p)&&Number.isFinite(R)&&R>h?1000*Math.sqrt(h*(2*R-h)):undefined;
  const gratingValid=validGrating(p), multi=gratingValid&&p.slitCountN>1;
  const ratio=multi?p.gratingPitchMicron/p.slitWidthMicron:undefined;
  const kMax=multi?Math.floor(p.gratingPitchMicron/(p.wavelengthNm*1e-3)+1e-12):undefined;
  const missingOrders:number[]=[];
  if(kMax!==undefined&&ratio!==undefined){
    for(let k=1;k<=kMax;k++){
      const m=k/ratio;
      if(Math.round(m)>0&&Math.abs(m-Math.round(m))<=1e-10)missingOrders.push(k);
    }
  }
  return {wedgeSpacingMm,newtonR1Mm,missingOrder:ratio,gratingValid,gratingMaxOrder:kMax,missingOrders};
}
export function createInitialState(p:WaveOpticsParams):WaveOpticsState {
  return {t:0,rgbHex:wavelengthToRgb(p.wavelengthNm).hex,mode:p.mode,metrics:computeKeyOpticsMetrics(p),
    centerIntensity:p.mode==='thin-film-wedge'?evalThinFilmIntensity(10,p):p.mode==='newtons-rings'?evalNewtonRingIntensity(0,p):evalFraunhoferGratingIntensity(0,p)};
}
export function stepWaveOptics(_state:WaveOpticsState,p:WaveOpticsParams,dt:number):StepResult<WaveOpticsState>{
  if(!Number.isFinite(dt)||dt<0)throw new Error('Invalid dt: '+dt);
  return {nextState:createInitialState(p),events:[]};
}
export function computeObservables(s:WaveOpticsState):Record<string,number>{
  const m=s.metrics,o:Record<string,number>={t:0};
  if(s.centerIntensity!==undefined)o.centerIntensity=s.centerIntensity;
  if(s.mode==='thin-film-wedge'&&m.wedgeSpacingMm!==undefined)o.wedgeFringeSpacingMm=m.wedgeSpacingMm;
  if(s.mode==='newtons-rings'&&m.newtonR1Mm!==undefined)o.newtonFirstDarkMm=m.newtonR1Mm;
  if(s.mode==='single-slit-grating'){
    o.gratingValid=m.gratingValid?1:0;
    if(m.missingOrder!==undefined)o.missingOrderRatio=m.missingOrder;
    if(m.gratingMaxOrder!==undefined){o.gratingMaxOrder=m.gratingMaxOrder;o.missingOrderCount=m.missingOrders.length;}
    if(m.missingOrders[0]!==undefined)o.firstMissingOrder=m.missingOrders[0];
  }
  return o;
}
export function checkInvariants(s:WaveOpticsState):InvariantReport[]{
  const ok=Object.values(computeObservables(s)).every(Number.isFinite)&&(s.centerIntensity===undefined||(s.centerIntensity>=0&&s.centerIntensity<=1+1e-12))&&s.t===0;
  return [{name:'静态归一化光强与有限观测量',measuredError:ok?0:1,tolerance:1e-12,passed:ok}];
}
