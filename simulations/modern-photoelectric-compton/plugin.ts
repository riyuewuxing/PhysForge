import { createWorldMapper, defineSimulationPlugin, resolveAndDrawLabels, type CanvasLabel, type ParamFieldSpec } from '@physforge/sim-sdk';
import { photoelectricComptonPresets } from './presets.js';
import {quantumGeometry,QUANTUM_BOUNDS,IV_PLOT,graphX,graphY,graphV,COMPTON_ORIGIN,comptonMomentumVectors} from './sceneGeometry.js';
export {comptonMomentumVectors} from './sceneGeometry.js';
import {
  checkInvariants,
  computeObservables,
  createInitialState,
  stepPhotoelectricCompton,
  type PhotoelectricComptonParams,
  type PhotoelectricComptonState
} from './engine.js';

const paramSchema: readonly ParamFieldSpec<PhotoelectricComptonParams>[] = [
  {
    key: 'mode',
    kind: 'select',
    label: '实验模式',
    defaultValue: 'photoelectric',
    options: [
      { label: '光电效应（I-U 曲线 + E_km-ν）', value: 'photoelectric' },
      { label: '康普顿散射（相对论矢量三角形）', value: 'compton' }
    ]
  },
  {
    key: 'cathodeMetal',
    kind: 'select',
    label: '阴极金属材料',
    defaultValue: 'Na',
    options: [
      { label: '铯 Cs (W₀ = 2.14 eV)', value: 'Cs' },
      { label: '钠 Na (W₀ = 2.36 eV)', value: 'Na' },
      { label: '锌 Zn (W₀ = 4.31 eV)', value: 'Zn' },
      { label: '铂 Pt (W₀ = 5.65 eV)', value: 'Pt' },
      { label: '自定义逸出功', value: 'custom' }
    ]
  },
  { key: 'customWorkFunctionEv', kind: 'number', label: '自定义逸出功 W₀', unit: 'eV', defaultValue: 2.36, min: 1.0, max: 6.5, step: 0.05 },
  { key: 'wavelengthNm', kind: 'number', label: '入射光波长 λ', unit: 'nm', defaultValue: 405, min: 200, max: 750, step: 5 },
  { key: 'intensityRel', kind: 'number', label: '相对光强 P', defaultValue: 1.4, min: 0, max: 3.0, step: 0.1 },
  { key: 'anodeVoltageV', kind: 'number', label: '光电管电压 U_AK', unit: 'V', defaultValue: 0, min: -7.0, max: 6.0, step: 0.1 },
  { key: 'freezeRefEnabled', kind: 'boolean', label: '同材料参考曲线', defaultValue: true },
  { key: 'refWavelengthNm', kind: 'number', label: '参考波长 λ_ref', unit: 'nm', defaultValue: 450, min: 200, max: 750, step: 5 },
  { key: 'refIntensityRel', kind: 'number', label: '同材料参考光强 P_ref', defaultValue: 0.8, min: 0, max: 3.0, step: 0.1 },
  { key: 'xrayWavelengthNm', kind: 'number', label: '入射 X 射线波长 λ', unit: 'nm', defaultValue: 0.071, min: 0.01, max: 0.2, step: 0.002 },
  { key: 'scatterAngleDeg', kind: 'number', label: '光子散射角 θ', unit: '°', defaultValue: 90, min: 0, max: 180, step: 5 }
];

export const modernPhotoelectricComptonPlugin = defineSimulationPlugin<
  PhotoelectricComptonParams,
  PhotoelectricComptonState
