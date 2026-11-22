import { defineSimulationPlugin, type DiagramPrimitive, type ParamFieldSpec } from '@physforge/sim-sdk';
import { rigidRollingPresets } from './presets.js';
import {
  SHAPE_INERTIA_COEFF,
  checkInvariants,
  computeObservables,
  createInitialState,
  stepRigidRollingSlip,
  type RigidBodyShape,
  type RigidRollingParams,
  type RigidRollingState
} from './engine.js';

const paramSchema: readonly ParamFieldSpec<RigidRollingParams>[] = [
  {
    key: 'scenario',
    kind: 'select',
    label: '竞赛物理场景',
    defaultValue: 'flat-bowling-slip',
    options: [
      { value: 'flat-bowling-slip', label: '水平打滑→纯滚动转换 (Hybrid)' },
      { value: 'incline-race', label: '四刚体同斜面纯滚动竞速' }
    ]
  },
  {
    key: 'shape',
    kind: 'select',
    label: '刚体构型 I = c m R²',
    defaultValue: 'solid-sphere',
    options: [
      { value: 'solid-sphere', label: '实心球 (c = 2/5)' },
      { value: 'solid-cylinder', label: '实心圆柱 (c = 1/2)' },
      { value: 'hollow-sphere', label: '空心球壳 (c = 2/3)' },
      { value: 'thin-ring', label: '薄圆环 (c = 1)' }
    ]
  },
  { key: 'massKg', kind: 'number', label: '质量 m', unit: 'kg', defaultValue: 2.0, min: 0.5, max: 10, step: 0.5 },
  { key: 'radiusM', kind: 'number', label: '半径 R', unit: 'm', defaultValue: 0.12, min: 0.06, max: 0.3, step: 0.02 },
  { key: 'v0Mps', kind: 'number', label: '初质心速度 v₀', unit: 'm/s', defaultValue: 7.0, min: -10, max: 15, step: 0.5 },
  { key: 'omega0Radps', kind: 'number', label: '初角速度 ω₀', unit: 'rad/s', defaultValue: 0, min: -150, max: 100, step: 10 },
  { key: 'muK', kind: 'number', label: '动摩擦因数 μ_k', defaultValue: 0.25, min: 0.05, max: 0.8, step: 0.05 },
  { key: 'inclineDeg', kind: 'number', label: '斜面倾角 θ', unit: '°', defaultValue: 20, min: 5, max: 45, step: 5 }
];

