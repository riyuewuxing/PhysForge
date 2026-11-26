import type { DiagramIR, DiagramPrimitive } from '@physforge/sim-sdk';
import type { ElectricalErrorParams, ElectricalErrorState } from './engine.js';

export type Role='ink'|'muted'|'reference'|'fit'|'measured'|'selected';
type Item={role:Role; primitive:DiagramPrimitive};
type Point={x:number;y:number};
const pt=(x:number,y:number):Point=>({x,y});
export const CALIPER_ZERO_X=-1.85, CALIPER_MM_WORLD=.034, CALIPER_RULER_Y=.76;
export const MICRO_ZERO_X=-1.85, MICRO_MM_WORLD=.082, MICRO_RULER_Y=-.94;
export const caliperX=(mm:number)=>CALIPER_ZERO_X+mm*CALIPER_MM_WORLD;
export const microX=(mm:number)=>MICRO_ZERO_X+mm*MICRO_MM_WORLD;
const fmt=(n:number,d=3)=>Number(n.toFixed(d)).toString();
const nice=(max:number)=>{const raw=Math.max(1e-9,max/5),p=10**Math.floor(Math.log10(raw)),v=raw/p;return (v<=1?1:v<=2?2:v<=5?5:10)*p;};
type Element=Extract<DiagramPrimitive,{kind:'circuitElement'}>['element'];

