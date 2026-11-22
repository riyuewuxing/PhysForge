import { CLASSROOM_GRAVITY } from '@physforge/physics-core';
import { defineSimulationPlugin, type DiagramPrimitive, type ParamFieldSpec } from '@physforge/sim-sdk';
import { acScopePresets } from './presets.js';
import {
  checkInvariants,
  computeObservables,
  createInitialState,
  stepAcScope,
  type AcScopeParams,
  type AcScopeState
} from './engine.js';

const paramSchema: readonly ParamFieldSpec<AcScopeParams>[] = [
  {
    key: 'mode',
    kind: 'select',
    label: '电场交互模型',
    defaultValue: 'ac-square-wave',
    options: [
      { value: 'ac-square-wave', label: '方波交变电场四相位对比' },
      { value: 'ac-sine-wave', label: '正弦交变电场加速' },
      { value: 'oscilloscope-lissajous', label: '示波管余辉与李萨如图' },
      { value: 'equivalent-gravity', label: '等效重力场与等效最高点' }
    ]
  },
  { key: 'periodT', kind: 'number', label: '交变周期 T', unit: 's', min: 0.6, max: 4.0, step: 0.2, defaultValue: 2.0 },
  { key: 'accelA0', kind: 'number', label: '峰值电场加速度 qE₀/m', unit: 'm/s²', min: 1, max: 10, step: 0.5, defaultValue: 4.0 },
  { key: 'uAccelV', kind: 'number', label: '示波管加速电压 U₁', unit: 'V', min: 400, max: 2400, step: 100, defaultValue: 1200 },
  { key: 'uXMaxV', kind: 'number', label: 'X 扫描电压幅值', unit: 'V', min: 20, max: 200, step: 10, defaultValue: 110 },
  { key: 'uYMaxV', kind: 'number', label: 'Y 信号电压幅值', unit: 'V', min: 20, max: 200, step: 10, defaultValue: 110 },
  { key: 'freqRatioYOverX', kind: 'number', label: '示波器频率比 fy/fx', unit: '', min: 0.5, max: 4, step: 0.5, defaultValue: 2 },
  { key: 'phaseDeltaDeg', kind: 'number', label: 'X/Y 初相差 δ', unit: '°', min: 0, max: 180, step: 15, defaultValue: 90 },
  { key: 'eqFieldAccelX', kind: 'number', label: '等效电场水平加速度 qEx/m', unit: 'm/s²', min: -15, max: 15, step: 0.5, defaultValue: 9.8 },
  { key: 'eqFieldAccelY', kind: 'number', label: '等效电场竖直加速度 qEy/m', unit: 'm/s²', min: -8, max: 12, step: 0.5, defaultValue: 0 },
  { key: 'pendulumLengthL', kind: 'number', label: '等效重力摆长 L', unit: 'm', min: 0.5, max: 2, step: 0.1, defaultValue: 1.2 },
  { key: 'initialAngleDeg', kind: 'number', label: '初始摆角 θ₀', unit: '°', min: -60, max: 60, step: 5, defaultValue: -10 }
];

