import { defineSimulationPlugin, type DiagramPrimitive, type ParamFieldSpec } from '@physforge/sim-sdk';
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
    const ppm = Math.min(viewport.width, viewport.height) * 0.22 * viewport.scale;
    const cx = viewport.width * 0.5 + viewport.offsetX;
    const cy = viewport.height * 0.5 + viewport.offsetY;
    const toX = (wx: number) => cx + wx * ppm;
    const toY = (wy: number) => cy - wy * ppm;

    ctx.save();
    if (params.mode === 'eddy-damping-compare') {
      const drawPendulum = (px: number, th: number, col: string, label: string, slotted: boolean) => {
        const py0 = viewport.height * 0.2;
        const Lpx = params.pendulumLengthL * ppm;
        // Magnetic pole gap at bottom equilibrium
        ctx.fillStyle = 'rgba(56, 189, 248, 0.18)';
        ctx.fillRect(px - 36, py0 + Lpx - 22, 72, 44);
        const bx = px + Lpx * Math.sin(th);
        const by = py0 + Lpx * Math.cos(th);
        ctx.strokeStyle = '#cbd5e1';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(px, py0);
        ctx.lineTo(bx, by);
        ctx.stroke();

        ctx.fillStyle = col;
        ctx.fillRect(bx - 22, by - 16, 44, 32);
        if (slotted) {
          ctx.fillStyle = '#0f172a';
          for (let k = -12; k <= 12; k += 8) {
            ctx.fillRect(bx + k - 1.5, by - 4, 3, 20);
          }
        }
        ctx.fillStyle = '#e2e8f0';
        ctx.font = 'bold 13px sans-serif';
        ctx.fillText(label, px - 48, py0 - 16);
      };

      drawPendulum(viewport.width * 0.34, state.solidTheta, '#f43f5e', '整块铜板（强涡流阻尼）', false);
      drawPendulum(viewport.width * 0.66, state.slottedTheta, '#4ade80', '开槽铜板（微弱阻尼）', true);
      ctx.restore();
      return;
    }

    const rPx = params.cylinderRadiusR * ppm;
    if (activeLayers.has('vortexRings')) {
      ctx.fillStyle = 'rgba(56, 189, 248, 0.12)';
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, rPx, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Concentric vortex electric field circles inside and outside cylinder
      ctx.strokeStyle = 'rgba(251, 191, 36, 0.5)';
      ctx.setLineDash([4, 4]);
      for (const factor of [0.45, 0.85, 1.3]) {
        ctx.beginPath();
        ctx.arc(cx, cy, rPx * factor, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    if (activeLayers.has('particle')) {
      if (state.trail.length > 1) {
        ctx.strokeStyle = '#4ade80';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(toX(state.trail[0]!.x), toY(state.trail[0]!.y));
        for (let i = 1; i < state.trail.length; i++) {
          ctx.lineTo(toX(state.trail[i]!.x), toY(state.trail[i]!.y));
        }
        ctx.stroke();
      }
      ctx.fillStyle = '#4ade80';
      ctx.beginPath();
      ctx.arc(toX(state.px), toY(state.py), 6.5, 0, Math.PI * 2);
      ctx.fill();
    }

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
