import { CLASSROOM_GRAVITY, degToRad } from '@physforge/physics-core';
import { defineSimulationPlugin, type DiagramPrimitive, type ParamFieldSpec } from '@physforge/sim-sdk';
import { projectileCouplingPresets } from './presets.js';
import {
  checkInvariants,
  computeObservables,
  createInitialState,
  stepProjectileCoupling,
  type ProjectileCouplingParams,
  type ProjectileCouplingState
} from './engine.js';

const paramSchema: readonly ParamFieldSpec<ProjectileCouplingParams>[] = [
  {
    key: 'mode',
    kind: 'select',
    label: '抛体耦合场景',
    options: [
      { label: '平抛落斜面（极值垂直点）', value: 'incline-flat' },
      { label: '平抛落半圆凹槽', value: 'semicircle-trough' },
      { label: '斜抛安全包络与阻尼对比', value: 'safety-envelope' }
    ],
    defaultValue: 'incline-flat'
  },
  { key: 'v0', kind: 'number', label: '发射初速率 v₀', unit: 'm/s', min: 1, max: 14, step: 0.5, defaultValue: 6 },
  { key: 'launchAngleDeg', kind: 'number', label: '斜抛仰角 α', unit: '°', min: 0, max: 85, step: 5, defaultValue: 45 },
  { key: 'inclineDeg', kind: 'number', label: '斜面倾角 θ', unit: '°', min: 15, max: 60, step: 1, defaultValue: 37 },
  { key: 'troughRadius', kind: 'number', label: '半圆槽半径 R', unit: 'm', min: 1, max: 5, step: 0.5, defaultValue: 2.5 },
  { key: 'dragCoeff', kind: 'number', label: '二次空气阻力系数 c_d', unit: 'kg/m', min: 0, max: 0.3, step: 0.02, defaultValue: 0 },
  { key: 'mass', kind: 'number', label: '质点质量 m', unit: 'kg', min: 0.5, max: 5, step: 0.5, defaultValue: 1 }
];

export const mechProjectileCouplingPlugin = defineSimulationPlugin<
  ProjectileCouplingParams,
  ProjectileCouplingState
