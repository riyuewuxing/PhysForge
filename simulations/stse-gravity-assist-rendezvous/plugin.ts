import { createWorldMapper, defineSimulationPlugin, resolveAndDrawLabels, type CanvasLabel, type DiagramPrimitive, type ParamFieldSpec } from '@physforge/sim-sdk';
import { gravityAssistPresets } from './presets.js';
import {
  checkInvariants,
  computeObservables,
  createInitialState,
  stepGravityAssistRendezvous,
  type GravityAssistRendezvousParams,
  type GravityAssistRendezvousState
} from './engine.js';

const paramSchema: readonly ParamFieldSpec<GravityAssistRendezvousParams>[] = [
  {
    key: 'mode',
    kind: 'select',
    label: '深空动力学场景',
    defaultValue: 'gravity-assist',
    options: [
      { value: 'gravity-assist', label: '深空引力弹弓掠飞' },
      { value: 'rendezvous', label: '圆轨周期与相位比较' }
    ]
  },
  {
    key: 'flybySide',
    kind: 'select',
    label: '掠飞方位（相对行星运动）',
    defaultValue: 'trailing',
    options: [
      { value: 'trailing', label: '后侧初始偏置' },
      { value: 'leading', label: '前侧初始偏置' }
    ]
  },
  { key: 'muPlanet', kind: 'number', label: '行星引力参数 μ_p', defaultValue: 0.16, min: 0.05, max: 0.4, step: 0.02 },
  { key: 'planetOrbitRadius', kind: 'number', label: '行星轨道半径 r_p', defaultValue: 5.0, min: 2.0, max: 8.0, step: 0.5 },
  { key: 'impactParam', kind: 'number', label: '初始横向偏置 b', defaultValue: 0.38, min: 0.15, max: 1.2, step: 0.04 },
  {
    key: 'rendezvousBurn',
    kind: 'select',
    label: '初始速度比较',
    defaultValue: 'prograde-boost',
    options: [
      { value: 'prograde-boost', label: '正向切向加速（高轨慢落后）' },
      { value: 'retro-lower-catchup', label: '逆向减速降轨（低轨快追赶）' }
    ]
  },
  { key: 'deltaVFraction', kind: 'number', label: '点火变轨 Δv/v₀', defaultValue: 0.06, min: 0.01, max: 0.16, step: 0.01 }
];

export const stseGravityAssistRendezvousPlugin = defineSimulationPlugin<
  GravityAssistRendezvousParams,
  GravityAssistRendezvousState
