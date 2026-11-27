import { createWorldMapper, defineSimulationPlugin, type ParamFieldSpec,type TelemetryChannelSpec } from '@physforge/sim-sdk';
import { advancedItems,advancedDiagram,advancedBounds,advancedViewBounds,fitAdvancedViewport,pendulumBobs,normalCenters,coriolisFrames,type Role } from './geometry.js';
import { CLASSROOM_GRAVITY } from '@physforge/physics-core';
import { chaosNormalCoriolisPresets } from './presets.js';
import {
  checkInvariants,
  normalQuantities,
  coriolisQuantities,
  computeObservables,
  createInitialState,
  stepChaosNormalCoriolis,
  type ChaosNormalCoriolisParams,
  type ChaosNormalCoriolisState
} from './engine.js';

const paramSchema: readonly ParamFieldSpec<ChaosNormalCoriolisParams>[] = [
  {
    key: 'mode',
    kind: 'select',
    label: '动力学模块',
    defaultValue: 'double-pendulum',
    options: [
      { value: 'double-pendulum', label: '混沌双摆 (RK45 + 初值分离)' },
      { value: 'normal-modes', label: '双耦合振子简正模与拍频' },
      { value: 'coriolis-disk', label: '旋转圆盘非惯性科里奥利力' }
    ]
  },
  { key: 'm1Kg', kind: 'number', label: '质点 1 质量 m₁', unit: 'kg', defaultValue: 1.0, min: 0.5, max: 3.0, step: 0.2 },
  { key: 'm2Kg', kind: 'number', label: '质点 2 质量 m₂', unit: 'kg', defaultValue: 1.0, min: 0.5, max: 3.0, step: 0.2 },
  { key: 'l1M', kind: 'number', label: '上杆长 L₁', unit: 'm', defaultValue: 1.0, min: 0.5, max: 1.8, step: 0.1 },
  { key: 'l2M', kind: 'number', label: '下杆长 L₂', unit: 'm', defaultValue: 1.0, min: 0.5, max: 1.8, step: 0.1 },
  { key: 'theta1Deg', kind: 'number', label: '初角 θ₁', unit: '°', defaultValue: 135, min: 10, max: 175, step: 5 },
  { key: 'theta2Deg', kind: 'number', label: '初角 θ₂', unit: '°', defaultValue: 135, min: 10, max: 175, step: 5 },
  { key: 'springKw', kind: 'number', label: '边墙弹簧 k_w', unit: 'N/m', defaultValue: 25, min: 5, max: 60, step: 5 },
  { key: 'springKc', kind: 'number', label: '耦合弹簧 k_c', unit: 'N/m', defaultValue: 10, min: 1, max: 40, step: 2 },
  {
    key: 'normalExcite',
    kind: 'select',
    label: '简正模初态激发',
    defaultValue: 'symmetric',
    options: [
      { value: 'symmetric', label: '同相简正模 x₁=x₂' },
      { value: 'antisymmetric', label: '反相简正模 x₁=-x₂' },
      { value: 'single-beat', label: '单侧偏置（拍频传递）' }
    ]
  },
  { key: 'diskOmegaRadps', kind: 'number', label: '圆盘角速度 Ω', unit: 'rad/s', defaultValue: 1.2, min: -3.0, max: 3.0, step: 0.2 },
  { key: 'puckSpeedMps', kind: 'number', label: '冰球惯性射速 v₀', unit: 'm/s', defaultValue: 0.9, min: 0, max: 2.0, step: 0.1 }
];

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

