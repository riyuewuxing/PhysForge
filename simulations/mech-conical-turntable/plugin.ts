import { CLASSROOM_GRAVITY as g } from '@physforge/physics-core';
import { createWorldMapper,defineSimulationPlugin,resolveAndDrawLabels,type ParamFieldSpec,type TelemetryChannelSpec } from '@physforge/sim-sdk';
import { conicalTurntablePresets } from './presets.js';
import { checkInvariants,computeObservables,createInitialState,stepConicalTurntable,type ConicalTurntableParams,type ConicalTurntableState } from './engine.js';
import { turntableDiagram,turntableForceVectors,turntableInitialView,fitTurntableViewport,turntableBoundsFit,type TurntableRole } from './diagram.js';

const paramSchema: readonly ParamFieldSpec<ConicalTurntableParams>[] = [
  {
    key: 'mode',
    kind: 'select',
    label: '圆周动力学模型',
    options: [
      { label: '水平圆盘双物块轻绳临界', value: 'turntable-dual' },
      { label: '圆锥摆空间稳定转动', value: 'conical-pendulum' }
    ],
    defaultValue: 'turntable-dual'
  },
  { key: 'omega', kind: 'number', label: '转动角速度 ω', unit: 'rad/s', min: 0, max: 6, step: 0.1, defaultValue: 1.7 },
  { key: 'massA', kind: 'number', label: '物块 A / 摆球 mA', unit: 'kg', min: 0.5, max: 5, step: 0.5, defaultValue: 1 },
  { key: 'massB', kind: 'number', label: '物块 B mB', unit: 'kg', min: 0.5, max: 5, step: 0.5, defaultValue: 2 },
  { key: 'radiusA', kind: 'number', label: 'A 半径 rA', unit: 'm', min: 0.2, max: 1.2, step: 0.1, defaultValue: 0.6 },
  { key: 'radiusB', kind: 'number', label: 'B 半径 rB', unit: 'm', min: 0.8, max: 2.4, step: 0.1, defaultValue: 1.5 },
  { key: 'mu', kind: 'number', label: '摩擦因数 μ（动静暂同）', unit: '', min: 0, max: 0.8, step: 0.05, defaultValue: 0.3 },
  { key: 'pendulumLength', kind: 'number', label: '圆锥摆长 L', unit: 'm', min: 0.6, max: 2.5, step: 0.1, defaultValue: 1.5 }
];


