import { createWorldMapper, type DiagramPrimitive, type DiagramIR, type Viewport } from '@physforge/sim-sdk';
import { DIVIDER_RESISTANCE, dividerLowerResistance, sampleDividerLampIvCurve, type CircuitParams, type CircuitState } from './engine.js';
import {drawLampGlass,drawLampCross,drawCircuitMeterFace,drawWiperContact} from './visualStyle.js';

type Point = { x: number; y: number };
const pt=(x:number,y:number):Point=>({x,y});
const X_SOURCE=-2.05, X_WIPER=.17, Y_TOP=1.427, Y_BOTTOM=-1.093;
const X_TURN=.57, Y_LAMP=.40, X_A=1.00, X_LAMP=1.77, X_POS=1.36, X_NEG=2.20, Y_V=1.02;
const A_R=.16, L_R=.18, V_R=.16, BATTERY_Y=.167, GAP=.075;

/** Exact world-space slider geometry shared by Canvas, drag and DiagramIR. */
export function dividerWiperY(sliderR:number):number {
  return Y_BOTTOM+(Y_TOP-Y_BOTTOM)*dividerLowerResistance(sliderR)/DIVIDER_RESISTANCE;
}
export function dividerRFromY(y:number):number {
  return dividerLowerResistance((y-Y_BOTTOM)/(Y_TOP-Y_BOTTOM)*DIVIDER_RESISTANCE);
}
export const dividerWiperX=X_WIPER;
/** Keep the text inside the circuit, away from the top/bottom supply wires.
 * The wiper and its hit target retain the exact physical endpoint. */
export function dividerWiperLabelAnchor(sliderR:number):Point {
  return pt(X_WIPER-.35,Math.max(Y_BOTTOM+.28,Math.min(Y_TOP-.28,dividerWiperY(sliderR))));
}
export function dividerDefaultCamera(width:number,height:number,reserveInspector=true):{scale:number;offsetRatioX:number;offsetRatioY:number} {
  const base=Math.max(1,Math.min(width,height)*.24);
  const usable=width-(reserveInspector&&width>=900?300:0);
  const scale=Math.max(.1,Math.min(1.05,(usable-36)/(5.0*base),(height-125)/(3.6*base)));
  return {scale,offsetRatioX:(usable/2-(reserveInspector?.10:.075)*base*scale)/Math.max(1,width)-.45,offsetRatioY:-.035};
}

export function dividerPotentialColor(v:number,emf:number,paper=false):string {
  // A neutral highlight between cyan and amber avoids a misleading green band.
  const stops=paper?[[7,89,133],[71,85,105],[146,64,14],[185,28,28]]:[[103,232,249],[211,219,217],[255,199,111],[255,125,119]];
  const t=emf>1e-9?Math.max(0,Math.min(1,v/emf)):0;
  const n=t<.25?0:t<.5?1:2,k=t<.25?t*4:t<.5?(t-.25)*4:(t-.5)*2;
  const a=stops[n]!,b=stops[n+1]!;
  return '#'+a.map((x,i)=>Math.round(x+(b[i]!-x)*k).toString(16).padStart(2,'0')).join('');
}

function geometry(sliderR:number) {
  const w=dividerWiperY(sliderR);
  return {
    sourceTop:pt(X_SOURCE,Y_TOP),sourceBottom:pt(X_SOURCE,Y_BOTTOM),
    rStart:pt(-1.60,Y_TOP),rEnd:pt(-.75,Y_TOP),
    sliderTop:pt(X_WIPER,Y_TOP),sliderBottom:pt(X_WIPER,Y_BOTTOM),wiper:pt(X_WIPER,w),
    branchIn:[pt(X_WIPER,w),pt(X_TURN,w),pt(X_TURN,Y_LAMP),pt(X_A-A_R,Y_LAMP)],
    afterA:[pt(X_A+A_R,Y_LAMP),pt(X_POS,Y_LAMP),pt(X_LAMP-L_R,Y_LAMP)],
    lampReturn:[pt(X_LAMP+L_R,Y_LAMP),pt(X_NEG,Y_LAMP),pt(X_NEG,Y_BOTTOM),pt(X_WIPER,Y_BOTTOM)],
    groundReturn:[pt(X_WIPER,Y_BOTTOM),pt(X_SOURCE,Y_BOTTOM)],
    vIn:[pt(X_POS,Y_LAMP),pt(X_POS,Y_V),pt(X_LAMP-V_R,Y_V)],
    vOut:[pt(X_LAMP+V_R,Y_V),pt(X_NEG,Y_V),pt(X_NEG,Y_LAMP)],
    a:pt(X_A,Y_LAMP),lamp:pt(X_LAMP,Y_LAMP),v:pt(X_LAMP,Y_V)
  };
}

