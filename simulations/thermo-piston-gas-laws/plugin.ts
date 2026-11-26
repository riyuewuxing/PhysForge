import { CLASSROOM_GRAVITY } from '@physforge/physics-core';
import { createWorldMapper, defineSimulationPlugin, resolveAndDrawLabels, type CanvasLabel, type DiagramPrimitive, type ForceVectorItem, type ParamFieldSpec, type ParamValue } from '@physforge/sim-sdk';
import { thermoGasPresets } from './presets.js';
import { makeThermoApparatus, makeThermoPlot, thermoControl } from './sceneGeometry.js';
import {
  checkInvariants,
  CM_HG_TO_PA,
  computeObservables,
  createInitialState,
  P_ATM,
  stepThermoGasLaws,
  type ThermoGasParams,
  type ThermoGasState
} from './engine.js';

const paramSchema: readonly ParamFieldSpec<ThermoGasParams>[] = [
  {
    key: 'mode',
    kind: 'select',
    label: '热学模型',
    defaultValue: 'stop-pin-cylinder',
    options: [
      { value: 'stop-pin-cylinder', label: '带卡口竖直汽缸活塞' },
      { value: 'mercury-tube-tilt', label: '倾转水银柱玻璃管' },
      { value: 'multi-stroke-pump', label: '变质量打气/抽气筒' }
    ]
  },
  { key: 'molesN', kind: 'number', label: '气体物质的量 n', unit: 'mol', min: 0.1, max: 0.6, step: 0.05, defaultValue: 0.25 },
  { key: 'initialTempK', kind: 'number', label: '汽缸初始温度 T₀', unit: 'K', min: 200, max: 600, step: 10, defaultValue: 260 },
  { key: 'targetTempK', kind: 'number', label: '目标 / 等温参考温度 T', unit: 'K', min: 200, max: 600, step: 10, defaultValue: 420 },
  { key: 'heatingRateKPerS', kind: 'number', label: '升降温速率 |dT/dt|', unit: 'K/s', min: 10, max: 150, step: 10, defaultValue: 60 },
  { key: 'pistonAreaCm2', kind: 'number', label: '汽缸 / 管截面积 S', unit: 'cm²', min: 20, max: 100, step: 10, defaultValue: 50 },
  { key: 'pistonMassKg', kind: 'number', label: '活塞质量 m', unit: 'kg', min: 0, max: 30, step: 2, defaultValue: 10 },
  { key: 'pinVolumeL', kind: 'number', label: '卡口限位容积 V₀', unit: 'L', min: 3, max: 10, step: 0.5, defaultValue: 5 },
  { key: 'tubeTiltDeg', kind: 'number', label: '玻璃管倾角 θ', unit: '°', min: -90, max: 90, step: 5, defaultValue: 0 },
  { key: 'mercuryCm', kind: 'number', label: '水平参考水银柱 h₀', unit: 'cm', min: 10, max: 30, step: 2, defaultValue: 20 },
  { key: 'tubeLengthCm', kind: 'number', label: '玻璃管总长 L', unit: 'cm', min: 45, max: 90, step: 5, defaultValue: 75 },
  { key: 'tankVolumeL', kind: 'number', label: '容器定容 V', unit: 'L', min: 2, max: 20, step: 1, defaultValue: 10 },
  { key: 'pumpDeltaVL', kind: 'number', label: '气筒单次容积 ΔV', unit: 'L', min: 0.5, max: 5, step: 0.5, defaultValue: 2.5 },
  { key: 'pumpStrokesK', kind: 'number', label: '操作次数 k', unit: '次', min: 0, max: 10, step: 1, defaultValue: 5 },
  {
    key: 'pumpDirection',
    kind: 'select',
    label: '充气 / 抽气方向',
    defaultValue: 'extract',
    options: [
      { value: 'extract', label: '抽气（降压 P₀[V/(V+ΔV)]ᵏ）' },
      { value: 'inject', label: '打气（增压）' }
    ]
  }
];