export function electricalItems(s:ElectricalErrorState,q:ElectricalErrorParams):Item[]{
  const items:Item[]=[];
  const add=(primitive:DiagramPrimitive,role:Role='ink')=>items.push({role,primitive});
  const line=(x1:number,y1:number,x2:number,y2:number,role:Role='ink',dashed=false,strokeWidth?:number)=>{if(Math.hypot(x2-x1,y2-y1)>1e-12)add({kind:'line',x1,y1,x2,y2,dashed,...(strokeWidth===undefined?{}:{strokeWidth})},role);};
  const text=(x:number,y:number,value:string,role:Role='ink',align:'start'|'middle'|'end'='middle')=>add({kind:'text',x,y,text:value,align},role);
  const dot=(x:number,y:number,role:Role='selected',r=.022)=>add({kind:'circle',cx:x,cy:y,r,fill:true},role);
  const element=(e:Element,a:Point,b:Point)=>add({kind:'circuitElement',element:e,x1:a.x,y1:a.y,x2:b.x,y2:b.y});
  const rect=(x:number,y:number,width:number,height:number,role:Role='muted')=>add({kind:'rect',x,y,width,height},role);
  const T=1.30,B=.32,L=-1.73,R=1.73;
  function supply(E:number){
    // The first terminal of the shared SVG battery primitive is its long (+) plate.
    element('battery',pt(L,T),pt(L,B));text(L+.27,.83,'E='+fmt(E,2)+' V','ink','start');
    line(L,B,R,B);
  }
  function axes(xMax:number,yMax:number,xLabel:string,yLabel:string){
    const l=-1.72,r=1.62,b=-1.40,t=-.20;
    const dx=nice(xMax),dy=nice(yMax),xm=Math.ceil(xMax/dx)*dx,ym=Math.ceil(yMax/dy)*dy;
    const map=(x:number,y:number)=>pt(l+x/xm*(r-l),b+y/ym*(t-b));
    add({kind:'arrow',x1:l,y1:b,x2:r+.11,y2:b});
    add({kind:'arrow',x1:l,y1:b,x2:l,y2:t+.10});
    text(r+.08,b-.17,xLabel,'ink','end');text(l,t+.16,yLabel,'ink','start');
    for(let i=0;i<=Math.round(xm/dx);i++){
      const p=map(i*dx,0);line(p.x,b-.02,p.x,b+.02);text(p.x,b-.085,fmt(i*dx),'muted');
    }
    for(let i=0;i<=Math.round(ym/dy);i++){
      const p=map(0,i*dy);line(l-.02,p.y,l+.02,p.y);text(l-.06,p.y,fmt(i*dy),'muted','end');
    }
    return {map,xm,ym};
  }
  if(q.mode==='emf-inner-outer'){
    supply(q.emfVolts);
    const nT=-.82,a0=-.53,nL=.43;
    element('resistor',pt(L,T),pt(nT,T));text((L+nT)/2,T+.16,'r='+fmt(q.rInternalOhm)+' Ω');
    line(nT,T,a0,T);element('ammeter',pt(a0,T),pt(nL,T));text((a0+nL)/2,T+.16,'R_A='+fmt(q.rAmmeterOhm)+' Ω');
    line(nL,T,R,T);element('resistor',pt(R,T),pt(R,B));text(R-.15,.83,'R_L','ink','end');
    const vx=q.emfWiring==='voltmeter-across-source'?nT:.82;
    element('voltmeter',pt(vx,T),pt(vx,B));text(vx+.15,.58,'R_V='+fmt(q.rVoltmeterOhm)+' Ω','ink','start');
    dot(vx,T,'ink');dot(vx,B,'ink');
    const e=s.emfSummary;
    text(0,.04,'真值 E='+fmt(q.emfVolts)+' V  r='+fmt(q.rInternalOhm)+' Ω    拟合 E='+fmt(e.eFittedV,4)+' V  r='+fmt(e.rFittedOhm,4)+' Ω','selected');
    const xmax=Math.max(.1,...e.uiCurve.map(p=>p.currentA))*1.1;
    const a=axes(xmax,Math.max(q.emfVolts,e.eFittedV),'I / A','U / V');
    const end=Math.min(a.xm,e.eFittedV/e.rFittedOhm);
    const refEnd=Math.min(a.xm,q.emfVolts/q.rInternalOhm);
    add({kind:'polyline',points:[a.map(0,q.emfVolts),a.map(refEnd,Math.max(0,q.emfVolts-q.rInternalOhm*refEnd))],dashed:true},'reference');
    add({kind:'polyline',points:[a.map(0,e.eFittedV),a.map(end,Math.max(0,e.eFittedV-e.rFittedOhm*end))]},'fit');
    for(const p of e.uiCurve){const d=a.map(p.currentA,p.voltageV);dot(d.x,d.y,'measured',.027);}
    line(-1.65,-1.75,-1.42,-1.75,'reference',true);text(-1.35,-1.75,'理想参照','reference','start');
    line(-.48,-1.75,-.25,-1.75,'fit');text(-.18,-1.75,'实测拟合','fit','start');
    dot(.83,-1.75,'measured');text(.9,-1.75,'MNA 测点','measured','start');
  }else if(q.mode==='bulb-iv-curve'){
    const f=s.bulbOperatingPoint.tap;
    supply(q.emfVolts);
    if(q.bulbWiring==='voltage-divider'){
      const x=-.25,y=.81,rt=(1-f)*q.rheostatMaxOhm,rb=f*q.rheostatMaxOhm;
      line(L,T,x,T);
      if(rt>0)element('resistor',pt(x,T),pt(x,y));else line(x,T,x,y);
      if(rb>0)element('resistor',pt(x,y),pt(x,B));else line(x,y,x,B);
      text(x-.13,1.10,'R上='+fmt(rt)+' Ω','ink','end');text(x-.13,.52,'R下='+fmt(rb)+' Ω','ink','end');
      line(x,y,R,y);element('lamp',pt(R,y),pt(R,B));dot(x,y,'selected');dot(x,B,'ink');
      text(R-.15,.56,'L','ink','end');
    }else{
      const rs=(1-f)*q.rheostatMaxOhm;
      if(rs>0)element('resistor',pt(L,T),pt(R,T));else line(L,T,R,T);
      text(0,T+.16,'R串='+fmt(rs)+' Ω');element('lamp',pt(R,T),pt(R,B));text(R-.15,.83,'L','ink','end');
    }
    const o=s.bulbOperatingPoint,pts=s.bulbCurve;
    text(0,.04,'滑片 '+fmt(100*f,1)+'%   U='+fmt(o.voltageV,4)+' V   I='+fmt(o.currentA,4)+' A   P='+fmt(o.voltageV*o.currentA,4)+' W','selected');
    const a=axes(Math.max(q.emfVolts,...pts.map(p=>p.voltageV)),Math.max(.01,...pts.map(p=>p.currentA)),'U / V','I / A');
    // The current sweep is a control-accessible locus, not a fabricated interpolation measurement.
    add({kind:'polyline',points:pts.map(p=>a.map(p.voltageV,p.currentA))},'fit');
    for(const p of pts){const v=a.map(p.voltageV,p.currentA);dot(v.x,v.y,'measured',.020);}
    const v=a.map(o.voltageV,o.currentA);add({kind:'circle',cx:v.x,cy:v.y,r:.055},'selected');
    dot(v.x,v.y,'selected',.029);
    line(-1.58,-1.75,-1.33,-1.75,'fit');text(-1.25,-1.75,'可调范围','fit','start');
    dot(-.1,-1.75,'measured');text(-.03,-1.75,'扫测点','measured','start');
    add({kind:'circle',cx:.88,cy:-1.75,r:.05},'selected');text(.98,-1.75,'当前工作点','selected','start');
  }else if(q.mode==='half-bias-rg'){
    const h=s.halfBias;
    supply(q.halfBiasSupplyV);
    element('resistor',pt(L,T),pt(-.48,T));text(-1.1,T+.16,'R₁='+fmt(h.rSeriesR1Ohm,1)+' Ω');
    line(-.48,T,R,T);element('ammeter',pt(-.48,T),pt(-.48,B));
    text(-.32,.82,'G · Rg='+fmt(h.rgTrueOhm)+' Ω','ink','start');
    element('resistor',pt(R,T),pt(R,B));text(R-.15,.64,'R₂='+fmt(h.rgMeasuredOhm)+' Ω','ink','end');
    dot(-.48,T,'ink');dot(-.48,B,'ink');
    const i0=q.halfBiasSupplyV/(h.rSeriesR1Ohm+h.rgTrueOhm);
    text(0,.08,'先断开 R₂：I₀='+fmt(i0*1000,4)+' mA；闭合后调至 I_G=I₀/2='+fmt(i0*500,4)+' mA');
    const bottom=-1.25,top=-.26,ratio=h.rgMeasuredOhm/h.rgTrueOhm;
    line(-1.68,bottom,1.68,bottom);rect(-1.15,bottom,.64,top-bottom,'reference');rect(.48,bottom,.64,(top-bottom)*ratio,'measured');
    text(-.83,top+.10,fmt(h.rgTrueOhm)+' Ω','reference');text(.8,bottom+(top-bottom)*ratio+.10,fmt(h.rgMeasuredOhm,3)+' Ω','measured');
    text(-.83,bottom-.17,'表头真值');text(.8,bottom-.17,'电阻箱读数');
    text(0,-1.68,'相对低估 '+fmt(h.biasRelativeErr*100,3)+'%','selected');
  }else{
    const v=s.instrument,N=Number(q.vernierDivisions),j=v.vernierCoincidentIndex;
    const mainY=1.13,vernierY=.69,origin=caliperX(v.vernierReadoutMm),coinc=caliperX(v.vernierMainMm+j);
    // Include the entire possible shifted vernier (50 + 49 mm), not only the jaw range.
    rect(CALIPER_ZERO_X-.055,mainY-.18,100*CALIPER_MM_WORLD+.11,.25);
    rect(origin-.045,vernierY-.10,(N-1)*CALIPER_MM_WORLD+.09,.24);
    for(let i=0;i<=100;i++){
      const x=caliperX(i);
      line(x,mainY,x,mainY-(i%10===0?.13:i%5===0?.10:.06),i===v.vernierMainMm+j?'selected':'ink',false,i===v.vernierMainMm+j?2:1);
      if(i%10===0)text(x,mainY+.14,String(i),'muted');
    }
    for(let i=0;i<=N;i++){
      const x=origin+i*(N-1)/N*CALIPER_MM_WORLD;
      line(x,vernierY,x,vernierY+(i%5===0?.12:.065),i===j?'selected':'ink',false,i===j?2:1);
      if(i%(N===50?10:N===20?5:2)===0)text(x,vernierY-.15,String(i),'muted');
    }
    dot(coinc,.90,'selected',.014);
    text(0,1.46,'游标 '+N+' 分度 · 主尺/mm · 最小分度 '+fmt(1/N)+' mm');
    text(0,.41,'主尺 '+v.vernierMainMm+' mm + 第 '+j+' 格 × '+fmt(1/N)+' = '+v.vernierReadoutMm.toFixed(2)+' mm','selected');
    text(0,.25,'待测 '+fmt(q.targetVernierMm)+' mm；量化差 '+fmt(v.vernierQuantErrorMm,5)+' mm','muted');
    // True-proportion local magnification of the corresponding three graduations.
    const k=v.vernierMainMm+j,zoom=.38,zc=-.5;
    for(let i=Math.max(0,k-2);i<=Math.min(100,k+2);i++){
      const x=zc+(i-k)*zoom;line(x,.08,x,-.07,i===k?'selected':'ink');
      text(x,.14,String(i),'muted');
    }
    for(let i=Math.max(0,j-2);i<=Math.min(N,j+2);i++){
      const x=zc+(v.vernierReadoutMm+i*(N-1)/N-k)*zoom;
      line(x,-.32,x,-.16,i===j?'selected':'ink');text(x,-.40,String(i),'muted');
    }
    line(zc,-.08,zc,-.15,'selected',true);
    text(.65,-.09,'局部放大','muted','start');text(.65,-.26,'第 '+j+' 格对齐','selected','start');
    // Sleeve: only exposed half-mm graduations are visible, with alternating sides.
    const xEnd=microX(v.microReadoutMm),y=MICRO_RULER_Y,half=v.microFixedHalfMmCount,div=v.microThimbleDiv;
    rect(MICRO_ZERO_X-.06,y-.19,Math.max(.06,xEnd-MICRO_ZERO_X+.06),.38);
    line(MICRO_ZERO_X,y,xEnd,y);
    for(let i=0;i<=half;i++){
      const x=microX(i*.5),up=i%2===0;
      line(x,y,x,y+(up?.15:-.13),i===half?'selected':'ink');
      if(up&&i%10===0)text(x,y+.23,fmt(i*.5),'muted');
    }
    rect(xEnd,y-.29,.53,.58);
    line(xEnd,y-.29,xEnd,y+.29,'selected');
    // The wrapped scale is shown as an explicitly local unrolled window, not a false linear sleeve.
    const tx=1.04;
    rect(tx-.11,y-.35,.52,.70);
    for(let i=-5;i<=5;i++){
      const n=(div+i+50)%50,yy=y+i*.064;
      line(tx-.10,yy,tx+(i===0?.20:.10),yy,i===0?'selected':'ink',false,i===0?2:1);
      if(i===0||n%5===0)text(tx+.26,yy,String(n),i===0?'selected':'muted','start');
    }
    line(xEnd,y,tx-.12,y,'selected',true);
    text(0,-.57,'螺旋测微器 · 固定尺 0.5 mm · 可动尺50格（局部展开）');
    text(0,-1.43,fmt(half*.5,2)+' mm + '+div+' × 0.01 mm = '+v.microReadoutMm.toFixed(2)+' mm','selected');
    text(0,-1.62,'待测 '+fmt(q.targetMicrometerMm)+' mm；量化差 '+fmt(v.microQuantErrorMm,5)+' mm','muted');
    text(0,-1.80,'示数按最小分度量化；未模拟估读、零误差或机械间隙','muted');
  }
  return items;
}
export function electricalDiagram(s:ElectricalErrorState,q:ElectricalErrorParams):DiagramIR {
  return {width:840,height:690,viewBox:{minX:-2.25,minY:-2.0,maxX:2.25,maxY:1.76},
    title:({ 'emf-inner-outer':'测电源电动势和内阻','bulb-iv-curve':'小灯泡伏安特性','half-bias-rg':'半偏法测表头内阻','caliper-micrometer':'游标卡尺与螺旋测微器'} as const)[q.mode],
    primitives:electricalItems(s,q).map(i=>i.primitive)};
}