/** Ideal A is in the lamp branch and ideal V is across the lamp only. */
export function exportDividerDiagram(params:CircuitParams):DiagramIR {
  const g=geometry(params.sliderR),primitives:DiagramPrimitive[]=[];
  const line=(a:Point,b:Point)=>{if(Math.hypot(a.x-b.x,a.y-b.y)>1e-9)primitives.push({kind:'line',x1:a.x,y1:a.y,x2:b.x,y2:b.y});};
  const path=(points:Point[])=>{for(let i=1;i<points.length;i++)line(points[i-1]!,points[i]!);};
  const element=(name:'resistor'|'battery'|'ammeter'|'voltmeter'|'lamp',a:Point,b:Point,label:string)=>primitives.push({kind:'circuitElement',element:name,x1:a.x,y1:a.y,x2:b.x,y2:b.y,label});
  element('battery',g.sourceBottom,g.sourceTop,'E='+params.emf+'V');
  line(g.sourceTop,g.rStart);element('resistor',g.rStart,g.rEnd,'r='+params.internalR+'Ω');line(g.rEnd,g.sliderTop);
  const rd=dividerLowerResistance(params.sliderR),ru=DIVIDER_RESISTANCE-rd;
  if(ru>0)element('resistor',g.sliderTop,g.wiper,'R上='+ru+'Ω');
  if(rd>0)element('resistor',g.wiper,g.sliderBottom,'R下='+rd+'Ω');
  path(g.branchIn);element('ammeter',pt(X_A-A_R,Y_LAMP),pt(X_A+A_R,Y_LAMP),'A');
  path(g.afterA);element('lamp',pt(X_LAMP-L_R,Y_LAMP),pt(X_LAMP+L_R,Y_LAMP),'L');
  path(g.lampReturn);path(g.groundReturn);path(g.vIn);
  element('voltmeter',pt(X_LAMP-V_R,Y_V),pt(X_LAMP+V_R,Y_V),'V');path(g.vOut);
  for(const p of [g.wiper,g.sliderBottom,pt(X_POS,Y_LAMP),pt(X_NEG,Y_LAMP)])primitives.push({kind:'circle',cx:p.x,cy:p.y,r:.025,fill:true});
  line(g.sliderBottom,pt(X_WIPER,Y_BOTTOM-.10));
  for(let i=0;i<3;i++){const y=Y_BOTTOM-.10-i*.045,w=.12-i*.035;line(pt(X_WIPER-w,y),pt(X_WIPER+w,y));}
  return {width:820,height:500,viewBox:{minX:-2.65,minY:-1.45,maxX:2.7,maxY:1.85},title:'分压电路测小灯泡伏安特性（理想表）',primitives};
}