const diskChannels:readonly TelemetryChannelSpec[]=[
  {key:'tensionN',label:'绳张力 T',unit:'N',color:'#38bdf8'},
  {key:'frictionAN',label:'A 向内摩擦分量 fA',unit:'N',color:'#4ade80'},
  {key:'frictionBN',label:'B 向内摩擦分量 fB',unit:'N',color:'#f472b6'},
  {key:'kineticEnergy',label:'地面系总动能',unit:'J',color:'#38bdf8'},
  {key:'heat',label:'摩擦热 Q',unit:'J',color:'#fbbf24'},
  {key:'diskWork',label:'盘面做功 W',unit:'J',color:'#a78bfa'}
];
const coneChannels:readonly TelemetryChannelSpec[]=[
  {key:'tensionN',label:'真实绳张力 T',unit:'N',color:'#38bdf8'},
  {key:'coneAngleDeg',label:'真实圆锥半顶角 θ',unit:'°',color:'#fbbf24'}
];
const format=(x:number|null)=>x===null?'\\text{不存在}':x.toFixed(3);
export const mechConicalTurntablePlugin=Object.assign(defineSimulationPlugin<ConicalTurntableParams,ConicalTurntableState>({
  meta:{id:'mech-conical-turntable',title:'圆锥摆、水平圆盘双物块临界滑移 (M07)',textbookRef:'人教版 必修第二册 第六章 第2–3节',curriculumTags:['物理观念','科学思维'],difficulty:'压轴专题',version:'2.0.0'},
  defaultView:{minScale:.001,scale:(p,v)=>turntableInitialView(createInitialState(p),p,v).scale,offsetRatioX:(p,v)=>turntableInitialView(createInitialState(p),p,v).offsetRatioX,offsetRatioY:(p,v)=>turntableInitialView(createInitialState(p),p,v).offsetRatioY},
  paramSchema,presets:conicalTurntablePresets,
  getParamFields:p=>paramSchema.filter(f=>p.mode==='turntable-dual'?f.key!=='pendulumLength':!['massB','radiusA','radiusB','mu'].includes(f.key)),
  engine:{createInitialState,step:stepConicalTurntable,computeObservables,checkInvariants},
  layers:[{id:'turntable',label:'实际圆盘 / 摆线与俯视',defaultVisible:true},{id:'forces',label:'实际受力矢量（同力标尺）',defaultVisible:true},{id:'construction',label:'几何与相对速度构造',defaultVisible:true},{id:'sweep',label:'静态可行域 f,T–ω² 图',defaultVisible:true}],
  telemetryChannels:[...diskChannels,...coneChannels.filter(c=>c.key!=='tensionN')],
  getTelemetryChannels:p=>p.mode==='turntable-dual'?diskChannels:coneChannels,
  getControlHandles:(s,p)=>{
    if(s.t>0)return [];
    if(p.mode==='conical-pendulum'){
      const origin={x:0,y:1.1};return [{id:'length',label:'L='+p.pendulumLength.toFixed(1)+'m',position:s.a,origin,handleKind:'radius',color:'#fbbf24',onDrag:wp=>({pendulumLength:Number(Math.max(.6,Math.min(2.5,Math.hypot(wp.x-origin.x,wp.y-origin.y))).toFixed(1))})}];
    }
    return [{id:'radius-a',label:'rA='+p.radiusA.toFixed(1)+'m',position:s.a,origin:{x:0,y:0},handleKind:'radius',color:'#38bdf8',onDrag:wp=>({radiusA:Number(Math.max(.2,Math.min(1.2,Math.hypot(wp.x,wp.y))).toFixed(1))})},
      {id:'radius-b',label:'rB='+p.radiusB.toFixed(1)+'m',position:s.b,origin:{x:0,y:0},handleKind:'radius',color:'#f472b6',onDrag:wp=>({radiusB:Number(Math.max(.8,Math.min(2.4,Math.hypot(wp.x,wp.y))).toFixed(1))})}];
  },
  getForceVectors:turntableForceVectors,
  referenceFrames:[{id:'turntable',label:'A / 摆球平移参考系',description:'只作坐标平移，不宣称惯性系。',getOrigin:s=>s.a,getVelocity:s=>s.va}],
  sceneSerializer:{exportScene:(_s,params)=>({schemaVersion:'2.0',modelId:'mech-conical-turntable',title:'圆盘临界与圆锥摆',params}),importScene:dsl=>dsl.params as Partial<ConicalTurntableParams>},
  exportDiagramIR:(s,p,opts)=>{const d=turntableDiagram(s,p,opts);return {width:960,height:560,viewBox:d.bounds,title:p.mode==='turntable-dual'?'双物块圆盘 · 真实位置与静态可行域':'圆锥摆 · 截面正投影与同相位俯视',primitives:d.items.map(i=>i.primitive)};},
  formatFormulas:(s,p)=>p.mode==='conical-pendulum'?[{id:'cone-condition',label:s.rotatingCone?'非零半径圆锥摆':'竖直静止支（无实际周期）',latex:s.rotatingCone?'T\\cos\\theta=mg,\\quad T\\sin\\theta=m\\omega^2L\\sin\\theta':'\\omega\\le\\sqrt{g/L},\\quad\\theta=0,\\quad T=mg',substitutedLatex:'\\theta='+s.coneAngleDeg.toFixed(3)+'^\\circ,\\quad T='+s.tensionN.toFixed(3)+'\\,\\mathrm{N}'}]:[
    {id:'static-feasibility',label:'共转静态可行区间（非滑移力）',latex:'T\\in[\\max(0,Q_A-F_A,Q_B-F_B),\\min(Q_A+F_A,Q_B+F_B)]',substitutedLatex:'T_{\\min}='+s.staticTMin.toFixed(3)+',\\quad T_{\\max}='+s.staticTMax.toFixed(3)+'\\,\\mathrm{N}'},
    {id:'critical-omegas',label:'静摩擦分段临界（rad/s）',latex:'D=m_Br_B-m_Ar_A,\\quad\\omega_3=\\sqrt{\\frac{\\mu(m_A+m_B)g}{|D|}}',substitutedLatex:'\\omega_1='+format(s.omega1)+',\\quad\\omega_2='+format(s.omega2)+',\\quad\\omega_3='+format(s.omega3)},
    ...(s.slippingOut?[{id:'kinetic-ledger',label:'二维滑移的实际能量账本',latex:'K-K_0=W_{\\rm disk}-Q',substitutedLatex:'\\Delta K='+(s.kineticEnergy-s.initialEnergy).toFixed(3)+',\\quad W-Q='+(s.diskWork-s.heat).toFixed(3)+'\\,\\mathrm{J}'}]:[])
  ],
  renderCanvas:(ctx,s,p,vp,layers)=>{
    const m=createWorldMapper(vp),d=turntableDiagram(s,p),paper=vp.theme==='projector';
    const colors:Record<TurntableRole,string>=paper?{disk:'#e2e8f0',rim:'#334155',guide:'#64748b',rope:'#334155','block-a':'#0369a1','block-b':'#be185d','friction-a':'#166534','friction-b':'#be185d',tension:'#075985',velocity:'#7c3aed',ink:'#0f172a',event:'#b45309','plot-axis':'#475569','plot-limit':'#64748b',gravity:'#92400e',net:'#166534',bob:'#b45309',orbit:'#475569','top-bob':'#b45309',pivot:'#0f172a'}:{disk:'#25354a',rim:'#bac7d3',guide:'#64748b',rope:'#d6e5ef','block-a':'#38bdf8','block-b':'#f472b6','friction-a':'#4ade80','friction-b':'#f472b6',tension:'#38bdf8',velocity:'#c4b5fd',ink:'#e2e8f0',event:'#fbbf24','plot-axis':'#94a3b8','plot-limit':'#64748b',gravity:'#fbbf24',net:'#4ade80',bob:'#fbbf24',orbit:'#94a3b8','top-bob':'#fbbf24',pivot:'#cbd5e1'};
    const labels:Array<{id:string;x:number;y:number;text:string;color:string;font:string}>=[];
    for(const [i,{primitive:q,role,layer}] of d.items.entries()){
      if(layer!=='always'&&!layers.has(layer))continue;
      const color=colors[role];ctx.save();ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=role==='rim'?3:role==='rope'?2.5:1.7;
      if(q.kind==='line'||q.kind==='arrow'){
        const a=m.toScreen(q.x1,q.y1),b=m.toScreen(q.x2,q.y2);ctx.setLineDash(q.dashed?[5,5]:[]);
        ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();ctx.setLineDash([]);
        if(q.kind==='arrow'){
          const ang=Math.atan2(b.y-a.y,b.x-a.x);
          if(Math.hypot(b.x-a.x,b.y-a.y)>2){ctx.beginPath();ctx.moveTo(b.x,b.y);ctx.lineTo(b.x-9*Math.cos(ang-.4),b.y-9*Math.sin(ang-.4));ctx.lineTo(b.x-9*Math.cos(ang+.4),b.y-9*Math.sin(ang+.4));ctx.closePath();ctx.fill();}
          if(q.label)labels.push({id:'arrow-'+i,x:(a.x+b.x)/2+Math.sin(ang)*13,y:(a.y+b.y)/2-Math.cos(ang)*13,text:q.label,color,font:'bold 13px sans-serif'});
        }
      }else if(q.kind==='circle'||q.kind==='arc'){
        const c=m.toScreen(q.cx,q.cy),r=m.len(q.r);ctx.setLineDash(q.dashed?[5,5]:[]);
        if(q.kind==='circle'&&q.fill&&role==='disk'&&!paper){const grad=ctx.createRadialGradient(c.x-.24*r,c.y-.32*r,.04*r,c.x,c.y,r);grad.addColorStop(0,'#394d63');grad.addColorStop(.76,'#233346');grad.addColorStop(1,'#152235');ctx.fillStyle=grad;}
        if(q.kind==='circle'&&q.fill&&(role==='bob'||role==='top-bob')&&!paper){ctx.shadowBlur=12;ctx.shadowColor=color;}
        ctx.beginPath();ctx.arc(c.x,c.y,q.kind==='circle'&&q.fill?Math.max(2,r):r,q.kind==='arc'?-q.startAngle:0,q.kind==='arc'?-q.endAngle:2*Math.PI,q.kind==='arc');
        if(q.kind==='circle'&&q.fill)ctx.fill();else ctx.stroke();
      }else if(q.kind==='block'){
        const c=m.toScreen(q.cx,q.cy),w=m.len(q.width),h=m.len(q.height);
        if(!paper){const grad=ctx.createLinearGradient(c.x-w/2,c.y-h/2,c.x+w/2,c.y+h/2);grad.addColorStop(0,'#e2e8f0');grad.addColorStop(.35,color);grad.addColorStop(1,role==='block-a'?'#075985':'#9d174d');ctx.fillStyle=grad;ctx.shadowBlur=8;ctx.shadowColor=color;}
        ctx.fillRect(c.x-w/2,c.y-h/2,w,h);ctx.shadowBlur=0;ctx.strokeRect(c.x-w/2,c.y-h/2,w,h);
      }else if(q.kind==='polyline'||q.kind==='trajectory'){
        ctx.lineWidth=2.3;ctx.setLineDash(q.dashed?[6,4]:[]);ctx.beginPath();q.points.forEach((pt,j)=>{const c=m.toScreen(pt.x,pt.y);if(j===0)ctx.moveTo(c.x,c.y);else ctx.lineTo(c.x,c.y);});ctx.stroke();
      }else if(q.kind==='text'){
        const c=m.toScreen(q.x,q.y);labels.push({id:'text-'+i,x:c.x,y:c.y,text:q.text,color,font:'13px sans-serif'});
      }
      ctx.restore();
    }
    resolveAndDrawLabels(ctx,labels.filter(l=>l.x>=0&&l.x<=vp.width&&l.y>=0&&l.y<=vp.height),vp.width,vp.height);
  }
}),{fitTurntableViewport,turntableBoundsFit});
export default mechConicalTurntablePlugin;
