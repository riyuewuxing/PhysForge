import { createWorldMapper, defineSimulationPlugin, resolveAndDrawLabels, type CanvasLabel, type DiagramPrimitive, type ParamFieldSpec } from '@physforge/sim-sdk';
import { eddyVortexPresets } from './presets.js';
import {
  checkInvariants,
  computeObservables,
  createInitialState,
  evalVortexField,
  stepEddyVortex,
  type EddyVortexParams,
  type EddyVortexState
} from './engine.js';

const paramSchema: readonly ParamFieldSpec<EddyVortexParams>[] = [
  {
    key: 'mode',
    kind: 'select',
    label: '实验场景',
    defaultValue: 'betatron-vortex',
    options: [
      { value: 'betatron-vortex', label: '柱对称涡旋电场与电子加速' },
      { value: 'eddy-damping-compare', label: '整块 vs 开槽铜板阻尼摆对比' }
    ]
  },
  { key: 'cylinderRadiusR', kind: 'number', label: '圆柱磁场半径 R', unit: 'm', min: 0.4, max: 1.8, step: 0.1, defaultValue: 1.2 },
  { key: 'bDotRate', kind: 'number', label: '磁感应强度变化率 ΔB/Δt', unit: 'T/s', min: -3, max: 3, step: 0.2, defaultValue: 1.5 },
  { key: 'bField0', kind: 'number', label: '初始磁场 B₀', unit: 'T', min: 0, max: 3, step: 0.2, defaultValue: 1.0 },
  { key: 'particleChargeRatio', kind: 'number', label: '荷质比 q/m', unit: '', min: 0.2, max: 4, step: 0.2, defaultValue: 1.6 },
  { key: 'particleInitRadius', kind: 'number', label: '初始轨道半径 r₀', unit: 'm', min: 0.3, max: 1.8, step: 0.1, defaultValue: 0.9 },
  { key: 'pendulumLengthL', kind: 'number', label: '铜板摆长 L', unit: 'm', min: 0.5, max: 1.6, step: 0.1, defaultValue: 1.0 },
  { key: 'solidDampingGamma', kind: 'number', label: '整块铜板涡流阻尼系数', unit: 's⁻¹', min: 0.5, max: 4, step: 0.2, defaultValue: 2.2 },
  { key: 'slottedDampingGamma', kind: 'number', label: '开槽铜板等效阻尼系数', unit: 's⁻¹', min: 0.02, max: 0.5, step: 0.02, defaultValue: 0.06 },
  { key: 'initialAngleDeg', kind: 'number', label: '双摆初始释放角 θ₀', unit: '°', min: 10, max: 60, step: 5, defaultValue: 35 }
];