export const thermoPistonGasLawsPlugin = defineSimulationPlugin<ThermoGasParams, ThermoGasState>({
  meta: {
    id: 'thermo-piston-gas-laws',
    title: '汽缸活塞卡口、水银柱与变质量充放气 (T01)',
    textbookRef: '人教版 选择性必修三 第二章',
    curriculumTags: ['物理观念', '科学思维', '科学探究'],
    difficulty: '压轴专题',
    version: '2.0.0'
  },
  paramSchema,
  presets: thermoGasPresets,
  defaultView:{scale:.9},
  getParamFields:p=>{
    const keys=p.mode==='stop-pin-cylinder'?['mode','initialTempK','targetTempK','heatingRateKPerS','pinVolumeL','molesN','pistonAreaCm2','pistonMassKg']:
      p.mode==='mercury-tube-tilt'?['mode','tubeTiltDeg','mercuryCm','tubeLengthCm','pistonAreaCm2','targetTempK']:
      ['mode','pumpDirection','pumpStrokesK','tankVolumeL','pumpDeltaVL','targetTempK'];
    return keys.flatMap(key=>paramSchema.filter(f=>f.key===key));
  },
  engine:{createInitialState,step:stepThermoGasLaws,computeObservables,checkInvariants},
  getForceVectors:(s,p):ForceVectorItem[]=>{
    const A=p.pistonAreaCm2*1e-4,apparatus=makeThermoApparatus(s,p),origin=apparatus.forceOrigin;
    if(!origin)return [];
    if(p.mode==='stop-pin-cylinder'){
      const result:ForceVectorItem[]=[
        {id:'gas-pressure',label:'F_gas=PS',origin,force:{x:0,y:s.pressurePa*A},color:'#38bdf8',category:'other',unit:'N'},
        {id:'atmospheric-pressure',label:'F_atm=P₀S',origin,force:{x:0,y:-P_ATM*A},color:'#fbbf24',category:'other',unit:'N'},
        {id:'piston-weight',label:'mg',origin,force:{x:0,y:-p.pistonMassKg*CLASSROOM_GRAVITY},color:'#fb923c',category:'gravity',unit:'N'}
      ];
      if(s.mode==='pinned')result.push({id:'pin-reaction',label:'F_pin',origin,force:{x:0,y:s.pinReactionN??0},color:'#a78bfa',category:'normal',unit:'N'});
      return result;
    }
    if(p.mode==='mercury-tube-tilt'){
      const a=apparatus.axis!,normal=apparatus.normal!,weight=CM_HG_TO_PA*A*s.mercuryColumnCm;
      return [
        {id:'gas-pressure-on-mercury',label:'F_gas=PS',origin,force:{x:s.pressurePa*A*a.x,y:s.pressurePa*A*a.y},color:'#38bdf8',category:'other',unit:'N'},
        {id:'atmospheric-pressure-on-mercury',label:'F_atm=P₀S',origin,force:{x:-P_ATM*A*a.x,y:-P_ATM*A*a.y},color:'#fbbf24',category:'other',unit:'N'},
        {id:'mercury-weight',label:'G_Hg',origin,force:{x:0,y:-weight},color:'#fb923c',category:'gravity',unit:'N'},
        {id:'tube-normal',label:'N_管壁',origin,force:{x:normal.x*weight*a.x,y:normal.y*weight*a.x},color:'#a78bfa',category:'normal',unit:'N'}
      ];
    }
    return [];
  },
  layers:[
    {id:'apparatus',label:'实际状态装置图',defaultVisible:true},
    {id:'pvCurve',label:'P-V 路径 / 平衡扫描 / 操作级次',defaultVisible:true}
  ],
  telemetryChannels:[
    {key:'pressureKPa',label:'气体压强 P',unit:'kPa',color:'#38bdf8'},
    {key:'volumeL',label:'气体体积 V',unit:'L',color:'#4ade80'},
    {key:'temperatureK',label:'温度 T',unit:'K',color:'#fbbf24'},
    {key:'workByGasJ',label:'气体对外做功 W',unit:'J',color:'#f472b6'}
  ],
  getControlHandles:(_s,p)=>[{id:'thermo-control',...thermoControl(p),handleKind:'point',color:'#fbbf24',
    onDrag:(wp):Record<string,ParamValue>=>p.mode==='mercury-tube-tilt'?{tubeTiltDeg:Math.round(Math.max(-90,Math.min(90,wp.y*90))/5)*5}:
    p.mode==='multi-stroke-pump'?{pumpStrokesK:Math.round(Math.max(0,Math.min(10,5+5*wp.y)))}:
    {targetTempK:Math.round(Math.max(200,Math.min(600,400+200*wp.y))/10)*10}}],
  sceneSerializer:{
    exportScene:(_s,params)=>({schemaVersion:'2.0',modelId:'thermo-piston-gas-laws',title:'气体实验定律与活塞模型',params}),
    importScene:dsl=>dsl.params as Partial<ThermoGasParams>
  },
  exportDiagramIR:(s,p)=>{
    const apparatus=makeThermoApparatus(s,p),plot=makeThermoPlot(s,p);
    return {width:960,height:650,viewBox:{minX:-2.38,minY:-1.45,maxX:2.38,maxY:1.57},title:'热学 · 装置与真实状态图',primitives:[...apparatus.primitives,...plot.primitives]};
  },
  renderCanvas:(ctx,s,p,viewport,layers)=>{
    const m=createWorldMapper(viewport),projector=viewport.theme==='projector',ink=projector?'#334155':'#cbd5e1',accent=projector?'#075985':'#67e8f9';
    const labels:CanvasLabel[]=[];
    const line=(x1:number,y1:number,x2:number,y2:number,color:string,width=1.5)=>{
      const a=m.toScreen(x1,y1),b=m.toScreen(x2,y2);ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();
    };
    const path=(points:readonly {x:number;y:number}[],closed=false)=>{
      ctx.beginPath();for(let i=0;i<points.length;i++){const v=points[i]!,q=m.toScreen(v.x,v.y);if(i===0)ctx.moveTo(q.x,q.y);else ctx.lineTo(q.x,q.y);}if(closed)ctx.closePath();
    };
    const draw=(items:readonly DiagramPrimitive[],prefix:string,color:string)=>{
      for(let i=0;i<items.length;i++){
        const v=items[i]!;
        if(v.kind==='text'){const q=m.toScreen(v.x,v.y);labels.push({id:prefix+i,x:q.x,y:q.y,text:v.text,color:ink,font:'12px sans-serif'});}
        else if(v.kind==='line'){ctx.setLineDash(v.dashed?[3,4]:[]);line(v.x1,v.y1,v.x2,v.y2,v.dashed?(projector?'#cbd5e1':'#475569'):color);ctx.setLineDash([]);}
        else if(v.kind==='polyline'){ctx.setLineDash(v.dashed?[4,4]:[]);path(v.points,v.closed);ctx.strokeStyle=color;ctx.lineWidth=1.8;ctx.stroke();ctx.setLineDash([]);}
        else if(v.kind==='circle'){const q=m.toScreen(v.cx,v.cy);ctx.beginPath();ctx.arc(q.x,q.y,m.len(v.r),0,2*Math.PI);ctx.fillStyle=accent;ctx.fill();}
        else if(v.kind==='arrow'){
          line(v.x1,v.y1,v.x2,v.y2,accent,2);const a=m.toScreen(v.x1,v.y1),b=m.toScreen(v.x2,v.y2),theta=Math.atan2(b.y-a.y,b.x-a.x);
          ctx.beginPath();ctx.moveTo(b.x,b.y);ctx.lineTo(b.x-7*Math.cos(theta-.5),b.y-7*Math.sin(theta-.5));ctx.lineTo(b.x-7*Math.cos(theta+.5),b.y-7*Math.sin(theta+.5));ctx.closePath();ctx.fillStyle=accent;ctx.fill();
        }
      }
    };
    ctx.save();
    if(layers.has('apparatus')){
      const apparatus=makeThermoApparatus(s,p);
      for(const region of apparatus.regions){
        path(region.points,true);
        const colors=projector?{gas:'#dbeafe',mercury:'#94a3b8',piston:'#64748b',tank:'#e0f2fe'}:{gas:'rgba(56,189,248,.17)',mercury:'#94a3b8',piston:'#64748b',tank:'rgba(56,189,248,.13)'};
        ctx.fillStyle=colors[region.role];ctx.fill();
      }
      draw(apparatus.primitives,'app-',ink);
    }
    if(layers.has('pvCurve'))draw(makeThermoPlot(s,p).primitives,'plot-',accent);
    const control=thermoControl(p),q=m.toScreen(control.position.x,control.position.y);
    line(control.position.x,-1,control.position.x,1,projector?'#92400e':'#fbbf24',1.4);
    ctx.beginPath();ctx.arc(q.x,q.y,4,0,2*Math.PI);ctx.fillStyle=projector?'#92400e':'#fbbf24';ctx.fill();
    const label=m.toScreen(control.position.x,-1.34);labels.push({id:'control',x:label.x,y:label.y,text:control.label,color:projector?'#92400e':'#fbbf24',font:'12px sans-serif'});
    resolveAndDrawLabels(ctx,labels,viewport.width,viewport.height);ctx.restore();
  },
  formatFormulas:(s,p)=>{
    const read='P='+ (s.pressurePa/1000).toFixed(3)+'\\,\\mathrm{kPa},\\quad V='+(s.volumeM3*1000).toFixed(3)+'\\,\\mathrm{L}';
    if(p.mode==='stop-pin-cylinder')return [
      {id:'pin-critical',label:'无摩擦准静态 · 下卡口临界',latex:'P_e=P_0+mg/S,\\quad T_c=P_eV_0/(nR)',substitutedLatex:'T_c='+s.criticalTempK!.toFixed(4)+'\\,\\mathrm K,\\quad P_e='+ (s.equilibriumPressurePa!/1000).toFixed(3)+'\\,\\mathrm{kPa}'},
      {id:'ideal-gas-law',label:s.mode==='pinned'?'等容 · 限位支持':'等压 · 活塞浮起',latex:'PV=nRT,\\quad W_{\\rm gas}=P_e(V-V_i)',substitutedLatex:read+',\\quad W='+(s.workByGasJ??0).toFixed(3)+'\\,\\mathrm J'}
    ];
    if(p.mode==='mercury-tube-tilt')return [{id:'ideal-gas-law',label:'同一水平参考 · 等温独立平衡',latex:'P=P_0(1+h\\sin\\theta/76),\\quad Pl=P_0l_0',substitutedLatex:read+',\\quad h='+s.mercuryColumnCm.toFixed(3)+'\\,\\mathrm{cm}'}];
    return [{id:'ideal-gas-law',label:'定容等温 · 变质量操作',latex:p.pumpDirection==='extract'?'P_k=P_0[V/(V+\\Delta V)]^k':'P_k=P_0(1+k\\Delta V/V)',substitutedLatex:read+',\\quad n='+s.molesN.toFixed(5)+'\\,\\mathrm{mol}'}];
  }
});
export default thermoPistonGasLawsPlugin;
