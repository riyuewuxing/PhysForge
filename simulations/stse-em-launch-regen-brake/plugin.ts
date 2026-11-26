import { createWorldMapper, defineSimulationPlugin, drawMetallicRail, resolveAndDrawLabels, type CanvasLabel, type DiagramPrimitive, type ParamFieldSpec } from '@physforge/sim-sdk';
import { emLaunchRegenPresets } from './presets.js';
import {
  checkInvariants,
  computeAnalyticPureEmStopDistance,
  computeObservables,
  createInitialState,
  stepEmLaunchRegen,
  type EmLaunchRegenParams,
  type EmLaunchRegenState
} from './engine.js';

const paramSchema: readonly ParamFieldSpec<EmLaunchRegenParams>[] = [
  {
    key: 'mode',
    kind: 'select',
    label: '系统模式',
    defaultValue: 'railgun',
    options: [
      { value: 'railgun', label: '电磁导轨弹射' },
      { value: 'regen-brake', label: '新能源再生制动' }
    ]
  },
  {
    key: 'driveMode',
    kind: 'select',
    label: '弹射供电方式',
    defaultValue: 'capacitor-pulse',
    options: [
      { value: 'capacitor-pulse', label: '脉冲电容器放电' },
      { value: 'constant-current', label: '恒流脉冲电源' }
    ]
  },
  { key: 'massKg', kind: 'number', label: '弹体/整车质量 M', unit: 'kg', defaultValue: 2.0, min: 0.5, max: 2500, step: 5 },
  { key: 'v0Mps', kind: 'number', label: '初速度 v₀', unit: 'm/s', defaultValue: 25, min: 0, max: 50, step: 1 },
  { key: 'bFieldT', kind: 'number', label: '导轨/电机等效 B', unit: 'T', defaultValue: 4.0, min: 1.0, max: 12.0, step: 0.5 },
  { key: 'trackSpanM', kind: 'number', label: '有效切割跨度 L', unit: 'm', defaultValue: 0.4, min: 0.2, max: 5.0, step: 0.1 },
  { key: 'circuitResOhm', kind: 'number', label: '内阻 R_int', unit: 'Ω', defaultValue: 0.25, min: 0.02, max: 1.0, step: 0.02 },
  { key: 'loadResOhm', kind: 'number', label: '储能负载 R_load', unit: 'Ω', defaultValue: 0.42, min: 0, max: 2.0, step: 0.05 },
  { key: 'capacitanceF', kind: 'number', label: '脉冲电容 C', unit: 'F', defaultValue: 0.2, min: 0.05, max: 2.0, step: 0.05 },
  { key: 'capVoltageV', kind: 'number', label: '电容初电压 U₀', unit: 'V', defaultValue: 800, min: 0, max: 2000, step: 50 },
  { key: 'driveCurrentA', kind: 'number', label: '恒流源电流 I', unit: 'A', defaultValue: 400, min: 50, max: 1000, step: 50 },
  { key: 'aeroDragCoeff', kind: 'number', label: '气动阻力系数 k_d', unit: 'N·s²/m²', defaultValue: 0.02, min: 0, max: 1.0, step: 0.02 },
  { key: 'mechBrakeN', kind: 'number', label: '机械摩擦制动力', unit: 'N', defaultValue: 0, min: 0, max: 4000, step: 100 }
];

