import { createWorldMapper, defineSimulationPlugin, type ParamFieldSpec,type TelemetryChannelSpec } from '@physforge/sim-sdk';
import {relativityItems,relativityDiagram,relativityBounds,relativityViewBounds,fitRelativityViewport,relativityEventPoint,potentialHandle} from './geometry.js';
import { relativityQuantumPresets } from './presets.js';
import {
  TDSE_DX,
  TDSE_GRID_N,
  potentialSupport,
  checkInvariants,
  computeObservables,
  createInitialState,
  solveLorentzInterval,
  stepRelativityQuantum,
  type RelativityQuantumParams,
  type RelativityQuantumState
} from './engine.js';

const paramSchema: readonly ParamFieldSpec<RelativityQuantumParams>[] = [
  {
    key: 'mode',
    kind: 'select',
    label: '近代物理拓展模块',
    defaultValue: 'tdse-tunneling',
    options: [
      { value: 'tdse-tunneling', label: '一维量子波包势垒隧穿 (512格 TDSE)' },
      { value: 'minkowski-relativity', label: '狭义相对论闵可夫斯基时空图' }
    ]
  },
  {
    key: 'potentialShape',
    kind: 'select',
    label: '量子势场形状 V(x)',
    defaultValue: 'single-barrier',
    options: [
      { value: 'single-barrier', label: '单矩形势垒' },
      { value: 'double-barrier', label: '双势垒干涉腔' },
      { value: 'potential-well', label: '负方势阱 (-V₀)' }
    ]
  },
  { key: 'barrierHeightV0', kind: 'number', label: '势垒高度 |V₀|', defaultValue: 2.45, min: 0.5, max: 5.0, step: 0.1 },
  { key: 'barrierWidth', kind: 'number', label: '势场宽度参数 w', defaultValue: 1.4, min: 0.6, max: 4.0, step: 0.2 },
  { key: 'waveMomentumK0', kind: 'number', label: '波包中心波矢 k₀', defaultValue: 2.0, min: 1.0, max: 3.5, step: 0.1 },
  { key: 'packetSigma', kind: 'number', label: '高斯波包宽度 σ', defaultValue: 3.2, min: 1.5, max: 6.0, step: 0.2 },
  { key: 'lorentzBeta', kind: 'number', label: '有向相对速度 β = v/c', defaultValue: 0.6, min: -0.95, max: 0.95, step: 0.05 },
  { key: 'eventX', kind: 'number', label: '时空事件坐标 x', defaultValue: 3.0, min: -6.0, max: 6.0, step: 0.5 },
  { key: 'eventCt', kind: 'number', label: '时空事件时间 ct', defaultValue: 5.0, min: -6.0, max: 8.0, step: 0.5 }
];

