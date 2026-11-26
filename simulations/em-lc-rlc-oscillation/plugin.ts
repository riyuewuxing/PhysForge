import { createWorldMapper, defineSimulationPlugin, resolveAndDrawLabels, type CanvasLabel, type DiagramPrimitive, type ParamFieldSpec, type Viewport, type TelemetryChannelSpec } from '@physforge/sim-sdk';
import { lcRlcPresets } from './presets.js';
import {
  checkInvariants,
  computeImpedanceSummary,
  computeLcNaturalOmega,
  computeObservables,
  createInitialState,
  stepLcRlcOscillation,
  type LcRlcParams,
  type LcRlcState
} from './engine.js';

const paramSchema: readonly ParamFieldSpec<LcRlcParams>[] = [
  {
    key: 'mode',
    kind: 'select',
    label: '振荡模式',
    defaultValue: 'lc-undamped',
    options: [
      { value: 'lc-undamped', label: '理想 LC 无阻尼自由振荡' },
      { value: 'rlc-damped', label: 'RLC 阻尼衰减振荡' },
      { value: 'rlc-ac-resonance', label: 'RLC 受迫交流谐振' }
    ]
  },
  { key: 'inductanceH', kind: 'number', label: '电感自感系数 L', unit: 'H', min: 0.05, max: 1.0, step: 0.05, defaultValue: 0.25 },
  { key: 'capacitanceF', kind: 'number', label: '电容 C', unit: 'F', min: 0.02, max: 0.5, step: 0.02, defaultValue: 0.1 },
  { key: 'resistanceR', kind: 'number', label: '串联电阻 R', unit: 'Ω', min: 0, max: 6, step: 0.2, defaultValue: 2.0 },
  { key: 'initialChargeC', kind: 'number', label: '上极板初始有向电荷 q₀', unit: 'C', min: -1.0, max: 1.0, step: 0.1, defaultValue: 0.5 },
  { key: 'driveVoltAmpUm', kind: 'number', label: '交流驱动电压幅值 Um', unit: 'V', min: 0, max: 20, step: 2, defaultValue: 10 },
  { key: 'driveOmega', kind: 'number', label: '驱动角频率 ω', unit: 'rad/s', min: 1, max: 35, step: 0.1, defaultValue: 6.325 }
];


