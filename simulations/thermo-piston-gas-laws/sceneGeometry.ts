import type {DiagramPrimitive} from '@physforge/sim-sdk';
import {P_ATM, R_GAS, computeCylinderEquilibriumPressure, solveMercuryTiltState, type ThermoGasParams,type ThermoGasState} from './engine.js';
type Point={x:number;y:number};
type Region={points:Point[];role:'gas'|'mercury'|'piston'|'tank'};
export interface ThermoApparatus {
  primitives:DiagramPrimitive[];regions:Region[];
  forceOrigin?:Point;axis?:Point;normal?:Point;
  cylinder?:{bottom:number;pinY:number;gasY:number;maxVolumeL:number};
  tube?:{closed:Point;open:Point;airEnd:Point;mercuryEnd:Point;length:number};
}
const at=(a:Point,b:Point,h:number):Point=>({x:a.x+b.x*h,y:a.y+b.y*h});
function box(x:number,y:number,w:number,h:number):Point[]{return [{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}];}
export function makeThermoApparatus(s:ThermoGasState,p:ThermoGasParams):ThermoApparatus{
  const primitives:DiagramPrimitive[]=[],regions:Region[]=[];
  const text=(x:number,y:number,value:string)=>primitives.push({kind:'text',x,y,text:value,align:'middle'});
  const line=(a:Point,b:Point,dashed=false)=>primitives.push({kind:'line',x1:a.x,y1:a.y,x2:b.x,y2:b.y,dashed});
  const poly=(points:Point[],role:Region['role'])=>{regions.push({points,role});primitives.push({kind:'polyline',points,closed:true});};
  if(p.mode==='stop-pin-cylinder'){
    const x=-1.13,bottom=-.96,half=.48,top=1.06;
    const maxVolumeL=Math.max(p.pinVolumeL,s.volumeM3*1000,s.initialVolumeM3*1000,s.molesN*R_GAS*Math.max(p.initialTempK,p.targetTempK)*1000/computeCylinderEquilibriumPressure(p))*1.08;
    const scale=1.74/maxVolumeL,gasY=bottom+s.volumeM3*1000*scale,pinY=bottom+p.pinVolumeL*scale;
    poly(box(x-half,bottom,half*2,gasY-bottom),'gas');poly(box(x-half,gasY,half*2,.11),'piston');
    line({x:x-half,y:top},{x:x-half,y:bottom});line({x:x-half,y:bottom},{x:x+half,y:bottom});line({x:x+half,y:bottom},{x:x+half,y:top});
    line({x:x-half-.12,y:pinY},{x:x-half+.12,y:pinY});line({x:x+half-.12,y:pinY},{x:x+half+.12,y:pinY});
    line({x:x-half-.12,y:pinY-.045},{x:x-half+.12,y:pinY-.045});line({x:x+half-.12,y:pinY-.045},{x:x+half+.12,y:pinY-.045});
    text(x,1.35,'竖直汽缸 · 下限位');text(x,1.15,s.mode==='pinned'?'等容 · 卡口支持':'等压 · 活塞浮起');
    text(x,(bottom+gasY)/2,'V='+ (s.volumeM3*1000).toFixed(2)+' L');
    text(x,-1.19,'V₀='+p.pinVolumeL.toFixed(1)+' L  ·  T='+s.temperatureK.toFixed(1)+' K');
    return {primitives,regions,forceOrigin:{x,y:gasY+.055},cylinder:{bottom,pinY,gasY,maxVolumeL}};
  }
  if(p.mode==='mercury-tube-tilt'){
    const theta=p.tubeTiltDeg*Math.PI/180,axis={x:Math.cos(theta),y:Math.sin(theta)},normal={x:-Math.sin(theta),y:Math.cos(theta)};
    const center={x:-1.15,y:.01},length=1.80,half=.105;
    const closed=at(center,axis,-length/2),open=at(center,axis,length/2);
    const airEnd=at(closed,axis,length*s.airColumnCm/p.tubeLengthCm),mercuryEnd=at(closed,axis,length*(s.airColumnCm+s.mercuryColumnCm)/p.tubeLengthCm);
    const section=(a:Point,b:Point,w:number)=>[at(a,normal,-w),at(b,normal,-w),at(b,normal,w),at(a,normal,w)];
    poly(section(closed,airEnd,half-.012),'gas');poly(section(airEnd,mercuryEnd,half-.012),'mercury');
    line(at(closed,normal,-half),at(closed,normal,half));line(at(closed,normal,-half),at(open,normal,-half));line(at(closed,normal,half),at(open,normal,half));
    const mercuryCenter=at(airEnd,axis,length*s.mercuryColumnCm/(2*p.tubeLengthCm));
    text(-1.15,1.35,'等温倾管 · θ='+p.tubeTiltDeg.toFixed(0)+'°');
    text(-1.15,1.15,s.overflowed?'溢出后的独立平衡':'无溢出 · 封闭气体');
    text(-1.15,-1.05,'l='+s.airColumnCm.toFixed(2)+' cm  h='+s.mercuryColumnCm.toFixed(2)+' cm');
    text(-1.15,-1.24,'溢出 '+s.spilledMercuryCm.toFixed(2)+' cm · L='+p.tubeLengthCm.toFixed(0)+' cm');
    // Draw the reference direction outside the tube, without closing its open end.
    const guide=at(center,normal,.20);
    line(at(guide,axis,-length/2),at(guide,axis,length/2),true);
    return {primitives,regions,forceOrigin:mercuryCenter,axis,normal,tube:{closed,open,airEnd,mercuryEnd,length}};
  }
  const tank={x:-2.04,y:-.44,w:.86,h:1.00},chamber={x:-.85,y:-.39,w:.52,h:.89};
  poly(box(tank.x,tank.y,tank.w,tank.h),'tank');poly(box(chamber.x,chamber.y,chamber.w,chamber.h),'gas');
  line({x:tank.x+tank.w,y:.03},{x:chamber.x,y:.03});
  line({x:chamber.x+chamber.w/2,y:chamber.y+chamber.h},{x:chamber.x+chamber.w/2,y:.83});
  line({x:chamber.x-.03,y:.83},{x:chamber.x+chamber.w+.03,y:.83});
  line({x:chamber.x-.02,y:.51},{x:chamber.x+chamber.w+.02,y:.51});
  const ex=p.pumpDirection==='extract';
  primitives.push({kind:'arrow',x1:ex?-1.18:-.85,y1:.23,x2:ex?-.85:-1.18,y2:.23});
  text(-1.15,1.35,ex?'定容储气罐 · 理想抽气':'定容储气罐 · 理想打气');
  text(-1.15,1.15,'操作方向示意 · 非瞬态流动');
  text(tank.x+tank.w/2,.2,'储气罐');text(tank.x+tank.w/2,-.08,p.tankVolumeL.toFixed(1)+' L');
  text(chamber.x+chamber.w/2,-.65,'气筒 ΔV');
  text(chamber.x+chamber.w/2,-.82,p.pumpDeltaVL.toFixed(1)+' L');
  text(-1.15,-1.07,'第 '+s.pumpStages.at(-1)!.k+' 次操作后 · '+(s.pressurePa/1000).toFixed(2)+' kPa');
  text(-1.15,-1.25,'装置示意 · 体积不按图示比例');
  return {primitives,regions};
}
export interface ThermoPlot{
  points:Point[];current:Point;raw:Point[];xMax:number;yMax:number;xLabel:string;yLabel:string;title:string;
  kind:'pv-path'|'equilibrium-scan'|'discrete-strokes';primitives:DiagramPrimitive[];
}
function niceMax(value:number):number{
  if(!(value>0)||!Number.isFinite(value))return 1;
  const p=10**Math.floor(Math.log10(value)),q=value/p;
  return (q<=1?1:q<=2?2:q<=5?5:10)*p;
}
export function makeThermoPlot(s:ThermoGasState,p:ThermoGasParams):ThermoPlot{
  let raw:Point[],current:Point,kind:ThermoPlot['kind'],xLabel:string,title:string,xLimit=0,yLimit=0;
  if(p.mode==='multi-stroke-pump'){
    kind='discrete-strokes';xLabel='操作级次 k';title='每次操作后的压强 · 离散状态';
    raw=s.pumpStages.map(q=>({x:q.k,y:q.pressurePa/1000}));current=raw.at(-1)!;
    xLimit=Math.max(1,current.x);
  }else if(p.mode==='mercury-tube-tilt'){
    kind='equilibrium-scan';xLabel='V / L';title='同一水平初态 · 等温平衡扫描';
    raw=Array.from({length:61},(_,i)=>{const m=solveMercuryTiltState({...p,tubeTiltDeg:-90+3*i});return {x:m.airCm*.01*p.pistonAreaCm2*1e-4*1000,y:m.pressurePa/1000};}).sort((a,b)=>a.x-b.x);
    current={x:s.volumeM3*1000,y:s.pressurePa/1000};
  }else{
    kind='pv-path';xLabel='V / L';title='实际 P-V 路径 · 气体对外做功';
    raw=s.pvHistory.map(q=>({x:q.vL,y:q.pKPa}));current={x:s.volumeM3*1000,y:s.pressurePa/1000};
    const peq=computeCylinderEquilibriumPressure(p),maxT=Math.max(p.initialTempK,p.targetTempK);
    xLimit=Math.max(p.pinVolumeL,s.molesN*R_GAS*maxT/peq*1000);yLimit=peq/1000;
  }
  const xMax=kind==='discrete-strokes'?Math.max(1,current.x+1):niceMax(Math.max(xLimit,current.x,...raw.map(q=>q.x))*1.02),yMax=niceMax(Math.max(yLimit,current.y,...raw.map(q=>q.y))*1.02);
  const x0=.37,x1=2.13,y0=-.80,y1=.88;
  const map=(q:Point):Point=>({x:x0+(x1-x0)*q.x/xMax,y:y0+(y1-y0)*q.y/yMax});
  const points=raw.map(map),now=map(current),primitives:DiagramPrimitive[]=[];
  const line=(a:Point,b:Point,dashed=false)=>primitives.push({kind:'line',x1:a.x,y1:a.y,x2:b.x,y2:b.y,dashed});
  const label=(x:number,y:number,text:string,align:'start'|'middle'|'end'='middle')=>primitives.push({kind:'text',x,y,text,align});
  line({x:x0,y:y0},{x:x1,y:y0});line({x:x0,y:y0},{x:x0,y:y1});
  for(let i=0;i<=4;i++){
    const x=x0+(x1-x0)*i/4,y=y0+(y1-y0)*i/4;
    if(kind!=='discrete-strokes'){line({x,y:y0},{x,y:y0-.04});label(x,y0-.13,(xMax*i/4).toFixed(xMax<2?2:1));}
    line({x:x0-.035,y},{x:x0,y});
    label(x0-.07,y,(yMax*i/4).toFixed(yMax<10?1:0),'end');
    if(i>0)line({x:x0,y},{x:x1,y},true);
  }
  if(kind==='discrete-strokes'){
    const step=xMax>6?2:1;
    for(let k=0;k<=xMax;k+=step){const x=map({x:k,y:0}).x;line({x,y:y0},{x,y:y0-.04});label(x,y0-.13,String(k));}
  }
  label((x0+x1)/2,-1.10,xLabel);label(x0-.01,1.03,'P / kPa','start');label((x0+x1)/2,1.35,title);
  if(points.length>1&&kind!=='discrete-strokes')primitives.push({kind:'polyline',points,dashed:kind==='equilibrium-scan'});
  if(kind==='discrete-strokes')for(const q of points)primitives.push({kind:'circle',cx:q.x,cy:q.y,r:.025,fill:true});
  primitives.push({kind:'circle',cx:now.x,cy:now.y,r:.037,fill:true});
  if(kind==='pv-path')label((x0+x1)/2,1.14,'W = '+(s.workByGasJ??0).toFixed(2)+' J');
  else if(kind==='equilibrium-scan')label((x0+x1)/2,1.14,'p·l = p₀·l₀');
  else label((x0+x1)/2,1.14,'n = '+s.molesN.toFixed(4)+' mol');
  return {points,current:now,raw,xMax,yMax,xLabel,yLabel:'P / kPa',title,kind,primitives};
}
export function thermoControl(p:ThermoGasParams){
  const y=p.mode==='mercury-tube-tilt'?p.tubeTiltDeg/90:p.mode==='multi-stroke-pump'?(p.pumpStrokesK-5)/5:(p.targetTempK-400)/200;
  return {position:{x:-.025,y},label:p.mode==='mercury-tube-tilt'?'θ='+p.tubeTiltDeg+'°':p.mode==='multi-stroke-pump'?'k='+Math.round(p.pumpStrokesK):'T目标='+p.targetTempK+' K'};
}
