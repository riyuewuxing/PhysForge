import { degToRad } from '@physforge/physics-core';
import { defineSimulationPlugin, type DiagramPrimitive, type ParamFieldSpec } from '@physforge/sim-sdk';
import { equilibriumPresets } from './presets.js';
import {
  checkInvariants,
  computeObservables,
  createInitialState,
  stepEquilibrium,
  type EquilibriumParams,
  type EquilibriumState
} from './engine.js';

const paramSchema: readonly ParamFieldSpec<EquilibriumParams>[] = [
  {
    key: 'mode',
    kind: 'select',
    label: '动态平衡模型类型',
    options: [
      { label: '死结矢量闭合三角形', value: 'dead-knot-rotate' },
      { label: '活结等张力对称轻滑轮', value: 'active-pulley-knot' },
      { label: '斜面/光滑支承几何变化', value: 'hemisphere-similar' }
    ],
    defaultValue: 'dead-knot-rotate'
  },
  { key: 'mass', kind: 'number', label: '重物质量 m', unit: 'kg', min: 0.5, max: 10, step: 0.5, defaultValue: 2 },
  { key: 'baseAngleDeg', kind: 'number', label: '固定基准角 α', unit: '°', min: 15, max: 75, step: 1, defaultValue: 37 },
  { key: 'sweepAngleDeg', kind: 'number', label: '变化施力角 β/θ', unit: '°', min: 10, max: 75, step: 1, defaultValue: 37 },
  { key: 'autoSweep', kind: 'boolean', label: '连续动画扫描角度', defaultValue: true }
];

