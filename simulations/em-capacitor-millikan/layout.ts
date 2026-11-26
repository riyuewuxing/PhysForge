import {createWorldMapper,type Viewport} from '@physforge/sim-sdk';
import {capacitorGeometry,computeCapacitorMetrics,createInitialState,type CapacitorMillikanParams,type CapacitorMillikanState} from './engine.js';
export interface CapSafeRect {left:number;right:number;top:number;bottom:number}
export interface CapBox extends CapSafeRect {id:string}
export interface CapLabel {id:string;x:number;y:number;text:string;role:'ink'|'muted'|'rose'|'gold'|'green';font:string}
type Measure=(text:string,font:string)=>number;
const FONT='13px sans-serif',BOLD='bold 13px sans-serif';
export const estimateCapLabel:Measure=(text)=>Array.from(text).reduce((w,c)=>w+(c.codePointAt(0)!>255?13:8),0);
const allLayers=new Set(['plates','oilDrop','electrometer']);
export function capacitorLayout(s:CapacitorMillikanState,p:CapacitorMillikanParams,v:Viewport,layers:ReadonlySet<string>,measure:Measure=estimateCapLabel){
  const m=computeCapacitorMetrics(p),g=capacitorGeometry(p),d=g.halfD,mapper=createWorldMapper(v);
  const px=mapper.toX,py=mapper.toY,top=py(d),bottom=py(-d),plateHeight=Math.max(7,mapper.len(.065));
  const r=Math.max(27,mapper.len(.34)),meter={x:Math.max(px(g.topRight+.75),px(g.topRight)+r+24),y:py(0),r};
  const labels:CapLabel[]=[],boxes:CapBox[]=[];
  const box=(id:string,left:number,right:number,top:number,bottom:number)=>boxes.push({id,left,right,top,bottom});
  const label=(id:string,x:number,y:number,text:string,role:CapLabel['role']='ink',font=FONT)=>{
    labels.push({id,x,y,text,role,font});
    const w=measure(text,font)+6;box(id,x-w/2,x+w/2,y-9,y+9);
  };
  const center=px((g.topLeft+g.topRight)/2);
  if(layers.has('plates')){
    box('top-plate',px(g.topLeft)-2,px(g.topRight)+2,top-plateHeight-2,top+2);
    box('bottom-plate',px(-1.5)-2,px(1.5)+2,bottom-2,bottom+plateHeight+2);
    label('top-potential',center,top-plateHeight-15,'上板 φ='+m.phiTopV.toFixed(1)+' V','ink',BOLD);
    label('overlap',center,top-plateHeight-36,'正对 '+(m.area*1e4).toFixed(0)+' cm² · εr='+p.dielectricEr,'muted');
    label('bottom-potential',px(0),bottom+plateHeight+15,'下板 φ='+m.phiBottomV.toFixed(1)+' V'+(p.groundMode==='none'?' · 中面零势':''),'ink',BOLD);
    label('field-label',px(0),bottom+plateHeight+36,m.fieldEy===0?'Eᵧ=0':'Eᵧ='+m.fieldEy.toExponential(2)+' V/m','green');
    const gap='d='+p.distanceMm+' mm';
    label('gap',px(-1.74)-measure(gap,FONT)/2-12,(top+bottom)/2,gap,'muted');
    box('gap-line',px(-1.80),px(-1.68),top,bottom);
    if(p.groundMode!=='none'){
      const x=p.groundMode==='top'?g.topRight:1.5,y=p.groundMode==='top'?top:bottom,dir=p.groundMode==='top'?-1:1;
      box('ground',px(x)-2,px(x+.30)+2,Math.min(y,y+dir*mapper.len(.29))-2,Math.max(y,y+dir*mapper.len(.29))+2);
    }
  }
  const probe={x:px(g.probeX),y:py(-d+2*d*p.probeFracP)},drop={x:px(g.dropX),y:py(-d+2*d*s.dropYFrac)};
  if(layers.has('oilDrop')){
    box('probe-dot',probe.x-5,probe.x+5,probe.y-5,probe.y+5);
    label('probe',center,top-plateHeight-57,'● P · '+m.phiPV.toFixed(1)+' V','rose',BOLD);
    if(p.oilDropEnabled){
      const r=Math.max(5,mapper.len(.045));box('drop-dot',drop.x-r,drop.x+r,drop.y-r,drop.y+r);
      label('drop',px(0),bottom+plateHeight+57,s.terminal?'● 油滴 · 触板停止':'● 油滴 q=−'+Math.round(p.dropChargeSteps)+'e','gold',BOLD);
    }
  }
  if(layers.has('electrometer')){
    const meterLabelHalf=Math.max(measure('静电计 · 指针示意',FONT),measure('参考 Q 恒定',BOLD),measure('电源 U 恒定',BOLD))/2+3;
    const right=Math.max(px(g.topRight),...boxes.map(b=>b.right));
    meter.x=Math.max(meter.x,right+Math.max(r+2,meterLabelHalf)+12);
    box('meter',meter.x-r-2,meter.x+r+2,meter.y-r-2,meter.y+r+2);
    label('meter-title',meter.x,meter.y+r+15,'静电计 · 指针示意','muted');
    label('mode',meter.x,meter.y+r+36,p.switchMode==='open-const-q'?'参考 Q 恒定':'电源 U 恒定','gold',BOLD);
  }
  return {labels,boxes,meter,probe,drop,plateHeight};
}
export function capacitorContentBounds(layout:ReturnType<typeof capacitorLayout>):CapSafeRect{
  return {left:Math.min(...layout.boxes.map(b=>b.left))-10,right:Math.max(...layout.boxes.map(b=>b.right))+10,
    top:Math.min(...layout.boxes.map(b=>b.top))-10,bottom:Math.max(...layout.boxes.map(b=>b.bottom))+10};
}
export function capacitorBoundsFit(s:CapacitorMillikanState,p:CapacitorMillikanParams,v:Viewport,safe:CapSafeRect,measure:Measure=estimateCapLabel){
  const b=capacitorContentBounds(capacitorLayout(s,p,v,allLayers,measure));
  return b.left>=safe.left-.01&&b.right<=safe.right+.01&&b.top>=safe.top-.01&&b.bottom<=safe.bottom+.01;
}
export function fitCapacitorViewport(p:CapacitorMillikanParams,v:Viewport,safe:CapSafeRect,measure:Measure=estimateCapLabel):Viewport|null{
  const w=safe.right-safe.left,h=safe.bottom-safe.top;
  if(w<220||h<160)return null;
  const s=createInitialState(p);
  const bounds=(scale:number)=>capacitorContentBounds(capacitorLayout(s,p,{...v,scale,offsetX:0,offsetY:0},allLayers,measure));
  let lo=.0001,hi=20;
  const small=bounds(lo);if(small.right-small.left>w||small.bottom-small.top>h)return null;
  // Bounding dimensions are monotone with scale. Reserve all annotation rows
  // even before a drop is released. A binary fit needs no physics or DOM mutation.
  for(let i=0;i<36;i++){
    const mid=(lo+hi)/2,b=bounds(mid);
    if(b.right-b.left<=w-4&&b.bottom-b.top<=h-4)lo=mid;else hi=mid;
  }
  const b=bounds(lo);
  return {...v,scale:lo,offsetX:(safe.left+safe.right-b.left-b.right)/2,offsetY:(safe.top+safe.bottom-b.top-b.bottom)/2};
}
export function capacitorInitialView(p:CapacitorMillikanParams,v:{width:number;height:number}){
  const full={...v,dpr:1,scale:1,offsetX:0,offsetY:0};
  const fit=fitCapacitorViewport(p,full,{left:30,right:v.width-30,top:28,bottom:v.height-28})??full;
  return {scale:fit.scale,offsetRatioX:fit.offsetX/v.width,offsetRatioY:fit.offsetY/v.height};
}