// Braking-only display geometry: the vehicle, arrows, handles and SVG use one center.
function regenLayout(state: EmLaunchRegenState, params: EmLaunchRegenParams) {
  const span=Math.max(10,computeAnalyticPureEmStopDistance(params)*1.15);
  const cx=-1.15+2.55*Math.min(1,Math.max(0,state.x/span));
  return {cx,cy:.64,span,trackY:.32};
}
function regenEnergySlices(s:EmLaunchRegenState) {
  return [
    {label:'剩余动能',value:s.energyKineticJ,color:'#38bdf8',paper:'#0369a1'},
    {label:'等效负载传递',value:s.energyRegenJ,color:'#4ade80',paper:'#15803d'},
    {label:'内阻热',value:s.energyJouleJ,color:'#fb923c',paper:'#c2410c'},
    {label:'风阻及机械损耗',value:s.energyDragMechJ,color:'#94a3b8',paper:'#64748b'}
  ];
}
function regenBrakingPrimitives(state:EmLaunchRegenState,params:EmLaunchRegenParams):DiagramPrimitive[] {
  const g=regenLayout(state,params), out:DiagramPrimitive[]=[
    {kind:'line',x1:-2.1,y1:g.trackY,x2:2.1,y2:g.trackY},
    {kind:'block',cx:g.cx,cy:g.cy,width:.6,height:.36,label:'M'},
    {kind:'circle',cx:g.cx-.19,cy:g.trackY+.08,r:.08},
    {kind:'circle',cx:g.cx+.19,cy:g.trackY+.08,r:.08},
    {kind:'text',x:0,y:1.48,text:'新能源汽车等效再生制动（示意）',align:'middle'},
    {kind:'text',x:0,y:1.18,text:'t = '+state.t.toFixed(3)+' s；v = '+state.v.toFixed(3)+' m/s；x = '+state.x.toFixed(3)+' m',align:'middle'},
    {kind:'text',x:0,y:-.12,text:'初始动能账本（等效负载≠真实电池储能）',align:'middle'}
  ];
  if(state.v>0){
    out.push({kind:'arrow',x1:g.cx,y1:g.cy+.27,x2:g.cx+.52,y2:g.cy+.27,label:'v'});
    if(state.currentA>0)out.push({kind:'arrow',x1:g.cx,y1:g.cy,x2:g.cx-.65,y2:g.cy,label:'F_em'});
    if(params.aeroDragCoeff*state.v*state.v+params.mechBrakeN>0)out.push({kind:'arrow',x1:g.cx,y1:g.cy-.12,x2:g.cx-.50,y2:g.cy-.12,label:'F_loss'});
  }
  let x=-2; const slices=regenEnergySlices(state);
  for(const [i,item] of slices.entries()){
    const w=state.energyInitialJ>0?4*item.value/state.energyInitialJ:0;
    if(w>0)out.push({kind:'rect',x,y:-.56,width:w,height:.22,hatch:i===1||i===3});
    x+=w;
    out.push({kind:'text',x:i%2===0?-1.06:1.06,y:i<2?-.86:-1.13,text:item.label+' '+(item.value/1000).toFixed(3)+' kJ',align:'middle'});
  }
  return out;
}

