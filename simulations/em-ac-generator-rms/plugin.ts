import { createWorldMapper, defineSimulationPlugin, resolveAndDrawLabels, type CanvasLabel, type DiagramPrimitive, type ForceVectorItem, type ParamFieldSpec, type Viewport } from '@physforge/sim-sdk';
import { acGeneratorPresets } from './presets.js';
import {
  checkInvariants,
  computeObservables,
  createInitialState,
  evalWaveformVoltage,
  isGeneratorLoad,
  sourceCurrent,
  stepAcGeneratorRms,
  type AcGeneratorParams,
  type AcGeneratorState
} from './engine.js';

const paramSchema: readonly ParamFieldSpec<AcGeneratorParams>[] = [
  {
    key: 'waveform',
    kind: 'select',
    label: '波形类型',
    defaultValue: 'sine',
    options: [
      { value: 'sine', label: '标准正弦交流电 (Um/√2)' },
      { value: 'half-wave', label: '半波整流波 (Um/2)' },
      { value: 'full-wave', label: '全波整流波 (Um/√2)' },
      { value: 'duty-square', label: '占空比方波 (Um√D)' },
      { value: 'sawtooth', label: '锯齿波 (Um/√3)' },
      { value: 'dc-plus-sine', label: '直流偏置叠加正弦波' }
    ]
  },
  { key: 'turnsN', kind: 'number', label: '线圈匝数 N', unit: '匝', min: 1, max: 30, step: 1, defaultValue: 10 },
  { key: 'magneticB', kind: 'number', label: '磁感应强度 B', unit: 'T', min: 0, max: 2, step: 0.1, defaultValue: 0.5 },
  { key: 'coilAreaS', kind: 'number', label: '线圈面积 S', unit: 'm²', min: 0.05, max: 0.5, step: 0.05, defaultValue: 0.2 },
  { key: 'freqHz', kind: 'number', label: '旋转频率 f', unit: 'Hz', min: 0, max: 5, step: 0.5, defaultValue: 2 },
  { key: 'loadR', kind: 'number', label: '等效负载电阻 R', unit: 'Ω', min: 2, max: 30, step: 2, defaultValue: 10 },
  { key: 'dutyCycleD', kind: 'number', label: '方波占空比 D', unit: '', min: 0, max: 1, step: 0.05, defaultValue: 0.5 },
  { key: 'dcOffsetV', kind: 'number', label: '直流偏置电压 Udc', unit: 'V', min: 0, max: 20, step: 2, defaultValue: 0 }
];


type Point={x:number;y:number};
type WavePoint={phase:number;voltage:number};
const centerX=-1.45, cameraSin=.4, cameraCos=Math.sqrt(1-cameraSin**2);
const graph=(p:AcGeneratorParams)=>isGeneratorLoad(p)?{left:.08,right:2.48}:{left:-2.25,right:2.25};
const voltageCenter=.49,voltageHalf=.36,powerBase=-.78,powerHeight=.47,railY=-1.12;
const phaseX=(p:AcGeneratorParams,f:number)=>{const g=graph(p);return g.left+(g.right-g.left)*f;};
const uScale=(s:AcGeneratorState)=>Math.max(1,s.loadPeakAbsV);
const pScale=(s:AcGeneratorState,p:AcGeneratorParams)=>Math.max(.1,uScale(s)**2/Math.max(.1,p.loadR));
const uPoint=(w:WavePoint,s:AcGeneratorState,p:AcGeneratorParams):Point=>({x:phaseX(p,w.phase),y:voltageCenter+voltageHalf*w.voltage/uScale(s)});
const pPoint=(w:WavePoint,s:AcGeneratorState,p:AcGeneratorParams):Point=>({x:phaseX(p,w.phase),y:powerBase+powerHeight*w.voltage**2/(Math.max(.1,p.loadR)*pScale(s,p))});