>({
  meta: {
    id: 'stse-gravity-assist-rendezvous',
    title: '深空引力弹弓与空间站交会对接 (S04)',
    textbookRef: '人教版 必修第二册 第七章 · 天体变轨与深空探测 STSE',
    curriculumTags: ['物理观念', '科学思维', '科学态度与责任'],
    difficulty: '压轴专题',
    version: '2.0.0'
  },
  defaultView: {
    scale:(params,view)=>params.mode==='rendezvous'?.78:Math.min(.60,.40*view.width/(.24*Math.min(view.width,view.height)*params.planetOrbitRadius))
  },
  paramSchema,
  presets: gravityAssistPresets,
  getParamFields:p=>paramSchema.filter(f=>(p.mode==='gravity-assist'?['mode','flybySide','muPlanet','planetOrbitRadius','impactParam']:['mode','rendezvousBurn','deltaVFraction']).includes(f.key)),
  getTelemetryChannels:p=>p.mode==='gravity-assist'?[{key:'helioSpeed',label:'局部惯性系速率',unit:'v₀',color:'#38bdf8'},{key:'relativeSpeed',label:'行星系瞬时速率',unit:'v₀',color:'#fbbf24'},{key:'deltaHelioEnergy',label:'比动能变化',unit:'归一化',color:'#4ade80'},{key:'relativeSpecificEnergy',label:'行星系比机械能',unit:'归一化',color:'#a855f7'},{key:'planetFrameSpeedRelErr',label:'等效速率残差',unit:'',color:'#94a3b8'}]:[{key:'phaseLagRad',label:'目标领先角',unit:'rad',color:'#4ade80'},{key:'chaserAngleRad',label:'追踪舱连续相角',unit:'rad',color:'#38bdf8'},{key:'targetAngleRad',label:'目标连续相角',unit:'rad',color:'#fbbf24'}],
  engine: {
    createInitialState,
    step: stepGravityAssistRendezvous,
    computeObservables,
    checkInvariants
  },
  layers: [
    { id: 'orbit', label: '参考系轨迹与矢量展示', defaultVisible: true }
  ],
  telemetryChannels: [
    { key: 'helioSpeed', label: '日心速率 v', unit: 'v₀', color: '#38bdf8' },
    { key: 'deltaHelioEnergy', label: '局部比动能变化 ΔE', unit: '', color: '#4ade80' },
    { key: 'planetFrameSpeedRelErr', label: '行星系速率守恒误差', unit: '', color: '#fbbf24' }
  ],
  getControlHandles: (state, params) => {
    if (params.mode !== 'gravity-assist') return [];
    const sign = params.flybySide === 'trailing' ? -1 : 1;
    return [{
      id: 'impact-parameter',
      label: `b=${params.impactParam.toFixed(2)}`,
      position: {
        x: params.planetOrbitRadius - 3.2,
        y: sign * params.impactParam
      },
      handleKind: 'point',
      color: '#4ade80',
      onDrag: (worldPos) => {
        const signedDistance = worldPos.y;
        return {
          impactParam: Number(Math.max(0.15, Math.min(1.2, Math.abs(signedDistance))).toFixed(2)),
          flybySide: signedDistance > 0 ? 'leading' : signedDistance < 0 ? 'trailing' : params.flybySide
        };
      }
    }];
  },
  referenceFrames: [
    {
      id: 'heliocentric',
      label: '局部/中心体惯性系',
      description: '掠飞为局部惯性近似；交会为中心体惯性系。',
      getOrigin: () => ({ x: 0, y: 0 }),
      getVelocity: () => ({ x: 0, y: 0 })
    },
    {
      id: 'planet-frame',
      label: '行星随动参考系',
      description: '原点随行星平移，用于比较掠飞前后的相对速率。',
      getOrigin: (state, params) => params.mode === 'gravity-assist'
        ? { x: state.planetPos.x, y: state.planetPos.y }
        : { x: 0, y: 0 },
      getVelocity: (state, params) => params.mode === 'gravity-assist'
        ? { x: state.planetVel.x, y: state.planetVel.y }
        : { x: 0, y: 0 }
    }
  ],
  sceneSerializer: {
    exportScene: (_s, params) => ({
      schemaVersion: '2.0',
      modelId: 'stse-gravity-assist-rendezvous',
      title: '引力弹弓与空间站交会对接',
      params
    }),
    importScene: (dsl) => dsl.params as Partial<GravityAssistRendezvousParams>
  },
  exportDiagramIR: (state, params) => {
    const relative=params.mode==='gravity-assist';
    const trace=state.trail.map(q=>({x:relative?q.x-q.px:q.x,y:relative?q.y-q.py:q.y}));
    const body=relative?{x:0,y:0}:state.planetPos;
    const craft=relative?{x:state.pos.x-state.planetPos.x,y:state.pos.y-state.planetPos.y}:state.pos;
    const points=[...trace,body,craft,{x:0,y:0}];
    const minX=Math.min(...points.map(q=>q.x),relative?0:-1)-.5,maxX=Math.max(...points.map(q=>q.x),relative?0:1)+.5;
    const minY=Math.min(...points.map(q=>q.y),relative?0:-1)-.55,maxY=Math.max(...points.map(q=>q.y),relative?0:1)+.55;
    const primitives:DiagramPrimitive[]=[
      ...(!relative?[{kind:'circle' as const,cx:0,cy:0,r:1,dashed:true},{kind:'circle' as const,cx:0,cy:0,r:.07,fill:true}]:[]),
      {kind:'trajectory',points:trace,strokeWidth:1.5},
      {kind:'circle',cx:body.x,cy:body.y,r:.065,fill:true},
      {kind:'circle',cx:craft.x,cy:craft.y,r:.045},
      {kind:'text',x:body.x,y:body.y+.12,text:relative?'行星（符号）':'目标舱'},
      {kind:'text',x:craft.x,y:craft.y-.14,text:relative?'探测器':'追踪舱'},
      {kind:'text',x:(minX+maxX)/2,y:maxY-.18,text:relative?'行星平移系 · 局部二体近似':'中心体惯性系 · 归一化相位比较',align:'middle'},
      {kind:'text',x:(minX+maxX)/2,y:minY+.16,text:relative?'t* = '+state.t.toFixed(3)+'；历史样本逐时刻变换':'t* = '+state.t.toFixed(3)+'；目标领先角 '+(state.targetAngleRad-state.chaserAngleRad).toFixed(3)+' rad',align:'middle'}
    ];
    return {width:760,height:480,viewBox:{minX,minY,maxX,maxY},title:relative?'局部二体掠飞：行星平移系':'圆轨周期与相位比较',primitives};
  },
  renderCanvas: (ctx,state,params,viewport,activeLayers)=>{
    if(!activeLayers.has('orbit'))return;
    const m=createWorldMapper(viewport),paper=viewport.theme==='projector',ink=paper?'#1e293b':'#e2e8f0';
    const muted=paper?'#64748b':'#94a3b8',traceColor=paper?'#0369a1':'#38bdf8',targetColor=paper?'#15803d':'#4ade80';
    const relative=params.mode==='gravity-assist'&&viewport.observationFrameId==='planet-frame';
    const labels:CanvasLabel[]=[];
    ctx.save();
    if(params.mode==='rendezvous'){
      const c=m.toScreen(0,0);
      ctx.strokeStyle=muted;ctx.lineWidth=1.5;ctx.setLineDash([5,4]);ctx.beginPath();ctx.arc(c.x,c.y,m.len(1),0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);
      ctx.fillStyle=paper?'#b45309':'#fbbf24';ctx.beginPath();ctx.arc(c.x,c.y,Math.max(4,m.len(.07)),0,Math.PI*2);ctx.fill();
      labels.push({id:'central',x:c.x,y:c.y+17,text:'中心体（符号）',color:muted,font:'12px ui-sans-serif, system-ui'});
    }
    ctx.strokeStyle=traceColor;ctx.lineWidth=2;ctx.beginPath();
    state.trail.forEach((q,i)=>{
      // The host translates by the CURRENT origin. Add that origin back after
      // transforming each historical point by its OWN historical planet location.
      const pt=relative?m.toScreen(q.x-q.px+state.planetPos.x,q.y-q.py+state.planetPos.y):m.toScreen(q.x,q.y);
      if(i===0)ctx.moveTo(pt.x,pt.y);else ctx.lineTo(pt.x,pt.y);
    });ctx.stroke();
    const body=m.toScreen(state.planetPos.x,state.planetPos.y),craft=m.toScreen(state.pos.x,state.pos.y);
    ctx.fillStyle=params.mode==='rendezvous'?targetColor:(paper?'#b45309':'#f59e0b');
    ctx.beginPath();ctx.arc(body.x,body.y,Math.max(4,m.len(.065)),0,Math.PI*2);ctx.fill();
    ctx.strokeStyle=traceColor;ctx.lineWidth=2;ctx.beginPath();ctx.arc(craft.x,craft.y,Math.max(3,m.len(.045)),0,Math.PI*2);ctx.stroke();
    labels.push(
      {id:'body',x:body.x,y:body.y-18,text:params.mode==='rendezvous'?'目标舱':'行星（符号）',color:ink,font:'13px ui-sans-serif, system-ui'},
      {id:'craft',x:craft.x,y:craft.y+18,text:params.mode==='rendezvous'?'追踪舱':'探测器',color:traceColor,font:'13px ui-sans-serif, system-ui'}
    );
    // Headers are screen anchors, not world-space data.
    const title=params.mode==='rendezvous'?'中心体惯性系 · 归一化相位比较（非对接）':relative?'行星平移系 · 局部二体近似':'局部惯性系 · 匀速平移行星、忽略太阳引力';
    const line=params.mode==='rendezvous'?'目标领先角 '+(state.targetAngleRad-state.chaserAngleRad).toFixed(3)+' rad': '比动能变化 '+(state.helioEnergyCurrent-state.helioEnergyInitial).toFixed(4)+'；等效速率残差 '+state.planetFrameSpeedRelErr.toExponential(2);
    ctx.fillStyle=ink;ctx.font='bold 14px ui-sans-serif, system-ui';ctx.textAlign='center';ctx.fillText(title,viewport.width*.5,49);
    ctx.fillStyle=muted;ctx.font='12px ui-sans-serif, system-ui';ctx.fillText('t* = '+state.t.toFixed(3)+' | '+line,viewport.width*.5,68);
    resolveAndDrawLabels(ctx,labels,viewport.width,viewport.height);ctx.restore();
  },
  formatFormulas: (state, params) => params.mode==='gravity-assist'?[
    {id:'slingshot-rendezvous',label:'局部二体近似 · 参考系速度变换',latex:'\\mathbf{v}_{\\rm local}=\\mathbf{V}_{p}+\\mathbf{v}_{\\rm rel}',substitutedLatex:'\\Delta K_{\\rm local}='+ (state.helioEnergyCurrent-state.helioEnergyInitial).toFixed(4)},
    {id:'relative-energy',label:'行星系比机械能（非瞬时速率恒定）',latex:'\\varepsilon=\\frac12 v_{\\rm rel}^2-\\frac{\\mu_p}{r}'}
  ]:[
    {id:'slingshot-rendezvous',label:'中心力轨道周期比较（归一化）',latex:'T=2\\pi\\sqrt{\\frac{a^3}{GM}}'},
    {id:'target-phase',label:'目标领先角（非对接判据）',latex:'\\Delta\\theta=\\theta_{\\rm target}-\\theta_{\\rm chaser}',substitutedLatex:'\\Delta\\theta='+ (state.targetAngleRad-state.chaserAngleRad).toFixed(4)+'\\,\\mathrm{rad}'}
  ]
});

export default stseGravityAssistRendezvousPlugin;
