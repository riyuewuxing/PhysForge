import type { LiveFormulaSpec } from '@physforge/sim-sdk';
import { CLASSROOM_GRAVITY } from '@physforge/physics-core';
import { createWorldMapper, defineSimulationPlugin, resolveAndDrawLabels, type CanvasLabel, type DiagramPrimitive, type ParamFieldSpec, type TelemetryChannelSpec, type Viewport } from '@physforge/sim-sdk';
import { acScopePresets } from './presets.js';
import {
  checkInvariants,
  equivalentMetrics,
  CRT_SCREEN_DRAW_RADIUS,
  CRT_CM_PER_DRAW_UNIT,
  EQ_MASS,
  computeObservables,
  createInitialState,
  stepAcScope,
  type AcScopeParams,
  type AcScopeState
} from './engine.js';

const paramSchema: readonly ParamFieldSpec<AcScopeParams>[] = [
  {
    key: 'mode',
    kind: 'select',
    label: '电场交互模型',
    defaultValue: 'ac-square-wave',
    options: [
      { value: 'ac-square-wave', label: '方波交变电场四相位对比' },
      { value: 'ac-sine-wave', label: '正弦交变电场加速' },
      { value: 'oscilloscope-lissajous', label: '示波管余辉与李萨如图' },
      { value: 'equivalent-gravity', label: '等效重力场与等效最高点' }
    ]
  },
  { key: 'periodT', kind: 'number', label: '交变周期 T', unit: 's', min: 0.6, max: 4.0, step: 0.2, defaultValue: 2.0 },
  { key: 'accelA0', kind: 'number', label: '峰值电场加速度 qE₀/m', unit: 'm/s²', min: 0, max: 10, step: 0.5, defaultValue: 4.0 },
  { key: 'uAccelV', kind: 'number', label: '示波管加速电压 U₁', unit: 'V', min: 0, max: 2400, step: 100, defaultValue: 1200 },
  { key: 'uXMaxV', kind: 'number', label: 'X 扫描电压幅值', unit: 'V', min: 0, max: 200, step: 5, defaultValue: 110 },
  { key: 'uYMaxV', kind: 'number', label: 'Y 信号电压幅值', unit: 'V', min: 0, max: 200, step: 5, defaultValue: 110 },
  { key: 'freqRatioYOverX', kind: 'number', label: '示波器频率比 fy/fx', unit: '', min: 0.5, max: 4, step: 0.5, defaultValue: 2 },
  { key: 'phaseDeltaDeg', kind: 'number', label: 'X/Y 初相差 δ', unit: '°', min: 0, max: 180, step: 15, defaultValue: 90 },
  { key: 'eqFieldAccelX', kind: 'number', label: '等效电场水平加速度 qEx/m', unit: 'm/s²', min: -15, max: 15, step: 0.1, defaultValue: 9.8 },
  { key: 'eqFieldAccelY', kind: 'number', label: '等效电场竖直加速度 qEy/m', unit: 'm/s²', min: -8, max: 12, step: 0.1, defaultValue: 0 },
  { key: 'pendulumLengthL', kind: 'number', label: '等效重力摆长 L', unit: 'm', min: 0.5, max: 2, step: 0.1, defaultValue: 1.2 },
  { key: 'initialAngleDeg', kind: 'number', label: '初始摆角 θ₀', unit: '°', min: -180, max: 180, step: 5, defaultValue: -10 }
];