>({
  meta: {
    id: 'mech-projectile-coupling',
    title: '抛体运动与斜面/曲面耦合（安全包络与阻力）(M04)',
    textbookRef: '人教版 必修第二册 第五章 第3节',
    curriculumTags: ['物理观念', '科学思维', '科学探究'],
    difficulty: '压轴专题',
    version: '2.0.0'
  },
  paramSchema,
  presets: projectileCouplingPresets,
  engine: {
    createInitialState,
    step: stepProjectileCoupling,
    computeObservables,
    checkInvariants
  },
  layers: [
    { id: 'surface', label: '斜面/半圆槽与安全包络', defaultVisible: true },
    { id: 'trajectory', label: '抛体轨迹与真空对照', defaultVisible: true }
  ],
  telemetryChannels: [
    { key: 'x', label: '水平位移 x', unit: 'm', color: '#38bdf8' },
    { key: 'y', label: '竖直位移 y', unit: 'm', color: '#f472b6' },
    { key: 'totalMechanicalEnergy', label: '机械能 E', unit: 'J', color: '#4ade80' }
  ],
  getControlHandles: (_s, params) => {
    const a = params.mode === 'incline-flat' ? 0 : degToRad(params.launchAngleDeg);
    return [
      {
        id: 'launch-vec',
        label: `v₀=${params.v0.toFixed(1)}`,
        position: { x: params.v0 * Math.cos(a) * 0.25, y: params.v0 * Math.sin(a) * 0.25 },
        origin: { x: 0, y: 0 },
        handleKind: 'vector',
        color: '#4ade80',
        onDrag: (wp) => ({
          v0: Number(Math.max(1, Math.min(14, Math.hypot(wp.x, wp.y) / 0.25)).toFixed(1)),
          launchAngleDeg: Math.max(0, Math.min(85, Math.round((Math.atan2(Math.max(0, wp.y), Math.max(0.1, wp.x)) * 180) / Math.PI / 5) * 5))
        })
      }
    ];
  },
  getForceVectors: (state, params) => {
    const spd = Math.hypot(state.vx, state.vy);
    const fDrag = params.dragCoeff * spd;
    return [
      { id: 'mg', label: 'mg', origin: { x: state.x, y: state.y }, force: { x: 0, y: -params.mass * CLASSROOM_GRAVITY }, color: '#fbbf24', unit: 'N' },
      ...(fDrag > 1e-4
        ? [{ id: 'drag', label: 'f_空', origin: { x: state.x, y: state.y }, force: { x: -fDrag * state.vx, y: -fDrag * state.vy }, color: '#f472b6', unit: 'N' }]
        : [])
    ];
  },
  sceneSerializer: {
    exportScene: (_s, params) => ({
      schemaVersion: '2.0',
      modelId: 'mech-projectile-coupling',
      title: '抛体斜面耦合',
      params
    }),
    importScene: (dsl) => dsl.params as Partial<ProjectileCouplingParams>
  },
  exportDiagramIR: (state, params) => {
    const primitives: DiagramPrimitive[] = [
      { kind: 'arrow', x1: 0, y1: 0, x2: 1.2, y2: 0, label: 'v_0' },
      ...(state.trail.length >= 2 ? [{ kind: 'trajectory' as const, points: state.trail }] : []),
      { kind: 'circle', cx: state.x, cy: state.y, r: 0.12, fill: true }
    ];
    if (params.mode === 'incline-flat') {
      const th = degToRad(params.inclineDeg);
      primitives.push({ kind: 'line', x1: 0, y1: 0, x2: 7, y2: -7 * Math.tan(th) });
    } else {
      primitives.push({ kind: 'hatchedGround', x1: -1, y1: 0, x2: 7, y2: 0 });
    }
    return {
      width: 720,
      height: 440,
      viewBox: { minX: -0.8, minY: -5, maxX: 7.5, maxY: 3.5 },
      title: '抛体运动与斜面/曲面耦合图解',
      primitives
    };
  },
  renderCanvas: (ctx, state, params, viewport, activeLayers) => {
    const ppm = Math.min(viewport.width, viewport.height) * 0.1 * viewport.scale;
    const ox = viewport.width * 0.2 + viewport.offsetX;
    const oy = viewport.height * 0.45 + viewport.offsetY;
    const toScr = (wx: number, wy: number) => ({ sx: ox + wx * ppm, sy: oy - wy * ppm });

    ctx.save();
    if (activeLayers.has('surface')) {
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 2.5;
      if (params.mode === 'incline-flat') {
        const th = degToRad(params.inclineDeg);
        const p1 = toScr(0, 0);
        const p2 = toScr(9, -9 * Math.tan(th));
        ctx.beginPath();
        ctx.moveTo(p1.sx, p1.sy);
        ctx.lineTo(p2.sx, p2.sy);
        ctx.stroke();
      } else if (params.mode === 'semicircle-trough') {
        const center = toScr(params.troughRadius, 0);
        ctx.beginPath();
        ctx.arc(center.sx, center.sy, params.troughRadius * ppm, 0, Math.PI, false);
        ctx.stroke();
      } else {
        // Safety envelope parabola y = v0^2/(2g) - g/(2 v0^2) x^2
        ctx.strokeStyle = 'rgba(251, 191, 36, 0.55)';
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        const maxX = (params.v0 * params.v0) / CLASSROOM_GRAVITY;
        for (let i = 0; i <= 50; i++) {
          const xw = (maxX * i) / 50;
          const yw = (params.v0 * params.v0) / (2 * CLASSROOM_GRAVITY) - (CLASSROOM_GRAVITY * xw * xw) / (2 * params.v0 * params.v0);
          const sp = toScr(xw, yw);
          if (i === 0) ctx.moveTo(sp.sx, sp.sy);
          else ctx.lineTo(sp.sx, sp.sy);
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    if (activeLayers.has('trajectory')) {
      if (params.dragCoeff > 0 && state.vacuumTrail.length >= 2) {
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.55)';
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        state.vacuumTrail.forEach((pt, i) => {
          const sp = toScr(pt.x, pt.y);
          if (i === 0) ctx.moveTo(sp.sx, sp.sy);
          else ctx.lineTo(sp.sx, sp.sy);
        });
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (state.trail.length >= 2) {
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        state.trail.forEach((pt, i) => {
          const sp = toScr(pt.x, pt.y);
          if (i === 0) ctx.moveTo(sp.sx, sp.sy);
          else ctx.lineTo(sp.sx, sp.sy);
        });
        ctx.stroke();
      }
    }

    const ball = toScr(state.x, state.y);
    ctx.fillStyle = '#f472b6';
    ctx.beginPath();
    ctx.arc(ball.sx, ball.sy, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
});

export default mechProjectileCouplingPlugin;
