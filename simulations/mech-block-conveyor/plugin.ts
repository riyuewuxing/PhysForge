import type { LiveFormulaSpec } from '@physforge/sim-sdk';
import { createWorldMapper, defineSimulationPlugin, resolveAndDrawLabels, type CanvasLabel, type ParamFieldSpec } from '@physforge/sim-sdk';
import { CLASSROOM_GRAVITY } from '@physforge/physics-core';
import { incline,world,blockCenter,contactDiagram,contactInitialView,contactBoundsFit,fitContactViewport,drawRelativeVelocityBand,type ContactRole } from './diagram.js';
import {
  checkInvariants,
  computeObservables,
  createInitialState,
  stepBlockConveyor,
  type BlockConveyorParams,
  type BlockConveyorState
} from './engine.js';

const paramSchema: readonly ParamFieldSpec<BlockConveyorParams>[] = [
  {
    key: 'systemMode',
    kind: 'select',
    label: '动力学场景',
    options: [
      { label: '水平/倾斜传送带模型', value: 'conveyor' },
      { label: '木块—长木板叠放模型', value: 'plank' }
    ],
    defaultValue: 'conveyor'
  },
  {
    key: 'massBlock',
    kind: 'number',
    label: '物块质量 m₁',
    unit: 'kg',
    min: 0.5,
    max: 10,
    step: 0.5,
    defaultValue: 2.0
  },
  {
    key: 'massPlank',
    kind: 'number',
    label: '木板质量 m₂（板块模式）',
    unit: 'kg',
    min: 0.5,
    max: 10,
    step: 0.5,
    defaultValue: 4.0
  },
  {
    key: 'muBlockCarrier',
    kind: 'number',
    label: '块与带/板摩擦因数 μ₁（μs=μk）',
    unit: '',
    min: 0,
    max: 0.8,
    step: 0.05,
    defaultValue: 0.25
  },
  {
    key: 'muGround',
    kind: 'number',
    label: '木板与地面摩擦因数 μ₂',
    unit: '',
    min: 0,
    max: 0.5,
    step: 0.05,
    defaultValue: 0
  },
  {
    key: 'inclineDeg',
    kind: 'number',
    label: '传送带倾角 θ',
    unit: '°',
    min: 0,
    max: 45,
    step: 1,
    defaultValue: 0
  },
  {
    key: 'beltVelocity',
    kind: 'number',
    label: '传送带速度 v带',
    unit: 'm/s',
    min: -6,
    max: 6,
    step: 0.5,
    defaultValue: 4.0
  },
  {
    key: 'blockInitialV',
    kind: 'number',
    label: '物块初速度 v₁₀',
    unit: 'm/s',
    min: -6,
    max: 8,
    step: 0.5,
    defaultValue: 0
  },
  {
    key: 'plankInitialV',
    kind: 'number',
    label: '木板初速度 v₂₀',
    unit: 'm/s',
    min: -4,
    max: 6,
    step: 0.5,
    defaultValue: 0
  },
  {
    key: 'externalForcePlank',
    kind: 'number',
    label: '木板外力 F外（板块模式）',
    unit: 'N',
    min: 0,
    max: 30,
    step: 1,
    defaultValue: 0
  },
  {key:'carrierLengthM',kind:'number',label:'承载面全长 L（0=无限）',unit:'m',min:0,max:30,step:1,defaultValue:0}
];