export const emEddyVortexFieldPlugin = defineSimulationPlugin<EddyVortexParams, EddyVortexState>({
  meta: {
    id: 'em-eddy-vortex-field',
    title: '感生涡旋电场与电磁阻尼对比 (E06)',
    textbookRef: '人教版 选择性必修二 第二章 第4节',
    curriculumTags: ['物理观念', '科学思维', '科学探究'],
    difficulty: '压轴专题',
    version: '2.0.0'
  },
  defaultView: { scale: 0.917, offsetRatioX: 0.05 },
  paramSchema,
  presets: eddyVortexPresets,
  engine: {
    createInitialState,
    step: stepEddyVortex,
    computeObservables,
    checkInvariants
  },
  layers: [
    { id: 'vortexRings', label: '涡旋感生电场环与 E 矢量', defaultVisible: true },
    { id: 'particle', label: '试探电子 / 阻尼双摆', defaultVisible: true }
  ],
  telemetryChannels: [
    { key: 'bCurrent', label: '柱内磁感应强度 B(t)', unit: 'T', color: '#38bdf8' },
    { key: 'eVortexMag', label: '所在处涡旋场强 |E|', unit: 'V/m', color: '#fbbf24' },
    { key: 'solidAngleDeg', label: '整块铜板摆角', unit: '°', color: '#f43f5e' },
    { key: 'slottedAngleDeg', label: '开槽铜板摆角', unit: '°', color: '#4ade80' }
  ],
  getForceVectors: (state, params) => {
    if (params.mode !== 'betatron-vortex') return [];
    const { Ex, Ey } = evalVortexField(state.px, state.py, params.cylinderRadiusR, params.bDotRate);
    return [
      {
        id: 'vortex-electric',
        label: 'qE感生',
        origin: { x: state.px, y: state.py },
        force: { x: params.particleChargeRatio * Ex, y: params.particleChargeRatio * Ey },
        category: 'electric',
        color: '#fbbf24'
      }
    ];
  },
  referenceFrames: [
    {
      id: 'eddy-probe',
      label: '试探粒子随动参考系',
      getOrigin: (s) => ({ x: s.px, y: s.py }),
      getVelocity: (s) => ({ x: s.vx, y: s.vy })
    }
  ],
  getControlHandles: (_s, params) =>
    params.mode === 'betatron-vortex'
      ? [
          {
            id: 'cyl-radius',
            label: `R=${params.cylinderRadiusR.toFixed(1)}m`,
            position: { x: params.cylinderRadiusR, y: 0 },
            handleKind: 'radius',
            color: '#38bdf8',
            onDrag: (wp) => ({ cylinderRadiusR: Number(Math.max(0.4, Math.min(1.8, Math.hypot(wp.x, wp.y))).toFixed(1)) })
          }
        ]
      : [],
  sceneSerializer: {
    exportScene: (_s, params) => ({
      schemaVersion: '2.0',
      modelId: 'em-eddy-vortex-field',
      title: '感生涡旋电场与电磁阻尼',
      params
    }),
    importScene: (dsl) => dsl.params as Partial<EddyVortexParams>
  },
  exportDiagramIR: (state, params) => {
    const primitives: DiagramPrimitive[] = [
      { kind: 'circle', cx: 0, cy: 0, r: params.cylinderRadiusR, dashed: true },
      { kind: 'circle', cx: state.px, cy: state.py, r: 0.08, fill: true },
      { kind: 'trajectory', points: state.trail.map((p) => ({ x: p.x, y: p.y })), strokeWidth: 1.5 },
      {
        kind: 'mathLabel',
        x: 2.0,
        y: 1.6,
        text: `\\dot{B}=${params.bDotRate.toFixed(1)}\\text{ T/s}`,
        align: 'end'
      }
    ];
    return {
      width: 640,
      height: 440,
      viewBox: { minX: -2.2, minY: -2.0, maxX: 2.2, maxY: 2.0 },
      title: '圆柱磁场涡旋电场配图',
      primitives
    };
  },
  renderCanvas: (ctx, state, params, viewport, activeLayers) => {
    const m = createWorldMapper(viewport);
    const labels: CanvasLabel[] = [];
    const fillWorldRect = (x: number, y: number, width: number, height: number) => {
      const a = m.toScreen(x, y + height);
      const b = m.toScreen(x + width, y);
      ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    };

    ctx.save();
    if (params.mode === 'eddy-damping-compare') {
      const drawPendulum = (pivotX: number, th: number, col: string, label: string, slotted: boolean, id: string) => {
        const pivotY = 1.25;
        const pivot = m.toScreen(pivotX, pivotY);
        const bx = pivotX + params.pendulumLengthL * Math.sin(th);
        const by = pivotY - params.pendulumLengthL * Math.cos(th);
        const bob = m.toScreen(bx, by);
        const poleGap = m.toScreen(pivotX, pivotY - params.pendulumLengthL + 0.2);
        ctx.fillStyle = 'rgba(56, 189, 248, 0.18)';
        fillWorldRect(pivotX - 0.38, pivotY - params.pendulumLengthL - 0.18, 0.76, 0.36);
        ctx.strokeStyle = '#cbd5e1';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(pivot.x, pivot.y);
        ctx.lineTo(bob.x, bob.y);
        ctx.stroke();

        ctx.fillStyle = col;
        fillWorldRect(bx - 0.28, by - 0.2, 0.56, 0.4);
        if (slotted) {
          ctx.fillStyle = '#0f172a';
          for (const offset of [-0.15, 0, 0.15]) {
            fillWorldRect(bx + offset - 0.012, by - 0.16, 0.024, 0.25);
          }
        }
        labels.push({ id, x: pivot.x, y: pivot.y - m.len(0.27), text: label, color: '#e2e8f0', font: 'bold 13px sans-serif' });
        labels.push({ id: `${id}-pole`, x: poleGap.x, y: poleGap.y, text: '磁极间隙', color: '#7dd3fc', font: '11px sans-serif' });
      };

      drawPendulum(-1.1, state.solidTheta, '#f43f5e', '整块铜板（强涡流阻尼）', false, 'solid-pendulum');
      drawPendulum(1.1, state.slottedTheta, '#4ade80', '开槽铜板（微弱阻尼）', true, 'slotted-pendulum');
      resolveAndDrawLabels(ctx, labels, viewport.width, viewport.height);
      ctx.restore();
      return;
    }

    const center = m.toScreen(0, 0);
    const rPx = params.cylinderRadiusR * m.ppm;
    if (activeLayers.has('vortexRings')) {
      ctx.fillStyle = 'rgba(56, 189, 248, 0.12)';
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(center.x, center.y, rPx, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Concentric vortex electric field circles inside and outside cylinder
      ctx.strokeStyle = 'rgba(251, 191, 36, 0.5)';
      ctx.setLineDash([4, 4]);
      for (const factor of [0.45, 0.85, 1.3]) {
        ctx.beginPath();
        ctx.arc(center.x, center.y, rPx * factor, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    if (activeLayers.has('particle')) {
      if (state.trail.length > 1) {
        ctx.strokeStyle = '#4ade80';
        ctx.lineWidth = 2;
        ctx.beginPath();
        const first = m.toScreen(state.trail[0]!.x, state.trail[0]!.y);
        ctx.moveTo(first.x, first.y);
        for (let i = 1; i < state.trail.length; i++) {
          const point = m.toScreen(state.trail[i]!.x, state.trail[i]!.y);
          ctx.lineTo(point.x, point.y);
        }
        ctx.stroke();
      }
      const particle = m.toScreen(state.px, state.py);
      ctx.fillStyle = '#4ade80';
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, m.len(0.035), 0, Math.PI * 2);
      ctx.fill();
    }

    const observables = computeObservables(state, params);
    labels.push({ id: 'eddy-vortex-summary', x: viewport.width * 0.5, y: 28, text: `B=${state.bCurrent.toFixed(2)} T  |  |E感|=${(observables.eVortexMag ?? 0).toFixed(3)} V/m`, color: '#e2e8f0', font: 'bold 13px sans-serif' });
    resolveAndDrawLabels(ctx, labels, viewport.width, viewport.height);
    ctx.restore();
  },
  formatFormulas: (state, params) => {
    const obs = computeObservables(state, params);
    return [
      {
        id: 'vortex-law',
        label: '麦克斯韦感生涡旋电场与阻尼对比',
        latex: '\\oint \\mathbf{E}\\cdot d\\mathbf{l} = -\\frac{d\\Phi_B}{dt}',
        substitutedLatex: `B=${state.bCurrent.toFixed(2)}\\text{ T},\\; |E_{\\text{感}}|=${(obs.eVortexMag ?? 0).toFixed(3)}\\text{ V/m}`
      }
    ];
  }
});

export default emEddyVortexFieldPlugin;