>({
  meta: {
    id: 'modern-photoelectric-compton',
    title: '光电效应与康普顿散射 (N01)',
    textbookRef: '人教版 选择性必修三 第四章第 2 节',
    curriculumTags: ['物理观念', '科学思维', '科学探究'],
    difficulty: '高三一轮',
    version: '2.0.0'
  },
  paramSchema,
  presets:photoelectricComptonPresets,
  defaultView:{offsetRatioX:-.05},
  getParamFields:p=>{
    const keys=p.mode==='compton'?['mode','xrayWavelengthNm','scatterAngleDeg']:['mode','cathodeMetal','wavelengthNm','intensityRel','anodeVoltageV',...(p.cathodeMetal==='custom'?['customWorkFunctionEv']:[]),'freezeRefEnabled',...(p.freezeRefEnabled?['refWavelengthNm','refIntensityRel']:[])];
    return keys.flatMap(key=>paramSchema.filter(f=>f.key===key));
  },
  timeSemantics:'static-analytic',
  engine:{createInitialState,step:stepPhotoelectricCompton,computeObservables,checkInvariants},
  layers:[
    {id:'apparatus',label:'光电管电路 / 动量矢量',defaultVisible:true},
    {id:'characteristic',label:'伏安及动能频率图 / 能量账本',defaultVisible:true}
  ],
  telemetryChannels:[
    {key:'currentMa',label:'光电流 I',unit:'mA',color:'#4ade80'},
    {key:'stoppingVoltageV',label:'遏止电压 U_c',unit:'V',color:'#38bdf8'},
    {key:'deltaLambdaPm',label:'康普顿波长差 Δλ',unit:'pm',color:'#f59e0b'},
    {key:'electronKineticKev',label:'反冲电子动能',unit:'keV',color:'#4ade80'}
  ],
  getTelemetryChannels:()=>[],
  sceneSerializer:{
    exportScene:(_s,params)=>({schemaVersion:'2.0',modelId:'modern-photoelectric-compton',title:'光电效应与康普顿散射',params}),
    importScene:dsl=>dsl.params as Partial<PhotoelectricComptonParams>
  },
  exportDiagramIR:(s,p)=>({width:1080,height:780,viewBox:QUANTUM_BOUNDS,title:p.mode==='photoelectric'?'光电管电路、伏安曲线与最大初动能频率图':'康普顿动量闭合与能量账本',primitives:quantumGeometry(s,p).marks.map(m=>m.primitive)}),
  renderCanvas:(ctx,s,p,viewport,layers)=>{
    const m=createWorldMapper(viewport),paper=viewport.theme==='projector';
    const palette=paper?{ink:'#0f172a',grid:'#94a3b8',beam:p.wavelengthNm<380?'#7e22ce':s.beamHex,cathode:'#1d4ed8',anode:'#b91c1c',electron:'#0369a1',current:'#0369a1',reference:'#475569',active:'#92400e',incident:'#0369a1',scattered:'#7e22ce',recoil:'#92400e',alert:'#be123c'}:
      {ink:'#e2e8f0',grid:'#64748b',beam:s.beamHex,cathode:'#60a5fa',anode:'#fb7185',electron:'#67e8f9',current:'#22d3ee',reference:'#94a3b8',active:'#fbbf24',incident:'#38bdf8',scattered:'#c084fc',recoil:'#fbbf24',alert:'#fb7185'};
    const labels:CanvasLabel[]=[];ctx.save();
    const line=(x1:number,y1:number,x2:number,y2:number,w:number)=>{
      ctx.lineWidth=w;ctx.beginPath();ctx.moveTo(m.toX(x1),m.toY(y1));ctx.lineTo(m.toX(x2),m.toY(y2));ctx.stroke();
    };
    quantumGeometry(s,p).marks.forEach(({primitive:v,tone,layer},i)=>{
      if(!layers.has(layer))return;
      const color=palette[tone];ctx.strokeStyle=color;ctx.fillStyle=color;
      if(v.kind==='text'){
        const q=m.toScreen(v.x,v.y);ctx.font='12px sans-serif';const w=ctx.measureText(v.text).width;
        labels.push({id:'quantum-'+i,x:q.x+(v.align==='start'?w/2:v.align==='end'?-w/2:0),y:q.y,text:v.text,color,font:'12px sans-serif'});
      }else if(v.kind==='line'){
        ctx.setLineDash(v.dashed?[4,4]:[]);line(v.x1,v.y1,v.x2,v.y2,tone==='grid'?1.1:1.8);ctx.setLineDash([]);
      }else if(v.kind==='arrow'){
        const a=m.toScreen(v.x1,v.y1),b=m.toScreen(v.x2,v.y2),theta=Math.atan2(b.y-a.y,b.x-a.x),l=Math.hypot(b.x-a.x,b.y-a.y);
        if(l>0){line(v.x1,v.y1,v.x2,v.y2,2);const tip=Math.min(8,l*.32);ctx.beginPath();ctx.moveTo(b.x,b.y);ctx.lineTo(b.x-tip*Math.cos(theta-.48),b.y-tip*Math.sin(theta-.48));ctx.lineTo(b.x-tip*Math.cos(theta+.48),b.y-tip*Math.sin(theta+.48));ctx.closePath();ctx.fill();}
      }else if(v.kind==='circle'){
        const q=m.toScreen(v.cx,v.cy);ctx.beginPath();ctx.arc(q.x,q.y,m.len(v.r),0,Math.PI*2);ctx.lineWidth=1.7;if(v.fill)ctx.fill();else ctx.stroke();
      }else if(v.kind==='rect'){
        const a=m.toScreen(v.x,v.y+v.height),w=m.len(v.width),h=m.len(v.height);
        if(p.mode==='compton'){ctx.globalAlpha=.55;ctx.fillRect(a.x,a.y,w,h);ctx.globalAlpha=1;}
        ctx.strokeRect(a.x,a.y,w,h);
      }else if(v.kind==='polyline'){
        ctx.setLineDash(v.dashed?[5,4]:[]);ctx.lineWidth=tone==='current'?2.5:1.8;ctx.beginPath();
        v.points.forEach((q,j)=>{const a=m.toScreen(q.x,q.y);if(j===0)ctx.moveTo(a.x,a.y);else ctx.lineTo(a.x,a.y);});ctx.stroke();ctx.setLineDash([]);
      }else if(v.kind==='arc'){
        const q=m.toScreen(v.cx,v.cy);ctx.lineWidth=1.4;ctx.beginPath();ctx.arc(q.x,q.y,m.len(v.r),-v.startAngle,-v.endAngle,true);ctx.stroke();
      }
    });
    resolveAndDrawLabels(ctx,labels,viewport.width,viewport.height);ctx.restore();
  },
  getControlHandles:(s,p)=>{
    if(p.mode==='compton'){
      const v=comptonMomentumVectors(s.compton,p.scatterAngleDeg);
      return [{id:'compton-scatter-angle',label:'θ='+p.scatterAngleDeg.toFixed(0)+'°',position:{x:COMPTON_ORIGIN.x+v.scattered.x,y:v.scattered.y},origin:COMPTON_ORIGIN,handleKind:'angle',color:'#c084fc',
        onDrag:world=>({scatterAngleDeg:Math.max(0,Math.min(180,Math.round(Math.atan2(world.y,world.x-COMPTON_ORIGIN.x)*180/Math.PI/5)*5))})}];
    }
    return [{id:'anode-voltage-point',label:'U_AK='+p.anodeVoltageV.toFixed(1)+' V',position:{x:graphX(p.anodeVoltageV),y:graphY(s.photoelectric.currentMa)},handleKind:'point',color:'#fbbf24',
      onDrag:world=>({anodeVoltageV:Math.max(IV_PLOT.uMin,Math.min(IV_PLOT.uMax,Math.round(graphV(world.x)*10)/10))})},
      {id:'incident-wavelength',label:'λ='+p.wavelengthNm.toFixed(0)+' nm',position:{x:-2.28,y:-.15+(750-p.wavelengthNm)/550*.80},handleKind:'point',color:s.beamHex,
        onDrag:world=>({wavelengthNm:Math.max(200,Math.min(750,Math.round((750-(world.y+.15)/.8*550)/5)*5))})}];
  },
  formatFormulas:(s,p)=>{
    if(p.mode==='compton'){
      const c=s.compton;
      return [{id:'einstein-compton',label:'静止自由电子 · 相对论散射',latex:'\\Delta\\lambda=\\frac{h}{m_ec}(1-\\cos\\theta)',substitutedLatex:'\\Delta\\lambda='+ (1000*c.deltaLambdaNm).toFixed(4)+'\\,\\mathrm{pm}'},
        {id:'compton-energy',label:'能量与二维动量守恒',latex:'E_\\gamma=E_\\gamma\' + K_e,\\quad \\vec p_\\gamma=\\vec p_\\gamma\'+\\vec p_e',substitutedLatex:'K_e='+c.electronKineticKev.toFixed(4)+'\\,\\mathrm{keV}'+(c.recoilAngleDefined?',\\quad\\varphi='+c.recoilAngleDeg.toFixed(2)+'^\\circ':'')}];
    }
    const pe=s.photoelectric;
    return [{id:'einstein-compton',label:pe.stoppingDefined?'爱因斯坦光电效应方程':p.intensityRel===0?'关光 · 无电流':'低于或等于阈频 · 无逸出',
      latex:pe.stoppingDefined?'h\\nu-W_0=eU_c':p.intensityRel===0?'P=0,\\quad I=0':'h\\nu\\le W_0,\\quad I=0',
      substitutedLatex:pe.stoppingDefined?'U_c='+pe.stoppingVoltageV.toFixed(3)+'\\,\\mathrm V,\\quad U_{AK}='+p.anodeVoltageV.toFixed(2)+'\\,\\mathrm V,\\quad I='+pe.currentMa.toFixed(3)+'\\,\\mathrm{mA}':'h\\nu='+pe.photonEnergyEv.toFixed(3)+'\\,\\mathrm{eV},\\quad I=0'},
      {id:'frequency-energy',label:'阈上理论最大初动能；不是阈下负动能',latex:'E_{km}=h\\nu-W_0\\quad(\\nu>\\nu_0),\\quad \\nu_0=W_0/h',
      substitutedLatex:'\\nu_0='+ (pe.cutoffFreqHz/1e14).toFixed(4)+'\\times10^{14}\\,\\mathrm{Hz}'+(pe.thresholdPassed?',\\quad E_{km}='+pe.maxKineticEv.toFixed(4)+'\\,\\mathrm{eV}':'')}];
  }
});
export default modernPhotoelectricComptonPlugin;
