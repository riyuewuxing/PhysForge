import { createWorldMapper, defineSimulationPlugin, type DiagramPrimitive, type ParamFieldSpec, type AnyParamFieldSpec, type TelemetryChannelSpec } from '@physforge/sim-sdk';
import { customOdePresets } from './presets.js';
import {
  checkInvariants,
  computeObservables,
  createInitialState,
  stepCustomOde,
  keplerAcceleration,
  KEPLER_CORE_RADIUS,
  pendulumLength,
  type CustomOdeParams,
  type CustomOdeState
} from './engine.js';

const paramSchema: readonly ParamFieldSpec<CustomOdeParams>[] = [
  {
    key: 'template',
    kind: 'select',
    label: 'ODE / 拉格朗日模板',
    options: [
      { label: '自定义受驱阻尼振子 (RK4)', value: 'harmonic-custom' },
      { label: '自定义数学表达式 a(x,v,t)', value: 'custom-expr' },
      { label: '拉格朗日非线性单摆', value: 'lagrangian-pendulum' },
      { label: '二维开普勒万有引力 (辛积分)', value: 'kepler-2d' }
    ],
    defaultValue: 'custom-expr'
  },
  {
    key: 'exprText',
    kind: 'select',
    label: '加速度 a(x,v,t) · 白名单 AST',
    customTextMaxLength:256,
    options: [
      { label: 'Duffing 硬化振子 -(k*x + 2*x^3)/m - gamma*v + A*cos(w*t)', value: '-(k * x + 2 * x^3) / m - gamma * v + A * cos(w * t)' },
      { label: '范德波尔自激振荡 (1 - x^2)*v - k*x', value: '(1 - x^2) * v - k * x' },
      { label: '标准线性简谐 -(k/m)*x', value: '-(k / m) * x' },
      { label: '非线性软弹簧 -(k*x - 0.8*x^3)/m', value: '-(k * x - 0.8 * x^3) / m' }
    ],
    defaultValue: '-(k * x + 2 * x^3) / m - gamma * v + A * cos(w * t)'
  },
  { key: 'mass', kind: 'number', label: '质量 m', unit: 'kg', min: 0.2, max: 10, step: 0.2, defaultValue: 1 },
  { key: 'stiffness', kind: 'number', label: '劲度/引力强度 k/μ', min: 1, max: 40, step: 1, defaultValue: 8 },
  { key: 'damping', kind: 'number', label: '阻尼系数 γ', min: 0, max: 2, step: 0.05, defaultValue: 0.1 },
  { key: 'driveAmp', kind: 'number', label: '外驱幅值 A', min: 0, max: 5, step: 0.2, defaultValue: 2.0 },
  { key: 'driveOmega', kind: 'number', label: '驱动角频率 ω', unit: 'rad/s', min: 0.5, max: 8, step: 0.2, defaultValue: 2.8 },
  { key: 'initialPos', kind: 'number', label: '初位移 x₀ / r₀', unit: 'm', min: -2.5, max: 2.5, step: 0.1, defaultValue: 1.2 },
  { key: 'initialVel', kind: 'number', label: '初速度 v₀', unit: 'm/s', min: -4, max: 4, step: 0.1, defaultValue: 0 }
];

