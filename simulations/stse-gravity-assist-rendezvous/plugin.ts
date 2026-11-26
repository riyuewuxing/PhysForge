import { createWorldMapper, defineSimulationPlugin, type DiagramPrimitive, type ParamFieldSpec } from '@physforge/sim-sdk';
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
      { value: 'rendezvous', label: '空间站交会对接变轨' }
    ]
  },
  {
    key: 'flybySide',
    kind: 'select',
    label: '掠飞方位（相对行星运动）',
    defaultValue: 'trailing',
    options: [
      { value: 'trailing', label: '绕行星尾后侧（加速）' },
      { value: 'leading', label: '绕行星前侧（减速）' }
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
  defaultView: { scale: (params) => params.mode === 'rendezvous' ? 0.5 : 1.417 },
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
      label: '太阳系（惯性系）',
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
    const primitives: DiagramPrimitive[] = [
      { kind: 'circle', cx: 0, cy: 0, r: 1.0, dashed: true },
      { kind: 'trajectory', points: state.trail.slice(-50).map((p) => ({ x: params.mode === 'gravity-assist' ? p.x - p.px : p.x, y: params.mode === 'gravity-assist' ? p.y - p.py : p.y })), strokeWidth: 1.5 }
    ];
    return {
      width: 680,
      height: 400,
      viewBox: { minX: -2.6, minY: -1.8, maxX: 2.6, maxY: 1.8 },
      title: params.mode === 'gravity-assist' ? '引力弹弓双曲线掠飞配图' : '空间站交会椭圆变轨配图',
      primitives
    };
  },
  renderCanvas: (ctx, state, params, viewport, activeLayers) => {
    if (!activeLayers.has('orbit')) return;
    const m = createWorldMapper(viewport);
    const center = m.toScreen(0, 0);
    ctx.save();

    if (params.mode === 'rendezvous') {
      ctx.strokeStyle = 'rgba(148,163,184,0.45)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(center.x, center.y, m.len(1), 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = '#fbbf24';
      ctx.beginPath();
      ctx.arc(center.x, center.y, m.len(0.1), 0, Math.PI * 2);
      ctx.fill();

      if (state.trail.length > 1) {
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2;
        ctx.beginPath();
        state.trail.forEach((pt, idx) => {
          const point = m.toScreen(pt.x, pt.y);
          if (idx === 0) ctx.moveTo(point.x, point.y);
          else ctx.lineTo(point.x, point.y);
        });
        ctx.stroke();
      }

      ctx.fillStyle = '#4ade80';
      const planet = m.toScreen(state.planetPos.x, state.planetPos.y);
      ctx.fillRect(planet.x - m.len(0.05), planet.y - m.len(0.05), m.len(0.1), m.len(0.1));
      ctx.fillStyle = '#38bdf8';
      ctx.beginPath();
      const chaser = m.toScreen(state.pos.x, state.pos.y);
      ctx.arc(chaser.x, chaser.y, m.len(0.05), 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#e2e8f0';
      ctx.font = 'bold 13px ui-sans-serif, system-ui';
      ctx.fillText(
        `${params.rendezvousBurn === 'prograde-boost' ? '正向增速：轨道周期更长' : '逆向减速：轨道周期更短（不代表已对接）'} | Δθ=${(state.chaserAngleRad - state.targetAngleRad).toFixed(3)} rad`,
        20,
        30
      );
      ctx.restore();
      return;
    }

    // Planet marker
    ctx.fillStyle = '#f59e0b';
    ctx.beginPath();
    const planet = m.toScreen(state.planetPos.x, state.planetPos.y);
    ctx.arc(planet.x, planet.y, m.len(0.06), 0, Math.PI * 2);
    ctx.fill();

    // Spacecraft trail
    if (state.trail.length > 1) {
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      state.trail.forEach((pt, idx) => {
        const px = pt.x;
        const py = pt.y;
        const point = m.toScreen(px, py);
        if (idx === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
      });
      ctx.stroke();
    }

    ctx.fillStyle = '#4ade80';
    ctx.beginPath();
    const spacecraft = m.toScreen(state.pos.x, state.pos.y);
    ctx.arc(spacecraft.x, spacecraft.y, m.len(0.05), 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#e2e8f0';
    ctx.font = 'bold 13px ui-sans-serif, system-ui';
    const dE = state.helioEnergyCurrent - state.helioEnergyInitial;
    ctx.fillText(
      `局部惯性系比动能变化 ΔEk = ${dE >= 0 ? '+' : ''}${dE.toFixed(4)} | 同初始半径等效速率残差 ${state.planetFrameSpeedRelErr.toExponential(2)}`,
      20,
      30
    );
    ctx.restore();
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
