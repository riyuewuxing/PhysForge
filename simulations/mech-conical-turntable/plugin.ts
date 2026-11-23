import { CLASSROOM_GRAVITY, degToRad } from '@physforge/physics-core';
import { defineSimulationPlugin, type DiagramPrimitive, type ForceVectorItem, type ParamFieldSpec } from '@physforge/sim-sdk';
import { conicalTurntablePresets } from './presets.js';
import {
  checkInvariants,
  computeObservables,
  createInitialState,
  stepConicalTurntable,
  type ConicalTurntableParams,
  type ConicalTurntableState
} from './engine.js';

const paramSchema: readonly ParamFieldSpec<ConicalTurntableParams>[] = [
  {
    key: 'mode',
    kind: 'select',
    label: '圆周动力学模型',
    options: [
      { label: '水平圆盘双物块轻绳临界', value: 'turntable-dual' },
      { label: '圆锥摆空间稳定转动', value: 'conical-pendulum' }
    ],
    defaultValue: 'turntable-dual'
  },
  { key: 'omega', kind: 'number', label: '转动角速度 ω', unit: 'rad/s', min: 0.2, max: 6, step: 0.1, defaultValue: 2.2 },
  { key: 'massA', kind: 'number', label: '内侧物块/摆球 mA', unit: 'kg', min: 0.5, max: 5, step: 0.5, defaultValue: 1 },
  { key: 'massB', kind: 'number', label: '外侧物块 mB', unit: 'kg', min: 0.5, max: 5, step: 0.5, defaultValue: 2 },
  { key: 'radiusA', kind: 'number', label: 'A 半径 rA', unit: 'm', min: 0.2, max: 1.2, step: 0.1, defaultValue: 0.6 },
  { key: 'radiusB', kind: 'number', label: 'B 半径 rB', unit: 'm', min: 0.8, max: 2.4, step: 0.1, defaultValue: 1.5 },
  { key: 'mu', kind: 'number', label: '圆盘静摩擦因数 μ', unit: '', min: 0.05, max: 0.8, step: 0.05, defaultValue: 0.3 },
  { key: 'pendulumLength', kind: 'number', label: '圆锥摆长 L', unit: 'm', min: 0.6, max: 2.5, step: 0.1, defaultValue: 1.5 }
];

export const mechConicalTurntablePlugin = defineSimulationPlugin<
  ConicalTurntableParams,
  ConicalTurntableState