const channels:readonly TelemetryChannelSpec[]=[
  {key:'x',label:'位置 x',unit:'m',color:'#38bdf8'},
  {key:'v',label:'速度 v',unit:'m/s',color:'#f472b6'},
  {key:'theta',label:'摆角 θ',unit:'rad',color:'#38bdf8'},
  {key:'omega',label:'角速度 ω',unit:'rad/s',color:'#f472b6'},
  {key:'y',label:'位置 y',unit:'m',color:'#f472b6'},
  {key:'vx',label:'速度 vx',unit:'m/s',color:'#38bdf8'},
  {key:'vy',label:'速度 vy',unit:'m/s',color:'#f472b6'},
  {key:'speed',label:'速率',unit:'m/s',color:'#fbbf24'},
  {key:'energy',label:'机械能 E',unit:'J',color:'#4ade80'},
  {key:'kineticEnergy',label:'平动动能 K',unit:'J',color:'#4ade80'},
  {key:'angularMomentum',label:'角动量 Lz',unit:'kg·m²/s',color:'#fbbf24'}
];
function modeChannels(p:CustomOdeParams){
  const keys=p.template==='kepler-2d'?['x','y','vx','vy','speed','energy','angularMomentum']:p.template==='lagrangian-pendulum'?['theta','omega','energy']:p.template==='custom-expr'?['x','v','kineticEnergy']:['x','v','energy','kineticEnergy'];
  return keys.flatMap(key=>channels.filter(c=>c.key===key));
}
function modeFields(p:CustomOdeParams):readonly AnyParamFieldSpec[]{
  const pend=p.template==='lagrangian-pendulum',orbit=p.template==='kepler-2d',custom=p.template==='custom-expr';
  const keys=orbit?['template','stiffness','initialPos','initialVel','mass']:custom?['template','exprText','initialPos','initialVel','mass','stiffness','damping','driveAmp','driveOmega']:['template','stiffness','initialPos','initialVel','mass','damping','driveAmp','driveOmega'];
  return keys.flatMap(key=>{
    const field=paramSchema.find(f=>f.key===key);
    if(!field)return [];
    if(field.kind!=='number')return [field];
    const labels:Record<string,{label:string;unit:string}>=pend?{
      stiffness:{label:'摆长参数 (L=0.1k，至少0.3 m)',unit:''},
      initialPos:{label:'初始摆角 θ₀',unit:'rad'},initialVel:{label:'初始角速度 ω₀',unit:'rad/s'},
      damping:{label:'角阻尼 γ',unit:'1/s'},driveAmp:{label:'角加速度驱动 A',unit:'rad/s²'}
    }:orbit?{stiffness:{label:'引力参数 μ',unit:'m³/s²'},initialPos:{label:'半径输入 |r₀|（至少0.4 m）',unit:'m'},initialVel:{label:'初始切向速度 vy₀',unit:'m/s'}}:custom?{stiffness:{label:'表达式系数 k',unit:''},damping:{label:'表达式系数 γ',unit:''},driveAmp:{label:'表达式系数 A',unit:''},driveOmega:{label:'表达式系数 w',unit:''}}:{stiffness:{label:'劲度系数 k',unit:'N/m'},damping:{label:'线性阻尼 γ',unit:'kg/s'},driveAmp:{label:'驱动力幅值 A',unit:'N'}};
    return [{...field,...labels[key]}];
  });
}
function axisNames(p:CustomOdeParams):[string,string]{
  return p.template==='kepler-2d'?['x (m)','y (m)']:p.template==='lagrangian-pendulum'?['θ (rad)','ω (rad/s)']:['x (m)','v (m/s)'];
}
function phaseExtent(p:CustomOdeParams):number{
  if(p.template==='kepler-2d')return Math.max(2.8,Math.abs(p.initialPos)*1.4);
  if(p.template==='harmonic-custom')return Math.max(3,Math.hypot(p.initialVel,Math.sqrt(p.stiffness/p.mass)*p.initialPos)*1.2);
  if(p.template==='lagrangian-pendulum')return Math.max(3,Math.sqrt(p.initialVel**2+2*9.8/pendulumLength(p)*(1-Math.cos(p.initialPos)))*1.25);
  return Math.max(4,Math.abs(p.initialPos)*2,Math.abs(p.initialVel)*1.5);
}
export const builderCustomOdeLabPlugin = defineSimulationPlugin<CustomOdeParams, CustomOdeState>({
  meta: {
    id: 'builder-custom-ode-lab',
    title: '通用微分方程与拉格朗日实验室 (B5)',
    textbookRef: '强基竞赛 & 高阶数值探究拓展',
    curriculumTags: ['科学思维', '科学探究'],
    difficulty: '压轴专题',
    version: '2.0.0'
  },
  defaultView: { scale:(p,{width,height})=>Math.max(.12,Math.min(.9,Math.max(100,Math.min(width*.6,height-140)) / (2*phaseExtent(p)*.24*Math.min(width,height)))), offsetRatioX: -0.05,offsetRatioY:-.04 },
  paramSchema,
  getParamFields:modeFields,
  getTelemetryChannels:modeChannels,
  presets: customOdePresets,
  engine: {
    createInitialState,
    step: stepCustomOde,
    computeObservables,
    checkInvariants
  },
  getForceVectors: (state, params) => {
    if (params.template === 'kepler-2d') {
      const a=keplerAcceleration(state.x,state.y,params);
      return [{
        id: 'kepler-gravity', label: 'F_g', origin: { x: state.x, y: state.y },
        force: { x: params.mass*a.x, y: params.mass*a.y }, color: '#fbbf24', category: 'gravity', unit: 'N'
      }];
    }
    // Phase-space ordinates are velocities, not physical y positions.
    return [];
  },
  layers: [
    { id: 'trajectory', label: '相空间 / 轨道轨迹', defaultVisible: true },
    { id: 'axes', label: '参考坐标与中心质点', defaultVisible: true }
  ],
  telemetryChannels:channels,
  getControlHandles:(state,params)=>state.t===0?[{
    id:'initial-pos',
    label:params.template==='kepler-2d'?'初始半径':params.template==='lagrangian-pendulum'?'初始角相点':'初始相点',
    position:{x:state.x,y:params.template==='kepler-2d'?0:state.vx},
    handleKind:'point',color:'#38bdf8',
    onDrag:wp=>params.template==='kepler-2d'?{initialPos:Math.round(Math.max(.4,Math.min(2.5,wp.x))*10)/10}:{initialPos:Math.round(Math.max(-2.5,Math.min(2.5,wp.x))*10)/10,initialVel:Math.round(Math.max(-4,Math.min(4,wp.y))*10)/10}
  }]:[],
  sceneSerializer: {
    exportScene: (_s, params) => ({
      schemaVersion: '2.0',
      modelId: 'builder-custom-ode-lab',
      title: '通用 ODE 仿真实验',
      params
    }),
    importScene: (dsl) => dsl.params as Partial<CustomOdeParams>
  },
  exportDiagramIR:(state,params)=>{
    const extent=Math.max(phaseExtent(params),...state.trail.map(p=>Math.max(Math.abs(p.x),Math.abs(p.y))))*1.12;
    const [xLabel,yLabel]=axisNames(params);
    const primitives:DiagramPrimitive[]=[
      {kind:'line',x1:-extent,y1:0,x2:extent,y2:0,dashed:true},
      {kind:'line',x1:0,y1:-extent,x2:0,y2:extent,dashed:true},
      {kind:'mathLabel',x:extent*.88,y:-extent*.12,text:xLabel,align:'end'},
      {kind:'mathLabel',x:extent*.08,y:extent*.88,text:yLabel,align:'start'}
    ];
    if(params.template==='kepler-2d')primitives.push({kind:'circle',cx:0,cy:0,r:KEPLER_CORE_RADIUS,fill:true});
    if(state.trail.length>=2)primitives.push({kind:'trajectory',points:state.trail});
    primitives.push({kind:'circle',cx:state.x,cy:params.template==='kepler-2d'?state.y:state.vx,r:.08,fill:true});
    return {width:720,height:440,viewBox:{minX:-extent,minY:-extent,maxX:extent,maxY:extent},title:'微分方程相轨迹与轨道图',primitives};
  },
  formatFormulas:(s,p)=>{
    const o=computeObservables(s,p),orbit=p.template==='kepler-2d',pend=p.template==='lagrangian-pendulum',custom=p.template==='custom-expr';
    const latex=orbit?String.raw`\ddot{\mathbf r}=-\mu\mathbf r/\max(r,R)^3,\ R=0.2\,\mathrm m`:pend?String.raw`\ddot\theta=-\frac{g}{L}\sin\theta-\gamma\dot\theta+A\cos(wt)`:custom?String.raw`\ddot x=f(x,v,t)`:String.raw`m\ddot x=-kx-\gamma v+A\cos(wt)`;
    const substitutedLatex=orbit?`x=${s.x.toFixed(3)},\\ y=${s.y.toFixed(3)},\\ v_y=${s.vy.toFixed(3)}`:pend?`\\theta=${s.x.toFixed(3)},\\ \\omega=${s.vx.toFixed(3)},\\ L=${pendulumLength(p).toFixed(2)}`:`x=${s.x.toFixed(3)},\\ v=${s.vx.toFixed(3)}`;
    const result=[{id:'ode-formula',label:s.formulaError?'求解停止：'+s.formulaError:custom?'a = '+p.exprText:orbit?'外部反平方 · 内部均匀球':'微分方程 · RK4',latex,substitutedLatex}];
    if(custom)result.push({id:'ode-energy',label:'任意加速度未定义机械势能；仅显示动能',latex:String.raw`K=\frac12mv^2`,substitutedLatex:`K=${o.kineticEnergy!.toFixed(3)}\\,\\mathrm J`});
    else result.push({id:'ode-energy',label:'机械能（仅无驱无阻尼系统守恒）',latex:orbit?String.raw`E=\frac12m(v_x^2+v_y^2)+U(r)`:pend?String.raw`E=\frac12mL^2\omega^2+mgL(1-\cos\theta)`:String.raw`E=\frac12mv^2+\frac12kx^2`,substitutedLatex:`E=${o.energy!.toFixed(3)}\\,\\mathrm J`});
    return result;
  },
  renderCanvas: (ctx, state, params, viewport, activeLayers) => {
    const m = createWorldMapper(viewport);
    const toScr = (wx: number, wy: number) => {
      const point = m.toScreen(wx, wy);
      return { sx: point.x, sy: point.y };
    };

    if (activeLayers.has('axes')) {
      ctx.save();
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      const extent=phaseExtent(params);
      const left = toScr(-extent, 0);
      const right = toScr(extent, 0);
      const bottom = toScr(0, -extent);
      const top = toScr(0, extent);
      ctx.moveTo(left.sx, left.sy);
      ctx.lineTo(right.sx, right.sy);
      ctx.moveTo(bottom.sx, bottom.sy);
      ctx.lineTo(top.sx, top.sy);
      ctx.stroke();
      ctx.setLineDash([]);ctx.fillStyle=viewport.theme==='projector'?'#334155':'#cbd5e1';ctx.font='12px system-ui';
      const [xl,yl]=axisNames(params);ctx.textAlign='right';ctx.fillText(xl,right.sx-4,right.sy-7);ctx.textAlign='left';ctx.fillText(yl,top.sx+7,top.sy+14);
      ctx.restore();
    }

    if (activeLayers.has('trajectory') && state.trail.length >= 2) {
      ctx.save();
      ctx.strokeStyle = viewport.theme==='projector'?'#0369a1':'#38bdf8';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      state.trail.forEach((pt, idx) => {
        const p = toScr(pt.x, pt.y);
        if (idx === 0) ctx.moveTo(p.sx, p.sy);
        else ctx.lineTo(p.sx, p.sy);
      });
      ctx.stroke();
      ctx.restore();
    }

    const cur =
      params.template === 'kepler-2d' ? toScr(state.x, state.y) : toScr(state.x, state.vx);
    ctx.save();
    if (params.template === 'kepler-2d') {
      ctx.fillStyle = '#fbbf24';
      ctx.beginPath();
      const origin = m.toScreen(0, 0);
      ctx.arc(origin.x, origin.y, m.len(KEPLER_CORE_RADIUS), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = viewport.theme==='projector'?'#be185d':'#f472b6';
    ctx.beginPath();
    ctx.arc(cur.sx, cur.sy, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }
});

export default builderCustomOdeLabPlugin;
