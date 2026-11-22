import { defineSimulationPlugin, type DiagramPrimitive, type ParamFieldSpec } from '@physforge/sim-sdk';
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
  {
    key: 'frameView',
    kind: 'select',
    label: '观察参考系',
    defaultValue: 'heliocentric',
    options: [
      { value: 'heliocentric', label: '日心惯性系' },
      { value: 'planet-frame', label: '行星共动参考系' }
    ]
  },
  { key: 'muPlanet', kind: 'number', label: '行星引力参数 μ_p', defaultValue: 0.16, min: 0.05, max: 0.4, step: 0.02 },
  { key: 'planetOrbitRadius', kind: 'number', label: '行星轨道半径 r_p', defaultValue: 5.0, min: 2.0, max: 8.0, step: 0.5 },
  { key: 'impactParam', kind: 'number', label: '瞄准距离 b', defaultValue: 0.38, min: 0.15, max: 1.2, step: 0.04 },
  {
    key: 'rendezvousBurn',
    kind: 'select',
    label: '交会点火策略',
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
  paramSchema,
  presets: gravityAssistPresets,
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
    { key: 'deltaHelioEnergy', label: '日心比机械能变化 ΔE', unit: '', color: '#4ade80' },
    { key: 'planetFrameSpeedRelErr', label: '行星系速率守恒误差', unit: '', color: '#fbbf24' }
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
    const w = viewport.width;
    const h = viewport.height;
    if (!activeLayers.has('orbit')) return;
    ctx.save();
    const cx = w * 0.5;
    const cy = h * 0.52;

    if (params.mode === 'rendezvous') {
      const scale = Math.min(w, h) * 0.34;
      ctx.strokeStyle = 'rgba(148,163,184,0.45)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, scale, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = '#fbbf24';
      ctx.beginPath();
      ctx.arc(cx, cy, 12, 0, Math.PI * 2);
      ctx.fill();

      if (state.trail.length > 1) {
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2;
        ctx.beginPath();
        state.trail.forEach((pt, idx) => {
          const sx = cx + pt.x * scale;
          const sy = cy - pt.y * scale;
          if (idx === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        });
        ctx.stroke();
      }

      ctx.fillStyle = '#4ade80';
      ctx.fillRect(cx + state.planetPos.x * scale - 6, cy - state.planetPos.y * scale - 6, 12, 12);
      ctx.fillStyle = '#38bdf8';
      ctx.beginPath();
      ctx.arc(cx + state.pos.x * scale, cy - state.pos.y * scale, 6, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#e2e8f0';
      ctx.font = 'bold 13px ui-sans-serif, system-ui';
      ctx.fillText(
        `${params.rendezvousBurn === 'prograde-boost' ? '正向加速高轨：周期更长，一圈后更落后目标舱' : '逆向降轨：周期更短，加速追及目标舱'} | Δθ=${(state.chaserAngleRad - state.targetAngleRad).toFixed(3)} rad`,
        20,
        30
      );
      ctx.restore();
      return;
    }

    const scale = Math.min(w, h) * 0.12;
    const isPlanet = params.frameView === 'planet-frame';
    const refX = isPlanet ? state.planetPos.x : params.planetOrbitRadius;
    const refY = isPlanet ? state.planetPos.y : 0;

    // Planet marker
    ctx.fillStyle = '#f59e0b';
    ctx.beginPath();
    ctx.arc(cx + (state.planetPos.x - refX) * scale, cy - (state.planetPos.y - refY) * scale, 10, 0, Math.PI * 2);
    ctx.fill();

    // Spacecraft trail
    if (state.trail.length > 1) {
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      state.trail.forEach((pt, idx) => {
        const px = isPlanet ? pt.x - pt.px : pt.x - refX;
        const py = isPlanet ? pt.y - pt.py : pt.y - refY;
        const sx = cx + px * scale;
        const sy = cy - py * scale;
        if (idx === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      });
      ctx.stroke();
    }

    ctx.fillStyle = '#4ade80';
    ctx.beginPath();
    ctx.arc(cx + (state.pos.x - refX) * scale, cy - (state.pos.y - refY) * scale, 6, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#e2e8f0';
    ctx.font = 'bold 13px ui-sans-serif, system-ui';
    const dE = state.helioEnergyCurrent - state.helioEnergyInitial;
    ctx.fillText(
      `日心动能变化 ΔEk = ${dE >= 0 ? '+' : ''}${dE.toFixed(4)} | 行星系进出速率守恒误差 ${state.planetFrameSpeedRelErr.toExponential(2)}`,
      20,
      30
    );
    ctx.restore();
  },
  formatFormulas: (state, params) => [
    {
      id: 'slingshot-rendezvous',
      label: params.mode === 'gravity-assist' ? '引力弹弓参考系矢量变换' : '开普勒第三定律与逆直觉追及',
      latex:
        params.mode === 'gravity-assist'
          ? '\\mathbf{v}_{\\text{日心}} = \\mathbf{v}_{\\text{行}} + \\mathbf{v}_{\\infty}'
          : 'T = 2\\pi\\sqrt{\\frac{a^3}{GM}}',
      substitutedLatex: `\\Delta E_{\\text{日心}}=${(state.helioEnergyCurrent - state.helioEnergyInitial).toFixed(4)},\\; \\text{Err}=${state.planetFrameSpeedRelErr.toExponential(1)}`
    }
  ]
});

export default stseGravityAssistRendezvousPlugin;