const liveFormulas: readonly LiveFormulaSpec[] = [
  {
    "id": "period-frequency",
    "title": "交变场周期与角频率",
    "latex": "\\omega=\\frac{2\\pi}{\\htmlClass{pf-live-var}{\\htmlData{param=periodT}{T}}}",
    "bindings": [
      {
        "tokenKey": "periodT",
        "paramKey": "periodT",
        "label": "交变周期 T",
        "unit": "s",
        "min": 0.6,
        "max": 4,
        "step": 0.2,
        "precision": 2
      }
    ],
    "when": {
      "mode": [
        "ac-square-wave",
        "ac-sine-wave",
        "oscilloscope-lissajous"
      ]
    }
  },
  {
    "id": "lissajous-frequency-ratio",
    "title": "李萨如图两轴角频率比",
    "latex": "\\omega_y=\\htmlClass{pf-live-var}{\\htmlData{param=freqRatioYOverX}{\\kappa}}\\omega_x",
    "bindings": [
      {
        "tokenKey": "freqRatioYOverX",
        "paramKey": "freqRatioYOverX",
        "label": "示波器频率比 fy/fx",
        "unit": "",
        "min": 0.5,
        "max": 4,
        "step": 0.5,
        "precision": 2
      }
    ],
    "when": {
      "mode": [
        "oscilloscope-lissajous"
      ]
    }
  },
  {
    "id": "effective-gravity",
    "title": "重力与电场力合成的等效重力加速度",
    "latex": "g_{\\rm eff}=\\sqrt{\\htmlClass{pf-live-var}{\\htmlData{param=eqFieldAccelX}{a_x}}^2+(\\htmlClass{pf-live-var}{\\htmlData{param=eqFieldAccelY}{a_y}}-g)^2}",
    "bindings": [
      {
        "tokenKey": "eqFieldAccelX",
        "paramKey": "eqFieldAccelX",
        "label": "等效电场水平加速度 qEx/m",
        "unit": "m/s²",
        "min": -15,
        "max": 15,
        "step": 0.1,
        "precision": 2
      },
      {
        "tokenKey": "eqFieldAccelY",
        "paramKey": "eqFieldAccelY",
        "label": "等效电场竖直加速度 qEy/m",
        "unit": "m/s²",
        "min": -8,
        "max": 12,
        "step": 0.1,
        "precision": 2
      }
    ],
    "when": {
      "mode": [
        "equivalent-gravity"
      ]
    }
  }
];