type Point={x:number;y:number};
type Tone='ink'|'muted'|'wire'|'electric'|'magnetic'|'heat'|'positive'|'negative'|'gold';
type Mark={primitive:DiagramPrimitive;tone:Tone;solid?:boolean;glow?:boolean};
type SafeRect={left:number;right:number;top:number;bottom:number};
const bounds={minX:-3.15,maxX:3.15,minY:-1.73,maxY:1.65};
const rail={left:-2.6,right:2.6,y:-1.59};
const freqX=(w:number)=>rail.left+(rail.right-rail.left)*(w-1)/34;
const dampLabels=['无阻尼','欠阻尼','临界阻尼','过阻尼'];
const responseLabels=['无外部驱动','有吸引的周期稳态参考','无阻尼特解参考 · 非稳态吸引','理想精确谐振 · 无有限周期稳态','零驱动 · 退化无激发'];
export function lcDiagramBounds(){return bounds;}
export function fitLcViewport(v:Viewport,safe:SafeRect):Viewport|null{
  const w=safe.right-safe.left,h=safe.bottom-safe.top;
  if(w<160||h<140)return null;
  const ppm=Math.min((w-68)/(bounds.maxX-bounds.minX),(h-44)/(bounds.maxY-bounds.minY));
  if(!Number.isFinite(ppm)||ppm<=0)return null;
  return {...v,scale:ppm/(.24*Math.min(v.width,v.height)),offsetX:(safe.left+safe.right)/2-.45*v.width,
    offsetY:(safe.top+safe.bottom)/2-.5*v.height};
}
export function lcBoundsFit(v:Viewport,safe:SafeRect){
  const m=createWorldMapper(v);return m.toX(bounds.minX)>=safe.left+16&&m.toX(bounds.maxX)<=safe.right-16&&m.toY(bounds.maxY)>=safe.top+10&&m.toY(bounds.minY)<=safe.bottom-10;
}
function initialView(v:{width:number;height:number}){
  const full={...v,dpr:1,scale:1,offsetX:0,offsetY:0},q=fitLcViewport(full,{left:26,right:v.width-26,top:24,bottom:v.height-24})??full;
  return {scale:q.scale,offsetRatioX:q.offsetX/v.width,offsetRatioY:q.offsetY/v.height};
}
export function lcScene(s:LcRlcState,p:LcRlcParams,layers:ReadonlySet<string>):Mark[]{
  const marks:Mark[]=[],driven=p.mode==='rlc-ac-resonance',R=p.mode==='lc-undamped'?0:Math.max(0,p.resistanceR),ref=s.reference;
  const add=(primitive:DiagramPrimitive,tone:Tone='ink',solid=false,glow=false)=>marks.push({primitive,tone,solid,glow});
  const line=(x1:number,y1:number,x2:number,y2:number,tone:Tone='wire',dashed=false)=>add({kind:'line',x1,y1,x2,y2,dashed},tone,false,tone==='wire');
  const poly=(points:Point[],tone:Tone='wire',glow=false)=>add({kind:'polyline',points},tone,false,glow);
  const label=(x:number,y:number,text:string,tone:Tone='ink')=>add({kind:'text',x,y,text,align:'middle'},tone);
  const arrow=(x1:number,y1:number,x2:number,y2:number,tone:Tone,dashed=false)=>add({kind:'arrow',x1,y1,x2,y2,dashed},tone,false,true);
  const rect=(x:number,y:number,width:number,height:number,tone:Tone,solid=false)=>add({kind:'rect',x,y,width,height,hatch:tone==='heat'},tone,solid,solid);
  const circle=(cx:number,cy:number,r:number,tone:Tone,fill=false)=>add({kind:'circle',cx,cy,r,fill},tone,fill,true);
  const number=(v:number)=>v.toFixed(3);
  if(layers.has('circuit')){
    const left=-2.73,right=-.37,top=1.04,bot=-.72,capY=.06,gap=.09,plate=.26,center=-1.55;
    label(-1.55,1.49,driven?'串联 RLC · 有向瞬时量':'自由 LC/RLC · '+dampLabels[s.dampingRegime],'ink');
    // Real gaps at the capacitor and source; no wire shorts either symbol.
    line(left,top,left,capY+gap);line(left,capY-gap,left,bot);
    const upper:Tone=s.chargeQ>1e-12?'positive':s.chargeQ< -1e-12?'negative':'muted',
      lower:Tone=s.chargeQ>1e-12?'negative':s.chargeQ< -1e-12?'positive':'muted';
    rect(left-plate,capY+gap-.025,plate*2,.05,upper,true);rect(left-plate,capY-gap-.025,plate*2,.05,lower,true);
    if(Math.abs(s.chargeQ)>1e-12){label(left+.38,capY+.12,s.chargeQ>0?'+':'−',upper);label(left+.38,capY-.12,s.chargeQ>0?'−':'+',lower);}
    if(R>0){
      line(left,top,center-.34,top);rect(center-.34,top-.09,.68,.18,'heat');line(center+.34,top,right,top);
      label(center,1.26,'R='+R.toFixed(2)+' Ω','heat');
    }else{line(left,top,right,top);label(center,1.26,'R=0 · 理想导线','muted');}
    const coilTop=.84,coilBottom=-.50;
    line(right,top,right,coilTop);line(right,coilBottom,right,bot);
    const coilPoints:Point[]=[];for(let j=0;j<=80;j++)coilPoints.push({x:right+.16*Math.sin(Math.PI*j/16),y:coilTop-(coilTop-coilBottom)*j/80});
    poly(coilPoints,'magnetic',true);
    if(driven){
      const r=.23;line(left,bot,center-r,bot);line(center+r,bot,right,bot);
      circle(center,bot,r,'gold');poly(Array.from({length:41},(_,j)=>({x:center-r*.68+1.36*r*j/40,y:bot+.26*r*Math.sin(2*Math.PI*j/40)})),'gold',true);
      label(center,-.99,'u源='+number(s.uDriveV)+' V','gold');
    }else line(left,bot,right,bot);
    if(Math.abs(s.currentI)>1e-10){const a=s.currentI>0?-2.02:-2.46,b=s.currentI>0?-2.46:-2.02;arrow(a,top+.14,b,top+.14,'gold');}
    label(-2.04,.71,'i='+number(s.currentI)+' A','gold');
    label(-1.95,.40,'q='+number(s.chargeQ)+' C','electric');
    label(-1.95,.11,'uC='+number(s.uCapV)+' V','electric');
    label(-1.02,-.17,'uL='+number(s.uIndV)+' V','magnetic');
    label(-1.92,-.45,'C='+p.capacitanceF.toFixed(2)+' F','muted');
    label(-.95,-.45,'L='+p.inductanceH.toFixed(2)+' H','magnetic');
    if(!driven)label(-1.55,-.96,'正向：流入上板 · 电流随符号反向','muted');
  }
  if(layers.has('energyBars')){
    const E=s.energyElectricJ+s.energyMagneticJ,available=s.initialEnergyJ+s.sourceWorkJ,total=E+s.jouleHeatJ,
      maxE=Math.max(.001,s.initialEnergyJ,available,total);
    if(!driven){
      label(1.52,1.49,'电磁储能与耗散 · 同一标尺','ink');
      const keys=[{x:.58,v:s.energyElectricJ,t:'electric' as Tone,n:'电场能'},{x:1.48,v:s.energyMagneticJ,t:'magnetic' as Tone,n:'磁场能'},{x:2.38,v:s.jouleHeatJ,t:'heat' as Tone,n:'焦耳热'}];
      const y=-.57,h=1.58;
      line(.14,y,2.94,y,'muted');line(.14,y+h,2.94,y+h,'muted',true);label(1.52,1.18,'标尺 '+number(maxE)+' J','muted');
      for(const k of keys){rect(k.x-.26,y,.52,h,'muted');if(k.v>0)rect(k.x-.26,y,.52,h*k.v/maxE,k.t,true);label(k.x,y-.12,k.n,k.t);label(k.x,y-.26,number(k.v)+' J',k.t);}
      label(1.52,-.99,s.measuredPeriod===null?'实测周期：等待两次向上过零':'实测过零间隔 '+number(s.measuredPeriod)+' s','muted');
    }
    // Shared power/energy ledger. Keep the reference and stack on one scale.
    const bx=-2.8,by=-1.35,bw=5.6,bh=.12;
    let x=bx;for(const [v,tone] of [[s.energyElectricJ,'electric'],[s.energyMagneticJ,'magnetic'],[s.jouleHeatJ,'heat']] as const){
      const len=bw*v/maxE;if(len>0){rect(x,by,len,bh,tone,true);x+=len;}
    }
    rect(bx,by,bw,bh,'muted');
    const refX=bx+bw*Math.max(0,available)/maxE;
    line(refX,by-.035,refX,by+bh+.035,'ink');
    label(0,by+.20,'储能 '+number(E)+' + 热 '+number(s.jouleHeatJ)+' = '+number(total)+' J · 初始+源功 '+number(available)+' J','ink');
    if(!driven)label(0,by-.13,'初始 '+number(s.initialEnergyJ)+' J · 账本残差 '+s.energyResidualJ.toExponential(1)+' J','muted');
  }
  if(driven&&layers.has('phasorPlot')){
    label(1.52,1.49,'解析响应参考（非时域实测）','ink');
    const x0=.36,x1=2.88,y0=.52,y1=1.16,w0=computeLcNaturalOmega(p),L=p.inductanceH,C=p.capacitanceF;
    if(ref.responseKind===1){
      const amp=(w:number)=>p.driveVoltAmpUm/Math.hypot(R,w*L-1/(w*C)),
        peakW=Math.max(1,Math.min(35,w0)),maxI=Math.max(.001,amp(peakW)),
        X=(w:number)=>x0+(x1-x0)*(w-1)/34,Y=(i:number)=>y0+(y1-y0)*i/maxI;
      line(x0,y0,x1,y0,'muted');line(x0,y0,x0,y1,'muted');line(x0,y1,x1,y1,'muted',true);
      const ws=Array.from(new Set([...Array.from({length:171},(_,i)=>1+i/5),peakW,p.driveOmega])).sort((a,b)=>a-b);
      poly(ws.map(w=>({x:X(w),y:Y(amp(w))})),'electric',true);
      if(w0>=1&&w0<=35)line(X(w0),y0,X(w0),y1,'gold',true);
      if(ref.referenceCurrentPeak!==undefined){circle(X(p.driveOmega),Y(ref.referenceCurrentPeak),.045,'gold',true);}
      label(1.62,1.28,'Iₘ(ω) · 峰值标尺 '+maxI.toFixed(2)+' A','electric');
      label(x0,y0-.12,'1','muted');label(x1,y0-.12,'35 rad/s','muted');
      label(1.55,y0-.12,'ω₀='+w0.toFixed(2),'gold');
    }else{
      label(1.52,1.08,responseLabels[ref.responseKind]??'—',ref.responseKind===3?'heat':'gold');
      label(1.52,.79,ref.responseKind===3?'电流随时间增长，不绘有限峰值':ref.responseKind===4?'零初态、零源：实际电流为零':'失谐特解有限，齐次振荡不会衰减','muted');
      if(ref.referenceCurrentPeak!==undefined)label(1.52,.55,'特解 Iₘ='+ref.referenceCurrentPeak.toFixed(3)+' A','electric');
    }
    // One common isotropic scale for the impedance vectors; no separate clipping.
    const cx=1.05,cy=-.24,scale=Math.min(1.45/Math.max(.001,R),.43/Math.max(.001,ref.xl,ref.xc));
    const dx=R*scale,dy=(ref.xl-ref.xc)*scale;
    line(.38,cy,2.84,cy,'muted');line(cx,-.75,cx,.30,'muted');
    if(ref.xl>0)arrow(cx,cy,cx,cy+ref.xl*scale,'magnetic');
    if(ref.xc>0)arrow(cx,cy,cx,cy-ref.xc*scale,'negative');
    if(R>0)arrow(cx,cy,cx+dx,cy,'wire');
    if(Math.abs(dy)>1e-10)arrow(cx+dx,cy,cx+dx,cy+dy,'gold',true);
    if(ref.zMag>0)arrow(cx,cy,cx+dx,cy+dy,'electric');
    label(.53,cy+.30,'X_L='+ref.xl.toFixed(2),'magnetic');label(.53,cy-.32,'X_C='+ref.xc.toFixed(2),'negative');
    label(2.14,cy+.24,'R='+R.toFixed(2)+' Ω','wire');
    label(2.14,cy-.23,'|Z|='+ref.zMag.toFixed(3)+' Ω','electric');
    label(1.55,-.91,ref.referenceCurrentPeak===undefined?responseLabels[ref.responseKind]:'参考 Iₘ='+ref.referenceCurrentPeak.toFixed(3)+' A · 非瞬时电流','gold');
  }
  if(driven){
    line(rail.left,rail.y,rail.right,rail.y,'gold');
    for(const w of [1,5,10,15,20,25,30,35]){const x=freqX(w);line(x,rail.y-.035,x,rail.y+.035,'gold');}
    circle(freqX(p.driveOmega),rail.y,.035,'gold',true);
    label(freqX(p.driveOmega),rail.y+.12,'ω='+p.driveOmega.toFixed(2)+' rad/s','gold');
  }
  return marks;
}

