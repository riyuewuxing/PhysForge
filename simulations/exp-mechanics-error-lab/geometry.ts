import { CLASSROOM_GRAVITY } from '@physforge/physics-core';
import type { DiagramPrimitive } from '@physforge/sim-sdk';
import { computeTrueCartAcceleration, type MechanicsErrorParams, type MechanicsErrorState } from './engine.js';

export const graphBox = { left: -1.75, right: 1.75, bottom: -1.10, top: .52 };
export const tapeY = 1.20;
const tapeLeft = -1.75, tapeRight = 1.75;
function niceStep(span: number, n = 6) {
  const raw = Math.max(1e-9, span / n);
  const p = 10 ** Math.floor(Math.log10(raw));
  const m = raw / p;
  return p * (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10);
}
function tickText(x:number){return Number(x.toPrecision(5)).toString();}
export function tapeGeometry(state: MechanicsErrorState, params: MechanicsErrorParams) {
  const offset = Math.max(-5, Math.min(20, params.rulerOffsetCm ?? 0));
  const abs = state.tapeDots.map(p => p.posCm);
  // Domain independent of the current offset: dragging is affine and cannot rescale itself.
  const min = Math.min(-5, ...abs) - 5, max = Math.max(20, ...abs) + 5;
  const scale = (tapeRight - tapeLeft) / (max - min);
  const x = (cm:number) => tapeLeft + (cm - min)*scale;
  const step = niceStep(max-min,7), minor=step/5;
  const ticks: {reading:number;x:number;major:boolean}[]=[];
  for(let i=Math.ceil((min-offset)/minor);i<=Math.floor((max-offset)/minor);i++){
    const reading=i*minor;ticks.push({reading,x:x(offset+reading),major:i%5===0});
  }
  const dots=state.tapeDots.map(p=>({index:p.index,timeS:p.timeS,reading:p.posCm-offset,x:x(p.posCm)}));
  return {min,max,scale,x,offset,zeroX:x(offset),ticks,dots,
    offsetAtX:(worldX:number)=>Math.max(-5,Math.min(20,min+(worldX-tapeLeft)/scale))};
}
export function afGeometry(state: MechanicsErrorState, params: MechanicsErrorParams) {
  const B=graphBox;
  const measured=state.afCurve.map(p=>({f:p.fAppN,a:p.aMeasured}));
  const overlay=state.csvOverlayPoints.map(p=>({f:p.fAppN,a:p.a}));
  const fLast=Math.max(.1,...measured.map(p=>p.f));
  const fStep=niceStep(Math.max(.2,fLast,...overlay.map(p=>p.f),state.analyticInterceptF));
  const fMax=Math.ceil(Math.max(.2,fLast,...overlay.map(p=>p.f),state.analyticInterceptF)/fStep)*fStep;
  const theory=Array.from({length:81},(_,i)=>{
    const f=fMax*i/80;
    return {f,a:computeTrueCartAcceleration(params.cartMassKg,f/CLASSROOM_GRAVITY,params.trackTiltDeg,params.frictionForceN)};
  });
  const fit=[{f:0,a:state.interceptFitA},{f:fLast,a:state.slopeFit*fLast+state.interceptFitA}];
  const values=[0,...measured.map(p=>p.a),...overlay.map(p=>p.a),...theory.map(p=>p.a),...fit.map(p=>p.a)];
  const lo=Math.min(0,...values),hi=Math.max(.2,...values),aStep=niceStep(hi-lo);
  const aMin=Math.floor(lo/aStep)*aStep,aMax=Math.ceil(hi/aStep)*aStep;
  const map=(f:number,a:number)=>({x:B.left+f/fMax*(B.right-B.left),y:B.bottom+(a-aMin)/(aMax-aMin)*(B.top-B.bottom)});
  const ft=Array.from({length:Math.round(fMax/fStep)+1},(_,i)=>i*fStep);
  const at=Array.from({length:Math.round((aMax-aMin)/aStep)+1},(_,i)=>aMin+i*aStep);
  const data={measured,overlay,theory,fit};
  return {bounds:B,fMax,aMin,aMax,fStep,aStep,map,ft,at,data};
}

export type GraphRole='axis'|'tick'|'measured'|'theory'|'fit'|'overlay'|'legend';
export type GraphItem={role:GraphRole;primitive:DiagramPrimitive};
export function graphItems(state:MechanicsErrorState,params:MechanicsErrorParams):GraphItem[]{
  const g=afGeometry(state,params), B=g.bounds, items:GraphItem[]=[];
  const push=(role:GraphRole,primitive:DiagramPrimitive)=>items.push({role,primitive});
  const line=(role:GraphRole,x1:number,y1:number,x2:number,y2:number,dashed=false)=>push(role,{kind:'line',x1,y1,x2,y2,dashed});
  const text=(role:GraphRole,x:number,y:number,value:string,align:'start'|'middle'|'end'='middle')=>push(role,{kind:'text',x,y,text:value,align});
  const zero=g.map(0,0);
  // Keep the measured guide first for the pre-existing DiagramIR contract.
  push('measured',{kind:'polyline',points:g.data.measured.map(p=>g.map(p.f,p.a)),dashed:true});
  push('axis',{kind:'arrow',x1:B.left,y1:zero.y,x2:B.right+.12,y2:zero.y,label:'F=mg / N'});
  push('axis',{kind:'arrow',x1:B.left,y1:B.bottom,x2:B.left,y2:B.top+.12,label:'a / (m/s²)'});
  for(const f of g.ft){
    const {x}=g.map(f,0);line('tick',x,zero.y-.025,x,zero.y+.025);
    text('tick',x,B.bottom-.085,tickText(f));
  }
  for(const a of g.at){
    const {y}=g.map(0,a);line('tick',B.left-.025,y,B.left+.025,y);
    text('tick',B.left-.06,y,tickText(a),'end');
  }
  push('theory',{kind:'polyline',points:g.data.theory.map(p=>g.map(p.f,p.a))});
  push('fit',{kind:'polyline',points:g.data.fit.map(p=>g.map(p.f,p.a)),dashed:true});
  for(const p of g.data.measured){const q=g.map(p.f,p.a);push('measured',{kind:'circle',cx:q.x,cy:q.y,r:.025,fill:true});}
  for(const p of g.data.overlay){const q=g.map(p.f,p.a);push('overlay',{kind:'rect',x:q.x-.025,y:q.y-.025,width:.05,height:.05});}
  text('theory',-.95,.72,'精确理论曲线');
  text('fit',.22,.72,'OLS 直线拟合');
  text('measured',1.23,.72,'纸带测点');
  if(g.data.overlay.length)text('overlay',0,-1.36,'方点：CSV 对照样例（非已核实实测）');
  return items;
}
