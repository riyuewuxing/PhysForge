import { defineSimulationPlugin, type DiagramPrimitive, type ParamFieldSpec } from '@physforge/sim-sdk';
import { preloadMathjsCompiler } from './safeAstCompiler.js';
import { customOdePresets } from './presets.js';
import {
  checkInvariants,
  computeObservables,
  createInitialState,
  stepCustomOde,
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
    label: '预置安全公式（白名单 AST）',
    options: [
      { label: 'Duffing 双稳振子 -(k*x + 2*x^3)/m - gamma*v + A*cos(w*t)', value: '-(k * x + 2 * x^3) / m - gamma * v + A * cos(w * t)' },
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

export const builderCustomOdeLabPlugin = defineSimulationPlugin<CustomOdeParams, CustomOdeState>({
  meta: {
    id: 'builder-custom-ode-lab',
    title: '通用微分方程与拉格朗日实验室 (B5)',
    textbookRef: '强基竞赛 & 高阶数值探究拓展',
    curriculumTags: ['科学思维', '科学探究'],
    difficulty: '压轴专题',
    version: '2.0.0'
  },
  paramSchema,
  presets: customOdePresets,
  engine: {
    createInitialState: (params) => {
      void preloadMathjsCompiler();
      return createInitialState(params);
    },
    step: stepCustomOde,
    computeObservables,
    checkInvariants
  },
  layers: [
    { id: 'trajectory', label: '相空间 / 轨道轨迹', defaultVisible: true },
    { id: 'axes', label: '参考坐标与中心质点', defaultVisible: true }
  ],
  telemetryChannels: [
    { key: 'x', label: '位置 x / θ', unit: 'm', color: '#38bdf8' },
    { key: 'v', label: '速度 v / ω', unit: 'm/s', color: '#f472b6' },
    { key: 'energy', label: '系统能量 E', unit: 'J', color: '#4ade80' }
  ],
  getControlHandles: (state) => [
    {
      id: 'initial-pos',
      label: `x=${state.x.toFixed(2)}`,
      position: { x: state.x, y: 0 },
      handleKind: 'point',
      color: '#38bdf8',
      onDrag: (wp) => ({ initialPos: Number(Math.max(-2.5, Math.min(2.5, wp.x)).toFixed(1)) })
    }
  ],
  sceneSerializer: {
    exportScene: (_s, params) => ({
      schemaVersion: '2.0',
      modelId: 'builder-custom-ode-lab',
      title: '通用 ODE 仿真实验',
      params
    }),
    importScene: (dsl) => dsl.params as Partial<CustomOdeParams>
  },
  exportDiagramIR: (state, params) => {
    const primitives: DiagramPrimitive[] = [
      { kind: 'line', x1: -2.8, y1: 0, x2: 2.8, y2: 0, dashed: true },
      { kind: 'line', x1: 0, y1: -2.2, x2: 0, y2: 2.2, dashed: true }
    ];
    if (state.trail.length >= 2) {
      primitives.push({ kind: 'trajectory', points: state.trail });
    }
    primitives.push({ kind: 'circle', cx: state.x, cy: params.template === 'kepler-2d' ? state.y : state.vx, r: 0.08, fill: true });
    primitives.push({ kind: 'mathLabel', x: 2.6, y: 1.9, text: params.template === 'kepler-2d' ? 'Kepler 2D' : 'Phase (x, v)', align: 'end' });
    return {
      width: 720,
      height: 440,
      viewBox: { minX: -3.2, minY: -2.4, maxX: 3.2, maxY: 2.4 },
      title: '微分方程相轨迹与轨道图',
      primitives
    };
  },
  formatFormulas: (state, params) => [
    {
      id: 'ode-formula',
      label: '当前微分方程核（白名单 AST 沙箱）',
      latex:
        params.template === 'kepler-2d'
          ? '\\ddot{\\mathbf{r}} = -\\frac{\\mu}{r^3}\\mathbf{r}'
          : `\\ddot{x} = \\text{${params.template === 'custom-expr' ? 'f(x,v,t)' : params.template}}`,
      substitutedLatex: `x = ${state.x.toFixed(3)},\\; v = ${state.vx.toFixed(3)}`
    }
  ],
  renderCanvas: (ctx, state, params, viewport, activeLayers) => {
    const ppm = Math.min(viewport.width, viewport.height) * 0.18 * viewport.scale;
    const cx = viewport.width * 0.5 + viewport.offsetX;
    const cy = viewport.height * 0.5 + viewport.offsetY;
    const toScr = (wx: number, wy: number) => ({ sx: cx + wx * ppm, sy: cy - wy * ppm });

    if (activeLayers.has('axes')) {
      ctx.save();
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(0, cy);
      ctx.lineTo(viewport.width, cy);
      ctx.moveTo(cx, 0);
      ctx.lineTo(cx, viewport.height);
      ctx.stroke();
      ctx.restore();
    }

    if (activeLayers.has('trajectory') && state.trail.length >= 2) {
      ctx.save();
      ctx.strokeStyle = '#38bdf8';
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
      ctx.arc(cx, cy, 10, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#f472b6';
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
