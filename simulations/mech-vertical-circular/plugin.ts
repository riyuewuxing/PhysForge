import { verticalCircularStoryDecks } from './storyDecks.js';
import { CLASSROOM_GRAVITY } from '@physforge/physics-core';
import { createWorldMapper, defineSimulationPlugin, type DiagramPrimitive, type ParamFieldSpec } from '@physforge/sim-sdk';
import { verticalCircularPresets } from './presets.js';
import {
  checkInvariants,
  computeObservables,
  createInitialState,
  stepVerticalCircular,
  type VerticalCircularParams,
  type VerticalCircularState
} from './engine.js';

const paramSchema: readonly ParamFieldSpec<VerticalCircularParams>[] = [
  {
    key: 'trackMode',
    kind: 'select',
    label: '轨道/约束类型',
    options: [
      { label: '外凸光滑半球面 (单边脱离)', value: 'outer-dome' },
      { label: '竖直内圆轨道 / 轻绳 (单边脱离)', value: 'inner-loop' },
      { label: '刚性轻杆 / 双轨管道 (不脱轨)', value: 'light-rod' }
    ],
    defaultValue: 'outer-dome'
  },
  { key: 'mass', kind: 'number', label: '质点质量 m', unit: 'kg', min: 0.5, max: 5, step: 0.5, defaultValue: 1 },
  { key: 'radius', kind: 'number', label: '圆弧半径 R', unit: 'm', min: 0.8, max: 2.5, step: 0.2, defaultValue: 1.6 },
  { key: 'vLaunch', kind: 'number', label: '初始切向速率 v₀', unit: 'm/s', min: 0, max: 12, step: 0.2, defaultValue: 0.01 },
  { key: 'startAngleDeg', kind: 'number', label: '半球微扰起始角 θ₀', unit: '°', min: 0.5, max: 30, step: 0.5, defaultValue: 0.5 }
];

export const mechVerticalCircularPlugin = Object.assign(defineSimulationPlugin<
  VerticalCircularParams,
  VerticalCircularState
>({
  meta: {
    id: 'mech-vertical-circular',
    title: '竖直面圆周运动与单边脱轨模态切换 (M06)',
    textbookRef: '人教版 必修第二册 第六章 第4节',
    curriculumTags: ['物理观念', '科学思维', '科学探究'],
    difficulty: '压轴专题',
    version: '2.0.0'
  },
  defaultView: { scale: 0.83 },
  paramSchema,
  presets: verticalCircularPresets,
  engine: {
    createInitialState,
    step: stepVerticalCircular,
    computeObservables,
    checkInvariants
  },
  layers: [
    { id: 'track', label: '圆弧轨道与轻杆轮廓', defaultVisible: true },
    { id: 'trajectory', label: '运动轨迹与脱轨抛体虚线', defaultVisible: true }
  ],
  telemetryChannels: [
    { key: 'normalForceN', label: '约束法向反力 FN', unit: 'N', color: '#38bdf8' },
    { key: 'speed', label: '瞬时速率 v', unit: 'm/s', color: '#fbbf24' },
    { key: 'energy', label: '系统机械能 E', unit: 'J', color: '#4ade80' }
  ],
  getControlHandles: (_s, params) => [
    {
      id: 'radius-handle',
      label: `R=${params.radius.toFixed(1)}m`,
      position: { x: params.radius, y: 0 },
      handleKind: 'radius',
      color: '#38bdf8',
      onDrag: (wp) => ({ radius: Number(Math.max(0.8, Math.min(2.5, Math.hypot(wp.x, wp.y))).toFixed(1)) })
    }
  ],
  getForceVectors: (state, params) => {
    const r = Math.max(1e-6, Math.hypot(state.x, state.y));
    const ux = state.x / r;
    const uy = state.y / r;
    const sign = params.trackMode === 'outer-dome' ? 1 : -1;
    return [
      { id: 'mg', label: 'mg', origin: { x: state.x, y: state.y }, force: { x: 0, y: -params.mass * CLASSROOM_GRAVITY }, color: '#fbbf24', unit: 'N' },
      ...(Math.abs(state.normalForceN) > 1e-4
        ? [{ id: 'fn', label: 'F_N', origin: { x: state.x, y: state.y }, force: { x: sign * state.normalForceN * ux, y: sign * state.normalForceN * uy }, color: '#38bdf8', unit: 'N' }]
        : [])
    ];
  },
  referenceFrames: [
    {
      id: 'circular-ball',
      label: '圆周运动质点随动系',
      getOrigin: (s) => ({ x: s.x, y: s.y }),
      getVelocity: (s) => ({ x: s.vx, y: s.vy })
    }
  ],
  sceneSerializer: {
    exportScene: (_s, params) => ({
      schemaVersion: '2.0',
      modelId: 'mech-vertical-circular',
      title: '竖直面圆周脱轨',
      params
    }),
    importScene: (dsl) => dsl.params as Partial<VerticalCircularParams>
  },
  exportDiagramIR: (state, params) => ({
    width: 720,
    height: 460,
    viewBox: { minX: -2.8, minY: -2.4, maxX: 2.8, maxY: 2.4 },
    title: '竖直面圆周运动与脱轨示意图',
    primitives: [
      { kind: 'circle', cx: 0, cy: 0, r: params.radius, dashed: true },
      ...(state.trail.length >= 2 ? [{ kind: 'trajectory' as const, points: state.trail }] : []),
      { kind: 'circle', cx: state.x, cy: state.y, r: 0.1, fill: true },
      { kind: 'arrow', x1: state.x, y1: state.y, x2: state.x, y2: state.y - 0.7, label: 'mg' }
    ] as DiagramPrimitive[]
  }),
  renderCanvas: (ctx, state, params, viewport, activeLayers) => {
    const m = createWorldMapper(viewport);
    const toScr = (wx: number, wy: number) => {
      const point = m.toScreen(wx, wy);
      return { sx: point.x, sy: point.y };
    };

    ctx.save();
    if (activeLayers.has('track')) {
      const c = toScr(0, 0);
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.5)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      if (params.trackMode === 'outer-dome') {
        ctx.arc(c.sx, c.sy, params.radius * m.ppm, Math.PI, 0, false);
      } else {
        ctx.arc(c.sx, c.sy, params.radius * m.ppm, 0, Math.PI * 2);
      }
      ctx.stroke();

      if (params.trackMode === 'light-rod') {
        const b = toScr(state.x, state.y);
        ctx.strokeStyle = '#94a3b8';
        ctx.beginPath();
        ctx.moveTo(c.sx, c.sy);
        ctx.lineTo(b.sx, b.sy);
        ctx.stroke();
      }
    }

    if (activeLayers.has('trajectory') && state.trail.length >= 2) {
      ctx.strokeStyle = state.derailed ? '#fbbf24' : '#38bdf8';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      state.trail.forEach((pt, idx) => {
        const s = toScr(pt.x, pt.y);
        if (idx === 0) ctx.moveTo(s.sx, s.sy);
        else ctx.lineTo(s.sx, s.sy);
      });
      ctx.stroke();
    }

    const ball = toScr(state.x, state.y);
    ctx.fillStyle = '#f472b6';
    ctx.beginPath();
    ctx.arc(ball.sx, ball.sy, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}), { storyDecks: verticalCircularStoryDecks });

export default mechVerticalCircularPlugin;