>({
  meta: {
    id: 'mech-conical-turntable',
    title: '圆锥摆、水平圆盘双物块临界滑移 (M07)',
    textbookRef: '人教版 必修第二册 第六章 第2–3节',
    curriculumTags: ['物理观念', '科学思维'],
    difficulty: '压轴专题',
    version: '2.0.0'
  },
  paramSchema,
  presets: conicalTurntablePresets,
  engine: {
    createInitialState,
    step: stepConicalTurntable,
    computeObservables,
    checkInvariants
  },
  layers: [
    { id: 'turntable', label: '圆盘 / 摆线机构', defaultVisible: true },
    { id: 'forces', label: '张力与静摩擦力读数', defaultVisible: true }
  ],
  telemetryChannels: [
    { key: 'tensionN', label: '轻绳张力 T', unit: 'N', color: '#38bdf8' },
    { key: 'frictionAN', label: '内块静摩擦 fA', unit: 'N', color: '#4ade80' },
    { key: 'frictionBN', label: '外块静摩擦 fB', unit: 'N', color: '#f472b6' },
    { key: 'coneAngleDeg', label: '圆锥半顶角 θ', unit: '°', color: '#fbbf24' }
  ],
  getControlHandles: (state, params) => {
    const angle = state.angleRad;
    const x = params.mode === 'turntable-dual' ? state.rB * Math.cos(angle) : params.radiusB;
    const y = params.mode === 'turntable-dual' ? -state.rB * Math.sin(angle) : 0;
    return [{
      id: 'radius-b',
      label: `rB=${params.radiusB.toFixed(1)}m`,
      position: { x, y },
      origin: { x: 0, y: 0 },
      handleKind: 'radius',
      color: '#f472b6',
      onDrag: (wp) => ({ radiusB: Number(Math.max(0.8, Math.min(2.4, Math.hypot(wp.x, wp.y))).toFixed(1)) })
    }];
  },
  getForceVectors: (state, params): ForceVectorItem[] => {
    if (params.mode === 'conical-pendulum') {
      const theta = (state.coneAngleDeg * Math.PI) / 180;
      const pivot = { x: 0, y: 1.1 };
      const bob = {
        x: params.pendulumLength * Math.sin(theta) * Math.cos(state.angleRad),
        y: pivot.y - params.pendulumLength * Math.cos(theta)
      };
      const dx = pivot.x - bob.x;
      const dy = pivot.y - bob.y;
      const length = Math.max(1e-9, Math.hypot(dx, dy));
      const tension = { x: (state.tensionN * dx) / length, y: (state.tensionN * dy) / length };
      const gravity = { x: 0, y: -params.massA * CLASSROOM_GRAVITY };
      return [
        { id: 'gravity', label: 'mg', origin: bob, force: gravity, color: '#fbbf24', category: 'gravity' },
        { id: 'tension', label: 'T', origin: bob, force: tension, color: '#38bdf8', category: 'tension' },
        { id: 'net', label: 'F_合', origin: bob, force: { x: tension.x, y: tension.y + gravity.y }, color: '#4ade80', category: 'net' }
      ];
    }

    const angle = state.angleRad;
    const a = { x: -state.rA * Math.cos(angle), y: state.rA * Math.sin(angle) };
    const b = { x: state.rB * Math.cos(angle), y: -state.rB * Math.sin(angle) };
    const inwardA = { x: -a.x / Math.max(1e-9, state.rA), y: -a.y / Math.max(1e-9, state.rA) };
    const inwardB = { x: -b.x / Math.max(1e-9, state.rB), y: -b.y / Math.max(1e-9, state.rB) };
    const vectors: ForceVectorItem[] = [];
    if (Math.abs(state.frictionAN) > 1e-5) {
      vectors.push({
        id: 'friction-a', label: 'f_A', origin: a,
        force: { x: state.frictionAN * inwardA.x, y: state.frictionAN * inwardA.y },
        color: '#4ade80', category: 'friction'
      });
    }
    if (Math.abs(state.frictionBN) > 1e-5) {
      vectors.push({
        id: 'friction-b', label: 'f_B', origin: b,
        force: { x: state.frictionBN * inwardB.x, y: state.frictionBN * inwardB.y },
        color: '#f472b6', category: 'friction'
      });
    }
    if (state.tensionN > 1e-5) {
      vectors.push(
        {
          id: 'tension-a', label: 'T_A', origin: a,
          force: { x: state.tensionN * inwardA.x, y: state.tensionN * inwardA.y },
          color: '#38bdf8', category: 'tension'
        },
        {
          id: 'tension-b', label: 'T_B', origin: b,
          force: { x: state.tensionN * inwardB.x, y: state.tensionN * inwardB.y },
          color: '#38bdf8', category: 'tension'
        }
      );
    }
    return vectors;
  },
  sceneSerializer: {
    exportScene: (_s, params) => ({
      schemaVersion: '2.0',
      modelId: 'mech-conical-turntable',
      title: '圆盘临界滑移',
      params
    }),
    importScene: (dsl) => dsl.params as Partial<ConicalTurntableParams>
  },
  exportDiagramIR: (state, params) => {
    const primitives: DiagramPrimitive[] = [
      { kind: 'circle', cx: 0, cy: 0, r: Math.max(2.0, state.rB + 0.3), dashed: true },
      { kind: 'line', x1: -params.radiusA, y1: 0, x2: state.rB, y2: 0 },
      { kind: 'block', cx: -params.radiusA, cy: 0, width: 0.3, height: 0.3, label: 'A' },
      { kind: 'block', cx: state.rB, cy: 0, width: 0.35, height: 0.35, label: 'B' },
      { kind: 'mathLabel', x: 2.2, y: 2.0, text: `\\omega_1=${state.omega1.toFixed(2)},\\; \\omega_3=${state.omega3.toFixed(2)}`, align: 'end' }
    ];
    return {
      width: 720,
      height: 440,
      viewBox: { minX: -2.8, minY: -2.5, maxX: 2.8, maxY: 2.5 },
      title: '水平圆盘双物块临界分析配图',
      primitives
    };
  },
  renderCanvas: (ctx, state, params, viewport, activeLayers) => {
    const ppm = Math.min(viewport.width, viewport.height) * 0.24 * viewport.scale;
    const cx = viewport.width * 0.45 + viewport.offsetX;
    const cy = viewport.height * 0.5 + viewport.offsetY;

    ctx.save();
    if (params.mode === 'turntable-dual') {
      if (activeLayers.has('turntable')) {
        ctx.fillStyle = 'rgba(30, 41, 59, 0.7)';
        ctx.strokeStyle = '#64748b';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(cx, cy, 2.2 * ppm, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        const cA = Math.cos(state.angleRad);
        const sA = Math.sin(state.angleRad);
        // A on opposite or same side? Keep A & B opposite sides of center (-rA, rB) OR same side (+rA, +rB) — match standard (+rA, +rB) aligned with formula mB rB - mA rA? Wait: in mB*rB - mA*rA formula, A & B are on OPPOSITE sides of center so T pulls A OUTWARD/same dir? Wait let's check: T pulls A toward center! Wait if A is at -rA (left) and B is at +rB (right), rope crosses center: T on A pulls RIGHT (+, toward center), T on B pulls LEFT (-, toward center). Let's match signs in renderCanvas!
        const ax = cx - state.rA * cA * ppm;
        const ay = cy - state.rA * sA * ppm;
        const bx = cx + state.rB * cA * ppm;
        const by = cy + state.rB * sA * ppm;

        ctx.strokeStyle = state.tensionN > 1e-4 ? '#fbbf24' : '#475569';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();

        ctx.fillStyle = '#38bdf8';
        ctx.fillRect(ax - 12, ay - 12, 24, 24);
        ctx.fillStyle = '#f472b6';
        ctx.fillRect(bx - 14, by - 14, 28, 28);
      }
    } else {
      const th = degToRad(state.coneAngleDeg);
      const rHoriz = params.pendulumLength * Math.sin(th) * Math.cos(state.angleRad);
      const yVert = params.pendulumLength * Math.cos(th);
      const top = { sx: cx, sy: cy - 1.1 * ppm };
      const bob = { sx: cx + rHoriz * ppm, sy: top.sy + yVert * ppm };
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(top.sx, top.sy);
      ctx.lineTo(bob.sx, bob.sy);
      ctx.stroke();
      ctx.fillStyle = '#fbbf24';
      ctx.beginPath();
      ctx.arc(bob.sx, bob.sy, 11, 0, Math.PI * 2);
      ctx.fill();
    }

    if (activeLayers.has('forces')) {
      ctx.fillStyle = '#e2e8f0';
      ctx.font = 'bold 13px monospace';
      ctx.fillText(
        `ω₁=${state.omega1.toFixed(2)} | ω₂=${state.omega2.toFixed(2)} | ω₃=${state.omega3.toFixed(2)} rad/s | T=${state.tensionN.toFixed(2)} N`,
        20,
        28
      );
    }
    ctx.restore();
  }
});

export default mechConicalTurntablePlugin;