export const emAcFieldOscilloscopePlugin = defineSimulationPlugin<AcScopeParams, AcScopeState>({
  meta: {
    id: 'em-ac-field-oscilloscope',
    title: '交变电场、示波管与等效重力场 (E03)',
    textbookRef: '人教版 必修第三册 第十章 第5节',
    curriculumTags: ['物理观念', '科学思维', '科学探究'],
    difficulty: '压轴专题',
    version: '2.0.0'
  },
  paramSchema,
  presets: acScopePresets,
  engine: {
    createInitialState,
    step: stepAcScope,
    computeObservables,
    checkInvariants
  },
  layers: [
    { id: 'mainStage', label: '粒子群 / 示波屏 / 等效轴', defaultVisible: true },
    { id: 'phosphorTrail', label: '示波荧光余辉 / 等效重力线', defaultVisible: true }
  ],
  telemetryChannels: [
    { key: 'x0', label: 't₀=0 入射位移', unit: 'm', color: '#38bdf8' },
    { key: 'xQuarter', label: 't₀=T/4 往复位移', unit: 'm', color: '#4ade80' },
    { key: 'screenXCm', label: '示波屏 X 偏转', unit: 'cm', color: '#fbbf24' },
    { key: 'screenYCm', label: '示波屏 Y 偏转', unit: 'cm', color: '#f472b6' }
  ],
  getForceVectors: (state, params) => {
    if (params.mode !== 'equivalent-gravity') return [];
    const L = params.pendulumLengthL;
    const bx = L * Math.sin(state.theta);
    const by = -L * Math.cos(state.theta);
    return [
      { id: 'mg', label: 'mg', origin: { x: bx, y: by }, force: { x: 0, y: -CLASSROOM_GRAVITY }, category: 'gravity', color: '#f59e0b' },
      { id: 'qe', label: 'qE', origin: { x: bx, y: by }, force: { x: params.eqFieldAccelX, y: params.eqFieldAccelY }, category: 'electric', color: '#38bdf8' }
    ];
  },
  getControlHandles: (_s, params) =>
    params.mode === 'equivalent-gravity'
      ? [
          {
            id: 'eq-field',
            label: `qE/m=(${params.eqFieldAccelX.toFixed(1)}, ${params.eqFieldAccelY.toFixed(1)})`,
            position: { x: params.eqFieldAccelX * 0.1, y: params.eqFieldAccelY * 0.1 },
            handleKind: 'vector',
            color: '#38bdf8',
            onDrag: (wp) => ({
              eqFieldAccelX: Number(Math.max(-15, Math.min(15, wp.x * 10)).toFixed(1)),
              eqFieldAccelY: Number(Math.max(-8, Math.min(12, wp.y * 10)).toFixed(1))
            })
          }
        ]
      : [],
  sceneSerializer: {
    exportScene: (_s, params) => ({
      schemaVersion: '2.0',
      modelId: 'em-ac-field-oscilloscope',
      title: '交变电场与示波管模型',
      params
    }),
    importScene: (dsl) => dsl.params as Partial<AcScopeParams>
  },
  exportDiagramIR: (state, params) => {
    const primitives: DiagramPrimitive[] = [
      { kind: 'line', x1: -2.4, y1: -1.1, x2: 2.4, y2: -1.1, strokeWidth: 2 },
      {
        kind: 'mathLabel',
        x: 0,
        y: 1.2,
        text: `T=${params.periodT.toFixed(1)}\\text{s},\\; x_{T/4}=${(state.particles[2]?.x ?? 0).toFixed(2)}\\text{m}`,
        align: 'middle'
      }
    ];
    return {
      width: 680,
      height: 380,
      viewBox: { minX: -2.6, minY: -1.4, maxX: 2.6, maxY: 1.5 },
      title: '交变电场与示波器配图',
      primitives
    };
  },
  renderCanvas: (ctx, state, params, viewport, activeLayers) => {
    const cx = viewport.width * 0.5 + viewport.offsetX;
    const cy = viewport.height * 0.5 + viewport.offsetY;
    ctx.save();

    if (params.mode === 'oscilloscope-lissajous') {
      if (activeLayers.has('mainStage')) {
        const radius = Math.min(viewport.width, viewport.height) * 0.34 * viewport.scale;
        ctx.fillStyle = 'rgba(2, 44, 34, 0.85)';
        ctx.strokeStyle = '#34d399';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.strokeStyle = 'rgba(52, 211, 153, 0.25)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx - radius, cy);
        ctx.lineTo(cx + radius, cy);
        ctx.moveTo(cx, cy - radius);
        ctx.lineTo(cx, cy + radius);
        ctx.stroke();

        const sc = radius * 0.35;
        if (activeLayers.has('phosphorTrail') && state.scopeTrail.length > 1) {
          ctx.strokeStyle = '#4ade80';
          ctx.lineWidth = 2.4;
          ctx.beginPath();
          ctx.moveTo(cx + state.scopeTrail[0]!.x * sc, cy - state.scopeTrail[0]!.y * sc);
          for (let i = 1; i < state.scopeTrail.length; i++) {
            ctx.lineTo(cx + state.scopeTrail[i]!.x * sc, cy - state.scopeTrail[i]!.y * sc);
          }
          ctx.stroke();
        }
        ctx.fillStyle = '#fef08a';
        ctx.beginPath();
        ctx.arc(cx + state.screenX * sc, cy - state.screenY * sc, 5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      return;
    }

    if (params.mode === 'equivalent-gravity') {
      const ppm = Math.min(viewport.width, viewport.height) * 0.24 * viewport.scale;
      const ox = cx;
      const oy = viewport.height * 0.34 + viewport.offsetY;
      const L = params.pendulumLengthL;
      const gx = params.eqFieldAccelX;
      const gy = -CLASSROOM_GRAVITY + params.eqFieldAccelY;
      const gEff = Math.hypot(gx, gy) || 1;
      const ux = gx / gEff;
      const uy = gy / gEff;

      if (activeLayers.has('phosphorTrail')) {
        // Equivalent gravity axis (top & bottom points)
        ctx.strokeStyle = 'rgba(251, 191, 36, 0.6)';
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(ox - ux * L * 1.2 * ppm, oy + uy * L * 1.2 * ppm);
        ctx.lineTo(ox + ux * L * 1.2 * ppm, oy - uy * L * 1.2 * ppm);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      const bx = ox + L * Math.sin(state.theta) * ppm;
      const by = oy + L * Math.cos(state.theta) * ppm;
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      ctx.lineTo(bx, by);
      ctx.stroke();
      ctx.fillStyle = '#38bdf8';
      ctx.beginPath();
      ctx.arc(bx, by, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }

    // 4-lane phase comparison for alternating field
    const colors = ['#38bdf8', '#f472b6', '#4ade80', '#fbbf24'];
    const labels = ['t₀=0 (一直向前)', 't₀=T/8', 't₀=T/4 (原位往复)', 't₀=3T/8'];
    const startX = viewport.width * 0.18;
    const pxPerM = 28 * viewport.scale;
    state.particles.forEach((p, idx) => {
      const ly = cy - 110 + idx * 72;
      ctx.strokeStyle = 'rgba(148,163,184,0.3)';
      ctx.beginPath();
      ctx.moveTo(startX - 40, ly);
      ctx.lineTo(viewport.width - 40, ly);
      ctx.stroke();

      ctx.fillStyle = '#cbd5e1';
      ctx.font = '12px sans-serif';
      ctx.fillText(labels[idx]!, 24, ly + 4);

      const px = startX + p.x * pxPerM;
      ctx.fillStyle = p.active ? colors[idx]! : '#475569';
      ctx.beginPath();
      ctx.arc(px, ly, 9, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  },
  formatFormulas: (state, params) => {
    const obs = computeObservables(state, params);
    return [
      {
        id: 'ac-scope-eq',
        label: params.mode === 'oscilloscope-lissajous' ? '示波屏偏转偏移' : '实时状态量',
        latex:
          params.mode === 'oscilloscope-lissajous'
            ? 'Y = \\frac{U_y L_1}{2 d U_1}\\left(\\frac{L_1}{2}+L_2\\right)'
            : 'x(t_0),\\; g_{\\text{eff}}',
        substitutedLatex:
          params.mode === 'oscilloscope-lissajous'
            ? `X=${(obs.screenXCm ?? 0).toFixed(2)}\\text{ cm},\\; Y=${(obs.screenYCm ?? 0).toFixed(2)}\\text{ cm}`
            : `x_{t_0=0}=${(obs.x0 ?? 0).toFixed(3)}\\text{ m},\\; x_{T/4}=${(obs.xQuarter ?? 0).toFixed(4)}\\text{ m}`
      }
    ];
  }
});

export default emAcFieldOscilloscopePlugin;
