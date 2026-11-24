import { orbitalStoryDecks } from './storyDecks.js';
import type { LiveFormulaSpec } from '@physforge/sim-sdk';
import { createWorldMapper, defineSimulationPlugin, type DiagramPrimitive, type ParamFieldSpec } from '@physforge/sim-sdk';
import { astroOrbitalPresets } from './presets.js';
import {
  checkInvariants,
  computeLagrangePoints,
  computeObservables,
  buildAstroScaleContext,
  createInitialState,
  extractRocheIsolines,
  stepAstroOrbital,
  type AstroOrbitalParams,
  type AstroOrbitalState
} from './engine.js';

/** Shared inertial/corotating display coordinates; dynamics stay in the inertial frame. */
export function orbitDisplayXY(x: number, y: number, t: number, corotating: boolean) {
  const theta = corotating ? -t : 0;
  const c = Math.cos(theta), sin = Math.sin(theta);
  return { x: x * c - y * sin, y: x * sin + y * c };
}

const paramSchema: readonly ParamFieldSpec<AstroOrbitalParams>[] = [
  {
    key: 'mode',
    kind: 'select',
    label: '天体模型',
    defaultValue: 'kepler-ellipse',
    options: [
      { value: 'kepler-ellipse', label: '开普勒椭圆与宇宙速度' },
      { value: 'hohmann-transfer', label: '霍曼双脉冲转移变轨' },
      { value: 'binary-lagrange', label: '双星系统与拉格朗日点' }
    ]
  },
  {
    key: 'scaleRegime',
    kind: 'select',
    label: '尺度量纲 (ScaleContext)',
    defaultValue: 'earth-orbit',
    options: [
      { value: 'earth-orbit', label: '近地卫星轨道 (7000 km / M地)' },
      { value: 'solar-au', label: '日地天文尺度 (1 AU / M日)' }
    ]
  },
  { key: 'r1Ratio', kind: 'number', label: '近地点尺度比 r₁/L₀', unit: '', min: 0.5, max: 2, step: 0.1, defaultValue: 1 },
  { key: 'r2OverR1', kind: 'number', label: '霍曼目标半径比 r₂/r₁', unit: '', min: 1.2, max: 3.5, step: 0.1, defaultValue: 2.4 },
  { key: 'v0Ratio', kind: 'number', label: '初速度比 v₀/v_环', unit: '', min: 0.7, max: 1.45, step: 0.02, defaultValue: 1.2 },
  { key: 'massRatioQ', kind: 'number', label: '双星次星质量比 q', unit: '', min: 0.01, max: 0.4, step: 0.01, defaultValue: 0.03 },
  { key: 'simSpeed', kind: 'number', label: '仿真倍率', unit: 'x', min: 0.5, max: 4, step: 0.5, defaultValue: 1 }
];


