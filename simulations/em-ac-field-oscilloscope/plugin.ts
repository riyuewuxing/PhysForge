import type { LiveFormulaSpec } from '@physforge/sim-sdk';
import { CLASSROOM_GRAVITY } from '@physforge/physics-core';
import { createWorldMapper, defineSimulationPlugin, resolveAndDrawLabels, type CanvasLabel, type DiagramPrimitive, type ParamFieldSpec } from '@physforge/sim-sdk';
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


const liveFormulas: readonly LiveFormulaSpec[] = [{
  "id": "period-frequency",
  "title": "交变场周期与角频率",
  "latex": "\\omega=\\frac{2\\pi}{\\htmlClass{pf-live-var}{\\htmlData{param=periodT}{T}}}",
  "bindings": [
    {
      "tokenKey": "periodT",
      "paramKey": "periodT",
      "label": "交变周期 T",
      "unit": "s",
      "min": 0.6,
      "max": 4,
      "step": 0.2,
      "precision": 2
    }
  ]
}];
export const emAcFieldOscilloscopePlugin = Object.assign(defineSimulationPlugin<AcScopeParams, AcScopeState>({
  meta: {
    id: 'em-ac-field-oscilloscope',
    title: '交变电场、示波管与等效重力场 (E03)',
    textbookRef: '人教版 必修第三册 第十章 第5节',
    curriculumTags: ['物理观念', '科学思维', '科学探究'],
    difficulty: '压轴专题',
    version: '2.0.0'
  },
  defaultView: {
    offsetRatioX: 0.05,
    offsetRatioY: (p) => p.mode === 'equivalent-gravity' ? -0.16 : 0
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
  referenceFrames: [
    {
      id: 'equivalent-bob',
      label: '等效重力摆球随动系',
      getOrigin: (s, p) => ({ x: p.pendulumLengthL * Math.sin(s.theta), y: -p.pendulumLengthL * Math.cos(s.theta) }),
      getVelocity: (s, p) => ({ x: p.pendulumLengthL * Math.cos(s.theta) * s.omega, y: p.pendulumLengthL * Math.sin(s.theta) * s.omega })
    }
  ],
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
    const m = createWorldMapper(viewport);
    const labels: CanvasLabel[] = [];
    ctx.save();

    if (params.mode === 'oscilloscope-lissajous') {
      if (activeLayers.has('mainStage')) {
        const center = m.toScreen(0, 0);
        const radius = m.len(1.4);
        ctx.fillStyle = 'rgba(2, 44, 34, 0.85)';
        ctx.strokeStyle = '#34d399';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.strokeStyle = 'rgba(52, 211, 153, 0.25)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(center.x - radius, center.y);
        ctx.lineTo(center.x + radius, center.y);
        ctx.moveTo(center.x, center.y - radius);
        ctx.lineTo(center.x, center.y + radius);
        ctx.stroke();

        const trailScale = 0.49;
        if (activeLayers.has('phosphorTrail') && state.scopeTrail.length > 1) {
          ctx.strokeStyle = '#4ade80';
          ctx.lineWidth = 2.4;
          ctx.beginPath();
          const first = m.toScreen(state.scopeTrail[0]!.x * trailScale, state.scopeTrail[0]!.y * trailScale);
          ctx.moveTo(first.x, first.y);
          for (let i = 1; i < state.scopeTrail.length; i++) {
            const point = m.toScreen(state.scopeTrail[i]!.x * trailScale, state.scopeTrail[i]!.y * trailScale);
            ctx.lineTo(point.x, point.y);
          }
          ctx.stroke();
        }
        const beamPoint = m.toScreen(state.screenX * trailScale, state.screenY * trailScale);
        ctx.fillStyle = '#fef08a';
        ctx.beginPath();
        ctx.arc(beamPoint.x, beamPoint.y, m.len(0.03), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      return;
    }

    if (params.mode === 'equivalent-gravity') {
      const pivot = m.toScreen(0, 0);
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
        const axisA = m.toScreen(-ux * L * 1.2, -uy * L * 1.2);
        const axisB = m.toScreen(ux * L * 1.2, uy * L * 1.2);
        ctx.beginPath();
        ctx.moveTo(axisA.x, axisA.y);
        ctx.lineTo(axisB.x, axisB.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      const bob = m.toScreen(L * Math.sin(state.theta), -L * Math.cos(state.theta));
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(pivot.x, pivot.y);
      ctx.lineTo(bob.x, bob.y);
      ctx.stroke();
      ctx.fillStyle = '#38bdf8';
      ctx.beginPath();
      ctx.arc(bob.x, bob.y, m.len(0.055), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }

    // 4-lane phase comparison for alternating field
    const colors = ['#38bdf8', '#f472b6', '#4ade80', '#fbbf24'];
    const phaseCaptions = ['t₀=0 (一直向前)', 't₀=T/8', 't₀=T/4 (原位往复)', 't₀=3T/8'];
    state.particles.forEach((p, idx) => {
      const laneY = 0.9 - idx * 0.6;
      const left = m.toScreen(-2, laneY);
      const right = m.toScreen(2, laneY);
      ctx.strokeStyle = 'rgba(148,163,184,0.3)';
      ctx.beginPath();
      ctx.moveTo(left.x, left.y);
      ctx.lineTo(right.x, right.y);
      ctx.stroke();

      const particle = m.toScreen(p.x * 0.25 - 1.5, laneY);
      ctx.fillStyle = p.active ? colors[idx]! : '#475569';
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, m.len(0.045), 0, Math.PI * 2);
      ctx.fill();
      labels.push({ id: `phase-label-${idx}`, x: left.x + m.len(0.45), y: left.y - m.len(0.12), text: phaseCaptions[idx]!, color: '#cbd5e1', font: '12px sans-serif' });
    });
    resolveAndDrawLabels(ctx, labels, viewport.width, viewport.height);
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
}), { liveFormulas });

export default emAcFieldOscilloscopePlugin;
