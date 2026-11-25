import type { LiveFormulaSpec } from '@physforge/sim-sdk';
import { CLASSROOM_GRAVITY, degToRad } from '@physforge/physics-core';
import { createWorldMapper, defineSimulationPlugin, resolveAndDrawLabels, type ParamFieldSpec } from '@physforge/sim-sdk';
import { projectileCouplingPresets } from './presets.js';
import { projectileDiagram,projectileInitialView,fitProjectileViewport,projectileBoundsFit,vacuumFarthest,projectileVelocityScale,type ProjectileRole } from './diagram.js';
import {
  checkInvariants,
  computeObservables,
  createInitialState,
  stepProjectileCoupling,
  type ProjectileCouplingParams,
  type ProjectileCouplingState
} from './engine.js';

const paramSchema: readonly ParamFieldSpec<ProjectileCouplingParams>[] = [
  {
    key: 'mode',
    kind: 'select',
    label: '抛体耦合场景',
    options: [
      { label: '平抛落斜面（最远距离）', value: 'incline-flat' },
      { label: '平抛落半圆凹槽', value: 'semicircle-trough' },
      { label: '斜抛安全包络与阻尼对比', value: 'safety-envelope' }
    ],
    defaultValue: 'incline-flat'
  },
  { key: 'v0', kind: 'number', label: '发射初速率 v₀', unit: 'm/s', min: 1, max: 14, step: 0.5, defaultValue: 6 },
  { key: 'launchAngleDeg', kind: 'number', label: '斜抛仰角 α', unit: '°', min: 0, max: 85, step: 5, defaultValue: 45 },
  { key: 'inclineDeg', kind: 'number', label: '斜面倾角 θ', unit: '°', min: 15, max: 60, step: 1, defaultValue: 37 },
  { key: 'troughRadius', kind: 'number', label: '半圆槽半径 R', unit: 'm', min: 1, max: 5, step: 0.5, defaultValue: 2.5 },
  { key: 'dragCoeff', kind: 'number', label: '二次空气阻力系数 c_d', unit: 'kg/m', min: 0, max: 0.3, step: 0.02, defaultValue: 0 },
  { key: 'mass', kind: 'number', label: '质点质量 m', unit: 'kg', min: 0.5, max: 5, step: 0.5, defaultValue: 1 }
];