export function renderDivider(ctx:CanvasRenderingContext2D,state:CircuitState,params:CircuitParams,viewport:Viewport,layers:ReadonlySet<string>):void {
  if(!layers.has('schematic'))return;
  const m=createWorldMapper(viewport),s=(p:Point)=>m.toScreen(p.x,p.y),len=(v:number)=>m.len(v),g=geometry(params.sliderR);
  const paper=viewport.theme==='projector',source=state.nodeVoltages[1]??params.emf,lamp=state.terminalVoltage;
  const terminal=state.divider?.sourceTerminalVoltage??(source-state.totalCurrent*params.internalR);
  const high=dividerPotentialColor(source,params.emf,paper),mid=dividerPotentialColor(terminal,params.emf,paper),tap=dividerPotentialColor(lamp,params.emf,paper),low=dividerPotentialColor(0,params.emf,paper);
  const ink=paper?'#334155':'#dce6ef',warm=paper?'#92400e':'#ffd89c';
  const f=Math.max(10,Math.min(17,len(.085)));
  const wireWidth=Math.max(2.5,Math.min(6,len(.028)));
  function trace(points:Point[],from:string,to=from,width=wireWidth) {
    const ps=points.map(s),first=ps[0]!,last=ps.at(-1)!;
    ctx.save();ctx.lineJoin='round';ctx.lineCap='round';
    let paint:string|CanvasGradient=from;
    if(from!==to&&Math.hypot(last.x-first.x,last.y-first.y)>1e-6){
      paint=ctx.createLinearGradient(first.x,first.y,last.x,last.y);paint.addColorStop(0,from);paint.addColorStop(1,to);
    }
    ctx.strokeStyle=paint;ctx.beginPath();ctx.moveTo(first.x,first.y);
    for(const p of ps.slice(1))ctx.lineTo(p.x,p.y);
    if(!paper){ctx.shadowColor=from;ctx.shadowBlur=17;ctx.lineWidth=width*1.40;ctx.globalAlpha=.18;ctx.stroke();}
    ctx.shadowBlur=paper?0:5;ctx.globalAlpha=1;ctx.lineWidth=width;ctx.stroke();
    if(!paper){ctx.shadowBlur=0;ctx.strokeStyle='rgba(255,255,255,.19)';ctx.lineWidth=Math.max(.6,width*.32);ctx.stroke();}
    ctx.restore();
  }
  function resistor(a:Point,b:Point,c1:string,c2:string) {
    const dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy);if(d<1e-8)return;
    const amp=Math.min(.062,d*.18),nx=-dy/d,ny=dx/d;
    const points=[a];
    for(let i=1;i<9;i++){const t=i/9,off=i%2?amp:-amp;points.push(pt(a.x+dx*t+nx*off,a.y+dy*t+ny*off));}
    points.push(b);trace(points,c1,c2,wireWidth*.78);
  }
  function label(p:Point,text:string,color=ink,size=f) {
    const q=s(p);ctx.save();ctx.font='500 '+size+'px system-ui, sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.strokeStyle=paper?'rgba(255,255,255,.95)':'rgba(12,17,23,.88)';ctx.lineWidth=3;ctx.lineJoin='round';ctx.strokeText(text,q.x,q.y);
    ctx.fillStyle=color;ctx.fillText(text,q.x,q.y);ctx.restore();
  }
  function node(p:Point,color:string,r=.023) {
    const q=s(p);ctx.save();ctx.fillStyle=color;ctx.shadowColor=color;ctx.shadowBlur=paper?0:10;
    ctx.beginPath();ctx.arc(q.x,q.y,len(r),0,Math.PI*2);ctx.fill();ctx.restore();
  }
  function meter(p:Point,r:number,value:number,unit:string,color:string) {
    const q=s(p),rr=len(r);ctx.save();
    drawCircuitMeterFace(ctx,q,rr,color,paper);
    ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle=ink;ctx.font='600 '+Math.max(8,Math.min(18,rr*.54))+'px system-ui, sans-serif';
    ctx.fillText(value.toFixed(2),q.x,q.y-rr*.13);ctx.fillStyle=color;ctx.font='500 '+Math.max(8,rr*.39)+'px system-ui, sans-serif';ctx.fillText(unit,q.x,q.y+rr*.48);ctx.restore();
  }
  function arrow(a:Point,b:Point,current:number,color:string) {
    const d=Math.hypot(b.x-a.x,b.y-a.y);
    if(!layers.has('current-flow')||Math.abs(current)<1e-6||d<.17)return;
    const direction=Math.sign(current),u=(b.x-a.x)/d*direction,v=(b.y-a.y)/d*direction;
    // Fixed number per segment and deterministic simulation-time phase. No
    // current arrows are drawn on the ideal voltmeter branch.
    const phase=((state.t*.55*Math.tanh(Math.abs(current))+0.12)%1+1)%1;
    const t=direction>0?.22+.56*phase:.78-.56*phase;
    const q=s(pt(a.x+(b.x-a.x)*t,a.y+(b.y-a.y)*t)),head=len(.048),half=len(.032);
    ctx.save();ctx.fillStyle=color;ctx.shadowColor=color;ctx.shadowBlur=paper?0:9;ctx.beginPath();ctx.moveTo(q.x+u*head,q.y-v*head);
    ctx.lineTo(q.x-u*head-v*half,q.y+v*head-u*half);ctx.lineTo(q.x-u*head+v*half,q.y+v*head+u*half);ctx.closePath();ctx.fill();ctx.restore();
  }
  function flow(points:Point[],current:number,color:string) {for(let i=1;i<points.length;i++)arrow(points[i-1]!,points[i]!,current,color);}
  ctx.save();
  // Ideal source, internal resistor, and 20-ohm divider.
  trace([g.sourceTop,g.rStart],high);resistor(g.rStart,g.rEnd,high,mid);trace([g.rEnd,g.sliderTop],mid);
  trace([g.sourceTop,pt(X_SOURCE,BATTERY_Y+GAP)],high);trace([pt(X_SOURCE,BATTERY_Y-GAP),g.sourceBottom],low);
  trace([pt(X_SOURCE-.12,BATTERY_Y+GAP),pt(X_SOURCE+.12,BATTERY_Y+GAP)],high);
  trace([pt(X_SOURCE-.072,BATTERY_Y-GAP),pt(X_SOURCE+.072,BATTERY_Y-GAP)],low);
  resistor(g.sliderTop,g.wiper,mid,tap);resistor(g.wiper,g.sliderBottom,tap,low);
  trace(g.branchIn,tap);trace(g.afterA,tap);trace(g.lampReturn,low);trace(g.groundReturn,low);
  if(layers.has('meters')){
    trace(g.vIn,tap, tap,wireWidth*.68);trace(g.vOut,low,low,wireWidth*.68);
    meter(g.a,A_R,state.branchCurrent2,'A',tap);
    meter(g.v,V_R,lamp,'V',paper?'#475569':'#a3c2d1');
  }else trace([pt(X_A-A_R,Y_LAMP),pt(X_A+A_R,Y_LAMP)],tap);
  // Standard two-terminal lamp symbol, distinct from the adjacent resistor
  // zigzag. The connected leads already terminate on the original ring.
  const q=s(g.lamp),rr=len(L_R);
  drawLampGlass(ctx,q,rr,state.outputPower,paper);
  drawLampCross(ctx,q,rr,state.outputPower,paper);
  // Junctions mark only actual connections, not nearby labels.
  drawWiperContact(ctx,s(g.wiper),Math.max(3,len(.050)),tap,paper);
  for(const p of [g.sliderBottom])node(p,low);
  if(layers.has('meters')){node(pt(X_POS,Y_LAMP),tap);node(pt(X_NEG,Y_LAMP),low);}
  trace([g.sliderBottom,pt(X_WIPER,Y_BOTTOM-.10)],low,low,wireWidth*.5);
  for(let i=0;i<3;i++){const y=Y_BOTTOM-.10-i*.045,w=.12-i*.035;trace([pt(X_WIPER-w,y),pt(X_WIPER+w,y)],low,low,wireWidth*.5);}
  arrow(g.sourceBottom,pt(X_SOURCE,BATTERY_Y-GAP),state.totalCurrent,low);
  arrow(pt(X_SOURCE,BATTERY_Y+GAP),g.sourceTop,state.totalCurrent,high);
  arrow(g.sourceTop,g.rStart,state.totalCurrent,high);arrow(g.rEnd,g.sliderTop,state.totalCurrent,mid);
  flow(g.branchIn,state.branchCurrent2,tap);flow(g.lampReturn,state.branchCurrent2,low);flow(g.groundReturn,state.totalCurrent,low);
  // Fixed label lanes leave both branches and the wiper readable at endpoints.
  label(pt(X_SOURCE+.46,BATTERY_Y+.17),'E = '+params.emf.toFixed(1)+' V',high);
  label(pt(-1.175,Y_TOP+.16),'r = '+params.internalR.toFixed(1)+' Ω',ink);
  label(pt(-.96,.95),'R上 '+(DIVIDER_RESISTANCE-dividerLowerResistance(params.sliderR)).toFixed(1)+' Ω');
  label(pt(-.96,.73),'R下 '+dividerLowerResistance(params.sliderR).toFixed(1)+' Ω');
  label(pt(-.96,-.25),'I总 = '+state.totalCurrent.toFixed(2)+' A',mid);
  label(pt(-.96,-.48),'I下 = '+state.branchCurrent1.toFixed(2)+' A',tap);
  label(dividerWiperLabelAnchor(params.sliderR),'滑片 '+(dividerLowerResistance(params.sliderR)*5).toFixed(0)+'%',warm,Math.max(9,f*.84));
  label(pt(X_LAMP,Y_LAMP-.29),'P灯 = '+state.outputPower.toFixed(2)+' W',warm,Math.max(10,f*.88));
  if(layers.has('potential-labels')){
    label(pt(X_SOURCE+.23,Y_TOP+.16),source.toFixed(2)+' V',high);
    label(pt(X_WIPER+.12,Y_TOP+.16),terminal.toFixed(2)+' V',mid);
    label(pt(.88,Y_LAMP+.26),lamp.toFixed(2)+' V',tap,Math.max(9,f*.86));
    label(pt(-.90,Y_BOTTOM-.14),'0.00 V',low);
  }
  // Actual I(U) law and operating point, in a dedicated lane inside the loop.
  const c1=s(pt(.70,-.02)),c2=s(pt(2.12,-.90)),w=c2.x-c1.x,h=c2.y-c1.y;
  const card=ctx.createLinearGradient(c1.x,c1.y,c2.x,c2.y);card.addColorStop(0,paper?'#fff':'#394049');card.addColorStop(1,paper?'#eef2f6':'#20262e');
  ctx.fillStyle=card;ctx.strokeStyle=paper?'#94a3b8':'#5c6570';ctx.lineWidth=1;ctx.beginPath();ctx.roundRect(c1.x,c1.y,w,h,Math.max(3,len(.06)));ctx.fill();ctx.stroke();
  const plotLeft=c1.x+w*.20,plotRight=c1.x+w*.90,plotTop=c1.y+h*.28,plotBottom=c1.y+h*.78;
  const maxU=Math.max(1,params.emf),samples=sampleDividerLampIvCurve(maxU,48),maxI=Math.max(.001,samples.at(-1)!.i);
  const cp=(u:number,i:number)=>pt(plotLeft+(plotRight-plotLeft)*u/maxU,plotBottom-(plotBottom-plotTop)*i/maxI);
  ctx.strokeStyle=paper?'#64748b':'#8b99a6';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(plotLeft,plotTop);ctx.lineTo(plotLeft,plotBottom);ctx.lineTo(plotRight,plotBottom);ctx.stroke();
  const curve=ctx.createLinearGradient(plotLeft,plotBottom,plotRight,plotTop);curve.addColorStop(0,low);curve.addColorStop(.5,dividerPotentialColor(maxU*.5,maxU,paper));curve.addColorStop(1,dividerPotentialColor(maxU,maxU,paper));
  const area=ctx.createLinearGradient(0,plotTop,0,plotBottom);area.addColorStop(0,paper?'rgba(146,64,14,.15)':'rgba(255,155,106,.22)');area.addColorStop(1,'rgba(103,232,249,.035)');
  ctx.fillStyle=area;ctx.beginPath();ctx.moveTo(plotLeft,plotBottom);samples.forEach(p=>{const q=cp(p.u,p.i);ctx.lineTo(q.x,q.y);});ctx.lineTo(plotRight,plotBottom);ctx.closePath();ctx.fill();
  ctx.strokeStyle=curve;ctx.lineWidth=Math.max(1.5,len(.015));ctx.beginPath();samples.forEach((p,i)=>{const q=cp(p.u,p.i);if(i===0)ctx.moveTo(q.x,q.y);else ctx.lineTo(q.x,q.y);});ctx.stroke();
  const op=cp(lamp,state.branchCurrent2);ctx.fillStyle=warm;ctx.beginPath();ctx.arc(op.x,op.y,Math.max(2,len(.023)),0,Math.PI*2);ctx.fill();
  ctx.font='500 '+Math.max(8,Math.min(12,len(.065)))+'px system-ui, sans-serif';ctx.textBaseline='middle';ctx.textAlign='left';ctx.fillStyle=ink;
  ctx.fillText('I–U 模型曲线',c1.x+w*.10,c1.y+h*.11);ctx.fillText('I/A',c1.x+w*.025,plotTop-h*.08);ctx.fillText(maxI.toFixed(2),c1.x+w*.025,plotTop);
  ctx.fillText('0',plotLeft-w*.07,plotBottom+h*.09);ctx.textAlign='right';ctx.fillText(maxU.toFixed(0)+' U/V',plotRight,plotBottom+h*.10);
  ctx.restore();
}
