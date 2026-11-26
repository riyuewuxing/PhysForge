import { createWorldMapper, defineSimulationPlugin, resolveAndDrawLabels, type CanvasLabel, type ParamFieldSpec } from '@physforge/sim-sdk';
import { rutherfordBohrPresets } from './presets.js';
import {atomicGeometry,ATOMIC_BOUNDS,IMPACT_RAIL_X,PROBE_RAIL,atomicPoint} from './sceneGeometry.js';
import {
  NUCLEAR_SCALE,
  checkInvariants,
  computeObservables,
  createInitialState,
  stepRutherfordBohr,
  type RutherfordBohrParams,
  type RutherfordBohrState
} from './engine.js';

const paramSchema: readonly ParamFieldSpec<RutherfordBohrParams>[] = [
  {
    key: 'mode',
    kind: 'select',
    label: '实验模块',
    defaultValue: 'rutherford',
    options: [
      { label: '卢瑟福 α 散射（库仑核尺度 ODE）', value: 'rutherford' },
      { label: '玻尔氢原子能级与真彩光谱', value: 'bohr' }
    ]
  },
  { key: 'alphaEnergyMev', kind: 'number', label: 'α 粒子初动能 K_α', unit: 'MeV', defaultValue: 5.0, min: 1.0, max: 12.0, step: 0.5 },
  { key: 'targetZ', kind: 'number', label: '靶核质子数 Z₂（Au=79）', defaultValue: 79, min: 13, max: 92, step: 1 },
  { key: 'impactParamFm', kind: 'number', label: '瞄准距离 b', unit: 'fm', defaultValue: 25, min: -80, max: 80, step: 5 },
  { key: 'excitedLevelN', kind: 'number', label: '最高激发态主量子数 n', defaultValue: 6, min: 2, max: 8, step: 1 },
  {
    key: 'populationMode',
    kind: 'select',
    label: '发光初态群体（独立于探针）',
    defaultValue: 'ensemble',
    options: [
      { label: '一群氢原子 (C_n^2 条)', value: 'ensemble' },
      { label: '单个氢原子 (最多 n-1 条)', value: 'single-atom' }
    ]
  },
  {
    key: 'probeKind',
    kind: 'select',
    label: '基态激发探针类型',
    defaultValue: 'photon',
    options: [
      { label: '单色光子（输入容差 ±0.005 eV）', value: 'photon' },
      { label: '入射电子 (E ≥ ΔE 即可激发)', value: 'electron' }
    ]
  },
  { key: 'probeEnergyEv', kind: 'number', label: '探针入射能量 E_probe', unit: 'eV', defaultValue: 12.09, min: 5.0, max: 15.0, step: 0.01 }
];

