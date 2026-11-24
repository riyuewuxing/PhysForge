import type { LiveFormulaSpec } from '@physforge/sim-sdk';
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


const liveFormulas: readonly LiveFormulaSpec[] = [
  {
    "id": "critical-speed",
    "title": "内圆轨道最低点临界初速",
    "latex": "v_{0,\\rm crit}=\\sqrt{5g\\htmlClass{pf-live-var}{\\htmlData{param=radius}{R}}}",
    "bindings": [
      {
        "tokenKey": "radius",
        "paramKey": "radius",
        "label": "圆弧半径 R",
        "unit": "m",
        "min": 0.8,
        "max": 2.5,
        "step": 0.2,
        "precision": 2
      }
    ],
    "when": {
      "trackMode": [
        "inner-loop"
      ]
    }
  },
  {
    "id": "dome-initial-normal",
    "title": "外凸半球起始接触条件（所需反力非负）",
    "latex": "N_0=\\htmlClass{pf-live-var}{\\htmlData{param=mass}{m}}\\left(g\\cos \\htmlClass{pf-live-var}{\\htmlData{param=startAngleDeg}{\\theta_0}}-\\frac{\\htmlClass{pf-live-var}{\\htmlData{param=vLaunch}{v_0}}^2}{\\htmlClass{pf-live-var}{\\htmlData{param=radius}{R}}}\\right)",
    "bindings": [
      {
        "tokenKey": "mass",
        "paramKey": "mass",
        "label": "质点质量 m",
        "unit": "kg",
        "min": 0.5,
        "max": 5,
        "step": 0.5,
        "precision": 2
      },
      {
        "tokenKey": "startAngleDeg",
        "paramKey": "startAngleDeg",
        "label": "半球微扰起始角 θ₀",
        "unit": "°",
        "min": 0.5,
        "max": 30,
        "step": 0.5,
        "precision": 2
      },
      {
        "tokenKey": "vLaunch",
        "paramKey": "vLaunch",
        "label": "初始切向速率 v₀",
        "unit": "m/s",
        "min": 0,
        "max": 12,
        "step": 0.2,
        "precision": 2
      },
      {
        "tokenKey": "radius",
        "paramKey": "radius",
        "label": "圆弧半径 R",
        "unit": "m",
        "min": 0.8,
        "max": 2.5,
        "step": 0.2,
        "precision": 2
      }
    ],
    "when": {
      "trackMode": [
        "outer-dome"
      ]
    }
  },
  {
    "id": "rod-radial-reaction",
    "title": "双边轻杆的径向约束力（向内为正，θ 从最高点计）",
    "latex": "F_r=\\htmlClass{pf-live-var}{\\htmlData{param=mass}{m}}\\left(\\frac{v^2}{\\htmlClass{pf-live-var}{\\htmlData{param=radius}{R}}}-g\\cos\\theta\\right)",
    "bindings": [
      {
        "tokenKey": "mass",
        "paramKey": "mass",
        "label": "质点质量 m",
        "unit": "kg",
        "min": 0.5,
        "max": 5,
        "step": 0.5,
        "precision": 2
      },
      {
        "tokenKey": "radius",
        "paramKey": "radius",
        "label": "圆弧半径 R",
        "unit": "m",
        "min": 0.8,
        "max": 2.5,
        "step": 0.2,
        "precision": 2
      }
    ],
    "when": {
      "trackMode": [
        "light-rod"
      ]
    }
  }
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
  formatFormulas: (state, params) => [{
    id: 'radial-reaction-state', label: state.derailed ? '脱离轨道后的运动状态' : '实际约束力与速率',
    latex: state.derailed ? '\\mathbf a=\\mathbf g' : params.trackMode === 'outer-dome'
      ? 'N=m(g\\cos\\theta-v^2/R)' : 'F_r=m(v^2/R-g\\cos\\theta)',
    substitutedLatex: `\\begin{aligned}v&=${Math.hypot(state.vx, state.vy).toFixed(3)}\\text{ m/s}\\\\${params.trackMode === 'light-rod' ? 'F_r' : 'N'}&=${(state.derailed ? 0 : state.normalForceN).toFixed(3)}\\text{ N}\\end{aligned}`
  }],
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
}), { storyDecks: verticalCircularStoryDecks, liveFormulas });

export default mechVerticalCircularPlugin;