const channels:readonly TelemetryChannelSpec[]=[
  {key:'chargeQ',label:'上板电荷 q',unit:'C',color:'#38bdf8'},
  {key:'currentI',label:'有向电流 i',unit:'A',color:'#f472b6'},
  {key:'energyElectricJ',label:'电场能',unit:'J',color:'#fbbf24'},
  {key:'energyMagneticJ',label:'磁场能',unit:'J',color:'#4ade80'},
  {key:'totalEmEnergyJ',label:'总电磁储能',unit:'J',color:'#38bdf8'},
  {key:'jouleHeatJ',label:'累计焦耳热',unit:'J',color:'#fb7185'},
  {key:'sourceWorkJ',label:'有符号源功',unit:'J',color:'#f472b6'},
  {key:'uCapV',label:'电容有向电压',unit:'V',color:'#fbbf24'},
  {key:'uIndV',label:'电感有向电压',unit:'V',color:'#4ade80'},
  {key:'uDriveV',label:'有向源电压',unit:'V',color:'#38bdf8'}
];
export const emLcRlcOscillationPlugin=Object.assign(defineSimulationPlugin<LcRlcParams,LcRlcState>({
  meta:{id:'em-lc-rlc-oscillation',title:'LC 电磁振荡与 RLC 交流谐振 (E09)',textbookRef:'人教版 选择性必修二 第四章',
    curriculumTags:['物理观念','科学思维','科学探究'],difficulty:'高三一轮',version:'2.0.0'},
  defaultView:{minScale:.0001,scale:(_p,v)=>initialView(v).scale,offsetRatioX:(_p,v)=>initialView(v).offsetRatioX,offsetRatioY:(_p,v)=>initialView(v).offsetRatioY},
  paramSchema,presets:lcRlcPresets,
  getParamFields:p=>(p.mode==='rlc-ac-resonance'?['mode','driveOmega','resistanceR','driveVoltAmpUm','inductanceH','capacitanceF']:
    p.mode==='rlc-damped'?['mode','resistanceR','inductanceH','capacitanceF','initialChargeC']:['mode','initialChargeC','inductanceH','capacitanceF']).flatMap(k=>paramSchema.filter(f=>f.key===k)),
  engine:{createInitialState,step:stepLcRlcOscillation,computeObservables,checkInvariants},
  layers:[{id:'circuit',label:'真实 LC/RLC 回路',defaultVisible:true},{id:'energyBars',label:'电磁能与功—热账本',defaultVisible:true},{id:'phasorPlot',label:'受迫解析阻抗与响应参考',defaultVisible:true}],
  telemetryChannels:channels,
  getTelemetryChannels:p=>{
    const keys=p.mode==='rlc-ac-resonance'?['currentI','uDriveV','chargeQ','energyElectricJ','energyMagneticJ','totalEmEnergyJ','jouleHeatJ','sourceWorkJ','uCapV','uIndV']:
      p.mode==='rlc-damped'?['totalEmEnergyJ','jouleHeatJ','chargeQ','currentI','energyElectricJ','energyMagneticJ','uCapV','uIndV']:
      ['energyElectricJ','energyMagneticJ','chargeQ','currentI','totalEmEnergyJ','uCapV','uIndV'];
    return keys.flatMap(k=>channels.filter(c=>c.key===k));
  },
  getControlHandles:(_s,p)=>p.mode==='rlc-ac-resonance'?[{id:'drive-omega',label:'ω='+p.driveOmega.toFixed(2),position:{x:freqX(p.driveOmega),y:rail.y},handleKind:'point',showWhenIdle:false,color:'#fbbf24',
    onDrag:wp=>({driveOmega:Math.round(Math.max(1,Math.min(35,1+(wp.x-rail.left)/(rail.right-rail.left)*34))*10)/10})}]:[],
  sceneSerializer:{exportScene:(_s,p)=>({schemaVersion:'2.0',modelId:'em-lc-rlc-oscillation',title:'LC 电磁振荡与 RLC 谐振',params:p}),importScene:dsl=>dsl.params as Partial<LcRlcParams>},
  exportDiagramIR:(s,p)=>({width:960,height:530,viewBox:bounds,title:p.mode==='rlc-ac-resonance'?'串联 RLC 受迫振荡与参考响应':'LC/RLC 自由振荡与能量',
    primitives:lcScene(s,p,new Set(['circuit','energyBars','phasorPlot'])).map(m=>m.primitive)}),
  renderCanvas:(ctx,s,p,v,layers)=>{
    const m=createWorldMapper(v),paper=v.theme==='projector',
      colors:Record<Tone,string>=paper?{ink:'#0f172a',muted:'#475569',wire:'#0369a1',electric:'#92400e',magnetic:'#166534',heat:'#be123c',positive:'#b91c1c',negative:'#075985',gold:'#92400e'}:
        {ink:'#e2e8f0',muted:'#94a3b8',wire:'#38bdf8',electric:'#fbbf24',magnetic:'#4ade80',heat:'#fb7185',positive:'#fb7185',negative:'#38bdf8',gold:'#fbbf24'};
    const labels:CanvasLabel[]=[];
    const path=(points:readonly Point[])=>{if(!points.length)return;const a=m.toScreen(points[0]!.x,points[0]!.y);ctx.beginPath();ctx.moveTo(a.x,a.y);for(const q of points.slice(1)){const b=m.toScreen(q.x,q.y);ctx.lineTo(b.x,b.y);}};
    ctx.save();ctx.lineJoin='round';ctx.lineCap='round';
    lcScene(s,p,layers).forEach(({primitive:q,tone,solid,glow},i)=>{
      const color=colors[tone];ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=tone==='wire'||tone==='magnetic'?2.5:1.8;
      ctx.shadowBlur=glow&&!paper?6:0;ctx.shadowColor=color;
      if(q.kind==='text'){const a=m.toScreen(q.x,q.y);labels.push({id:'e09-'+i,x:a.x,y:a.y,text:q.text,color,font:tone==='ink'?'bold 13px sans-serif':'12px sans-serif'});return;}
      if(q.kind==='line'||q.kind==='arrow'){
        const a=m.toScreen(q.x1,q.y1),b=m.toScreen(q.x2,q.y2);ctx.setLineDash(q.dashed?[5,4]:[]);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();ctx.setLineDash([]);
        if(q.kind==='arrow'){const dx=b.x-a.x,dy=b.y-a.y,n=Math.hypot(dx,dy);if(n>2){const u=dx/n,w=dy/n;ctx.beginPath();ctx.moveTo(b.x,b.y);ctx.lineTo(b.x-8*u+4*w,b.y-8*w-4*u);ctx.lineTo(b.x-8*u-4*w,b.y-8*w+4*u);ctx.closePath();ctx.fill();}}
      }else if(q.kind==='polyline'){path(q.points);ctx.stroke();}
      else if(q.kind==='circle'){const a=m.toScreen(q.cx,q.cy);ctx.beginPath();ctx.arc(a.x,a.y,m.len(q.r),0,2*Math.PI);if(q.fill)ctx.fill();else ctx.stroke();}
      else if(q.kind==='rect'){const a=m.toScreen(q.x,q.y+q.height),b=m.toScreen(q.x+q.width,q.y);
        if(solid){const g=ctx.createLinearGradient(a.x,a.y,a.x,b.y);g.addColorStop(0,color);g.addColorStop(1,paper?'#e2e8f0':color);ctx.fillStyle=g;ctx.fillRect(a.x,a.y,b.x-a.x,b.y-a.y);}
        ctx.strokeRect(a.x,a.y,b.x-a.x,b.y-a.y);
      }
    });ctx.shadowBlur=0;resolveAndDrawLabels(ctx,labels,v.width,v.height);ctx.restore();
  },
  formatFormulas:(s,p)=>{
    const driven=p.mode==='rlc-ac-resonance',ref=computeImpedanceSummary(p),items=[
      {id:'lc-kvl',label:'有向瞬时电压与电流',latex:'u_L+Ri+q/C=u_s,\\quad i=\\dot q',
        substitutedLatex:'i='+s.currentI.toFixed(3)+'\\,\\mathrm A,\\;q='+s.chargeQ.toFixed(3)+'\\,\\mathrm C'},
      {id:'lc-energy',label:'实际功—热账本',latex:'E_C+E_L+Q_{\\rm heat}=E_0+W_s',
        substitutedLatex:'Q_{\\rm heat}='+s.jouleHeatJ.toFixed(3)+'\\,\\mathrm J,\\;W_s='+s.sourceWorkJ.toFixed(3)+'\\,\\mathrm J'}
    ];
    if(!driven){items.unshift({id:'lc-period',label:dampLabels[s.dampingRegime]??'自由响应',latex:'T_0=2\\pi\\sqrt{LC}',
      substitutedLatex:'T_0='+s.naturalPeriod.toFixed(3)+'\\,\\mathrm s'+(s.measuredPeriod===null?'':',\\;T_{\\rm meas}='+s.measuredPeriod.toFixed(3)+'\\,\\mathrm s')});}
    else items.unshift({id:'lc-reference',label:responseLabels[ref.responseKind]??'解析参考',latex:'|Z|=\\sqrt{R^2+(\\omega L-1/(\\omega C))^2}',
      substitutedLatex:'|Z|='+ref.zMag.toFixed(3)+'\\,\\Omega'+(ref.referenceCurrentPeak===undefined?'':',\\;I_m='+ref.referenceCurrentPeak.toFixed(3)+'\\,\\mathrm A')});
    return items;
  }
}),{lcDiagramBounds,fitLcViewport,lcBoundsFit});
export default emLcRlcOscillationPlugin;