export const modernRutherfordBohrPlugin = defineSimulationPlugin<RutherfordBohrParams, RutherfordBohrState>({
  meta: {
    id: 'modern-rutherford-bohr',
    title: '卢瑟福散射与玻尔氢原子能级 (N02)',
    textbookRef: '人教版 选择性必修三 第四章第 3–4 节',
    curriculumTags: ['物理观念', '科学思维', '科学探究'],
    difficulty: '高三一轮',
    version: '2.0.0'
  },
  paramSchema,
  presets:rutherfordBohrPresets,
  getParamFields:p=>paramSchema.filter(f=>(p.mode==='rutherford'?['mode','alphaEnergyMev','targetZ','impactParamFm']:['mode','excitedLevelN','populationMode','probeKind','probeEnergyEv']).includes(f.key)),
  engine:{createInitialState,step:stepRutherfordBohr,computeObservables,checkInvariants},
  layers:[{id:'main',label:'真实轨迹 / 能级与光谱',defaultVisible:true}],
  telemetryChannels:[{key:'currentDistanceFm',label:'当前核距 r',unit:'fm',color:'#38bdf8'},{key:'speedMps',label:'α 粒子速率',unit:'m/s',color:'#fbbf24'},{key:'forceN',label:'库仑力大小',unit:'N',color:'#fb7185'}],
  getTelemetryChannels:p=>p.mode==='rutherford'?[{key:'currentDistanceFm',label:'当前核距 r',unit:'fm',color:'#38bdf8'},{key:'speedMps',label:'α 粒子速率',unit:'m/s',color:'#fbbf24'},{key:'forceN',label:'库仑力大小',unit:'N',color:'#fb7185'}]:[],
  sceneSerializer:{
    exportScene:(_s,params)=>({schemaVersion:'2.0',modelId:'modern-rutherford-bohr',title:'卢瑟福散射与氢原子能级',params}),
    importScene:dsl=>dsl.params as Partial<RutherfordBohrParams>
  },
  exportDiagramIR:(s,p)=>({width:1060,height:690,viewBox:ATOMIC_BOUNDS,title:s.mode==='rutherford'?'真实核尺度散射轨迹与数值账本':'氢原子能级与实际选中谱线',primitives:atomicGeometry(s,p).marks.map(m=>m.primitive)}),
  renderCanvas:(ctx,s,p,viewport,layers)=>{
    if(!layers.has('main'))return;
    const m=createWorldMapper(viewport),paper=viewport.theme==='projector';
    const palette=paper?{ink:'#0f172a',grid:'#94a3b8',path:'#0369a1',sample:'#be123c',nucleus:'#92400e',force:'#be123c',velocity:'#166534',energy:'#075985',uv:'#7e22ce',ir:'#9a3412',visible:'#0369a1',alert:'#be123c'}:
      {ink:'#e2e8f0',grid:'#64748b',path:'#38bdf8',sample:'#fb7185',nucleus:'#fbbf24',force:'#fb7185',velocity:'#4ade80',energy:'#67e8f9',uv:'#c084fc',ir:'#fb923c',visible:'#38bdf8',alert:'#fb7185'};
    const labels:CanvasLabel[]=[];ctx.save();
    const drawLine=(x1:number,y1:number,x2:number,y2:number,w:number)=>{
      ctx.lineWidth=w;ctx.beginPath();ctx.moveTo(m.toX(x1),m.toY(y1));ctx.lineTo(m.toX(x2),m.toY(y2));ctx.stroke();
    };
    atomicGeometry(s,p).marks.forEach(({primitive:v,tone,hex},i)=>{
      const color=hex&&tone==='visible'?hex:palette[tone];ctx.strokeStyle=color;ctx.fillStyle=color;
      if(v.kind==='text'){
        const q=m.toScreen(v.x,v.y);ctx.font='12px sans-serif';const w=ctx.measureText(v.text).width;
        labels.push({id:'atomic-'+i,x:q.x+(v.align==='start'?w/2:v.align==='end'?-w/2:0),y:q.y,text:v.text,color,font:'12px sans-serif'});
      }else if(v.kind==='line'){
        ctx.setLineDash(v.dashed?[4,4]:[]);drawLine(v.x1,v.y1,v.x2,v.y2,tone==='grid'?1:1.7);ctx.setLineDash([]);
      }else if(v.kind==='arrow'){
        const a=m.toScreen(v.x1,v.y1),b=m.toScreen(v.x2,v.y2),l=Math.hypot(b.x-a.x,b.y-a.y),theta=Math.atan2(b.y-a.y,b.x-a.x);
        if(l>0){drawLine(v.x1,v.y1,v.x2,v.y2,1.8);const tip=Math.min(7,l*.34);ctx.beginPath();ctx.moveTo(b.x,b.y);ctx.lineTo(b.x-tip*Math.cos(theta-.5),b.y-tip*Math.sin(theta-.5));ctx.lineTo(b.x-tip*Math.cos(theta+.5),b.y-tip*Math.sin(theta+.5));ctx.closePath();ctx.fill();}
      }else if(v.kind==='circle'){
        const q=m.toScreen(v.cx,v.cy);ctx.beginPath();ctx.arc(q.x,q.y,m.len(v.r),0,Math.PI*2);ctx.lineWidth=1.3;if(v.fill)ctx.fill();else ctx.stroke();
      }else if(v.kind==='trajectory'||v.kind==='polyline'){
        ctx.beginPath();ctx.lineWidth=2.8;v.points.forEach((q,j)=>{const a=m.toScreen(q.x,q.y);if(j===0)ctx.moveTo(a.x,a.y);else ctx.lineTo(a.x,a.y);});ctx.stroke();
      }
    });
    resolveAndDrawLabels(ctx,labels,viewport.width,viewport.height);ctx.restore();
  },
  getControlHandles:(_s,p)=>p.mode==='rutherford'?[{id:'impact-param-b',label:'b='+p.impactParamFm.toFixed(0)+' fm',position:{x:IMPACT_RAIL_X,y:p.impactParamFm/65},origin:{x:IMPACT_RAIL_X,y:0},handleKind:'point',color:'#38bdf8',
    onDrag:world=>({impactParamFm:Math.max(-80,Math.min(80,Math.round(world.y*65/5)*5))})}]:
    [{id:'probe-energy',label:'E='+p.probeEnergyEv.toFixed(2)+' eV',position:{x:PROBE_RAIL.x+(p.probeEnergyEv-PROBE_RAIL.min)/(PROBE_RAIL.max-PROBE_RAIL.min)*PROBE_RAIL.w,y:PROBE_RAIL.y},handleKind:'point',color:'#fbbf24',
      onDrag:world=>({probeEnergyEv:Math.max(PROBE_RAIL.min,Math.min(PROBE_RAIL.max,Math.round((PROBE_RAIL.min+(world.x-PROBE_RAIL.x)/PROBE_RAIL.w*(PROBE_RAIL.max-PROBE_RAIL.min))*100)/100))})}],
  getForceVectors:s=>{
    if(s.mode!=='rutherford')return [];
    const p=s.sample,r=Math.hypot(p.x,p.y),mag=NUCLEAR_SCALE.forceUnit*s.rutherford.kappaDimless/(r*r);
    return [{id:'coulomb-repulsion',label:'F库仑',origin:atomicPoint(s.rutherford,p),force:{x:mag*p.x/r,y:mag*p.y/r},color:'#fb7185',category:'electric',unit:'N'}];
  },
  referenceFrames:[{id:'alpha-particle',label:'α 粒子随动参考系',getOrigin:s=>s.mode==='rutherford'?atomicPoint(s.rutherford,s.sample):{x:0,y:0}}],
  formatFormulas:(s,p)=>{
    if(s.mode==='rutherford'){
      const r=s.rutherford;
      return [{id:'rutherford-bohr',label:'固定重靶核、经典点库仑近似',latex:'a=\\frac{k_e Z_1Z_2e^2}{2K_\\alpha},\\quad\\theta=2\\operatorname{atan2}(a,|b|)',substitutedLatex:'\\theta='+r.analyticalAngleDeg.toFixed(4)+'^\\circ'},
      {id:'rutherford-distance',label:'最近距离与真实数值轨迹',latex:'r_{\\min}=a+\\sqrt{a^2+b^2},\\quad E=K+U',substitutedLatex:'r_{\\min}='+r.minDistanceFm.toFixed(4)+'\\,\\mathrm{fm}'}];
    }
    const b=s.bohr;
    return [{id:'rutherford-bohr',label:'氢原子 n-only 能级（模型，不是电子路径）',latex:'E_n=-13.6/n^2\\,\\mathrm{eV},\\quad\\lambda=hc/\\Delta E',substitutedLatex:'n='+p.excitedLevelN+',\\quad N_{\\rm shown}='+b.spectralLines.length},
      {id:'bohr-population',label:p.populationMode==='ensemble'?'多原子全部可选 n 对':'一个原子的最大条数级联示例',latex:p.populationMode==='ensemble'?'N_{\\rm max}=n(n-1)/2':'N_{\\rm max}=n-1',substitutedLatex:'N_{\\rm max}='+ (p.populationMode==='ensemble'?b.totalCombinationLines:b.maxSingleAtomLines)}];
  }
});
export default modernRutherfordBohrPlugin;