const liveFormulas: readonly LiveFormulaSpec[] = [
  {
    "id": "hohmann-first-burn",
    "title": "圆轨道霍曼转移第一次加速（κ=r₂/r₁）",
    "latex": "\\frac{\\Delta v_1}{v_{c1}}=\\sqrt{\\frac{2\\htmlClass{pf-live-var}{\\htmlData{param=r2OverR1}{\\kappa}}}{1+\\htmlClass{pf-live-var}{\\htmlData{param=r2OverR1}{\\kappa}}}}-1",
    "bindings": [
      {
        "tokenKey": "r2OverR1",
        "paramKey": "r2OverR1",
        "label": "霍曼目标半径比 r₂/r₁",
        "unit": "",
        "min": 1.2,
        "max": 3.5,
        "step": 0.1,
        "precision": 2
      }
    ],
    "when": {
      "mode": [
        "hohmann-transfer"
      ]
    }
  },
  {
    "id": "circular-speed",
    "title": "圆轨道速度（r₁=ηL₀，M 由尺度位形确定）",
    "latex": "v_{c1}=\\sqrt{\\frac{GM}{\\htmlClass{pf-live-var}{\\htmlData{param=r1Ratio}{\\eta}}L_0}}",
    "bindings": [
      {
        "tokenKey": "r1Ratio",
        "paramKey": "r1Ratio",
        "label": "近地点尺度比 r₁/L₀",
        "unit": "",
        "min": 0.5,
        "max": 2,
        "step": 0.1,
        "precision": 2
      }
    ],
    "when": {
      "mode": [
        "kepler-ellipse",
        "hohmann-transfer"
      ]
    }
  },
  {
    "id": "binary-barycenter",
    "title": "双星质心距离（a 为两星间距）",
    "latex": "\\begin{aligned}r_1&=\\htmlClass{pf-live-var}{\\htmlData{param=massRatioQ}{q}}a\\\\r_2&=(1-q)a\\end{aligned}",
    "bindings": [
      {
        "tokenKey": "massRatioQ",
        "paramKey": "massRatioQ",
        "label": "双星次星质量比 q",
        "unit": "",
        "min": 0.01,
        "max": 0.4,
        "step": 0.01,
        "precision": 2
      }
    ],
    "when": {
      "mode": [
        "binary-lagrange"
      ]
    }
  }
];
export const astroOrbitalMechanicsPlugin = Object.assign(defineSimulationPlugin<AstroOrbitalParams, AstroOrbitalState>({
  meta: {
    id: 'astro-orbital-mechanics',
    title: '万有引力、霍曼转移与拉格朗日点 (M10)',
    textbookRef: '人教版 必修第二册 第七章',
    curriculumTags: ['物理观念', '科学思维', '科学探究'],
    difficulty: '压轴专题',
    version: '2.0.0'
  },
  renderMode: 'hybrid',
  defaultView: {
    scale: (params) => (0.42 / 0.24) / (params.mode === 'hohmann-transfer' ? params.r2OverR1 + 0.6 : 2.6),
    offsetRatioX: 0.05
  },
  paramSchema,
  presets: astroOrbitalPresets,
  engine: {
    createInitialState,
    step: stepAstroOrbital,
    computeObservables,
    checkInvariants
  },
  getForceVectors: (state, params, activeLayers) => {
    const { muSI, r1SI } = buildAstroScaleContext(params);
    const scaleSI = muSI / (r1SI * r1SI);
    const position = { x: state.xNorm, y: state.yNorm };
    if (params.mode !== 'binary-lagrange') {
      const r2 = position.x * position.x + position.y * position.y;
      const scale = r2 > 1e-12 ? -scaleSI / (r2 * Math.sqrt(r2)) : 0;
      return [{
        id: 'central-gravity', label: 'F_g (1 kg)', origin: position,
        force: { x: scale * position.x, y: scale * position.y }, color: '#fbbf24', category: 'gravity', unit: 'N'
      }];
    }

    const q = Math.max(0.01, Math.min(0.45, params.massRatioQ));
    const c = Math.cos(state.tNorm), sin = Math.sin(state.tNorm);
    const corotating = activeLayers?.has('corotatingView') ?? false;
    const project = (x: number, y: number) => orbitDisplayXY(x, y, state.tNorm, corotating);
    const primaries = [
      { id: 'primary-1', label: 'F₁', x: -q * c, y: -q * sin, fraction: 1 - q },
      { id: 'primary-2', label: 'F₂', x: (1 - q) * c, y: (1 - q) * sin, fraction: q }
    ];
    return primaries.map((primary, index) => {
      const dx = primary.x - position.x, dy = primary.y - position.y;
      // Match the existing softened restricted-three-body acceleration.
      const r2 = dx * dx + dy * dy + 1e-6;
      const scale = scaleSI * primary.fraction / (r2 * Math.sqrt(r2));
      return {
        id: primary.id, label: `${primary.label} (1 kg)`, origin: project(position.x, position.y),
        force: project(scale * dx, scale * dy), color: index === 0 ? '#fbbf24' : '#fb923c', category: 'gravity' as const, unit: 'N'
      };
    });
  },
  layers: [
    { id: 'orbit', label: '轨道轨迹与天体', defaultVisible: true },
    { id: 'keplerSectors', label: '开普勒等面积扫过扇区', defaultVisible: true },
    { id: 'rocheIsolines', label: '拉格朗日 L₁–L₅ 与洛希等势线', defaultVisible: true },
    { id: 'corotatingView', label: '双星共转系锁定视图', defaultVisible: true }
  ],
  telemetryChannels: [
    { key: 'rNorm', label: '无量纲距离 r/r₁', unit: '', color: '#38bdf8' },
    { key: 'speedNorm', label: '无量纲速率 v/v_环', unit: '', color: '#4ade80' },
    { key: 'energyNorm', label: '比机械能 ε', unit: '', color: '#fbbf24' },
    { key: 'angularMomNorm', label: '比角动量 Lz', unit: '', color: '#f472b6' }
  ],
  referenceFrames: [
    {
      id: 'satellite',
      label: '卫星随动参考系',
      getOrigin: (s, p, layers) => orbitDisplayXY(s.xNorm, s.yNorm, s.tNorm, p.mode === 'binary-lagrange' && (layers?.has('corotatingView') ?? false)),
      getVelocity: (s, p, layers) => {
        const rotating = p.mode === 'binary-lagrange' && (layers?.has('corotatingView') ?? false);
        return orbitDisplayXY(s.vxNorm + (rotating ? s.yNorm : 0), s.vyNorm - (rotating ? s.xNorm : 0), s.tNorm, rotating);
      }
    }
  ],
  getControlHandles: (state, params) =>
    params.mode === 'kepler-ellipse'
      ? [
          {
            id: 'periapsis-speed',
            label: `v₀/v_环=${params.v0Ratio.toFixed(2)}`,
            position: { x: 1, y: params.v0Ratio - 1 },
            handleKind: 'vector',
            color: '#4ade80',
            onDrag: (wp) => ({
              v0Ratio: Number(Math.max(0.7, Math.min(1.45, 1 + wp.y)).toFixed(2))
            })
          }
        ]
      : state.hohmannPhase === 'transfer'
        ? [
            {
              id: 'target-r2',
              label: `r₂/r₁=${params.r2OverR1.toFixed(1)}`,
              position: { x: -params.r2OverR1, y: 0 },
              handleKind: 'point',
              color: '#fbbf24',
              onDrag: (wp) => ({
                r2OverR1: Number(Math.max(1.2, Math.min(3.5, -wp.x)).toFixed(1))
              })
            }
          ]
        : [],
  sceneSerializer: {
    exportScene: (_s, params) => ({
      schemaVersion: '2.0',
      modelId: 'astro-orbital-mechanics',
      title: '万有引力与天体力学',
      params
    }),
    importScene: (dsl) => dsl.params as Partial<AstroOrbitalParams>
  },
  exportDiagramIR: (state, params) => {
    const primitives: DiagramPrimitive[] = [
      { kind: 'circle', cx: 0, cy: 0, r: 0.24, fill: true },
      {
        kind: 'polyline',
        points: state.trailNorm.map((p) => ({ x: p.x, y: p.y })),
        dashed: true
      },
      { kind: 'circle', cx: state.xNorm, cy: state.yNorm, r: 0.1 },
      {
        kind: 'arrow',
        x1: state.xNorm,
        y1: state.yNorm,
        x2: state.xNorm + state.vxNorm * 0.45,
        y2: state.yNorm + state.vyNorm * 0.45,
        label: 'v'
      },
      {
        kind: 'mathLabel',
        x: 2.8,
        y: 2.3,
        text: `r/r_1=${Math.hypot(state.xNorm, state.yNorm).toFixed(2)},\\; v_0/v_{\\text{circ}}=${params.v0Ratio.toFixed(2)}`,
        align: 'end'
      }
    ];
    return {
      width: 720,
      height: 460,
      viewBox: { minX: -3.2, minY: -2.6, maxX: 3.2, maxY: 2.6 },
      title: '天体轨道动力学配图',
      primitives
    };
  },
  renderCanvas: (ctx, state, params, viewport, activeLayers) => {
    const baseExtent = params.mode === 'hohmann-transfer' ? params.r2OverR1 + 0.6 : 2.6;
    const m = createWorldMapper(viewport);
    const baseViewScale = (0.42 / 0.24) / baseExtent;
    const markerRadius = (pixels: number) => m.len(pixels / (Math.min(viewport.width, viewport.height) * 0.24 * baseViewScale));
    const useCorotating = params.mode === 'binary-lagrange' && activeLayers.has('corotatingView');

    const mapPoint = (x: number, y: number): { px: number; py: number } => {
      const p = orbitDisplayXY(x, y, state.tNorm, useCorotating);
      const point = m.toScreen(p.x, p.y);
      return { px: point.x, py: point.y };
    };

    ctx.save();

    if (params.mode === 'binary-lagrange' && activeLayers.has('rocheIsolines')) {
      const contours = extractRocheIsolines(params.massRatioQ);
      const rot = useCorotating ? 0 : state.tNorm;
      const cr = Math.cos(rot);
      const sr = Math.sin(rot);
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.32)';
      ctx.lineWidth = 1;
      for (const c of contours) {
        ctx.beginPath();
        for (const seg of c.segments) {
          const ax = seg.a.x * cr - seg.a.y * sr;
          const ay = seg.a.x * sr + seg.a.y * cr;
          const bx = seg.b.x * cr - seg.b.y * sr;
          const by = seg.b.x * sr + seg.b.y * cr;
          const a = m.toScreen(ax, ay);
          const b = m.toScreen(bx, by);
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
        }
        ctx.stroke();
      }

      const lPts = computeLagrangePoints(params.massRatioQ);
      ctx.fillStyle = '#fbbf24';
      ctx.font = '11px sans-serif';
      for (const lp of lPts) {
        const lx = lp.x * cr - lp.y * sr;
        const ly = lp.x * sr + lp.y * cr;
        ctx.beginPath();
        const point = m.toScreen(lx, ly);
        ctx.arc(point.x, point.y, markerRadius(3.5), 0, Math.PI * 2);
        ctx.fill();
        ctx.fillText(lp.id, point.x + 6, point.y - 4);
      }
    }

    if (params.mode === 'kepler-ellipse' && activeLayers.has('keplerSectors')) {
      state.sectors.forEach((sec, idx) => {
        if (sec.vertices.length < 2) return;
        ctx.fillStyle = idx % 2 === 0 ? 'rgba(56, 189, 248, 0.2)' : 'rgba(244, 114, 182, 0.2)';
        ctx.beginPath();
        const origin = m.toScreen(0, 0);
        ctx.moveTo(origin.x, origin.y);
        for (const v of sec.vertices) {
          const point = m.toScreen(v.x, v.y);
          ctx.lineTo(point.x, point.y);
        }
        ctx.closePath();
        ctx.fill();
      });
    }

    if (activeLayers.has('orbit')) {
      if (params.mode === 'hohmann-transfer') {
        ctx.strokeStyle = 'rgba(148,163,184,0.3)';
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        const origin = m.toScreen(0, 0);
        ctx.arc(origin.x, origin.y, m.len(1), 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(origin.x, origin.y, params.r2OverR1 * m.ppm, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      if (state.trailNorm.length > 1) {
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2;
        ctx.beginPath();
        const p0 = mapPoint(state.trailNorm[0]!.x, state.trailNorm[0]!.y);
        ctx.moveTo(p0.px, p0.py);
        for (let i = 1; i < state.trailNorm.length; i++) {
          const p = mapPoint(state.trailNorm[i]!.x, state.trailNorm[i]!.y);
          ctx.lineTo(p.px, p.py);
        }
        ctx.stroke();
      }

      if (params.mode === 'binary-lagrange') {
        const q = params.massRatioQ;
        const p1 = { x: -q * Math.cos(state.tNorm), y: -q * Math.sin(state.tNorm) };
        const p2 = { x: (1 - q) * Math.cos(state.tNorm), y: (1 - q) * Math.sin(state.tNorm) };
        const c1 = mapPoint(p1.x, p1.y);
        const c2 = mapPoint(p2.x, p2.y);
        ctx.fillStyle = '#fbbf24';
        ctx.beginPath();
        ctx.arc(c1.px, c1.py, markerRadius(14), 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#60a5fa';
        ctx.beginPath();
        ctx.arc(c2.px, c2.py, markerRadius(7), 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = '#fbbf24';
        ctx.beginPath();
        const origin = m.toScreen(0, 0);
        ctx.arc(origin.x, origin.y, markerRadius(16), 0, Math.PI * 2);
        ctx.fill();
      }

      const sat = mapPoint(state.xNorm, state.yNorm);
      ctx.fillStyle = '#4ade80';
      ctx.beginPath();
      ctx.arc(sat.px, sat.py, markerRadius(6), 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  },
  formatFormulas: (state, params) => {
    const obs = computeObservables(state, params);
    if (params.mode === 'binary-lagrange') {
      const display = orbitDisplayXY(state.xNorm, state.yNorm, state.tNorm, true);
      return [{ id: 'binary-state', label: '共转系试探粒子位置（双星间距为长度单位）',
        latex: 'r_1/a=q,\\quad r_2/a=1-q',
        substitutedLatex: `\\begin{aligned}x_{\\rm rot}/a&=${display.x.toFixed(3)}\\\\y_{\\rm rot}/a&=${display.y.toFixed(3)}\\\\q&=${params.massRatioQ.toFixed(3)}\\end{aligned}` }];
    }
    const items = [{ id: 'orbit-state', label: '归一化二体轨道状态',
      latex: 'r/r_1,\\quad v/v_{c1},\\quad e',
      substitutedLatex: `\\begin{aligned}r/r_1&=${(obs.rNorm ?? 0).toFixed(4)}\\\\v/v_{c1}&=${(obs.speedNorm ?? 0).toFixed(4)}\\\\e&=${(obs.eccentricity ?? 0).toFixed(4)}\\end{aligned}` }];
    if (params.mode === 'hohmann-transfer') {
      const dv2 = state.hohmannPhase === 'circularized'
        ? `${(state.deltaV2SI / 1000).toFixed(3)}\\text{ km/s}` : '\\text{待点火}';
      items.push({ id: 'hohmann-dv', label: '霍曼转移实际脉冲速度增量',
        latex: '\\Delta v_1=\\sqrt{GM/r_1}\\left(\\sqrt{2r_2/(r_1+r_2)}-1\\right)',
        substitutedLatex: `\\begin{aligned}\\Delta v_1&=${(state.deltaV1SI / 1000).toFixed(3)}\\text{ km/s}\\\\\\Delta v_2&=${dv2}\\end{aligned}` });
    } else if (state.sectors.length >= 2) {
      const previous = state.sectors[state.sectors.length - 2], last = state.sectors[state.sectors.length - 1];
      if (previous && last) items.push({ id: 'kepler-area', label: '最近两个完整等时区间的数值扫过面积',
        latex: '\\Delta A=\\frac12|\\mathbf r\\times\\mathbf v|\\Delta t',
        substitutedLatex: `\\begin{aligned}A_{n-1}/r_1^2&=${previous.areaDimless.toFixed(5)}\\\\A_n/r_1^2&=${last.areaDimless.toFixed(5)}\\end{aligned}` });
    }
    return items;
  }
}), { storyDecks: orbitalStoryDecks, liveFormulas, spatial3D: { flattenPlane: 'xz' as const, defaultVisibleHeight: 8.5, sceneDepthRadius: 8, default3DAzimuthRad: 0.5, default3DPolarRad: 0.92 } });

export default astroOrbitalMechanicsPlugin;