export const stseEmLaunchRegenBrakePlugin = defineSimulationPlugin<EmLaunchRegenParams, EmLaunchRegenState>({
  meta: {
    id: 'stse-em-launch-regen-brake',
    title: '电磁弹射与新能源再生制动 (S03)',
    textbookRef: '人教版 选择性必修二 第二章 & 必修二 · 电磁能流 STSE',
    curriculumTags: ['物理观念', '科学思维', '科学态度与责任'],
    difficulty: '高三一轮',
    version: '2.0.0'
  },
  paramSchema,
  presets: emLaunchRegenPresets,
  getParamFields: p=>p.mode==='regen-brake'?['mode','v0Mps','loadResOhm','mechBrakeN','aeroDragCoeff','massKg','bFieldT','trackSpanM','circuitResOhm'].flatMap(key=>paramSchema.filter(f=>f.key===key)):paramSchema,
  getTelemetryChannels: p=>p.mode==='regen-brake'?[{key:'v',label:'速度 v',unit:'m/s',color:'#38bdf8'},{key:'x',label:'位移 x',unit:'m',color:'#fbbf24'},{key:'currentA',label:'等效回路电流',unit:'A',color:'#a855f7'},{key:'energyInitialKj',label:'初始动能',unit:'kJ',color:'#94a3b8'},{key:'energyKineticKj',label:'剩余动能',unit:'kJ',color:'#38bdf8'},{key:'energyRegenKj',label:'等效负载能量',unit:'kJ',color:'#4ade80'},{key:'energyJouleKj',label:'内阻热',unit:'kJ',color:'#fb923c'},{key:'energyDragMechKj',label:'机械及风阻损耗',unit:'kJ',color:'#94a3b8'},{key:'ledgerResidualJ',label:'能量残差',unit:'J',color:'#f59e0b'}]:[{key:'v',label:'速度 v',unit:'m/s',color:'#38bdf8'},{key:'x',label:'位移 x',unit:'m',color:'#fbbf24'},{key:'energyKineticKj',label:'动能 E_k',unit:'kJ',color:'#4ade80'},{key:'energyRegenKj',label:'再生回收能量',unit:'kJ',color:'#a855f7'}],
  engine: {
    createInitialState,
    step: stepEmLaunchRegen,
    computeObservables,
    checkInvariants
  },
  layers: [
    { id: 'track', label: '导轨滑行 / 制动车辆与能量堆叠条', defaultVisible: true }
  ],
  telemetryChannels: [
    { key: 'v', label: '速度 v', unit: 'm/s', color: '#38bdf8' },
    { key: 'x', label: '位移 x', unit: 'm', color: '#fbbf24' },
    { key: 'energyKineticKj', label: '动能 E_k', unit: 'kJ', color: '#4ade80' },
    { key: 'energyRegenKj', label: '再生回收能量', unit: 'kJ', color: '#a855f7' }
  ],
  sceneSerializer: {
    exportScene: (_s, params) => ({
      schemaVersion: '2.0',
      modelId: 'stse-em-launch-regen-brake',
      title: '电磁弹射与再生制动',
      params
    }),
    importScene: (dsl) => dsl.params as Partial<EmLaunchRegenParams>
  },
  exportDiagramIR: (state, params) => {
    if(params.mode==='regen-brake')return {width:760,height:480,viewBox:{minX:-2.35,minY:-1.4,maxX:2.35,maxY:1.65},title:'新能源汽车等效再生制动',primitives:regenBrakingPrimitives(state,params)};
    const legacyMode: string = params.mode;
    const primitives: DiagramPrimitive[] = [
      { kind: 'line', x1: -2.0, y1: -0.6, x2: 2.0, y2: -0.6, strokeWidth: 2 },
      { kind: 'block', cx: -1.2 + Math.min(2.4, state.x * 0.05), cy: -0.35, width: 0.45, height: 0.45, label: 'M' },
      { kind: 'arrow', x1: -1.2 + Math.min(2.4, state.x * 0.05), y1: -0.35, x2: -0.6 + Math.min(2.4, state.x * 0.05), y2: -0.35, label: legacyMode === 'railgun' ? 'F_A' : 'F_em' }
    ];
    return {
      width: 680,
      height: 360,
      viewBox: { minX: -2.2, minY: -1.2, maxX: 2.2, maxY: 1.2 },
      title: legacyMode === 'railgun' ? '电磁导轨炮模型简图' : '再生制动电磁阻尼受力简图',
      primitives
    };
  },
  renderCanvas: (ctx, state, params, viewport, activeLayers) => {
    if (!activeLayers.has('track')) return;
    const m = createWorldMapper(viewport);
    ctx.save();
    const labels: CanvasLabel[] = [];
    if(params.mode==='regen-brake'){
      const g=regenLayout(state,params),paper=viewport.theme==='projector',ink=paper?'#1e293b':'#e2e8f0',muted=paper?'#475569':'#94a3b8';
      const a=m.toScreen(-2.1,g.trackY),b=m.toScreen(2.1,g.trackY);
      ctx.strokeStyle=muted;ctx.lineWidth=Math.max(1,m.len(.018));ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();
      const body=m.toScreen(g.cx-.3,g.cy+.18);
      ctx.fillStyle=paper?'#dbeafe':'#164e63';ctx.fillRect(body.x,body.y,m.len(.6),m.len(.36));ctx.strokeStyle=paper?'#0369a1':'#38bdf8';ctx.strokeRect(body.x,body.y,m.len(.6),m.len(.36));
      for(const dx of [-.19,.19]){const w=m.toScreen(g.cx+dx,g.trackY+.08);ctx.fillStyle=paper?'#334155':'#64748b';ctx.beginPath();ctx.arc(w.x,w.y,m.len(.08),0,Math.PI*2);ctx.fill();}
      const slices=regenEnergySlices(state),start=m.toScreen(-2,-.34);
      ctx.strokeStyle=muted;ctx.lineWidth=1;ctx.strokeRect(start.x,start.y,m.len(4),m.len(.22));
      let x=start.x;
      for(const [i,item] of slices.entries()){
        const w=state.energyInitialJ>0?m.len(4)*item.value/state.energyInitialJ:0;
        ctx.fillStyle=paper?item.paper:item.color;if(w>0)ctx.fillRect(x,start.y,w,m.len(.22));x+=w;
        labels.push({id:'regen-energy-'+i,...m.toScreen(i%2===0?-1.05:1.05,i<2?-.76:-1.02),text:item.label+' '+(item.value/1000).toFixed(3)+' kJ',color:paper?item.paper:item.color,font:'13px ui-sans-serif, system-ui'});
      }
      labels.push(
        {id:'regen-title',...m.toScreen(0,1.48),text:'新能源汽车等效再生制动（示意）',color:ink,font:'bold 15px ui-sans-serif, system-ui'},
        {id:'regen-state',...m.toScreen(0,1.20),text:'t = '+state.t.toFixed(3)+' s | v = '+state.v.toFixed(3)+' m/s | x = '+state.x.toFixed(3)+' m',color:ink,font:'13px ui-sans-serif, system-ui'},
        {id:'regen-budget',...m.toScreen(0,-.13),text:'初始动能账本：'+(state.energyInitialJ/1000).toFixed(3)+' kJ | 等效负载≠真实电池储能',color:muted,font:'13px ui-sans-serif, system-ui'}
      );
      resolveAndDrawLabels(ctx,labels,viewport.width,viewport.height);ctx.restore();return;
    }

    const legacyMode: string = params.mode;
    // Top track & sliding armature/vehicle
    const trackLeft = m.toScreen(-2.2, 0.45);
    const trackRight = m.toScreen(2.2, 0.45);
    const trackY = trackLeft.y;
    drawMetallicRail(ctx, trackLeft.x, trackY, trackRight.x, m.len(0.08));

    const maxVisualX = legacyMode === 'railgun' ? 25 : Math.max(10, computeAnalyticPureEmStopDistance(params) * 1.15);
    const fracX = Math.min(1, state.x / maxVisualX);
    const car = m.toScreen(-2.0 + fracX * 4.0, 0.58);
    ctx.fillStyle = legacyMode === 'railgun' ? '#38bdf8' : '#4ade80';
    ctx.fillRect(car.x - m.len(0.18), car.y - m.len(0.13), m.len(0.36), m.len(0.22));

    // Stacked energy ledger bar
    const total = Math.max(1e-6, state.energyInitialJ + state.energyInputWorkJ);
    const barLeft = m.toScreen(-2.0, -0.65);
    const barRight = m.toScreen(2.0, -0.65);
    const barX = barLeft.x;
    const barY = barLeft.y;
    const barW = barRight.x - barLeft.x;
    const slices = [
      { val: state.energyKineticJ, col: '#38bdf8', name: '动能' },
      { val: state.energyCapJ, col: '#fbbf24', name: '电容余能' },
      { val: state.energyRegenJ, col: '#4ade80', name: '再生回收' },
      { val: state.energyJouleJ, col: '#ef4444', name: '内阻焦耳热' },
      { val: state.energyDragMechJ, col: '#94a3b8', name: '风阻/机械摩擦' }
    ];
    let curX = barX;
    slices.forEach((sl) => {
      const segW = Math.max(0, (sl.val / total) * barW);
      if (segW > 0.5) {
        ctx.fillStyle = sl.col;
        ctx.fillRect(curX, barY, segW, m.len(0.15));
        curX += segW;
      }
    });

    labels.push(
      { id: 'launch-state-summary', ...m.toScreen(0, 0.95), text: `t=${state.t.toFixed(2)}s | x=${state.x.toFixed(2)}m | v=${state.v.toFixed(2)}m/s | 账本残差=${state.ledgerResidualJ.toExponential(2)} J`, color: '#e2e8f0', font: 'bold 13px ui-sans-serif, system-ui' },
      { id: 'launch-energy-summary', ...m.toScreen(-1.95, -0.45), text: `能量流账本占比（总投入 ${(total / 1000).toFixed(2)} kJ）`, color: '#e2e8f0', font: '12px ui-sans-serif, system-ui' }
    );
    resolveAndDrawLabels(ctx, labels, viewport.width, viewport.height);
    ctx.restore();
  },
  getControlHandles: (state, params) => {
    const maxVisualX = params.mode === 'railgun' ? 25 : Math.max(10, computeAnalyticPureEmStopDistance(params) * 1.15);
    const carX = params.mode==='regen-brake'?regenLayout(state,params).cx:-2 + Math.min(1, state.x / maxVisualX) * 4;
    return [
      params.mode === 'railgun'
        ? {
            id: 'railgun-drive-current',
            label: `I=${params.driveCurrentA} A`,
            position: { x: carX + (params.driveCurrentA / 1000) * 1.1, y: 0.58 },
            origin: { x: carX, y: 0.58 },
            handleKind: 'vector' as const,
            color: '#38bdf8',
            onDrag: (world: { x: number; y: number }) => ({ driveCurrentA: Math.max(50, Math.min(1000, Math.round(((world.x - carX) / 1.1) * 1000 / 50) * 50)) })
          }
        : {
            id: 'regen-v0',
            label: `v₀=${params.v0Mps} m/s`,
            position: { x: carX + (params.v0Mps / 50) * 1.2, y: regenLayout(state,params).cy },
            origin: { x: carX, y: regenLayout(state,params).cy },
            handleKind: 'vector' as const,
            color: '#4ade80',
            onDrag: (world: { x: number; y: number }) => ({ v0Mps: Math.max(0, Math.min(50, Math.round(((world.x - carX) / 1.2) * 50))) })
          }
    ];
  },
  getForceVectors: (state, params) => {
    const maxVisualX = params.mode === 'railgun' ? 25 : Math.max(10, computeAnalyticPureEmStopDistance(params) * 1.15);
    const g=params.mode==='regen-brake'?regenLayout(state,params):null;
    const origin = g?{x:g.cx,y:g.cy}:{ x: -2 + Math.min(1, state.x / maxVisualX) * 4, y: 0.58 };
    const forceEm = params.mode === 'railgun'
      ? params.bFieldT * params.trackSpanM * state.currentA
      : -params.bFieldT * params.trackSpanM * Math.abs(state.currentA);
    const forceDrag = -params.aeroDragCoeff * state.v * Math.abs(state.v) - (state.v > 0 ? params.mechBrakeN : 0);
    return [
      { id: 'em-ampere', label: params.mode === 'railgun' ? 'F安 (发射)' : 'F安 (制动)', origin, force: { x: forceEm, y: 0 }, color: '#38bdf8', category: 'magnetic', unit: 'N' },
      ...(Math.abs(forceDrag) > 1e-3 ? [{ id: 'drag-mechanical', label: 'F阻', origin, force: { x: forceDrag, y: 0 }, color: '#f43f5e', category: 'friction' as const, unit: 'N' }] : [])
    ];
  },
  referenceFrames: [
    {
      id: 'armature-frame',
      label: '电枢/列车随动参考系',
      getOrigin: (state, params) => {
        const maxVisualX = params.mode === 'railgun' ? 25 : Math.max(10, computeAnalyticPureEmStopDistance(params) * 1.15);
        if(params.mode==='regen-brake'){const g=regenLayout(state,params);return {x:g.cx,y:g.cy};}
        return { x: -2 + Math.min(1, state.x / maxVisualX) * 4, y: 0.58 };
      },
      getVelocity: (state, params) => {
        const maxVisualX = params.mode === 'railgun' ? 25 : Math.max(10, computeAnalyticPureEmStopDistance(params) * 1.15);
        if(params.mode==='regen-brake'){const g=regenLayout(state,params);return {x:state.x>=g.span?0:state.v/g.span*2.55,y:0};}
        return { x: (state.v / maxVisualX) * 4, y: 0 };
      }
    }
  ],
  formatFormulas: (state, params) => params.mode==='regen-brake'?[
    {id:'regen-energy-budget',label:'初始动能分账（等效负载能量）',latex:'E_{k0}=E_k+E_{\\mathrm{load}}+Q_{\\mathrm{int}}+W_{\\mathrm{loss}}',substitutedLatex:'E_{k0}='+ (state.energyInitialJ/1000).toFixed(3)+'\\,\\mathrm{kJ},\\quad |\\Delta E|='+state.ledgerResidualJ.toExponential(2)+'\\,\\mathrm{J}'},
    {id:'regen-force',label:'等效电磁阻尼（运动向右）',latex:'F_x=-BLI'},
    ...(params.aeroDragCoeff===0&&params.mechBrakeN===0?[{id:'regen-pure-limit',label:'纯电磁阻尼的渐近位移极限（非有限停车）',latex:'x_{\\infty}=\\frac{M v_0 R}{B^2L^2}'}]:[])
  ]:[
    {
      id: 'em-launch-regen-ledger',
      label: '电磁全能量账本与制动解析总距',
      latex:
        (params.mode as string) === 'railgun'
          ? 'E_{\\text{in}}=E_k+E_{\\text{cap}}+Q_J+W_{\\text{drag}}'
          : 'x_{\\text{停}}=\\frac{M v_0 R}{B^2 L^2}',
      substitutedLatex: `x=${state.x.toFixed(2)}\\text{ m},\\; E_k=${(state.energyKineticJ / 1000).toFixed(2)}\\text{ kJ},\\; |\\Delta E|=${state.ledgerResidualJ.toExponential(1)}\\text{ J}`
    }
  ]
});

export default stseEmLaunchRegenBrakePlugin;