export const compRigidRollingSlipPlugin = defineSimulationPlugin<RigidRollingParams, RigidRollingState>({
  meta: {
    id: 'comp-rigid-rolling-slip',
    title: '刚体定轴转动与滑滚转换 (C01)',
    textbookRef: '人教版 选择性必修一 & 强基竞赛 · 刚体转动与滑滚',
    curriculumTags: ['物理观念', '科学思维'],
    difficulty: '压轴专题',
    version: '2.0.0'
  },
  paramSchema,
  presets: rigidRollingPresets,
  engine: {
    createInitialState,
    step: stepRigidRollingSlip,
    computeObservables,
    checkInvariants
  },
  layers: [
    { id: 'main', label: '刚体滚轮与角线速度对照', defaultVisible: true }
  ],
  telemetryChannels: [
    { key: 'v', label: '质心速度 v', unit: 'm/s', color: '#38bdf8' },
    { key: 'omegaR', label: '边缘转动线速度 ωR', unit: 'm/s', color: '#fbbf24' },
    { key: 'slipSpeed', label: '触地相对滑速 v-ωR', unit: 'm/s', color: '#f43f5e' },
    { key: 'currentEnergyJ', label: '机械能 E', unit: 'J', color: '#4ade80' }
  ],
  sceneSerializer: {
    exportScene: (_s, params) => ({
      schemaVersion: '2.0',
      modelId: 'comp-rigid-rolling-slip',
      title: '刚体定轴转动与滑滚转换',
      params
    }),
    importScene: (dsl) => dsl.params as Partial<RigidRollingParams>
  },
  exportDiagramIR: (state, params) => {
    const primitives: DiagramPrimitive[] = [
      { kind: 'hatchedGround', x1: -2.0, y1: -0.5, x2: 2.0, y2: -0.5 },
      { kind: 'circle', cx: -0.4 + Math.min(1.6, state.x * 0.1), cy: -0.1, r: 0.4 },
      { kind: 'arrow', x1: -0.4 + Math.min(1.6, state.x * 0.1), y1: -0.1, x2: 0.3 + Math.min(1.6, state.x * 0.1), y2: -0.1, label: 'v' },
      { kind: 'mathLabel', x: 0, y: 1.0, text: `I=${SHAPE_INERTIA_COEFF[params.shape].toFixed(2)}mR^2`, align: 'middle' }
    ];
    return {
      width: 680,
      height: 360,
      viewBox: { minX: -2.2, minY: -1.1, maxX: 2.2, maxY: 1.3 },
      title: '刚体滑滚转换模型配图',
      primitives
    };
  },
  renderCanvas: (ctx, state, params, viewport, activeLayers) => {
    const w = viewport.width;
    const h = viewport.height;
    if (!activeLayers.has('main')) return;
    ctx.save();

    if (params.scenario === 'incline-race') {
      const shapes: { key: RigidBodyShape; label: string; col: string }[] = [
        { key: 'solid-sphere', label: '实心球 (c=0.40)', col: '#4ade80' },
        { key: 'solid-cylinder', label: '实心圆柱 (c=0.50)', col: '#38bdf8' },
        { key: 'hollow-sphere', label: '空心球壳 (c=0.67)', col: '#fbbf24' },
        { key: 'thin-ring', label: '薄圆环 (c=1.00)', col: '#f43f5e' }
      ];
      const maxX = Math.max(8, ...Object.values(state.inclinePositions));
      shapes.forEach((sh, idx) => {
        const y = h * 0.24 + idx * (h * 0.17);
        ctx.strokeStyle = '#475569';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(w * 0.12, y);
        ctx.lineTo(w * 0.9, y);
        ctx.stroke();

        const px = w * 0.14 + Math.min(1, state.inclinePositions[sh.key]! / maxX) * (w * 0.72);
        ctx.fillStyle = sh.col;
        ctx.beginPath();
        ctx.arc(px, y - 16, 15, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#e2e8f0';
        ctx.font = 'bold 12px ui-sans-serif, system-ui';
        ctx.fillText(`${sh.label}: x=${state.inclinePositions[sh.key]!.toFixed(2)}m`, w * 0.12, y - 34);
      });
      ctx.restore();
      return;
    }

    const groundY = h * 0.65;
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(w * 0.08, groundY);
    ctx.lineTo(w * 0.92, groundY);
    ctx.stroke();

    const rPx = 38;
    const ballX = ((w * 0.2 + state.x * 38) % (w * 0.72)) + w * 0.1;
    const ballY = groundY - rPx;
    ctx.fillStyle = state.mode === 'pure-rolling' ? 'rgba(74, 222, 128, 0.25)' : 'rgba(244, 63, 94, 0.25)';
    ctx.strokeStyle = state.mode === 'pure-rolling' ? '#4ade80' : '#f43f5e';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(ballX, ballY, rPx, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Spoke to show rotation phase theta
    ctx.beginPath();
    ctx.moveTo(ballX, ballY);
    ctx.lineTo(ballX + rPx * Math.cos(-state.theta), ballY - rPx * Math.sin(-state.theta));
    ctx.stroke();

    ctx.fillStyle = '#e2e8f0';
    ctx.font = 'bold 13px ui-sans-serif, system-ui';
    ctx.fillText(
      `状态: ${state.mode === 'pure-rolling' ? '纯滚动 (v=ωR)' : '滑动搓地中'} | v=${state.v.toFixed(3)} m/s | ωR=${(state.omega * params.radiusM).toFixed(3)} m/s${state.transitionTimeS !== null ? ` | t_c=${state.transitionTimeS.toFixed(4)}s` : ''}`,
      20,
      30
    );
    ctx.restore();
  },
  formatFormulas: (state, params) => [
    {
      id: 'rigid-rolling',
      label: '刚体滑滚转换动力学',
      latex: 'I=cmR^2,\\quad t_c=\\frac{v_0-\\omega_0 R}{(1+1/c)\\mu_k g}',
      substitutedLatex: `v=${state.v.toFixed(3)}\\text{ m/s},\\; \\omega R=${(state.omega * params.radiusM).toFixed(3)}\\text{ m/s}`
    }
  ]
});

export default compRigidRollingSlipPlugin;