export const mechDynamicEquilibriumPlugin = defineSimulationPlugin<EquilibriumParams, EquilibriumState>({
  meta: {
    id: 'mech-dynamic-equilibrium',
    title: '动态平衡几何图解（活结/死结/矢量三角形）(M02)',
    textbookRef: '人教版 必修第一册 第三章 第4节',
    curriculumTags: ['物理观念', '科学思维'],
    difficulty: '高三一轮',
    version: '2.0.0'
  },
  paramSchema,
  presets: equilibriumPresets,
  engine: {
    createInitialState,
    step: stepEquilibrium,
    computeObservables,
    checkInvariants
  },
  layers: [
    { id: 'ropes', label: '受力绳杆结构', defaultVisible: true },
    { id: 'triangle', label: '动态矢量闭合三角形', defaultVisible: true }
  ],
  telemetryChannels: [
    { key: 'force1', label: 'F₁ 张力/支持力', unit: 'N', color: '#38bdf8' },
    { key: 'force2', label: 'F₂ 拉力/张力', unit: 'N', color: '#f472b6' },
    { key: 'angleDeg', label: '施力角度 θ', unit: '°', color: '#fbbf24' }
  ],
  getControlHandles: (state) => {
    const a = degToRad(state.activeAngleDeg);
    return [
      {
        id: 'pull-angle',
        label: `θ=${state.activeAngleDeg.toFixed(0)}°`,
        position: { x: 1.4 * Math.cos(a), y: 1.4 * Math.sin(a) },
        origin: { x: 0, y: 0 },
        handleKind: 'angle',
        color: '#f472b6',
        onDrag: (wp) => ({
          sweepAngleDeg: Math.max(10, Math.min(75, Math.round((Math.atan2(wp.y, Math.max(0.1, wp.x)) * 180) / Math.PI))),
          autoSweep: false
        })
      }
    ];
  },
  getForceVectors: (state) => [
    { id: 'f1', label: 'F₁', origin: { x: 0, y: 0 }, force: { x: state.force1.x, y: state.force1.y }, color: '#38bdf8', unit: 'N' },
    { id: 'f2', label: 'F₂', origin: { x: 0, y: 0 }, force: { x: state.force2.x, y: state.force2.y }, color: '#f472b6', unit: 'N' },
    { id: 'mg', label: 'mg', origin: { x: 0, y: 0 }, force: { x: state.gravity.x, y: state.gravity.y }, color: '#fbbf24', unit: 'N' }
  ],
  sceneSerializer: {
    exportScene: (_s, params) => ({
      schemaVersion: '2.0',
      modelId: 'mech-dynamic-equilibrium',
      title: '动态平衡图解',
      params
    }),
    importScene: (dsl) => dsl.params as Partial<EquilibriumParams>
  },
  exportDiagramIR: (state) => {
    const s = 1 / Math.max(state.gravity.mag, 1e-6);
    const primitives: DiagramPrimitive[] = [
      { kind: 'circle', cx: 0, cy: 0, r: 0.08, fill: true },
      { kind: 'arrow', x1: 0, y1: 0, x2: state.force1.x * s * 1.4, y2: state.force1.y * s * 1.4, label: 'F_1' },
      { kind: 'arrow', x1: 0, y1: 0, x2: state.force2.x * s * 1.4, y2: state.force2.y * s * 1.4, label: 'F_2' },
      { kind: 'arrow', x1: 0, y1: 0, x2: 0, y2: -1.4, label: 'mg' },
      { kind: 'mathLabel', x: 1.5, y: 1.2, text: `F_1=${state.force1.mag.toFixed(1)}N, F_2=${state.force2.mag.toFixed(1)}N`, align: 'end' }
    ];
    return {
      width: 720,
      height: 440,
      viewBox: { minX: -2.2, minY: -2, maxX: 2.2, maxY: 2 },
      title: '动态平衡力学图解与矢量三角形',
      primitives
    };
  },
  formatFormulas: (state) => [
    {
      id: 'eq-forces',
      label: '共点力矢量闭合条件',
      latex: '\\vec{F}_1 + \\vec{F}_2 + m\\vec{g} = \\mathbf{0}',
      substitutedLatex: `F_1 = ${state.force1.mag.toFixed(2)}\\text{ N},\\; F_2 = ${state.force2.mag.toFixed(2)}\\text{ N},\\; F_{2,\\min} = ${state.minPullForceN.toFixed(2)}\\text{ N}`
    }
  ],
  renderCanvas: (ctx, state, _params, viewport, activeLayers) => {
    const ppm = Math.min(viewport.width, viewport.height) * 0.22 * viewport.scale;
    const cx = viewport.width * 0.35 + viewport.offsetX;
    const cy = viewport.height * 0.5 + viewport.offsetY;
    const scale = 1.4 / Math.max(state.gravity.mag, 1);

    const drawArrow = (x1: number, y1: number, x2: number, y2: number, color: string, label: string) => {
      const ang = Math.atan2(y2 - y1, x2 - x1);
      ctx.save();
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - 9 * Math.cos(ang - 0.4), y2 - 9 * Math.sin(ang - 0.4));
      ctx.lineTo(x2 - 9 * Math.cos(ang + 0.4), y2 - 9 * Math.sin(ang + 0.4));
      ctx.closePath();
      ctx.fill();
      ctx.font = 'bold 13px sans-serif';
      ctx.fillText(label, x2 + 6, y2 - 6);
      ctx.restore();
    };

    if (activeLayers.has('ropes')) {
      ctx.fillStyle = '#e2e8f0';
      ctx.beginPath();
      ctx.arc(cx, cy, 8, 0, Math.PI * 2);
      ctx.fill();
      drawArrow(cx, cy, cx + state.force1.x * scale * ppm, cy - state.force1.y * scale * ppm, '#38bdf8', `F1=${state.force1.mag.toFixed(1)}N`);
      drawArrow(cx, cy, cx + state.force2.x * scale * ppm, cy - state.force2.y * scale * ppm, '#f472b6', `F2=${state.force2.mag.toFixed(1)}N`);
      drawArrow(cx, cy, cx, cy - state.gravity.y * scale * ppm, '#fbbf24', `mg=${state.gravity.mag.toFixed(1)}N`);
    }

    if (activeLayers.has('triangle')) {
      const tx = viewport.width * 0.72 + viewport.offsetX;
      const ty = viewport.height * 0.35 + viewport.offsetY;
      const gx = tx;
      const gy = ty - state.gravity.y * scale * ppm;
      const fx1 = gx + state.force1.x * scale * ppm;
      const fy1 = gy - state.force1.y * scale * ppm;
      drawArrow(tx, ty, gx, gy, '#fbbf24', 'mg');
      drawArrow(gx, gy, fx1, fy1, '#38bdf8', 'F1');
      drawArrow(fx1, fy1, tx, ty, '#f472b6', 'F2');
    }
  }
});

export default mechDynamicEquilibriumPlugin;
