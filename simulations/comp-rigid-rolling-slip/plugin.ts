import { CLASSROOM_GRAVITY } from '@physforge/physics-core';
import { createWorldMapper, defineSimulationPlugin, type ForceVectorItem, type ParamFieldSpec } from '@physforge/sim-sdk';
import { rollingScene, rollingItems, rollingDiagram, SPEED_SCALE, V_LANE, W_LANE, type RollingRole } from './geometry.js';
import { rigidRollingPresets } from './presets.js';
import {
  SHAPE_INERTIA_COEFF,
  checkInvariants,
  rollingQuantities,
  computeObservables,
  createInitialState,
  stepRigidRollingSlip,
  type RigidRollingParams,
  type RigidRollingState
} from './engine.js';

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

const paramSchema: readonly ParamFieldSpec<RigidRollingParams>[] = [
  {
    key: 'scenario',
    kind: 'select',
    label: '竞赛物理场景',
    defaultValue: 'flat-bowling-slip',
    options: [
      { value: 'flat-bowling-slip', label: '水平打滑→纯滚动转换 (Hybrid)' },
      { value: 'incline-race', label: '四刚体同斜面纯滚动竞速' }
    ]
  },
  {
    key: 'shape',
    kind: 'select',
    label: '刚体构型 I = c m R²',
    defaultValue: 'solid-sphere',
    options: [
      { value: 'solid-sphere', label: '实心球 (c = 2/5)' },
      { value: 'solid-cylinder', label: '实心圆柱 (c = 1/2)' },
      { value: 'hollow-sphere', label: '空心球壳 (c = 2/3)' },
      { value: 'thin-ring', label: '薄圆环 (c = 1)' }
    ]
  },
  { key: 'massKg', kind: 'number', label: '质量 m', unit: 'kg', defaultValue: 2.0, min: 0.5, max: 10, step: 0.5 },
  { key: 'radiusM', kind: 'number', label: '半径 R', unit: 'm', defaultValue: 0.12, min: 0.06, max: 0.3, step: 0.02 },
  { key: 'v0Mps', kind: 'number', label: '初质心速度 v₀', unit: 'm/s', defaultValue: 7.0, min: -10, max: 15, step: 0.5 },
  { key: 'omega0Radps', kind: 'number', label: '初角速度 ω₀', unit: 'rad/s', defaultValue: 0, min: -150, max: 100, step: 10 },
  { key: 'muK', kind: 'number', label: '动摩擦因数 μ_k', defaultValue: 0.25, min: 0, max: 0.8, step: 0.05 },
  { key: 'inclineDeg', kind: 'number', label: '斜面倾角 θ', unit: '°', defaultValue: 20, min: 5, max: 45, step: 5 }
];