const liveFormulas: readonly LiveFormulaSpec[] = [
  {
    "id": "launch-velocity",
    "title": "初速度水平分量",
    "latex": "v_{0x}=\\htmlClass{pf-live-var}{\\htmlData{param=v0}{v_0}}\\cos \\htmlClass{pf-live-var}{\\htmlData{param=launchAngleDeg}{\\alpha}}",
    "bindings": [
      {
        "tokenKey": "v0",
        "paramKey": "v0",
        "label": "发射初速率 v₀",
        "unit": "m/s",
        "min": 1,
        "max": 14,
        "step": 0.5,
        "precision": 2
      },
      {
        "tokenKey": "launchAngleDeg",
        "paramKey": "launchAngleDeg",
        "label": "斜抛仰角 α",
        "unit": "°",
        "min": 0,
        "max": 85,
        "step": 5,
        "precision": 1
      }
    ],
    "when": {
      "mode": [
        "semicircle-trough",
        "safety-envelope"
      ]
    }
  },
  {
    "id": "horizontal-launch",
    "title": "水平抛出且忽略空气阻力时的水平位移",
    "latex": "x-x_0=\\htmlClass{pf-live-var}{\\htmlData{param=v0}{v_0}}t",
    "bindings": [
      {
        "tokenKey": "v0",
        "paramKey": "v0",
        "label": "发射初速率 v₀",
        "unit": "m/s",
        "min": 1,
        "max": 14,
        "step": 0.5,
        "precision": 2
      }
    ],
    "when": {
      "mode": [
        "incline-flat"
      ],
      "dragCoeff": [
        0
      ]
    }
  },
  {
    "id": "horizontal-launch-initial",
    "title": "水平抛出的初速度分量",
    "latex": "v_{0x}=\\htmlClass{pf-live-var}{\\htmlData{param=v0}{v_0}},\\quad v_{0y}=0",
    "bindings": [
      {
        "tokenKey": "v0",
        "paramKey": "v0",
        "label": "发射初速率 v₀",
        "unit": "m/s",
        "min": 1,
        "max": 14,
        "step": 0.5,
        "precision": 2
      }
    ],
    "when": {
      "mode": [
        "incline-flat"
      ]
    }
  }
];
export const mechProjectileCouplingPlugin = Object.assign(defineSimulationPlugin<
  ProjectileCouplingParams,
  ProjectileCouplingState
>({
  meta: {
    id: 'mech-projectile-coupling',
    title: '抛体运动与斜面/曲面耦合（安全包络与阻力）(M04)',
    textbookRef: '人教版 必修第二册 第五章 第3节',
    curriculumTags: ['物理观念', '科学思维', '科学探究'],
    difficulty: '压轴专题',
    version: '2.0.0'
  },
  defaultView:{minScale:.001,scale:(p,v)=>projectileInitialView(p,v).scale,offsetRatioX:(p,v)=>projectileInitialView(p,v).offsetRatioX,offsetRatioY:(p,v)=>projectileInitialView(p,v).offsetRatioY},
  getParamFields:p=>paramSchema.filter(f=>f.key==='inclineDeg'?p.mode==='incline-flat':f.key==='troughRadius'?p.mode==='semicircle-trough':f.key==='launchAngleDeg'?p.mode!=='incline-flat':true),
  paramSchema,
  presets: projectileCouplingPresets,
  engine: {
    createInitialState,
    step: stepProjectileCoupling,
    computeObservables,
    checkInvariants
  },
  layers: [
    { id: 'surface', label: '斜面/半圆槽与安全包络', defaultVisible: true },
    { id: 'trajectory', label: '抛体轨迹与真空对照', defaultVisible: true },
    { id:'construction',label:'速度与真空几何构造',defaultVisible:true }
  ],
  telemetryChannels: [
    { key: 'x', label: '水平位移 x', unit: 'm', color: '#38bdf8' },
    { key: 'y', label: '竖直位移 y', unit: 'm', color: '#f472b6' },
    { key: 'totalMechanicalEnergy', label: '机械能 E', unit: 'J', color: '#4ade80' }
  ],
  getControlHandles: (s, params) => {
    if(s.t>0||s.termination)return [];
    const a = params.mode === 'incline-flat' ? 0 : degToRad(params.launchAngleDeg),k=projectileVelocityScale(s,params);
    return [
      {
        id: 'launch-vec',
        label: `v₀=${params.v0.toFixed(1)}`,
        position: { x: params.v0 * Math.cos(a) * k, y: params.v0 * Math.sin(a) * k },
        origin: { x: 0, y: 0 },
        handleKind: 'vector',
        color: '#4ade80',
        showWhenIdle:false,
        onDrag: (wp) => ({
          v0:Math.max(1,Math.min(14,Math.round((params.mode==='incline-flat'?Math.max(0,wp.x):Math.hypot(wp.x,wp.y))/k*2)/2)),
          ...(params.mode==='incline-flat'?{}:{launchAngleDeg:Math.max(0,Math.min(85,Math.round(Math.atan2(Math.max(0,wp.y),Math.max(.001,wp.x))*180/Math.PI/5)*5))})
        })
      }
    ];
  },
  getForceVectors: (state, params) => {
    const spd = Math.hypot(state.vx, state.vy);
    const fDrag = params.dragCoeff * spd;
    return [
      { id: 'mg', label: 'mg', origin: { x: state.x, y: state.y }, force: { x: 0, y: -params.mass * CLASSROOM_GRAVITY }, color: '#fbbf24', unit: 'N' },
      ...(fDrag > 1e-4
        ? [{ id: 'drag', label: 'f_空', origin: { x: state.x, y: state.y }, force: { x: -fDrag * state.vx, y: -fDrag * state.vy }, color: '#f472b6', unit: 'N' }]
        : [])
    ];
  },
  referenceFrames: [
    {
      id: 'projectile-comoving',
      label: '抛体随动参考系',
      getOrigin: (s) => ({ x: s.x, y: s.y }),
      getVelocity: (s) => ({ x: s.vx, y: s.vy })
    }
  ],
  sceneSerializer: {
    exportScene: (_s, params) => ({
      schemaVersion: '2.0',
      modelId: 'mech-projectile-coupling',
      title: '抛体斜面耦合',
      params
    }),
    importScene: (dsl) => dsl.params as Partial<ProjectileCouplingParams>
  },
  formatFormulas:(s,p)=>{
    const pair=(a:string,b:string)=>'\\begin{gathered}'+a+'\\\\'+b+'\\end{gathered}';
    const n=(x:number)=>x.toFixed(3);
    const readout=pair('v_x='+n(s.vx)+'\\,\\mathrm{m/s}','v_y='+n(s.vy)+'\\,\\mathrm{m/s}');
    const far=vacuumFarthest(p);
    return [{id:'m04-velocity',label:'当前速度（撞击前瞬时值）',latex:p.dragCoeff===0?'v_x=v_{0x},\\ v_y=v_{0y}-gt':'m\\dot{\\vec v}=m\\vec g-c_d|\\vec v|\\vec v',substitutedLatex:readout},
      ...(far?[{id:'m04-farthest',label:'真空理论最远点与飞行时间',latex:pair('t_* = v_0\\tan\\theta/g','t_f=2t_*'),substitutedLatex:pair('t_*='+n(far.t)+'\\,\\mathrm s','d_{\\max}='+n(far.distance)+'\\,\\mathrm m')}]:[]),
      ...(p.mode==='semicircle-trough'?[{id:'m04-trough',label:'真实下半圆槽壁',latex:pair('(x-R)^2+y^2=R^2','y\\le0,\\ 0\\le x\\le2R')}]:[]),
      ...(p.mode==='safety-envelope'?[{id:'m04-envelope',label:'真空包络（不是当前轨迹）',latex:'y_e=\\frac{v_0^2}{2g}-\\frac{gx^2}{2v_0^2}'}]:[]),
      ...(s.termination?[{id:'m04-terminal',label:s.landed?'撞击 · 已终止':'飞出槽口 · 已终止',latex:'t='+n(s.t)+'\\,\\mathrm s'}]:[])];
  },
  exportDiagramIR:(s,p,opts)=>{
    const d=projectileDiagram(s,p,opts);return {width:900,height:560,viewBox:d.bounds,title:'抛体运动 · 真实边界与解析构造',primitives:d.items.map(x=>x.primitive)};
  },
  renderCanvas:(ctx,s,p,vp,layers)=>{
    const d=projectileDiagram(s,p),m=createWorldMapper(vp),paper=vp.theme==='projector';
    const palette:Record<ProjectileRole,string>=paper?{surface:'#334155',envelope:'#92400e',trajectory:'#0369a1',vacuum:'#64748b',velocity:'#166534',construction:'#6d28d9',event:'#be185d',ink:'#0f172a'}:{surface:'#cbd5e1',envelope:'#fbbf24',trajectory:'#38bdf8',vacuum:'#94a3b8',velocity:'#4ade80',construction:'#c4b5fd',event:'#f472b6',ink:'#e2e8f0'};
    const labels:Array<{id:string;x:number;y:number;text:string;color:string;font:string}>=[];
    for(const [i,{primitive:q,role,layer}] of d.items.entries()){
      if(layer!=='always'&&!layers.has(layer))continue;
      const color=palette[role];ctx.save();ctx.fillStyle=color;ctx.strokeStyle=color;ctx.lineWidth=role==='surface'||role==='trajectory'?2.5:1.7;
      if(q.kind==='line'||q.kind==='arrow'){
        const a=m.toScreen(q.x1,q.y1),b=m.toScreen(q.x2,q.y2);
        ctx.setLineDash(q.dashed?[5,5]:[]);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();ctx.setLineDash([]);
        if(q.kind==='arrow'){
          const ang=Math.atan2(b.y-a.y,b.x-a.x);
          if(Math.hypot(b.x-a.x,b.y-a.y)>2){ctx.beginPath();ctx.moveTo(b.x,b.y);ctx.lineTo(b.x-9*Math.cos(ang-.4),b.y-9*Math.sin(ang-.4));ctx.lineTo(b.x-9*Math.cos(ang+.4),b.y-9*Math.sin(ang+.4));ctx.closePath();ctx.fill();}
          if(q.label)labels.push({id:'arrow-'+i,x:(a.x+b.x)/2+Math.sin(ang)*15,y:(a.y+b.y)/2-Math.cos(ang)*15,text:q.label,color,font:'bold 13px sans-serif'});
        }
      }else if(q.kind==='arc'){
        const c=m.toScreen(q.cx,q.cy);ctx.beginPath();ctx.arc(c.x,c.y,m.len(q.r),-q.startAngle,-q.endAngle,true);ctx.stroke();
      }else if(q.kind==='circle'){
        const c=m.toScreen(q.cx,q.cy);ctx.beginPath();ctx.arc(c.x,c.y,Math.max(3,m.len(q.r)),0,2*Math.PI);if(q.fill)ctx.fill();else ctx.stroke();
      }else if(q.kind==='polyline'||q.kind==='trajectory'){
        ctx.setLineDash(q.dashed?[5,5]:[]);ctx.beginPath();q.points.forEach((p,j)=>{const c=m.toScreen(p.x,p.y);if(j===0)ctx.moveTo(c.x,c.y);else ctx.lineTo(c.x,c.y);});ctx.stroke();
      }else if(q.kind==='text'){
        const c=m.toScreen(q.x,q.y);labels.push({id:'text-'+i,x:c.x,y:c.y,text:q.text,color,font:'13px sans-serif'});
      }
      ctx.restore();
    }
    resolveAndDrawLabels(ctx,labels,vp.width,vp.height);
  }
}), { liveFormulas,fitProjectileViewport,projectileBoundsFit });
export default mechProjectileCouplingPlugin;