const channels:readonly TelemetryChannelSpec[]=[
  {key:'dpEnergyDriftRel',label:'双摆能量最大相对漂移',unit:'',color:'#4ade80'},
  {key:'dpDivergenceRad',label:'两初值主值角距',unit:'rad',color:'#f43f5e'},
  {key:'dpTheta1',label:'θ₁ 主值角',unit:'rad',color:'#38bdf8'},
  {key:'dpTheta2',label:'θ₂ 主值角',unit:'rad',color:'#fbbf24'},
  {key:'x1Nm',label:'振子 1 位移',unit:'m',color:'#38bdf8'},
  {key:'x2Nm',label:'振子 2 位移',unit:'m',color:'#fbbf24'},
  {key:'normalEnergyJ',label:'双振子总能量',unit:'J',color:'#4ade80'},
  {key:'normalSymEnergyJ',label:'同相模能量',unit:'J',color:'#38bdf8'},
  {key:'normalAntiEnergyJ',label:'反相模能量',unit:'J',color:'#fbbf24'},
  {key:'labRadius',label:'惯性系径向距离',unit:'m',color:'#4ade80'},
  {key:'rotRadius',label:'旋转系径向距离',unit:'m',color:'#38bdf8'},
  {key:'coriolisDeviation',label:'双系位置偏差',unit:'m',color:'#f43f5e'},
  {key:'coriolisVelocityError',label:'双系速度偏差',unit:'m/s',color:'#fbbf24'},
  {key:'coriolisAccel',label:'科氏加速度大小',unit:'m/s²',color:'#38bdf8'},
  {key:'centrifugalAccel',label:'离心加速度大小',unit:'m/s²',color:'#f472b6'}
];
const modeKeys:Record<ChaosNormalCoriolisParams['mode'],readonly string[]>={
  'double-pendulum':['mode','m1Kg','m2Kg','l1M','l2M','theta1Deg','theta2Deg'],
  'normal-modes':['mode','m1Kg','springKw','springKc','normalExcite'],
  'coriolis-disk':['mode','diskOmegaRadps','puckSpeedMps']
};
const channelKeys:Record<ChaosNormalCoriolisParams['mode'],readonly string[]>={
  'double-pendulum':['dpEnergyDriftRel','dpDivergenceRad','dpTheta1','dpTheta2'],
  'normal-modes':['x1Nm','x2Nm','normalEnergyJ','normalSymEnergyJ','normalAntiEnergyJ'],
  'coriolis-disk':['labRadius','rotRadius','coriolisDeviation','coriolisVelocityError','coriolisAccel','centrifugalAccel']
};
export const compChaosNormalCoriolisPlugin = Object.assign(defineSimulationPlugin<
  ChaosNormalCoriolisParams,
  ChaosNormalCoriolisState
>({
  meta: {
    id: 'comp-chaos-normal-coriolis',
    title: '混沌双摆、简正模与科里奥利力 (C02)',
    textbookRef: '人教版 选择性必修一 & 强基竞赛 · 分析力学与非惯性系',
    curriculumTags: ['物理观念', '科学思维'],
    difficulty: '压轴专题',
    version: '2.0.0'
  },
  paramSchema,
  presets: chaosNormalCoriolisPresets,
  engine: {
    createInitialState,
    step: stepChaosNormalCoriolis,
    computeObservables,
    checkInvariants
  },
  layers: [
    { id: 'main', label: '混沌分叉 / 简正波形 / 双系对照', defaultVisible: true }
  ],
  telemetryChannels:channels,
  getParamFields:p=>paramSchema.filter(f=>modeKeys[p.mode].includes(f.key)).map(f=>p.mode==='normal-modes'&&f.key==='m1Kg'?{...f,label:'每个振子的质量 m'}:f),
  getTelemetryChannels:p=>channels.filter(c=>channelKeys[p.mode].includes(c.key)),
  defaultView:{
    scale:(p,v)=>{const b=advancedBounds(createInitialState(p),p),base=Math.max(1,.24*Math.min(v.width,v.height)),w=v.width-(v.width>=900?300:0);return Math.max(.035,Math.min((w-48)/(b.maxX-b.minX)/base,(v.height-210)/(b.maxY-b.minY)/base));},
    offsetRatioX:(p,v)=>{const b=advancedBounds(createInitialState(p),p),base=Math.max(1,.24*Math.min(v.width,v.height)),w=v.width-(v.width>=900?300:0),ppm=Math.max(.035*base,Math.min((w-48)/(b.maxX-b.minX),(v.height-210)/(b.maxY-b.minY)));return (w/2-.45*v.width-(b.maxX+b.minX)*ppm/2)/Math.max(1,v.width);},
    offsetRatioY:-.075
  },
  getForceVectors: (state, params) => {
    if (params.mode === 'double-pendulum') {
      const [bob1,bob2]=pendulumBobs(state.dpState,params);
      return [
        { id: 'weight-1', label: 'm₁g', origin: bob1, force: { x: 0, y: -params.m1Kg * CLASSROOM_GRAVITY }, color: '#fbbf24', category: 'gravity', unit: 'N' },
        { id: 'weight-2', label: 'm₂g', origin: bob2, force: { x: 0, y: -params.m2Kg * CLASSROOM_GRAVITY }, color: '#fb923c', category: 'gravity', unit: 'N' }
      ];
    }
    if (params.mode === 'normal-modes') {
      const [x1, x2] = state.nmVerlet.positions;
      const safeX1 = x1 ?? 0;
      const safeX2 = x2 ?? 0;
      const [origin1,origin2]=normalCenters(state,params);
      return [
        { id: 'normal-restoring-1', label: 'F₁', origin: origin1, force: { x: -params.springKw * safeX1 - params.springKc * (safeX1 - safeX2), y: 0 }, color: '#38bdf8', category: 'other', unit: 'N' },
        { id: 'normal-restoring-2', label: 'F₂', origin: origin2, force: { x: -params.springKw * safeX2 - params.springKc * (safeX2 - safeX1), y: 0 }, color: '#fbbf24', category: 'other', unit: 'N' }
      ];
    }
    const q=coriolisQuantities(state,params),origin=coriolisFrames(state,params).rot;
    return [
      {id:'coriolis-specific',label:'a_C (F/m)',origin,force:{x:q.axC,y:q.ayC},color:'#38bdf8',category:'other',unit:'N/kg'},
      {id:'centrifugal-specific',label:'a_cf (F/m)',origin,force:{x:q.axF,y:q.ayF},color:'#f472b6',category:'other',unit:'N/kg'}
    ];
  },
  getControlHandles: (state, params) => {
    if(params.mode!=='double-pendulum'||state.t>1e-12)return [];
    const [bob1,bob2]=pendulumBobs(state.dpState,params);
    const angleFrom = (x: number, y: number) => {
      const thetaDeg = (Math.atan2(x, -y) * 180) / Math.PI;
      return Number(clamp(thetaDeg, 10, 175).toFixed(1));
    };
    return [
      {
        id: 'double-pendulum-bob1',
        label: `θ₁=${params.theta1Deg.toFixed(1)}°`,
        position: bob1,
        handleKind: 'point',
        color: '#38bdf8',
        onDrag: (worldPos) => ({ theta1Deg: angleFrom(worldPos.x, worldPos.y) })
      },
      {
        id: 'double-pendulum-bob2',
        label: `θ₂=${params.theta2Deg.toFixed(1)}°`,
        position: bob2,
        handleKind: 'point',
        color: '#fbbf24',
        onDrag: (worldPos) => ({ theta2Deg: angleFrom(worldPos.x - bob1.x, worldPos.y - bob1.y) })
      }
    ];
  },
  referenceFrames: [
    {
      id: 'inertial',
      label: '地面惯性系',
      description: '惯性实验室坐标系，原点位于旋转圆盘中心。',
      getOrigin: () => ({ x: 0, y: 0 }),
      getVelocity: () => ({ x: 0, y: 0 })
    },
    {
      id: 'rotating-disk',
      label: '旋转圆盘非惯性系',
      description: '圆盘中心与惯性系重合；科里奥利模式的并列视图同时展示两系轨迹。',
      getOrigin: () => ({ x: 0, y: 0 }),
      getVelocity: () => ({ x: 0, y: 0 })
    }
  ],
  sceneSerializer: {
    exportScene: (_s, params) => ({
      schemaVersion: '2.0',
      modelId: 'comp-chaos-normal-coriolis',
      title: '混沌双摆、简正模与科里奥利力',
      params
    }),
    importScene: (dsl) => dsl.params as Partial<ChaosNormalCoriolisParams>
  },
  exportDiagramIR:advancedDiagram,
  renderCanvas:(ctx,s,p,vp,layers)=>{
    if(!layers.has('main'))return;
    const m=createWorldMapper(vp),paper=vp.theme==='projector';
    const colors:Record<Role,string>=paper?{ink:'#172033',muted:'#64748b',main:'#0369a1',shadow:'#be123c',green:'#166534',warm:'#92400e'}:{ink:'#e2e8f0',muted:'#94a3b8',main:'#38bdf8',shadow:'#fb7185',green:'#4ade80',warm:'#fbbf24'};
    const trace=(points:readonly {x:number;y:number}[])=>{if(points.length<2)return;ctx.beginPath();points.forEach((p,i)=>{const z=m.toScreen(p.x,p.y);if(i)ctx.lineTo(z.x,z.y);else ctx.moveTo(z.x,z.y);});ctx.stroke();};
    const text=(x:number,y:number,t:string,align:CanvasTextAlign='center',size=11)=>{const a=m.toScreen(x,y);ctx.save();ctx.font='500 '+size+'px system-ui,sans-serif';ctx.textAlign=align;ctx.textBaseline='middle';ctx.fillText(t,a.x,a.y);ctx.restore();};
    ctx.save();ctx.lineCap='round';ctx.lineJoin='round';
    for(const {role,primitive:d} of advancedItems(s,p)){
      ctx.strokeStyle=colors[role];ctx.fillStyle=colors[role];ctx.lineWidth=role==='muted'?1:2;
      ctx.setLineDash('dashed' in d&&d.dashed?[4,4]:[]);
      if(d.kind==='line')trace([{x:d.x1,y:d.y1},{x:d.x2,y:d.y2}]);
      else if(d.kind==='trajectory'||d.kind==='polyline')trace(d.points);
      else if(d.kind==='circle'){
        const z=m.toScreen(d.cx,d.cy);ctx.beginPath();ctx.arc(z.x,z.y,Math.max(1.5,m.len(d.r)),0,Math.PI*2);if(d.fill)ctx.fill();else ctx.stroke();
      }else if(d.kind==='rect'){
        const z=m.toScreen(d.x,d.y+d.height);ctx.strokeRect(z.x,z.y,m.len(d.width),m.len(d.height));
      }else if(d.kind==='block'){
        const z=m.toScreen(d.cx-d.width/2,d.cy+d.height/2),w=m.len(d.width),h=m.len(d.height);
        ctx.globalAlpha=.23;ctx.fillRect(z.x,z.y,w,h);ctx.globalAlpha=1;ctx.strokeRect(z.x,z.y,w,h);
        if(d.label)text(d.cx,d.cy,d.label);
      }else if(d.kind==='spring'){
        const dx=d.x2-d.x1,dy=d.y2-d.y1,l=Math.hypot(dx,dy);if(l<1e-9)continue;
        const count=2*(d.coils??10),amp=d.amplitude??.06,pts=[{x:d.x1,y:d.y1}];
        for(let i=1;i<count;i++){const t=i/count,k=(i%2?1:-1)*amp;pts.push({x:d.x1+t*dx-k*dy/l,y:d.y1+t*dy+k*dx/l});}
        pts.push({x:d.x2,y:d.y2});trace(pts);
      }else if(d.kind==='text')text(d.x,d.y,d.text,d.align==='start'?'left':d.align==='end'?'right':'center',Math.max(10,Math.min(14,m.len(.10))));
    }
    ctx.restore();
    if(ctx.canvas?.dataset)ctx.canvas.dataset.advancedMechanicsRendered=JSON.stringify({
      t:s.t,mode:p.mode,bounds:advancedViewBounds(s,p,vp),params:p,obs:computeObservables(s,p),
      ...(p.mode==='double-pendulum'?{bobs:pendulumBobs(s.dpState,p),shadow:pendulumBobs(s.dpShadow,p),state:s.dpState,shadowState:s.dpShadow,points:s.poincarePts}
        :p.mode==='normal-modes'?{centers:normalCenters(s,p),q:normalQuantities(s,p)}
        :{frames:coriolisFrames(s,p),q:coriolisQuantities(s,p),labPos:s.labPos})
    });
  },
  formatFormulas:(s,p)=>{
    if(p.mode==='double-pendulum')return [
      {id:'dp-energy',label:'双摆机械能（铅直向下为角度零点）',latex:'E=T+U',substitutedLatex:'E='+s.dpCurrentEnergy.toFixed(4)+'\\ \\mathrm J'},
      {id:'dp-kinetic',label:'动能与耦合项',latex:'\\begin{aligned}T&=\\tfrac12(m_1+m_2)L_1^2\\dot\\theta_1^2\\\\&+\\tfrac12m_2L_2^2\\dot\\theta_2^2\\\\&+m_2L_1L_2\\dot\\theta_1\\dot\\theta_2\\\\&\\quad\\times\\cos(\\theta_1-\\theta_2)\\end{aligned}'},
      {id:'dp-potential',label:'重力势能（固定支点为零）',latex:'\\begin{aligned}U&=-(m_1+m_2)gL_1\\cos\\theta_1\\\\&-m_2gL_2\\cos\\theta_2\\end{aligned}'},
      {id:'dp-section',label:'真实事件定位截面',latex:'\\theta_1=2k\\pi,\\quad\\dot\\theta_1>0',substitutedLatex:'N='+s.poincarePts.length},
      {id:'dp-separation',label:'两主值角差的欧氏距离，不是李雅普诺夫指数',latex:'d=\\sqrt{\\Delta\\theta_1^2+\\Delta\\theta_2^2}',substitutedLatex:'d='+computeObservables(s,p).dpDivergenceRad!.toExponential(3)+'\\ \\mathrm{rad}'}
    ];
    if(p.mode==='normal-modes'){const q=normalQuantities(s,p);return [
      {id:'nm-sym',label:'同相频率',latex:'\\omega_1=\\sqrt{k_w/m}',substitutedLatex:'\\omega_1='+q.w1.toFixed(4)+'\\ \\mathrm{rad/s}'},
      {id:'nm-anti',label:'反相频率',latex:'\\omega_2=\\sqrt{(k_w+2k_c)/m}',substitutedLatex:'\\omega_2='+q.w2.toFixed(4)+'\\ \\mathrm{rad/s}'},
      {id:'nm-energy',label:'机械能（包含耦合弹簧势能）',latex:'\\begin{aligned}E&=\\tfrac12m(v_1^2+v_2^2)\\\\&+\\tfrac12k_w(x_1^2+x_2^2)\\\\&+\\tfrac12k_c(x_1-x_2)^2\\end{aligned}',substitutedLatex:'E='+q.E.toFixed(4)+'\\ \\mathrm J'},
      {id:'nm-mode-energy',label:'独立模能量',latex:'E=E_s+E_a',substitutedLatex:'E_s='+q.Es.toFixed(3)+'\\ \\mathrm J,\\ E_a='+q.Ea.toFixed(3)+'\\ \\mathrm J'}
    ];}
    const q=coriolisQuantities(s,p);return [
      {id:'cor-position',label:'惯性自由运动到匀速旋转坐标变换',latex:'\\begin{aligned}x&=Vt\\cos(\\Omega t)\\\\y&=-Vt\\sin(\\Omega t)\\end{aligned}'},
      {id:'cor-coriolis',label:'科氏加速度',latex:'\\mathbf a_C=-2\\boldsymbol\\Omega\\times\\mathbf v_r',substitutedLatex:'a_C='+Math.hypot(q.axC,q.ayC).toFixed(3)+'\\ \\mathrm{m/s^2}'},
      {id:'cor-centrifugal',label:'离心加速度',latex:'\\begin{aligned}\\mathbf a_f&=-\\boldsymbol\\Omega\\times\\\\&\\quad(\\boldsymbol\\Omega\\times\\mathbf r_r)\\end{aligned}',substitutedLatex:'a_f='+Math.hypot(q.axF,q.ayF).toFixed(3)+'\\ \\mathrm{m/s^2}'},
      {id:'cor-error',label:'独立积分与坐标变换的位置偏差',latex:'\\delta r=|\\mathbf r_{ODE}-\\mathbf r_{rot}|',substitutedLatex:'\\delta r='+q.positionError.toExponential(3)+'\\ \\mathrm m'}
    ];
  }
}),{fitAdvancedViewport,advancedViewBounds});
export default compChaosNormalCoriolisPlugin;