const liveFormulas: readonly LiveFormulaSpec[] = [
  {
    "id": "belt-kinetic-friction",
    "title": "斜传送带相对滑动时的摩擦力大小",
    "latex": "f_k=\\htmlClass{pf-live-var}{\\htmlData{param=muBlockCarrier}{\\mu_1}}\\htmlClass{pf-live-var}{\\htmlData{param=massBlock}{m_1}}g\\cos \\htmlClass{pf-live-var}{\\htmlData{param=inclineDeg}{\\theta}}",
    "bindings": [
      {
        "tokenKey": "muBlockCarrier",
        "paramKey": "muBlockCarrier",
        "label": "块与带/板间动摩擦因数 μ₁",
        "unit": "",
        "min": 0,
        "max": 0.8,
        "step": 0.05,
        "precision": 3
      },
      {
        "tokenKey": "massBlock",
        "paramKey": "massBlock",
        "label": "物块质量 m₁",
        "unit": "kg",
        "min": 0.5,
        "max": 10,
        "step": 0.5,
        "precision": 2
      },
      {
        "tokenKey": "inclineDeg",
        "paramKey": "inclineDeg",
        "label": "传送带倾角 θ",
        "unit": "°",
        "min": 0,
        "max": 45,
        "step": 1,
        "precision": 1
      }
    ],
    "when": {
      "systemMode": [
        "conveyor"
      ]
    }
  },
  {
    "id": "plank-kinetic-friction",
    "title": "水平木板与木块相对滑动时的摩擦力大小",
    "latex": "f_k=\\htmlClass{pf-live-var}{\\htmlData{param=muBlockCarrier}{\\mu_1}}\\htmlClass{pf-live-var}{\\htmlData{param=massBlock}{m_1}}g",
    "bindings": [
      {
        "tokenKey": "muBlockCarrier",
        "paramKey": "muBlockCarrier",
        "label": "木块—承载面动摩擦因数",
        "unit": "",
        "min": 0,
        "max": 0.8,
        "step": 0.05,
        "precision": 2
      },
      {
        "tokenKey": "massBlock",
        "paramKey": "massBlock",
        "label": "木块质量 m₁",
        "unit": "kg",
        "min": 0.5,
        "max": 10,
        "step": 0.5,
        "precision": 2
      }
    ],
    "when": {
      "systemMode": [
        "plank"
      ]
    }
  }
];
export const mechBlockConveyorPlugin = Object.assign(defineSimulationPlugin<
  BlockConveyorParams,
  BlockConveyorState
>({
  meta: {
    id: 'mech-block-conveyor',
    title: '动力学板块模型与传送带摩擦力突变',
    textbookRef: '人教版 必修第一册 第四章 第5–6节',
    curriculumTags: ['物理观念', '科学思维', '科学探究'],
    difficulty: '压轴专题',
    version: '1.0.0'
  },
  defaultView:{minScale:.001,scale:(p,v)=>contactInitialView(createInitialState(p),p,v).scale,offsetRatioX:(p,v)=>contactInitialView(createInitialState(p),p,v).offsetRatioX,offsetRatioY:(p,v)=>contactInitialView(createInitialState(p),p,v).offsetRatioY},
  getParamFields:p=>paramSchema.filter(f=>['massPlank','muGround','plankInitialV','externalForcePlank'].includes(f.key)?p.systemMode==='plank':['inclineDeg','beltVelocity'].includes(f.key)?p.systemMode==='conveyor':true),
  paramSchema,
  presets: [
    {
      id: 'conveyor-horizontal-startup',
      name: '1. 水平传送带从静止加速至共速',
      description: '物块无初速放上 4 m/s 传送带，观测划痕恰好等于物块对地位移，电机额外耗能一半转化为动能、一半生热。',
      params: {
        systemMode: 'conveyor',
        massBlock: 2.0,
        muBlockCarrier: 0.25,
        inclineDeg: 0,
        beltVelocity: 4.0,
        blockInitialV: 0
      },
      visibleLayers: ['carrier', 'block', 'scratchTrack', 'forceAndVelocity', 'eventPins']
    },
    {
      id: 'conveyor-inclined-downward-break',
      name: '2. 倾斜向下传送带共速摩擦力突变',
      description: '37° 倾斜传送带逆时针向下 4 m/s 运转，因 μ=0.25 < tan37°，共速后滑动摩擦力由向下突变为向上，v-t 出现明显拐点！',
      params: {
        systemMode: 'conveyor',
        massBlock: 2.0,
        muBlockCarrier: 0.25,
        inclineDeg: 37,
        beltVelocity: -4.0,
        blockInitialV: 0
      },
      visibleLayers: ['carrier', 'block', 'scratchTrack', 'forceAndVelocity', 'eventPins']
    },
    {
      id: 'conveyor-misconception-positive-friction',
      name: '3. 易错反例：滑动摩擦力也可以做正功',
      description: '静止物块被高速传送带拖动加速，对地而言滑动摩擦力方向与位移同向，正功使物块动能从 0 增至 mv²/2。',
      params: {
        systemMode: 'conveyor',
        massBlock: 1.5,
        muBlockCarrier: 0.3,
        inclineDeg: 0,
        beltVelocity: 5.0,
        blockInitialV: 0
      },
      visibleLayers: ['carrier', 'block', 'scratchTrack', 'forceAndVelocity', 'eventPins']
    },
    {
      id: 'plank-smooth-ground-momentum',
      name: '4. 光滑地面板块滑行至共速',
      description: '物块以 6 m/s 滑上静止 4 kg 长木板，动量守恒最终共速 2 m/s，实时量化木板位移与相对划痕长度。',
      params: {
        systemMode: 'plank',
        massBlock: 2.0,
        massPlank: 4.0,
        muBlockCarrier: 0.2,
        muGround: 0,
        blockInitialV: 6.0,
        plankInitialV: 0,
        externalForcePlank: 0
      },
      visibleLayers: ['carrier', 'block', 'scratchTrack', 'forceAndVelocity', 'eventPins']
    }
  ],
  engine: {
    createInitialState,
    step: stepBlockConveyor,
    computeObservables,
    checkInvariants
  },
  layers: [
    { id: 'carrier', label: '传送带 / 长木板本体', defaultVisible: true },
    { id: 'block', label: '运动物块', defaultVisible: true },
    { id: 'scratchTrack', label: '相对划痕长度 Δx_rel 可视条', defaultVisible: true },
    { id: 'forceAndVelocity', label: '速度与摩擦力方向矢量', defaultVisible: true },
    { id: 'eventPins', label: '共速临界突变点', defaultVisible: true }
  ],
  telemetryChannels: [
    { key: 'vBlock', label: '物块速度 v物', unit: 'm/s', color: '#38bdf8' },
    { key: 'vCarrier', label: '带/板速度 v带', unit: 'm/s', color: '#fbbf24' },
    { key: 'relativeScratch', label: '累计相对滑移路程 s_rel', unit: 'm', color: '#f472b6' },
    { key: 'frictionHeat', label: '摩擦生热 Q', unit: 'J', color: '#fb7185' },
    { key: 'kineticEnergy', label: '总动能 Ek', unit: 'J', color: '#4ade80' },
    {key:'groundHeat',label:'地面生热 Q₂',unit:'J',color:'#fb7185'},
    {key:'carrierWork',label:'外力/电机功 W',unit:'J',color:'#4ade80'},
    {key:'frictionOnBlockN',label:'有向摩擦力 f₁',unit:'N',color:'#fbbf24'}
  ],
  getControlHandles:(s,p)=>{
    if(s.t>0||s.terminal)return [];
    const isBelt=p.systemMode==='conveyor',v=isBelt?p.beltVelocity:p.plankInitialV,origin=world(p,0,isBelt?-1.14:-.92);
    return [{id:'carrier-initial-velocity',label:(isBelt?'v带':'v板₀')+'='+v.toFixed(1)+' m/s',position:world(p,.3*v,isBelt?-1.14:-.92),origin,handleKind:'vector',color:'#fbbf24',showWhenIdle:false,
      onDrag:wp=>{const a=incline(p),v=Math.round(((wp.x-origin.x)*Math.cos(a)+(wp.y-origin.y)*Math.sin(a))/.3*2)/2;
        const patch:Record<string,number>={};
        patch[isBelt?'beltVelocity':'plankInitialV']=Math.max(isBelt?-6:-4,Math.min(6,v));
        return patch;}}];
  },
  getForceVectors:(s,p)=>{
    const a=incline(p),mg=p.massBlock*CLASSROOM_GRAVITY,N=mg*Math.cos(a),origin=blockCenter(s,p),f=s.frictionOnBlockN;
    return [{id:'gravity',label:'mg',origin,force:{x:0,y:-mg},color:'#fbbf24',unit:'N'},
      {id:'normal',label:'F_N',origin,force:{x:-N*Math.sin(a),y:N*Math.cos(a)},color:'#38bdf8',unit:'N'},
      {id:'friction',label:'f₁',origin,force:world(p,f),color:'#f472b6',unit:'N'}];
  },
  referenceFrames:[
    {id:'carrier',label:'带/板材料参考系',getOrigin:(s,p)=>world(p,s.xCarrier),getVelocity:(s,p)=>world(p,s.vCarrier)},
    {id:'block',label:'物块平移参考系',getOrigin:(s,p)=>world(p,s.xBlock),getVelocity:(s,p)=>world(p,s.vBlock)}
  ],
  sceneSerializer: {
    exportScene: (_s, params) => ({
      schemaVersion: '2.0',
      modelId: 'mech-block-conveyor',
      title: '传送带与板块动力学',
      params
    }),
    importScene: (dsl) => dsl.params as Partial<BlockConveyorParams>
  },
  exportDiagramIR:(s,p)=>{
    const d=contactDiagram(s,p);return {width:900,height:520,viewBox:d.bounds,title:'板块与传送带 · 实际位置和摩擦',primitives:d.items.map(x=>x.primitive)};
  },
  formatFormulas:(s,p)=>{
    const pair=(a:string,b:string)=>'\\begin{gathered}'+a+'\\\\'+b+'\\end{gathered}';
    const n=(x:number,u:string)=>x.toFixed(3)+'\\,\\mathrm{'+u+'}';
    return [{id:'m05-force',label:s.coMovingLocked?'当前静摩擦':'当前滑动摩擦',latex:'f_1='+n(s.frictionOnBlockN,'N'),substitutedLatex:pair('a_1='+n(s.accelerationBlock,'m/s^2'),'a_2='+n(s.accelerationCarrier,'m/s^2'))},
      {id:'scratch-heat',label:'累计滑移路程（不等于净位移）',latex:'Q_1=\\mu_1N\\int |v_1-v_2|dt',substitutedLatex:pair('s_{rel}='+n(s.relativeScratch,'m'),'Q_1='+n(s.frictionHeat,'J'))},
      {id:'m05-ledger',label:'真实功能关系',latex:'\\Delta E+Q_1+Q_2=W',substitutedLatex:pair('Q_2='+n(s.groundHeat,'J'),'W='+n(s.carrierWork,'J'))},
      ...(s.terminal?[{id:'m05-terminal',label:'到达承载边界 · 保留接触前瞬时值',latex:'t='+n(s.t,'s')}]:[])];
  },
  renderCanvas:(ctx,s,p,vp,layers)=>{
    const d=contactDiagram(s,p),m=createWorldMapper(vp),paper=vp.theme==='projector';
    const colors:Record<ContactRole,string>=paper?{support:'#334155',block:'#0369a1',trace:'#9d174d',velocity:'#166534',friction:'#9d174d',ink:'#0f172a',event:'#b91c1c'}:{support:'#94a3b8',block:'#38bdf8',trace:'#f472b6',velocity:'#4ade80',friction:'#fbbf24',ink:'#e2e8f0',event:'#fb7185'};
    const labels:CanvasLabel[]=[];
    for(const [i,{primitive:q,role,layer}] of d.items.entries()){
      if(!layers.has(layer))continue;
      const color=colors[role];ctx.save();ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=role==='trace'?5:2;
      if(q.kind==='line'||q.kind==='arrow'){
        const a=m.toScreen(q.x1,q.y1),b=m.toScreen(q.x2,q.y2);
        ctx.setLineDash(q.dashed?[5,5]:[]);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();ctx.setLineDash([]);
        if(q.kind==='arrow'){
          const ang=Math.atan2(b.y-a.y,b.x-a.x);
          if(Math.hypot(b.x-a.x,b.y-a.y)>2){ctx.beginPath();ctx.moveTo(b.x,b.y);ctx.lineTo(b.x-9*Math.cos(ang-.4),b.y-9*Math.sin(ang-.4));ctx.lineTo(b.x-9*Math.cos(ang+.4),b.y-9*Math.sin(ang+.4));ctx.closePath();ctx.fill();}
          if(q.label)labels.push({id:'arrow-'+i,x:(a.x+b.x)/2+Math.sin(ang)*17,y:(a.y+b.y)/2-Math.cos(ang)*17,text:q.label,color,font:'bold 13px sans-serif'});
        }
      }else if(q.kind==='polyline'){
        ctx.setLineDash(q.dashed?[5,5]:[]);ctx.beginPath();q.points.forEach((p,i)=>{const c=m.toScreen(p.x,p.y);if(i===0)ctx.moveTo(c.x,c.y);else ctx.lineTo(c.x,c.y);});if(q.closed)ctx.closePath();ctx.stroke();
      }else if(q.kind==='circle'){
        const c=m.toScreen(q.cx,q.cy);ctx.beginPath();ctx.arc(c.x,c.y,Math.max(2,m.len(q.r)),0,Math.PI*2);if(q.fill)ctx.fill();else ctx.stroke();
      }else if(q.kind==='block'){
        const c=m.toScreen(q.cx,q.cy);ctx.translate(c.x,c.y);ctx.rotate(-(q.angleDeg??0)*Math.PI/180);
        ctx.globalAlpha=.25;ctx.fillRect(-m.len(q.width)/2,-m.len(q.height)/2,m.len(q.width),m.len(q.height));ctx.globalAlpha=1;ctx.strokeRect(-m.len(q.width)/2,-m.len(q.height)/2,m.len(q.width),m.len(q.height));
      }else if(q.kind==='text'){const c=m.toScreen(q.x,q.y);labels.push({id:'text-'+i,x:c.x,y:c.y,text:q.text,color,font:'13px sans-serif'});}
      ctx.restore();
    }
    resolveAndDrawLabels(ctx,labels,vp.width,vp.height);
  }
}),{liveFormulas,contactBoundsFit,fitContactViewport,drawRelativeVelocityBand});
export default mechBlockConveyorPlugin;