/** A one-period graph with explicit one-sided endpoints, never a diagonal across an ideal jump. */
export function waveformSegments(s:AcGeneratorState,p:AcGeneratorParams):WavePoint[][]{
  const a=s.uPeakV;
  if(p.waveform==='duty-square'){
    const d=Math.max(0,Math.min(1,p.dutyCycleD));
    return [...(d>0?[[{phase:0,voltage:a},{phase:d,voltage:a}]]:[]),
      ...(d<1?[[{phase:d,voltage:0},{phase:1,voltage:0}]]:[])];
  }
  const breaks=p.waveform==='half-wave'||p.waveform==='full-wave'?[0,.5,1]:[0,1];
  return breaks.slice(0,-1).map((lo,i)=>{
    const hi=breaks[i+1]!;
    return Array.from({length:81},(_,j)=>{
      const f=lo+(hi-lo)*j/80;
      const voltage=p.waveform==='sawtooth'?a*(2*f-1):evalWaveformVoltage(f,a,p);
      return {phase:f,voltage};
    });
  });
}
function coilGeometry(s:AcGeneratorState){
  // B along +x, coil normal (cosθ,0,sinθ), horizontal side (-sinθ,0,cosθ).
  // Orthographic oblique camera horizontal axis (cosα,0,sinα); vertical axis +y.
  const h=.55*(-Math.sin(s.angleRad)*cameraCos+Math.cos(s.angleRad)*cameraSin);
  return {a:{x:centerX-h,y:0},b:{x:centerX+h,y:0},corners:[
    {x:centerX-h,y:.52},{x:centerX+h,y:.52},{x:centerX+h,y:-.52},{x:centerX-h,y:-.52}
  ]};
}
export interface GeneratorSafeRect{left:number;right:number;top:number;bottom:number}
export function generatorDiagramBounds(p:AcGeneratorParams){
  return {minX:isGeneratorLoad(p)?-2.55:-2.43,maxX:2.6,minY:p.waveform==='duty-square'?-1.35:-1.03,maxY:1.18};
}
export function fitGeneratorViewport(p:AcGeneratorParams,v:Viewport,safe:GeneratorSafeRect):Viewport|null{
  const b=generatorDiagramBounds(p),w=safe.right-safe.left,h=safe.bottom-safe.top;
  if(w<170||h<140)return null;
  const ppm=Math.min((w-54)/(b.maxX-b.minX),(h-44)/(b.maxY-b.minY));
  if(!Number.isFinite(ppm)||ppm<=0)return null;
  return {...v,scale:ppm/(.24*Math.min(v.width,v.height)),
    offsetX:(safe.left+safe.right)/2-(b.minX+b.maxX)*ppm/2-.45*v.width,
    offsetY:(safe.top+safe.bottom)/2+(b.minY+b.maxY)*ppm/2-.5*v.height};
}
export function generatorBoundsFit(p:AcGeneratorParams,v:Viewport,safe:GeneratorSafeRect){
  const b=generatorDiagramBounds(p),m=createWorldMapper(v);
  return m.toX(b.minX)>=safe.left+12&&m.toX(b.maxX)<=safe.right-12&&m.toY(b.maxY)>=safe.top+10&&m.toY(b.minY)<=safe.bottom-10;
}
function initialView(p:AcGeneratorParams,v:{width:number;height:number}){
  const full={...v,dpr:1,scale:1,offsetX:0,offsetY:0};
  const q=fitGeneratorViewport(p,full,{left:26,right:v.width-26,top:24,bottom:v.height-24})??full;
  return {scale:q.scale,offsetRatioX:q.offsetX/v.width,offsetRatioY:q.offsetY/v.height};
}
const waveName:Record<AcGeneratorParams['waveform'],string>={
  sine:'正弦交流', 'half-wave':'理想半波整流','full-wave':'理想全波整流',
  'duty-square':'独立脉冲波','sawtooth':'独立锯齿波','dc-plus-sine':'独立 DC + AC 波'
};
export const emAcGeneratorRmsPlugin=Object.assign(defineSimulationPlugin<AcGeneratorParams,AcGeneratorState>({
  meta:{id:'em-ac-generator-rms',title:'交流电产生与有效值削峰填谷推导 (E07)',
    textbookRef:'人教版 选择性必修二 第三章 第1–2节',
    curriculumTags:['物理观念','科学思维','科学探究'],difficulty:'高三一轮',version:'2.0.0'},
  defaultView:{minScale:.0001,scale:(p,v)=>initialView(p,v).scale,
    offsetRatioX:(p,v)=>initialView(p,v).offsetRatioX,offsetRatioY:(p,v)=>initialView(p,v).offsetRatioY},
  paramSchema,presets:acGeneratorPresets,
  getParamFields:p=>paramSchema.filter(f=>f.key==='dutyCycleD'?p.waveform==='duty-square':f.key==='dcOffsetV'?p.waveform==='dc-plus-sine':true),
  engine:{createInitialState,step:stepAcGeneratorRms,computeObservables,checkInvariants},
  getForceVectors:(s,p,layers):ForceVectorItem[]=>{
    if(!isGeneratorLoad(p)||(layers&&!layers.has('coil3d')))return [];
    const g=coilGeometry(s),F=p.turnsN*p.magneticB*sourceCurrent(s,p)*Math.sqrt(Math.max(0,p.coilAreaS));
    return [
      {id:'ampere-force-a',label:'F_A 投影',origin:g.a,force:{x:-F*cameraSin,y:0},color:'#f472b6',category:'magnetic',unit:'N'},
      {id:'ampere-force-b',label:'F_B 投影',origin:g.b,force:{x:F*cameraSin,y:0},color:'#38bdf8',category:'magnetic',unit:'N'}
    ];
  },
  referenceFrames:[{id:'coil-frame',label:'线圈中心参考系（仅平动原点）',
    getOrigin:(_s,p)=>({x:isGeneratorLoad(p)?centerX:0,y:0}),getVelocity:()=>({x:0,y:0})}],
  layers:[{id:'coil3d',label:'2.5D 发电机（正弦/理想整流）',defaultVisible:true},
    {id:'powerFill',label:'实际电压/功率与等面积平均功率',defaultVisible:true}],
  telemetryChannels:[
    {key:'uInstV',label:'负载瞬时电压 u(t)',unit:'V',color:'#38bdf8'},
    {key:'uRmsV',label:'负载有效值 Urms',unit:'V',color:'#fbbf24'},
    {key:'pInstW',label:'瞬时热功率 p(t)',unit:'W',color:'#f472b6'},
    {key:'pAvgW',label:'平均热功率 Pavg',unit:'W',color:'#fb923c'},
    {key:'jouleHeatJ',label:'累计焦耳热 Q',unit:'J',color:'#4ade80'},
    {key:'currentA',label:'负载电流 i(t)',unit:'A',color:'#a78bfa'},
    {key:'sourceEmfV',label:'参考线圈源电动势 e',unit:'V',color:'#60a5fa'},
    {key:'fluxWb',label:'参考单匝磁通 Φ',unit:'Wb',color:'#4ade80'}
  ],
  getControlHandles:(_s,p)=>{
    if(p.waveform!=='duty-square')return [];
    const g=graph(p);
    return [{id:'duty-cycle',label:'D='+Math.round(p.dutyCycleD*100)+'%',
      position:{x:phaseX(p,p.dutyCycleD),y:railY},handleKind:'point',color:'#fbbf24',showWhenIdle:false,
      onDrag:wp=>({dutyCycleD:Math.round(20*Math.max(0,Math.min(1,(wp.x-g.left)/(g.right-g.left))))/20})}];
  },
  sceneSerializer:{exportScene:(_s,p)=>({schemaVersion:'2.0',modelId:'em-ac-generator-rms',title:'交流电与有效值推导',params:p}),
    importScene:dsl=>dsl.params as Partial<AcGeneratorParams>},
  exportDiagramIR:(s,p)=>{
    const g=graph(p),primitives:DiagramPrimitive[]=[
      {kind:'line',x1:g.left,y1:voltageCenter,x2:g.right,y2:voltageCenter},
      {kind:'line',x1:g.left,y1:powerBase,x2:g.right,y2:powerBase},
      {kind:'line',x1:g.left,y1:powerBase+powerHeight*s.pAvgW/pScale(s,p),x2:g.right,y2:powerBase+powerHeight*s.pAvgW/pScale(s,p),dashed:true},
      {kind:'text',x:(g.left+g.right)/2,y:1.08,text:waveName[p.waveform]+' · u/V',align:'middle'},
      {kind:'text',x:(g.left+g.right)/2,y:-.12,text:'p/W · 虚线平均功率',align:'middle'},
      {kind:'mathLabel',x:g.left,y:.95,text:'U_{\\rm rms}='+s.uRmsV.toFixed(2)+'\\,\\mathrm V'},
      {kind:'text',x:g.right,y:-.95,text:p.freqHz>0?'t/T = 1':'静止恒值',align:'end'}
    ];
    for(const seg of waveformSegments(s,p)){
      primitives.push({kind:'polyline',points:seg.map(w=>uPoint(w,s,p)),strokeWidth:2},
        {kind:'polyline',points:seg.map(w=>pPoint(w,s,p)),strokeWidth:2});
    }
    if(isGeneratorLoad(p)){
      const c=coilGeometry(s);primitives.push({kind:'polyline',points:[...c.corners,c.corners[0]!]},
        {kind:'arrow',x1:-2.22,y1:.77,x2:-.65,y2:.77},{kind:'text',x:centerX,y:.97,text:'B →（斜投影）',align:'middle'},
        {kind:'text',x:centerX,y:-.78,text:'源 e = '+s.sourceEmfV.toFixed(2)+' V',align:'middle'});
    }
    return {width:900,height:520,viewBox:generatorDiagramBounds(p),title:'负载电压与热功率 · '+waveName[p.waveform],primitives};
  },
  renderCanvas:(ctx,s,p,v,layers)=>{
    const m=createWorldMapper(v),paper=v.theme==='projector',ink=paper?'#0f172a':'#e2e8f0',muted=paper?'#475569':'#94a3b8',
      blue=paper?'#0369a1':'#38bdf8',gold=paper?'#92400e':'#fbbf24',rose=paper?'#be123c':'#f472b6',labels:CanvasLabel[]=[];
    const label=(id:string,x:number,y:number,text:string,color=ink,font='13px sans-serif')=>{const q=m.toScreen(x,y);labels.push({id,x:q.x,y:q.y,text,color,font});};
    const path=(points:Point[],close=false)=>{if(!points.length)return;const first=m.toScreen(points[0]!.x,points[0]!.y);ctx.beginPath();ctx.moveTo(first.x,first.y);
      for(const w of points.slice(1)){const q=m.toScreen(w.x,w.y);ctx.lineTo(q.x,q.y);}if(close)ctx.closePath();};
    const line=(points:Point[],c:string,width=1.4)=>{ctx.strokeStyle=c;ctx.lineWidth=width;path(points);ctx.stroke();};
    const rect=(x:number,y:number,w:number,h:number,c:string)=>{const a=m.toScreen(x,y+h),b=m.toScreen(x+w,y);ctx.fillStyle=c;ctx.fillRect(a.x,a.y,b.x-a.x,b.y-a.y);};
    ctx.save();
    if(layers.has('coil3d')&&isGeneratorLoad(p)){
      for(const [x,c,name] of [[-2.34,'#fb7185','N'],[-.8,'#38bdf8','S']] as const){
        const a=m.toScreen(x,.64),b=m.toScreen(x+.28,-.64);
        const g=ctx.createLinearGradient(a.x,a.y,b.x,b.y);g.addColorStop(0,paper?'#e2e8f0':c);g.addColorStop(.42,paper?'#cbd5e1':'#334155');g.addColorStop(1,paper?'#94a3b8':'#0f172a');
        ctx.fillStyle=g;ctx.fillRect(a.x,a.y,b.x-a.x,b.y-a.y);
        label('pole-'+name,x+.14,0,name,ink,'bold 15px sans-serif');
      }
      for(const y of [-.64,.72]){
        line([{x:-2.02,y},{x:-.84,y}],blue,1.4);
        line([{x:-.94,y:y+.05},{x:-.84,y},{x:-.94,y:y-.05}],blue,1.4);
      }
      line([{x:centerX,y:-.66},{x:centerX,y:.71}],muted,1.4);
      const c=coilGeometry(s);path(c.corners,true);ctx.strokeStyle=paper?'#92400e':'#f59e0b';ctx.lineWidth=5;ctx.stroke();
      path(c.corners,true);ctx.strokeStyle=paper?'#78350f':'#fde68a';ctx.lineWidth=1.8;ctx.stroke();
      label('generator-field',centerX,.92,'B →  ·  线圈斜投影',blue);
      label('generator-source',centerX,-.79,'源 e = '+s.sourceEmfV.toFixed(2)+' V',gold);
      label('generator-plane',centerX,1.14,s.atNeutralPlane?'中性面附近 · |Φ| 最大、e≈0':'θ='+((s.referencePhase*360).toFixed(0))+'° · Φ='+s.fluxWb.toFixed(3)+' Wb',s.atNeutralPlane?gold:muted);
    }
    if(layers.has('powerFill')){
      const g=graph(p),mid=(g.left+g.right)/2,us=uScale(s),ps=pScale(s,p);
      const avgY=powerBase+powerHeight*s.pAvgW/ps;
      rect(g.left,powerBase,g.right-g.left,avgY-powerBase,paper?'rgba(180,110,0,.12)':'rgba(251,191,36,.12)');
      for(const segment of waveformSegments(s,p)){
        const pp=segment.map(w=>pPoint(w,s,p));
        path([{x:pp[0]!.x,y:powerBase},...pp,{x:pp.at(-1)!.x,y:powerBase}],true);
        ctx.fillStyle=paper?'rgba(190,18,60,.13)':'rgba(244,114,182,.17)';ctx.fill();
        line(segment.map(w=>uPoint(w,s,p)),blue,2.3);line(pp,rose,2.3);
      }
      line([{x:g.left,y:voltageCenter},{x:g.right,y:voltageCenter}],muted);
      line([{x:g.left,y:voltageCenter-voltageHalf},{x:g.left,y:voltageCenter+voltageHalf}],muted);
      line([{x:g.left,y:powerBase},{x:g.right,y:powerBase}],muted);
      line([{x:g.left,y:powerBase},{x:g.left,y:powerBase+powerHeight}],muted);
      ctx.setLineDash([5,4]);line([{x:g.left,y:avgY},{x:g.right,y:avgY}],gold,1.8);ctx.setLineDash([]);
      const x=phaseX(p,s.referencePhase),up=uPoint({phase:s.referencePhase,voltage:s.uInstV},s,p),pp=pPoint({phase:s.referencePhase,voltage:s.uInstV},s,p);
      ctx.setLineDash([3,4]);line([{x,y:powerBase},{x,y:voltageCenter+voltageHalf}],muted);ctx.setLineDash([]);
      for(const [q,c] of [[up,blue],[pp,rose]] as const){const pt=m.toScreen(q.x,q.y);ctx.fillStyle=c;ctx.beginPath();ctx.arc(pt.x,pt.y,4,0,2*Math.PI);ctx.fill();}
      label('wave-title',mid,1.11,waveName[p.waveform]+(isGeneratorLoad(p)?' · 负载':' · 幅值独立设定'),ink,'bold 14px sans-serif');
      label('wave-voltage',mid,.94,'u / V · ±'+us.toFixed(1)+' · Urms='+s.uRmsV.toFixed(2),blue);
      label('wave-power',mid,-.12,'p / W · 0–'+ps.toFixed(1)+' · Pavg='+s.pAvgW.toFixed(2),rose);
      for(const f of [0,.5,1])label('phase-'+f,phaseX(p,f),-.94,f===0?'0':f===.5?'½':'1',muted,'11px sans-serif');
      label('phase-axis',mid,p.waveform==='duty-square'?-1.33:-1.08,p.freqHz>0?'t/T · T='+ (1/p.freqHz).toFixed(2)+' s':'f=0 · 无有限周期',muted,'11px sans-serif');
    }
    if(p.waveform==='duty-square'){
      const g=graph(p);line([{x:g.left,y:railY},{x:g.right,y:railY}],gold,2);
      for(const f of [0,.25,.5,.75,1]){const x=phaseX(p,f);line([{x,y:railY-.035},{x,y:railY+.035}],gold);}
      const x=phaseX(p,p.dutyCycleD),q=m.toScreen(x,railY);ctx.fillStyle=gold;ctx.beginPath();ctx.arc(q.x,q.y,4.5,0,2*Math.PI);ctx.fill();
      label('duty-rail',x,railY+.1,'D='+Math.round(100*p.dutyCycleD)+'%',gold);
    }
    resolveAndDrawLabels(ctx,labels,v.width,v.height);ctx.restore();
  },
  formatFormulas:(s,p)=>[
    {id:'ac-rms-eq',label:isGeneratorLoad(p)?'理想源与负载有效值':'独立教学波形 · 热量等效',
      latex:isGeneratorLoad(p)?'\\Phi=BS\\cos\\theta,\\quad e=NBS\\omega\\sin\\theta':'A=NBS\\omega\\;\\text{(幅值标定)}',
      substitutedLatex:(isGeneratorLoad(p)?'e='+s.sourceEmfV.toFixed(2)+'\\,\\mathrm V,\\;E_m=':'A=')+s.uPeakV.toFixed(2)+'\\,\\mathrm V'},
    {id:'ac-rms-heat',label:'纯电阻负载 · 一参考周期热效应',
      latex:p.freqHz>0?'U_{\\rm rms}=\\sqrt{\\frac1T\\int_0^T u^2dt},\\quad P_{\\rm avg}=\\frac{U_{\\rm rms}^2}{R}':'f=0,\\quad U_{\\rm rms}=|u|,\\quad P=u^2/R',
      substitutedLatex:'U_{\\rm rms}='+s.uRmsV.toFixed(2)+'\\,\\mathrm V,\\;P_{\\rm avg}='+s.pAvgW.toFixed(2)+'\\,\\mathrm W'},
    {id:'ac-rms-load',label:'实际累计热量（非平均功率乘任意时刻）',
      latex:'i=u/R,\\quad Q(t)=\\int_0^t\\frac{u^2(\\tau)}R\\,d\\tau',
      substitutedLatex:'u='+s.uInstV.toFixed(2)+'\\,\\mathrm V,\\;Q='+s.jouleHeatJ.toFixed(3)+'\\,\\mathrm J'}
  ]
}),{generatorDiagramBounds,fitGeneratorViewport,generatorBoundsFit});
export default emAcGeneratorRmsPlugin;