const channels:readonly TelemetryChannelSpec[]=[
  {key:'reflectionProb',label:'左区占据概率 P_L',unit:'',color:'#fbbf24'},
  {key:'transmissionProb',label:'右区占据概率 P_R',unit:'',color:'#4ade80'},
  {key:'middleProb',label:'中区占据概率 P_M',unit:'',color:'#38bdf8'},
  {key:'totalNorm',label:'总概率',unit:'',color:'#a78bfa'},
  {key:'normDrift',label:'概率归一化漂移',unit:'',color:'#f472b6'},
  {key:'energyExpectation',label:'离散能量期望',unit:'E*',color:'#38bdf8'},
  {key:'energyDrift',label:'能量期望绝对漂移',unit:'E*',color:'#fbbf24'},
  {key:'boundaryProb',label:'边缘占据概率',unit:'',color:'#fb7185'},
  {key:'maxBoundaryProb',label:'边缘占据历史峰值',unit:'',color:'#fb7185'},
  {key:'gammaFactor',label:'洛伦兹因子 γ',unit:'',color:'#38bdf8'},
  {key:'eventXPrime',label:'事件 x′',unit:'L*',color:'#38bdf8'},
  {key:'eventCtPrime',label:'事件 ct′',unit:'L*',color:'#fbbf24'},
  {key:'intervalS2',label:'间隔 s²',unit:'L*²',color:'#4ade80'},
  {key:'intervalPrimeS2',label:'间隔 s′²',unit:'L*²',color:'#38bdf8'},
  {key:'intervalError',label:'间隔绝对误差',unit:'L*²',color:'#f472b6'},
  {key:'twinStayProperTime',label:'留守 cτ',unit:'L*',color:'#4ade80'},
  {key:'twinTravelerProperTime',label:'远行 cτ',unit:'L*',color:'#38bdf8'}
];
const fields:Record<RelativityQuantumParams['mode'],readonly string[]>={
  'tdse-tunneling':['mode','potentialShape','barrierHeightV0','barrierWidth','waveMomentumK0','packetSigma'],
  'minkowski-relativity':['mode','lorentzBeta','eventX','eventCt']
};
const keys:Record<RelativityQuantumParams['mode'],readonly string[]>={
  'tdse-tunneling':['reflectionProb','transmissionProb','middleProb','totalNorm','normDrift','energyExpectation','energyDrift','boundaryProb','maxBoundaryProb'],
  'minkowski-relativity':['gammaFactor','eventXPrime','eventCtPrime','intervalS2','intervalPrimeS2','intervalError','twinStayProperTime','twinTravelerProperTime']
};
const sci=(v:number)=>{if(v===0)return '0';const [m,e]=v.toExponential(3).split('e');return m+'\\times 10^{'+Number(e)+'}';};
export const compRelativityQuantumTunnelingPlugin = Object.assign(defineSimulationPlugin<
  RelativityQuantumParams,
  RelativityQuantumState
>({
  meta: {
    id: 'comp-relativity-quantum-tunneling',
    title: '狭义相对论时空图与一维量子隧穿 (C03)',
    textbookRef: '人教版 选择性必修三 & 强基竞赛 · 相对论几何与 TDSE 隧穿',
    curriculumTags: ['物理观念', '科学思维'],
    difficulty: '压轴专题',
    version: '2.0.0'
  },
  paramSchema,
  timeSemantics:p=>p.mode==='minkowski-relativity'?'static-analytic':'evolving',
  presets: relativityQuantumPresets,
  engine: {
    createInitialState,
    step: stepRelativityQuantum,
    computeObservables,
    checkInvariants
  },
  layers: [
    { id: 'main', label: '概率密度分布 / 时空光锥图', defaultVisible: true }
  ],
  telemetryChannels:channels,
  getParamFields:p=>paramSchema.filter(f=>fields[p.mode].includes(f.key)),
  getTelemetryChannels:p=>channels.filter(c=>keys[p.mode].includes(c.key)),
  defaultView:{
    scale:(p,v)=>{const b=relativityBounds(p),base=Math.max(1,.24*Math.min(v.width,v.height)),w=v.width-(v.width>=900?300:0);return Math.max(.035,Math.min((w-48)/(b.maxX-b.minX)/base,(v.height-210)/(b.maxY-b.minY)/base));},
    offsetRatioX:(p,v)=>{const b=relativityBounds(p),w=v.width-(v.width>=900?300:0),ppm=Math.max(.035*.24*Math.min(v.width,v.height),Math.min((w-48)/(b.maxX-b.minX),(v.height-210)/(b.maxY-b.minY)));return (w/2-.45*v.width-(b.minX+b.maxX)*ppm/2)/Math.max(1,v.width);},
    offsetRatioY:-.075
  },
  sceneSerializer: {
    exportScene: (_s, params) => ({
      schemaVersion: '2.0',
      modelId: 'comp-relativity-quantum-tunneling',
      title: '狭义相对论与量子波包隧穿',
      params
    }),
    importScene: (dsl) => dsl.params as Partial<RelativityQuantumParams>
  },
  exportDiagramIR:relativityDiagram,
  renderCanvas:(ctx,s,p,vp,layers)=>{
    if(!layers.has('main'))return;
    const m=createWorldMapper(vp),paper=vp.theme==='projector';
    const colors=paper?{ink:'#172033',muted:'#64748b',main:'#0369a1',imag:'#6d28d9',green:'#166534',warm:'#92400e'}:{ink:'#e2e8f0',muted:'#94a3b8',main:'#38bdf8',imag:'#c4b5fd',green:'#4ade80',warm:'#fbbf24'};
    const trace=(points:readonly {x:number;y:number}[])=>{if(points.length<2)return;ctx.beginPath();points.forEach((p,i)=>{const q=m.toScreen(p.x,p.y);if(i)ctx.lineTo(q.x,q.y);else ctx.moveTo(q.x,q.y);});ctx.stroke();};
    ctx.save();ctx.lineCap='round';ctx.lineJoin='round';
    for(const {role,primitive:d} of relativityItems(s,p)){
      ctx.strokeStyle=colors[role];ctx.fillStyle=colors[role];ctx.lineWidth=role==='muted'?1:1.8;
      ctx.setLineDash('dashed' in d&&d.dashed?[4,4]:[]);
      if(d.kind==='line'||d.kind==='arrow'){
        trace([{x:d.x1,y:d.y1},{x:d.x2,y:d.y2}]);
        if(d.kind==='arrow'){
          const x=m.toScreen(d.x1,d.y1),y=m.toScreen(d.x2,d.y2),angle=Math.atan2(y.y-x.y,y.x-x.x);
          ctx.beginPath();ctx.moveTo(y.x,y.y);ctx.lineTo(y.x-8*Math.cos(angle-.42),y.y-8*Math.sin(angle-.42));ctx.moveTo(y.x,y.y);ctx.lineTo(y.x-8*Math.cos(angle+.42),y.y-8*Math.sin(angle+.42));ctx.stroke();
        }
      }else if(d.kind==='trajectory'||d.kind==='polyline')trace(d.points);
      else if(d.kind==='circle'){const q=m.toScreen(d.cx,d.cy);ctx.beginPath();ctx.arc(q.x,q.y,Math.max(1.5,m.len(d.r)),0,Math.PI*2);if(d.fill)ctx.fill();else ctx.stroke();}
      else if(d.kind==='rect'){const q=m.toScreen(d.x,d.y+d.height);ctx.strokeRect(q.x,q.y,m.len(d.width),m.len(d.height));}
      else if(d.kind==='text'){const q=m.toScreen(d.x,d.y);ctx.font='500 '+Math.max(10,Math.min(14,m.len(.10)))+'px system-ui,sans-serif';ctx.textAlign=d.align==='start'?'left':d.align==='end'?'right':'center';ctx.textBaseline='middle';ctx.fillText(d.text,q.x,q.y);}
    }
    ctx.restore();
    if(ctx.canvas?.dataset)ctx.canvas.dataset.relativityQuantumRendered=JSON.stringify({t:s.t,mode:p.mode,params:p,bounds:relativityViewBounds(p,vp),obs:computeObservables(s),
      ...(p.mode==='tdse-tunneling'?{support:potentialSupport(s.potential),N:TDSE_GRID_N,dx:TDSE_DX,energy:s.energyExpectation,initialEnergy:s.initialEnergy,peakDensity:Math.max(...Array.from(s.psiRe,(v,j)=>v*v+s.psiIm[j]!**2))}:
      {event:relativityEventPoint(p),lorentz:solveLorentzInterval(p.lorentzBeta,p.eventX,p.eventCt),turn:{x:5*p.lorentzBeta,ct:5},reunion:{x:0,ct:10}})});
  },
  getControlHandles:(s,p)=>{
    if(p.mode==='minkowski-relativity')return [{id:'spacetime-event',label:'拖动事件 E',position:relativityEventPoint(p),handleKind:'point',showWhenIdle:false,color:'#4ade80',onDrag:world=>{
      const o=relativityEventPoint({...p,eventX:0,eventCt:0}),x=(world.x-o.x)/.225,y=(world.y-o.y)/.225;
      return {eventX:Math.max(-6,Math.min(6,Math.round(x*2)/2)),eventCt:Math.max(-6,Math.min(8,Math.round(y*2)/2))};
    }}];
    if(s.t>1e-12)return [];
    const h=potentialHandle(s,p);
    return [{id:'potential-height',label:'|V₀|='+p.barrierHeightV0.toFixed(1),position:h.point,handleKind:'point',color:'#fbbf24',onDrag:world=>({barrierHeightV0:h.onHeight(world.y)})}];
  },
  // Generic Galilean translation frames cannot represent Lorentz boosts.
  referenceFrames:[],
  formatFormulas:(s,p)=>{
    if(p.mode==='tdse-tunneling')return [
      {id:'tdse-equation',label:'约化单位 ℏ=m=1 的含时薛定谔方程',latex:'i\\partial_t\\psi=(-\\tfrac12\\partial_x^2+V)\\psi'},
      {id:'tdse-density',label:'概率密度与归一化（离散求和）',latex:'\\rho=|\\psi|^2,\\quad N=\\sum_j\\rho_j\\Delta x',substitutedLatex:'N='+s.totalNorm.toFixed(9)},
      {id:'tdse-regions',label:'左、中、右区占据概率；非瞬时反射率/透射率',latex:'P_L+P_M+P_R=N',substitutedLatex:'\\begin{aligned}P_L&='+s.reflectionProb.toFixed(5)+'\\\\P_M&='+s.middleProb.toFixed(5)+'\\\\P_R&='+s.transmissionProb.toFixed(5)+'\\end{aligned}'},
      {id:'tdse-energy',label:'中心动能与离散 Hamiltonian 期望（波包有展宽）',latex:'E_0=k_0^2/2,\\quad\\langle H_d\\rangle=\\psi^\\dagger H_d\\psi\\Delta x',substitutedLatex:'\\begin{aligned}E_0&='+(.5*p.waveMomentumK0**2).toFixed(4)+'\\\\\\langle H_d\\rangle&='+s.energyExpectation.toFixed(5)+'\\end{aligned}'},
      {id:'tdse-cayley',label:'Crank–Nicolson 离散幺正步进',latex:'\\begin{aligned}(I+\\tfrac{i h}{2}H_d)\\psi^{n+1}\\\\=(I-\\tfrac{i h}{2}H_d)\\psi^n\\end{aligned}',substitutedLatex:'\\delta N='+sci(s.normDrift)}
    ];
    const q=solveLorentzInterval(p.lorentzBeta,p.eventX,p.eventCt);
    return [
      {id:'lorentz-gamma',label:'有向 β 与洛伦兹因子',latex:'\\beta=v/c,\\quad\\gamma=(1-\\beta^2)^{-1/2}',substitutedLatex:'\\gamma='+q.gamma.toFixed(5)},
      {id:'lorentz-event',label:'同一事件的两个参考系坐标',latex:"\\begin{aligned}x'&=\\gamma(x-\\beta ct)\\\\ct'&=\\gamma(ct-\\beta x)\\end{aligned}",substitutedLatex:"\\begin{aligned}x'&="+q.xPrime.toFixed(5)+"\\\\ct'&="+q.ctPrime.toFixed(5)+"\\end{aligned}"},
      {id:'lorentz-interval',label:'不变间隔（x 与 ct 使用相同长度单位）',latex:"\\begin{aligned}s^2&=(ct)^2-x^2\\\\&=(ct')^2-(x')^2\\end{aligned}",substitutedLatex:'s^2='+q.s2.toFixed(5)+',\\quad\\delta='+sci(q.err)},
      {id:'lorentz-twin',label:'同一出发与重逢；理想瞬时折返',latex:'c\\tau=\\int\\sqrt{1-\\beta(t)^2}\\,d(ct)',substitutedLatex:"\\begin{aligned}c\\tau_{stay}&="+s.twinStayProperTime.toFixed(4)+"\\\\c\\tau_{trip}&="+s.twinTravelerProperTime.toFixed(4)+"\\end{aligned}"}
    ];
  }
}),{fitRelativityViewport,relativityViewBounds});
export default compRelativityQuantumTunnelingPlugin;