const phaseLabels=['0','T/8','T/4','3T/8'],phaseKeys=['0','Eighth','Quarter','ThreeEighths'];
const phaseColors=['#38bdf8','#f472b6','#4ade80','#fbbf24'];
const phaseChannels:TelemetryChannelSpec[]=phaseKeys.flatMap((key,i)=>[
  {key:'x'+key,label:'t₀='+phaseLabels[i]+' 位移 x',unit:'m',color:phaseColors[i]!},
  {key:'v'+key,label:'t₀='+phaseLabels[i]+' 速度 v',unit:'m/s',color:phaseColors[i]!}
]);
const allChannels:readonly TelemetryChannelSpec[]=[
  ...phaseChannels,{key:'fieldAcceleration',label:'交变场加速度 a',unit:'m/s²',color:'#a78bfa'},
  {key:'screenXCm',label:'实际屏点 X',unit:'cm',color:'#fbbf24'},
  {key:'screenYCm',label:'实际屏点 Y',unit:'cm',color:'#f472b6'},
  {key:'signalUxV',label:'X 信号电压',unit:'V',color:'#38bdf8'},
  {key:'signalUyV',label:'Y 信号电压',unit:'V',color:'#4ade80'},
  {key:'beamOn',label:'屏幕命中（1亮/0暗）',unit:'',color:'#a78bfa'},
  {key:'eqThetaDeg',label:'有向摆角',unit:'°',color:'#38bdf8'},
  {key:'eqOmega',label:'角速度',unit:'rad/s',color:'#fbbf24'},
  {key:'rodForceN',label:'有向杆反力',unit:'N',color:'#4ade80'},
  {key:'eqTotalEnergy',label:'总能量',unit:'J',color:'#f472b6'}
];
const screenR=CRT_SCREEN_DRAW_RADIUS,cmScale=1/CRT_CM_PER_DRAW_UNIT;
export function acLaneGeometry(s:AcScopeState){
  const xmin=Math.min(0,...s.particles.map(p=>p.x)),xmax=Math.max(0,...s.particles.map(p=>p.x));
  const span=Math.max(2,xmax-xmin),center=(xmin+xmax)/2,left=center-.70*span,right=center+.70*span;
  const dy=Math.max(.58,(right-left)*.16);
  return {left,right,dy,ys:[1.5,.5,-.5,-1.5].map(k=>k*dy),span:right-left};
}
export interface AcSafeRect{left:number;right:number;top:number;bottom:number}
export function acDiagramBounds(s:AcScopeState,p:AcScopeParams){
  if(p.mode==='oscilloscope-lissajous')return {minX:-1.8,maxX:1.8,minY:-1.72,maxY:1.88};
  if(p.mode==='equivalent-gravity'){
    const e=equivalentMetrics(s,p),radius=Math.max(e.L*1.28,1.3);
    return {minX:-Math.max(radius,Math.abs(p.eqFieldAccelX)*.1+.2),maxX:Math.max(radius,Math.abs(p.eqFieldAccelX)*.1+.2),
      minY:-radius,maxY:Math.max(radius,Math.abs(p.eqFieldAccelY)*.1+.2)};
  }
  const g=acLaneGeometry(s);
  return {minX:g.left-.10*g.span,maxX:g.right+.12*g.span,minY:-2.2*g.dy,maxY:2.75*g.dy};
}
export function fitAcScopeViewport(s:AcScopeState,p:AcScopeParams,v:Viewport,safe:AcSafeRect):Viewport|null{
  const b=acDiagramBounds(s,p),w=safe.right-safe.left,h=safe.bottom-safe.top;
  if(w<140||h<120)return null;
  const ppm=Math.min((w-88)/(b.maxX-b.minX),(h-64)/(b.maxY-b.minY));
  if(!Number.isFinite(ppm)||ppm<=0)return null;
  return {...v,scale:ppm/(.24*Math.min(v.width,v.height)),
    offsetX:(safe.left+safe.right)/2-(b.minX+b.maxX)*ppm/2-.45*v.width,
    offsetY:(safe.top+safe.bottom)/2+(b.minY+b.maxY)*ppm/2-.5*v.height};
}
export function acScopeBoundsFit(s:AcScopeState,p:AcScopeParams,v:Viewport,safe:AcSafeRect){
  const b=acDiagramBounds(s,p),m=createWorldMapper(v);
  return m.toX(b.minX)>=safe.left+24&&m.toX(b.maxX)<=safe.right-24&&m.toY(b.maxY)>=safe.top+20&&m.toY(b.minY)<=safe.bottom-20;
}
function initialView(p:AcScopeParams,v:{width:number;height:number}){
  const full={...v,dpr:1,scale:1,offsetX:0,offsetY:0};
  const q=fitAcScopeViewport(createInitialState(p),p,full,{left:30,right:v.width-30,top:28,bottom:v.height-28})??full;
  return {scale:q.scale,offsetRatioX:q.offsetX/v.width,offsetRatioY:q.offsetY/v.height};
}
export const emAcFieldOscilloscopePlugin = Object.assign(defineSimulationPlugin<AcScopeParams, AcScopeState>({
  meta: {
    id: 'em-ac-field-oscilloscope',
    title: '交变电场、示波管与等效重力场 (E03)',
    textbookRef: '人教版 必修第三册 第十章 第5节',
    curriculumTags: ['物理观念', '科学思维', '科学探究'],
    difficulty: '压轴专题',
    version: '2.0.0'
  },
  defaultView:{
    minScale:.0001,scale:(p,v)=>initialView(p,v).scale,
    offsetRatioX:(p,v)=>initialView(p,v).offsetRatioX,
    offsetRatioY:(p,v)=>initialView(p,v).offsetRatioY
  },
  paramSchema,
  getParamFields:p=>{
    const keys=p.mode==='equivalent-gravity'?['mode','eqFieldAccelX','eqFieldAccelY','pendulumLengthL','initialAngleDeg']:
      p.mode==='oscilloscope-lissajous'?['mode','uAccelV','uXMaxV','uYMaxV','periodT','freqRatioYOverX','phaseDeltaDeg']:['mode','periodT','accelA0'];
    return keys.flatMap(key=>paramSchema.filter(f=>f.key===key));
  },
  presets: acScopePresets,
  engine: {
    createInitialState,
    step: stepAcScope,
    computeObservables,
    checkInvariants
  },
  layers: [
    { id: 'mainStage', label: '粒子群 / 示波屏 / 等效轴', defaultVisible: true },
    { id: 'phosphorTrail', label: '示波荧光余辉 / 等效重力线', defaultVisible: true }
  ],
  telemetryChannels:allChannels,
  getTelemetryChannels:p=>{
    const keys=p.mode==='equivalent-gravity'?['eqThetaDeg','eqOmega','rodForceN','eqTotalEnergy']:
      p.mode==='oscilloscope-lissajous'?['screenXCm','screenYCm','signalUxV','signalUyV','beamOn']:
      ['x0','xQuarter','xEighth','xThreeEighths','v0','vQuarter','vEighth','vThreeEighths','fieldAcceleration'];
    return keys.flatMap(key=>allChannels.filter(c=>c.key===key));
  },
  getForceVectors:(state,p)=>{
    if(p.mode!=='equivalent-gravity')return [];
    const e=equivalentMetrics(state,p),origin={x:e.x,y:e.y};
    return [
      {id:'mg',label:'mg',origin,force:{x:0,y:-EQ_MASS*CLASSROOM_GRAVITY},category:'gravity',color:'#f59e0b',unit:'N'},
      {id:'qe',label:'qE',origin,force:{x:EQ_MASS*p.eqFieldAccelX,y:EQ_MASS*p.eqFieldAccelY},category:'electric',color:'#38bdf8',unit:'N'},
      {id:'rod-reaction',label:e.rodForce<0?'杆压力':'杆拉力',origin,force:{x:-e.rodForce*e.rx,y:-e.rodForce*e.ry},category:'tension',color:'#4ade80',unit:'N'}
    ];
  },
  referenceFrames: [
    {
      id: 'equivalent-bob',
      label: '刚性杆摆球随动系',
      getOrigin: (s,p)=>p.mode==='equivalent-gravity'?{x:equivalentMetrics(s,p).x,y:equivalentMetrics(s,p).y}:{x:0,y:0},
      getVelocity: (s,p)=>p.mode==='equivalent-gravity'?{x:equivalentMetrics(s,p).L*Math.cos(s.theta)*s.omega,y:equivalentMetrics(s,p).L*Math.sin(s.theta)*s.omega}:{x:0,y:0}
    }
  ],
  getControlHandles: (_s, params) =>
    params.mode === 'equivalent-gravity'
      ? [
          {
            id: 'eq-field',
            label: `qE/m=(${params.eqFieldAccelX.toFixed(1)}, ${params.eqFieldAccelY.toFixed(1)})`,
            position: { x: params.eqFieldAccelX * 0.1, y: params.eqFieldAccelY * 0.1 },
            handleKind: 'vector',
            showWhenIdle:false,
            color: '#38bdf8',
            onDrag: (wp) => ({
              eqFieldAccelX: Number(Math.max(-15, Math.min(15, wp.x * 10)).toFixed(1)),
              eqFieldAccelY: Number(Math.max(-8, Math.min(12, wp.y * 10)).toFixed(1))
            })
          }
        ]
      : [],
  sceneSerializer: {
    exportScene: (_s, params) => ({
      schemaVersion: '2.0',
      modelId: 'em-ac-field-oscilloscope',
      title: '交变电场与示波管模型',
      params
    }),
    importScene: (dsl) => dsl.params as Partial<AcScopeParams>
  },
  exportDiagramIR:(state,p)=>{
    const primitives:DiagramPrimitive[]=[];
    if(p.mode==='oscilloscope-lissajous'){
      primitives.push({kind:'circle',cx:0,cy:0,r:screenR},{kind:'line',x1:-screenR,y1:0,x2:screenR,y2:0,dashed:true},
        {kind:'line',x1:0,y1:-screenR,x2:0,y2:screenR,dashed:true},{kind:'text',x:0,y:screenR+.22,text:'示波屏 R=6cm',align:'middle'});
      let segment:{x:number;y:number}[]=[];
      const flush=()=>{if(segment.length>1)primitives.push({kind:'polyline',points:segment});segment=[];};
      for(const q of state.scopeTrail){if(q.breakBefore)flush();segment.push({x:q.x*cmScale,y:q.y*cmScale});}flush();
      if(state.screenX!==null&&state.screenY!==null)primitives.push({kind:'circle',cx:state.screenX*cmScale,cy:state.screenY*cmScale,r:.04,fill:true});
      else primitives.push({kind:'text',x:0,y:-screenR-.2,text:'屏幕未命中',align:'middle'});
    }else if(p.mode==='equivalent-gravity'){
      const e=equivalentMetrics(state,p);
      primitives.push({kind:'circle',cx:0,cy:0,r:e.L,dashed:true},{kind:'line',x1:0,y1:0,x2:e.x,y2:e.y,strokeWidth:2},{kind:'circle',cx:e.x,cy:e.y,r:.065,fill:true});
      if(e.mag>0){
        const x=e.L*e.gx/e.mag,y=e.L*e.gy/e.mag;
        primitives.push({kind:'arrow',x1:-x,y1:-y,x2:x,y2:y,label:'g_eff',dashed:true},{kind:'text',x,y:y-.12,text:'等效低点'},{kind:'text',x:-x,y:-y+.12,text:'等效高点'});
      }else primitives.push({kind:'text',x:0,y:e.L+.15,text:'g_eff=0，无唯一等效高低点',align:'middle'});
    }else{
      const g=acLaneGeometry(state),a=computeObservables(state,p).fieldAcceleration!;
      state.particles.forEach((q,k)=>{
        const y=g.ys[k]!;
        primitives.push({kind:'line',x1:g.left,y1:y,x2:g.right,y2:y},{kind:'circle',cx:q.x,cy:y,r:g.dy*.075,fill:q.active},
          {kind:'text',x:g.left,y:y+g.dy*.25,text:'t₀='+phaseLabels[k]+(q.active?' x='+q.x.toFixed(3)+'m':' 未释放')});
      });
      if(a!==0)primitives.push({kind:'arrow',x1:0,y1:2.25*g.dy,x2:Math.sign(a)*g.span*.18,y2:2.25*g.dy,label:'a(t)'});
    }
    return {width:820,height:500,viewBox:acDiagramBounds(state,p),title:'E03 交变场与示波管 · 当前物理状态',primitives};
  },
  renderCanvas:(ctx,state,p,viewport,layers)=>{
    const m=createWorldMapper(viewport),paper=viewport.theme==='projector',labels:CanvasLabel[]=[];
    const ink=paper?'#0f172a':'#e2e8f0',muted=paper?'#475569':'#94a3b8',green=paper?'#166534':'#4ade80',blue=paper?'#0369a1':'#38bdf8',gold=paper?'#92400e':'#fbbf24';
    const label=(id:string,x:number,y:number,text:string,color=ink,font='13px sans-serif')=>{const q=m.toScreen(x,y);labels.push({id,x:q.x,y:q.y,text,color,font});};
    const line=(x1:number,y1:number,x2:number,y2:number,color:string,w=1.5,dash=false)=>{
      const a=m.toScreen(x1,y1),b=m.toScreen(x2,y2);ctx.strokeStyle=color;ctx.lineWidth=w;ctx.setLineDash(dash?[5,5]:[]);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();ctx.setLineDash([]);
    };
    const arrow=(x1:number,y1:number,x2:number,y2:number,color:string)=>{
      const a=m.toScreen(x1,y1),b=m.toScreen(x2,y2),dx=b.x-a.x,dy=b.y-a.y,n=Math.hypot(dx,dy);if(n<1e-8)return;
      line(x1,y1,x2,y2,color,2);const u=dx/n,v=dy/n,h=Math.min(9,n*.35);ctx.fillStyle=color;ctx.beginPath();ctx.moveTo(b.x,b.y);ctx.lineTo(b.x-h*u+h*.45*v,b.y-h*v-h*.45*u);ctx.lineTo(b.x-h*u-h*.45*v,b.y-h*v+h*.45*u);ctx.closePath();ctx.fill();
    };
    const dot=(x:number,y:number,r:number,color:string,glow=false)=>{
      const q=m.toScreen(x,y);ctx.save();ctx.fillStyle=color;if(glow&&!paper){ctx.shadowColor=color;ctx.shadowBlur=12;}ctx.beginPath();ctx.arc(q.x,q.y,Math.max(4,m.len(r)),0,Math.PI*2);ctx.fill();ctx.restore();
    };
    ctx.save();
    if(p.mode==='oscilloscope-lissajous'){
      const q=m.toScreen(0,0),R=m.len(screenR);
      if(layers.has('mainStage')){
        const grad=ctx.createRadialGradient(q.x-R*.2,q.y-R*.25,0,q.x,q.y,R);
        grad.addColorStop(0,paper?'#effaf3':'#124b3d');grad.addColorStop(1,paper?'#e0f1e8':'#021d1a');
        ctx.fillStyle=grad;ctx.strokeStyle=green;ctx.lineWidth=2.5;ctx.beginPath();ctx.arc(q.x,q.y,R,0,Math.PI*2);ctx.fill();ctx.stroke();
        ctx.save();ctx.clip();line(-screenR,0,screenR,0,muted,1,true);line(0,-screenR,0,screenR,muted,1,true);
        for(let k=-4;k<=4;k+=2){if(!k)continue;const x=k*cmScale;line(x,-.04,x,.04,muted,1);line(-.04,x,.04,x,muted,1);}
        if(layers.has('phosphorTrail')&&state.scopeTrail.length){
          ctx.beginPath();
          state.scopeTrail.forEach((r,i)=>{const pt=m.toScreen(r.x*cmScale,r.y*cmScale);if(i===0||r.breakBefore)ctx.moveTo(pt.x,pt.y);else ctx.lineTo(pt.x,pt.y);});
          ctx.strokeStyle=green;ctx.lineWidth=2;ctx.lineJoin='round';if(!paper){ctx.shadowBlur=10;ctx.shadowColor=green;}ctx.stroke();ctx.shadowBlur=0;
        }
        if(state.screenX!==null&&state.screenY!==null)dot(state.screenX*cmScale,state.screenY*cmScale,.035,gold,true);
        ctx.restore();
        label('screen-title',0,screenR+.2,'准静态双轴示波屏 · R=6 cm',ink,'bold 14px sans-serif');
        const status={lit:'真实命中','no-acceleration':'未加速 · 无电子束','x-plate':'X 板触板 · 断光','y-plate':'Y 板触板 · 断光','both-plates':'两轴触板 · 断光','screen-miss':'超出屏幕 · 断光'}[state.beamStatus];
        label('beam-status',0,-screenR-.2,status,state.beamStatus==='lit'?green:gold,'bold 13px sans-serif');
      }
    }else if(p.mode==='equivalent-gravity'){
      const e=equivalentMetrics(state,p);
      if(layers.has('mainStage')){
        const pivot=m.toScreen(0,0);ctx.strokeStyle=muted;ctx.lineWidth=1;ctx.setLineDash([4,5]);ctx.beginPath();ctx.arc(pivot.x,pivot.y,m.len(e.L),0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);
        line(-.18,0,.18,0,muted,3);line(0,0,e.x,e.y,ink,3);dot(0,0,.03,muted);dot(e.x,e.y,.075,blue,true);
      }
      if(layers.has('phosphorTrail')){
        if(e.mag>0){
          const ux=e.gx/e.mag,uy=e.gy/e.mag;
          line(-ux*e.L*1.12,-uy*e.L*1.12,ux*e.L*1.12,uy*e.L*1.12,gold,1.3,true);
          arrow(0,0,ux*e.L*.65,uy*e.L*.65,gold);
          dot(ux*e.L,uy*e.L,.035,gold);dot(-ux*e.L,-uy*e.L,.035,gold);
          label('low',ux*e.L*1.2,uy*e.L*1.2,'等效低点',gold);
          label('high',-ux*e.L*1.2,-uy*e.L*1.2,'等效高点',gold);
        }else label('zero-g',0,e.L*.65,'g_eff=0 · 无唯一等效轴',gold,'bold 14px sans-serif');
        label('rod',0,-e.L*1.22,'刚性轻杆 · m=1kg · '+(e.rodForce<0?'受压':'向内反力'),ink);
      }
    }else if(layers.has('mainStage')){
      const g=acLaneGeometry(state),obs=computeObservables(state,p),a=obs.fieldAcceleration!;
      for(let k=0;k<4;k++){
        const q=state.particles[k]!,y=g.ys[k]!,color=paper?['#0369a1','#be185d','#166534','#92400e'][k]!:phaseColors[k]!;
        line(g.left,y,g.right,y,muted,1);
        line(0,y-.11*g.dy,0,y+.11*g.dy,muted,1);
        if(q.active){line(0,y,q.x,y,color,2);dot(q.x,y,g.dy*.075,color,true);}
        else {const pt=m.toScreen(0,y);ctx.strokeStyle=muted;ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(pt.x,pt.y,5,0,Math.PI*2);ctx.stroke();}
        label('phase-'+k,(g.left+g.right)/2,y+.30*g.dy,'t₀='+phaseLabels[k]+' · '+(q.active?'x='+q.x.toFixed(3)+' m  v='+q.v.toFixed(3)+' m/s':'未释放'),color);
      }
      const center=(g.left+g.right)/2;
      if(a!==0)arrow(center-Math.sign(a)*g.span*.12,2.15*g.dy,center+Math.sign(a)*g.span*.12,2.15*g.dy,blue);
      label('ac-field',center,2.58*g.dy,(p.mode==='ac-square-wave'?'方波':'正弦')+' · a(t)='+a.toFixed(3)+' m/s²',ink,'bold 14px sans-serif');
      label('axis',center,-2.02*g.dy,'x 轴实际位移 · 竖向分道仅为示意',muted);
    }
    resolveAndDrawLabels(ctx,labels,viewport.width,viewport.height);ctx.restore();
  },
  formatFormulas:(state,p)=>{
    const o=computeObservables(state,p);
    if(p.mode==='oscilloscope-lissajous')return [
      {id:'crt-speed',label:'加速后速度（U₁=0 无束）',latex:'v_0=\\sqrt{2\\eta U_1}'},
      {id:'crt-y',label:'未触板且命中屏幕时的偏转',latex:'Y=\\frac{U_y L_1}{2dU_1}(\\frac{L_1}{2}+L_2)',
        substitutedLatex:state.screenX!==null&&state.screenY!==null?'X='+state.screenX.toFixed(3)+'\\,\\mathrm{cm},\\quad Y='+state.screenY.toFixed(3)+'\\,\\mathrm{cm}':'\\text{No screen hit}'},
      {id:'crt-condition',label:'两轴均未触板且屏面半径内',latex:'|y_p|<d/2,\\quad X^2+Y^2\\le R^2'}
    ];
    if(p.mode==='equivalent-gravity')return [
      {id:'eq-field',label:'合成重力加速度',latex:'\\mathbf g_{\\rm eff}=(a_x,a_y-g)',substitutedLatex:'g_{\\rm eff}='+o.gEffMag!.toFixed(3)+'\\,\\mathrm{m/s^2}'},
      {id:'eq-rod',label:'沿杆向内为正；负值为压力',latex:'T=m(L\\omega^2+\\mathbf g_{\\rm eff}\\cdot\\hat r)',substitutedLatex:'T='+o.rodForceN!.toFixed(3)+'\\,\\mathrm N'},
      {id:'eq-energy',label:'固定等效场总能量',latex:'E=\\frac12mL^2\\omega^2-m\\mathbf g_{\\rm eff}\\cdot\\mathbf r',substitutedLatex:'E='+o.eqTotalEnergy!.toFixed(3)+'\\,\\mathrm J'}
    ];
    return [
      {id:'ac-phase',label:'真实释放时间与解析位移',latex:'v=\\int_{t_0}^{t}a(s)\\,ds,\\quad x=\\int_{t_0}^{t}v(s)\\,ds'},
      {id:'ac-wave',label:p.mode==='ac-square-wave'?'前半正、后半负':'连续正弦加速度',latex:p.mode==='ac-square-wave'?'a(t)=\\begin{cases}a_0,&0\\le t\\bmod T<T/2\\\\-a_0,&T/2\\le t\\bmod T<T\\end{cases}':'a(t)=a_0\\sin(2\\pi t/T)',
        substitutedLatex:'a='+o.fieldAcceleration!.toFixed(3)+'\\,\\mathrm{m/s^2}'},
      {id:'ac-quarter',label:'四分之一周期释放',latex:'x(t_0+T)=0,\\quad v(t_0+T)=0',
        substitutedLatex:o.xQuarter===undefined?'\\text{Not released}':'x='+o.xQuarter.toFixed(4)+'\\,\\mathrm m'}
    ];
  }
}), {liveFormulas,fitAcScopeViewport,acScopeBoundsFit,acDiagramBounds});

export default emAcFieldOscilloscopePlugin;