export const compRigidRollingSlipPlugin = defineSimulationPlugin<RigidRollingParams, RigidRollingState>({
  meta: {
    id: 'comp-rigid-rolling-slip',
    title: '刚体定轴转动与滑滚转换 (C01)',
    textbookRef: '人教版 选择性必修一 & 强基竞赛 · 刚体转动与滑滚',
    curriculumTags: ['物理观念', '科学思维'],
    difficulty: '压轴专题',
    version: '2.0.0'
  },
  paramSchema,
  presets: rigidRollingPresets,
  engine: {
    createInitialState,
    step: stepRigidRollingSlip,
    computeObservables,
    checkInvariants
  },
  layers: [
    { id: 'main', label: '刚体滚轮与角线速度对照', defaultVisible: true }
  ],
  telemetryChannels: [
    { key: 'v', label: '质心速度 v', unit: 'm/s', color: '#38bdf8' },
    { key: 'omegaR', label: '边缘转动线速度 ωR', unit: 'm/s', color: '#fbbf24' },
    { key: 'slipSpeed', label: '触地相对滑速 v-ωR', unit: 'm/s', color: '#f43f5e' },
    { key: 'currentEnergyJ', label: '机械能 E', unit: 'J', color: '#4ade80' },
    { key: 'dissipatedEnergyJ', label: '滑动耗散能 Q', unit: 'J', color: '#fb923c' }
  ],
  getParamFields: p=>paramSchema.filter(f=>(p.scenario==='incline-race'?['scenario','shape','massKg','radiusM','inclineDeg']:['scenario','shape','massKg','radiusM','v0Mps','omega0Radps','muK']).includes(f.key)),
  defaultView: {
    scale:(p,v)=>{
      const base=Math.max(1,Math.min(v.width,v.height)*.24),usable=v.width-(v.width>=900?300:0);
      return Math.max(.1,Math.min(1.18,(usable-28)/(4.8*base),(v.height-94)/((p.scenario==='incline-race'?4.98:3.8)*base)));
    },
    offsetRatioX:(_p,v)=>(v.width-(v.width>=900?300:0))/(2*Math.max(1,v.width))-.45,
    offsetRatioY:-.01
  },
  getControlHandles:(state,p)=>{
    if(p.scenario!=='flat-bowling-slip'||state.t>1e-12)return [];
    const R=Math.max(.05,p.radiusM),vy=V_LANE-.09,wy=W_LANE-.09;
    return [
      {id:'initial-velocity',label:'v₀',position:{x:p.v0Mps*SPEED_SCALE,y:vy},origin:{x:0,y:vy},handleKind:'vector',color:'#38bdf8',
        onDrag:pos=>({v0Mps:Number(clamp(pos.x/SPEED_SCALE,-10,15).toFixed(2))})},
      {id:'initial-omega',label:'−ω₀R',position:{x:-p.omega0Radps*R*SPEED_SCALE,y:wy},origin:{x:0,y:wy},handleKind:'vector',color:'#fbbf24',
        onDrag:pos=>({omega0Radps:Number(clamp(-pos.x/(R*SPEED_SCALE),-150,100).toFixed(2))})}
    ];
  },
  getForceVectors:(s,p):ForceVectorItem[]=>{
    const sc=rollingScene(s,p),q=rollingQuantities(s,p),b=sc.selected;
    const normalForce=q.m*CLASSROOM_GRAVITY*Math.cos(q.theta);
    const vectors:ForceVectorItem[]=[
      {id:'gravity',label:'mg',origin:b.center,force:{x:0,y:-q.m*CLASSROOM_GRAVITY},color:'#fbbf24',category:'gravity'},
      {id:'normal',label:'F_N',origin:b.contact,force:{x:normalForce*sc.normal.x,y:normalForce*sc.normal.y},color:'#38bdf8',category:'normal'}
    ];
    if(Math.abs(q.f)>1e-12)vectors.push({id:'friction',label:s.mode==='pure-rolling'?'f_静':'f_动',origin:b.contact,
      force:{x:q.f*sc.tangent.x,y:q.f*sc.tangent.y},color:'#f472b6',category:'friction'});
    return vectors;
  },
  referenceFrames: [{
    id:'cylinder-cm',label:'刚体质心随动系（显示窗口）',
    getOrigin:(s,p)=>rollingScene(s,p).selected.center,
    getVelocity:(s,p)=>{const sc=rollingScene(s,p);return {x:s.v*sc.tangent.x,y:s.v*sc.tangent.y};}
  }],
  sceneSerializer: {
    exportScene: (_s, params) => ({
      schemaVersion: '2.0',
      modelId: 'comp-rigid-rolling-slip',
      title: '刚体定轴转动与滑滚转换',
      params
    }),
    importScene: (dsl) => dsl.params as Partial<RigidRollingParams>
  },
  exportDiagramIR:rollingDiagram,
  renderCanvas:(ctx,s,p,vp,layers)=>{
    if(!layers.has('main'))return;
    const m=createWorldMapper(vp),screen=m.toScreen,paper=vp.theme==='projector';
    const colors:Record<RollingRole,string>=paper?{ink:'#172033',muted:'#64748b',velocity:'#0369a1',rotation:'#92400e',contact:'#9f1239',rolling:'#166534',slipping:'#be123c',energy:'#166534',heat:'#c2410c'}:{ink:'#e2e8f0',muted:'#94a3b8',velocity:'#38bdf8',rotation:'#fbbf24',contact:'#fb7185',rolling:'#4ade80',slipping:'#fb7185',energy:'#4ade80',heat:'#fb923c'};
    const font=Math.max(9,Math.min(13,m.len(.070)));
    function trace(points:readonly {x:number;y:number}[]){
      if(points.length<2)return;ctx.beginPath();points.forEach((p,i)=>{const z=screen(p.x,p.y);if(i)ctx.lineTo(z.x,z.y);else ctx.moveTo(z.x,z.y);});ctx.stroke();
    }
    const line=(x1:number,y1:number,x2:number,y2:number)=>trace([{x:x1,y:y1},{x:x2,y:y2}]);
    function label(x:number,y:number,t:string,align:CanvasTextAlign='center',size=font){
      const a=screen(x,y);ctx.save();ctx.font='500 '+size+'px system-ui,sans-serif';ctx.textAlign=align;ctx.textBaseline='middle';ctx.fillText(t,a.x,a.y);ctx.restore();
    }
    ctx.save();ctx.lineCap='round';ctx.lineJoin='round';
    for(const {role,primitive:d} of rollingItems(s,p)){
      const paint=colors[role];ctx.strokeStyle=paint;ctx.fillStyle=paint;ctx.lineWidth=role==='muted'?1.05:1.9;
      ctx.setLineDash('dashed' in d&&d.dashed?[4,4]:[]);
      if(d.kind==='line'){line(d.x1,d.y1,d.x2,d.y2);}
      else if(d.kind==='arrow'){
        line(d.x1,d.y1,d.x2,d.y2);const a=screen(d.x1,d.y1),b=screen(d.x2,d.y2),angle=Math.atan2(b.y-a.y,b.x-a.x),len=Math.hypot(b.x-a.x,b.y-a.y),h=Math.min(8,len*.45);
        if(h>.4){ctx.beginPath();ctx.moveTo(b.x-h*Math.cos(angle-.47),b.y-h*Math.sin(angle-.47));ctx.lineTo(b.x,b.y);ctx.lineTo(b.x-h*Math.cos(angle+.47),b.y-h*Math.sin(angle+.47));ctx.stroke();}
      }else if(d.kind==='circle'){
        const z=screen(d.cx,d.cy);ctx.beginPath();ctx.arc(z.x,z.y,Math.max(.9,m.len(d.r)),0,2*Math.PI);
        if(d.fill)ctx.fill();else{if(role==='rolling'||role==='slipping'||role==='velocity'){ctx.globalAlpha=.13;ctx.fill();ctx.globalAlpha=1;}ctx.stroke();}
      }else if(d.kind==='rect'){
        const z=screen(d.x,d.y+d.height),w=m.len(d.width),h=m.len(d.height);
        if(role!=='ink'){ctx.globalAlpha=.6;ctx.fillRect(z.x,z.y,w,h);ctx.globalAlpha=1;}ctx.strokeRect(z.x,z.y,w,h);
      }else if(d.kind==='hatchedGround'){
        line(d.x1,d.y1,d.x2,d.y2);
        const dx=d.x2-d.x1,dy=d.y2-d.y1,l=Math.hypot(dx,dy);
        if(l>0){const ux=dx/l,uy=dy/l,nx=-uy,ny=ux,depth=d.depth??.06;for(let u=.05;u<l;u+=.12){
          const x=d.x1+u*ux,y=d.y1+u*uy;line(x,y,x-depth*nx-.04*ux,y-depth*ny-.04*uy);
        }}
      }else if(d.kind==='text')label(d.x,d.y,d.text,d.align==='start'?'left':d.align==='end'?'right':'center');
    }
    ctx.restore();
    const sc=rollingScene(s,p),q=rollingQuantities(s,p);
    if(ctx.canvas?.dataset)ctx.canvas.dataset.rigidRollingRendered=JSON.stringify({
      t:s.t,scenario:p.scenario,shape:p.shape,m:p.massKg,R:p.radiusM,v0:p.v0Mps,omega0:p.omega0Radps,mu:p.muK,incline:p.inclineDeg,
      mode:s.mode,x:s.x,v:s.v,omega:s.omega,theta:s.theta,tC:s.transitionTimeS,vC:s.transitionSpeedMps,
      energy:s.currentEnergyJ,initialEnergy:s.initialEnergyJ,q,bodies:sc.bodies,windowOrigin:sc.windowOrigin,raceExtent:sc.raceExtent,
      selected:sc.selected,normal:sc.normal,tangent:sc.tangent,
      handles:{v:screen(p.v0Mps*SPEED_SCALE,V_LANE-.09),omega:screen(-p.omega0Radps*p.radiusM*SPEED_SCALE,W_LANE-.09),scale:m.len(SPEED_SCALE)}
    });
  },
  formatFormulas:(s,p)=>{
    const q=rollingQuantities(s,p);
    if(p.scenario==='incline-race')return [
      {id:'rolling-inertia',label:'转动惯量',latex:'I=cmR^2',substitutedLatex:'I='+q.I.toFixed(4)+'\\ \\mathrm{kg\\,m^2}'},
      {id:'rolling-incline',label:'静摩擦充足的纯滚加速度',latex:'a=\\frac{g\\sin\\theta}{1+c}',substitutedLatex:'a='+q.acceleration.toFixed(3)+'\\ \\mathrm{m/s^2}'},
      {id:'rolling-static',label:'静摩擦条件（不是动摩擦因数）',latex:'\\mu_s\\ge\\frac{c\\tan\\theta}{1+c}',substitutedLatex:'\\mu_s\\ge '+q.requiredStaticMu.toFixed(4)},
      {id:'rolling-energy',label:'平动、转动及重力势能',latex:'\\frac12mv^2+\\frac12I\\omega^2-mgs\\sin\\theta=0'}
    ];
    return [
      {id:'rolling-slip',label:'有向接触点速度',latex:'u=v-\\omega R',substitutedLatex:'u='+q.u.toFixed(4)+'\\ \\mathrm{m/s}'},
      {id:'rolling-friction',label:'动摩擦反抗滑移；纯滚水平面无摩擦',latex:s.mode==='slipping'?'f=-\\mu_kmg\\operatorname{sgn}(u)':'f=0',substitutedLatex:'f='+q.f.toFixed(3)+'\\ \\mathrm{N}'},
      {id:'rolling-transition',label:'纯滚转换时刻（μk>0）',latex:q.predictedTime===null?'\\mu_k=0\\Rightarrow\\text{不锁定}':'t_c=\\frac{|v_0-\\omega_0R|}{\\mu_k g(1+1/c)}',...(q.predictedTime===null?{}:{substitutedLatex:'t_c='+q.predictedTime.toFixed(5)+'\\ \\mathrm{s}'})},
      {id:'rolling-momentum',label:'水平固定接触高度角动量',latex:'L=mRv+I\\omega=\\mathrm{const.}',substitutedLatex:'L='+q.angularMomentum.toFixed(4)+'\\ \\mathrm{kg\\,m^2/s}'},
      {id:'rolling-heat',label:'滑动耗散与机械能闭合',latex:'Q=\\frac{mc(u_0^2-u^2)}{2(1+c)}',substitutedLatex:'Q='+q.heat.toFixed(3)+'\\ \\mathrm{J}'}
    ];
  }
});

export default compRigidRollingSlipPlugin;
