import { fusionStoryDecks } from './storyDecks.js';
import { createWorldMapper, defineSimulationPlugin, type DiagramPrimitive, type LiveFormulaSpec, type ParamFieldSpec } from '@physforge/sim-sdk';
import { tokamakMirrorPresets } from './presets.js';
import {
  buildTokamakMirrorSegments,
  checkInvariants,
  computeMirrorLossConeDeg,
  computeObservables,
  createInitialState,
  stepTokamakMirror,
  traceTokamakMirrorLines,
  type TokamakMirrorParams,
  type TokamakMirrorState
} from './engine.js';

const paramSchema: readonly ParamFieldSpec<TokamakMirrorParams>[] = [
  {
    key: 'mode',
    kind: 'select',
    label: '磁约束位形',
    defaultValue: 'magnetic-mirror',
    options: [
      { value: 'magnetic-mirror', label: '3D 无散磁镜 / 磁瓶' },
      { value: 'tokamak', label: '托卡马克环形螺旋磁面' }
    ]
  },
  { key: 'b0Tesla', kind: 'number', label: '中心磁场 B₀', unit: 'T', defaultValue: 2.5, min: 0.5, max: 5.0, step: 0.2 },
  { key: 'mirrorLengthM', kind: 'number', label: '磁镜特征长度 L', unit: 'm', defaultValue: 1.2, min: 0.6, max: 2.4, step: 0.1 },
  { key: 'coilHalfSpanM', kind: 'number', label: '磁喉半跨距 z_c', unit: 'm', defaultValue: 1.5, min: 0.8, max: 2.5, step: 0.1 },
  { key: 'pitchAngleDeg', kind: 'number', label: '初速度投射角 θ', unit: '°', defaultValue: 52, min: 10, max: 85, step: 2 },
  { key: 'speed0', kind: 'number', label: '粒子速率 v₀', unit: 'm/s', defaultValue: 2.0, min: 0.5, max: 4.0, step: 0.2 },
  { key: 'qOverM', kind: 'number', label: '荷质比 q/m', defaultValue: 45, min: 10, max: 80, step: 5 },
  { key: 'majorRadiusM', kind: 'number', label: '托卡马克大半径 R₀', unit: 'm', defaultValue: 1.4, min: 1.0, max: 2.2, step: 0.1 },
  { key: 'safetyFactorQ', kind: 'number', label: '安全因子 q', defaultValue: 2.5, min: 1.2, max: 5.0, step: 0.2 }
];

/** Shared right-handed physical-to-display rotation. XY is the torus plane;
 * for a mirror the axial z direction is horizontal and depth is -x. */
export function fusionDisplayPoint(point: { x: number; y: number; z: number }, mode: TokamakMirrorParams['mode']) {
  return mode === 'tokamak' ? { x: point.x, y: point.y, z: point.z } : { x: point.z, y: point.y, z: -point.x };
}
const liveFormulas: readonly LiveFormulaSpec[] = [
  {
    "id": "mirror-ratio",
    "title": "磁镜轴线上两喉口与中心的磁场比",
    "latex": "R_m=1+\\left(\\frac{\\htmlClass{pf-live-var}{\\htmlData{param=coilHalfSpanM}{z_c}}}{\\htmlClass{pf-live-var}{\\htmlData{param=mirrorLengthM}{L}}}\\right)^2,\\quad\\sin^2\\theta_c=1/R_m",
    "bindings": [
      {
        "tokenKey": "coilHalfSpanM",
        "paramKey": "coilHalfSpanM",
        "label": "磁喉半跨距 z_c",
        "unit": "m",
        "min": 0.8,
        "max": 2.5,
        "step": 0.1,
        "precision": 2
      },
      {
        "tokenKey": "mirrorLengthM",
        "paramKey": "mirrorLengthM",
        "label": "磁镜特征长度 L",
        "unit": "m",
        "min": 0.6,
        "max": 2.4,
        "step": 0.1,
        "precision": 2
      }
    ],
    "when": {
      "mode": [
        "magnetic-mirror"
      ]
    }
  },
  {
    "id": "mirror-pitch",
    "title": "磁镜中心的初始垂直速率",
    "latex": "v_\\perp=\\htmlClass{pf-live-var}{\\htmlData{param=speed0}{v_0}}\\sin \\htmlClass{pf-live-var}{\\htmlData{param=pitchAngleDeg}{\\theta_0}}",
    "bindings": [
      {
        "tokenKey": "speed0",
        "paramKey": "speed0",
        "label": "粒子速率 v₀",
        "unit": "m/s",
        "min": 0.5,
        "max": 4,
        "step": 0.2,
        "precision": 2
      },
      {
        "tokenKey": "pitchAngleDeg",
        "paramKey": "pitchAngleDeg",
        "label": "初速度投射角 θ",
        "unit": "°",
        "min": 10,
        "max": 85,
        "step": 2,
        "precision": 0
      }
    ],
    "when": {
      "mode": [
        "magnetic-mirror"
      ]
    }
  },
  {
    "id": "mirror-axial-field",
    "title": "磁镜轴线上的磁场（模型位形）",
    "latex": "B_z(z)=\\htmlClass{pf-live-var}{\\htmlData{param=b0Tesla}{B_0}}\\left(1+\\frac{z^2}{\\htmlClass{pf-live-var}{\\htmlData{param=mirrorLengthM}{L}}^2}\\right)",
    "bindings": [
      {
        "tokenKey": "b0Tesla",
        "paramKey": "b0Tesla",
        "label": "中心磁场 B₀",
        "unit": "T",
        "min": 0.5,
        "max": 5,
        "step": 0.2,
        "precision": 2
      },
      {
        "tokenKey": "mirrorLengthM",
        "paramKey": "mirrorLengthM",
        "label": "磁镜特征长度 L",
        "unit": "m",
        "min": 0.6,
        "max": 2.4,
        "step": 0.1,
        "precision": 2
      }
    ],
    "when": {
      "mode": [
        "magnetic-mirror"
      ]
    }
  },
  {
    "id": "tokamak-toroidal-field",
    "title": "托卡马克环向磁场分量（R 为柱坐标半径）",
    "latex": "B_\\phi=\\frac{\\htmlClass{pf-live-var}{\\htmlData{param=b0Tesla}{B_0}}\\htmlClass{pf-live-var}{\\htmlData{param=majorRadiusM}{R_0}}}{R}",
    "bindings": [
      {
        "tokenKey": "b0Tesla",
        "paramKey": "b0Tesla",
        "label": "中心磁场 B₀",
        "unit": "T",
        "min": 0.5,
        "max": 5,
        "step": 0.2,
        "precision": 2
      },
      {
        "tokenKey": "majorRadiusM",
        "paramKey": "majorRadiusM",
        "label": "托卡马克大半径 R₀",
        "unit": "m",
        "min": 1,
        "max": 2.2,
        "step": 0.1,
        "precision": 2
      }
    ],
    "when": {
      "mode": [
        "tokamak"
      ]
    }
  }
];

export const stseTokamakMagneticMirrorPlugin = Object.assign(defineSimulationPlugin<TokamakMirrorParams, TokamakMirrorState>({
  meta: {
    id: 'stse-tokamak-magnetic-mirror',
    title: '托卡马克环形磁场与磁镜/磁瓶 (S01)',
    textbookRef: '人教版 选择性必修二 第一章 · 现代核聚变磁约束 STSE',
    curriculumTags: ['物理观念', '科学思维', '科学态度与责任'],
    difficulty: '压轴专题',
    version: '2.0.0'
  },
  renderMode: 'three3d',
  paramSchema,
  presets: tokamakMirrorPresets,
  defaultView: { scale: 0.917, offsetRatioX: 0.05 },
  engine: {
    createInitialState,
    step: stepTokamakMirror,
    computeObservables,
    checkInvariants
  },
  layers: [
    { id: 'conductors', label: '3D 线圈 / 真空室骨架', defaultVisible: true },
    { id: 'fieldLines3d', label: '3D 空间磁感线', defaultVisible: true }
  ],
  telemetryChannels: [
    { key: 'z', label: '轴向位置 z', unit: 'm', color: '#38bdf8' },
    { key: 'bMagT', label: '所在处磁感应强度 |B|', unit: 'T', color: '#fbbf24' },
    { key: 'muCurrent', label: '单位质量磁矩 μ/m', unit: 'J/(kg·T)', color: '#4ade80' },
    { key: 'maxMuRelDev', label: 'μ 最大相对波动', unit: '', color: '#f472b6' }
  ],
  sceneSerializer: {
    exportScene: (_s, params) => ({
      schemaVersion: '2.0',
      modelId: 'stse-tokamak-magnetic-mirror',
      title: '托卡马克与磁镜三维磁约束',
      params
    }),
    importScene: (dsl) => dsl.params as Partial<TokamakMirrorParams>
  },
  exportDiagramIR: (state, params) => {
    const primitives: DiagramPrimitive[] = [
      ...(params.mode === 'tokamak' ? [{ kind: 'circle' as const, cx: 0, cy: 0, r: params.majorRadiusM, fill: false }] : [{ kind: 'line' as const, x1: -2.2, y1: 0, x2: 2.2, y2: 0, dashed: true }]),
      { kind: 'trajectory', points: state.trail.map(p => fusionDisplayPoint(p, params.mode)), strokeWidth: 1.5 },
      { kind: 'circle', cx: fusionDisplayPoint(state.position, params.mode).x, cy: fusionDisplayPoint(state.position, params.mode).y, r: 0.08, fill: true }
    ];
    return {
      width: 680,
      height: 400,
      viewBox: { minX: -2.4, minY: -1.5, maxX: 2.4, maxY: 1.5 },
      title: '磁镜/托卡马克二维投影轨迹图',
      primitives
    };
  },
  renderCanvas: (ctx, state, params, viewport, activeLayers) => {
    const m = createWorldMapper(viewport);
    const proj = (p: { x: number; y: number; z: number }) => { const v = fusionDisplayPoint(p, params.mode); return m.toScreen(v.x, v.y); };
    ctx.save();
    if (activeLayers.has('conductors')) {
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (const seg of buildTokamakMirrorSegments(params)) {
        const a = proj(seg.a);
        const b = proj(seg.b);
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
      ctx.stroke();
    }
    if (activeLayers.has('fieldLines3d')) {
      ctx.strokeStyle = 'rgba(56,189,248,0.45)';
      ctx.lineWidth = 1.4;
      for (const line of traceTokamakMirrorLines(params)) {
        if (line.length < 2) continue;
        ctx.beginPath();
        line.forEach((p, idx) => {
          const pt = proj(p);
          if (idx === 0) ctx.moveTo(pt.x, pt.y);
          else ctx.lineTo(pt.x, pt.y);
        });
        ctx.stroke();
      }
    }
    if (state.trail.length > 1) {
      ctx.strokeStyle = '#4ade80';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      state.trail.forEach((p, idx) => {
        const pt = proj(p);
        if (idx === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      });
      ctx.stroke();
    }
    const sp = proj(state.position);
    ctx.fillStyle = state.escaped ? '#ef4444' : '#4ade80';
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, m.len(0.028), 0, Math.PI * 2);
    ctx.fill();

    const radiusGuideEnd = params.mode === 'magnetic-mirror'
      ? { x: params.coilHalfSpanM, y: 0 }
      : { x: params.majorRadiusM, y: 0 };
    const radiusGuideStart = m.toScreen(0, 0);
    const radiusGuide = m.toScreen(radiusGuideEnd.x, radiusGuideEnd.y);
    ctx.strokeStyle = 'rgba(245,158,11,0.5)';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(radiusGuideStart.x, radiusGuideStart.y);
    ctx.lineTo(radiusGuide.x, radiusGuide.y);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = '#e2e8f0';
    ctx.font = 'bold 13px ui-sans-serif, system-ui';
    ctx.textAlign = 'center';
    const crit = computeMirrorLossConeDeg(params);
    ctx.fillText(
      params.mode === 'magnetic-mirror'
        ? `θ=${params.pitchAngleDeg}° (逃逸锥角 θc=${crit.toFixed(1)}°) | 反射次数=${state.reflectionCount} | μ 波动 ${(state.maxMuRelDev * 100).toFixed(2)}% | ${state.escaped ? '已穿过磁喉' : state.reflectionCount > 0 ? '已记录反射，尚未穿过磁喉' : '尚未穿过磁喉'}`
        : `托卡马克螺旋约束 | R₀=${params.majorRadiusM.toFixed(1)}m | 安全因子 q=${params.safetyFactorQ}`,
      viewport.width * 0.5,
      26
    );
    ctx.restore();
  },
  getControlHandles: (_state, params) => [
    params.mode === 'magnetic-mirror'
      ? {
          id: 'mirror-coil-span',
          label: `z_c=${params.coilHalfSpanM.toFixed(1)} m`,
          position: { x: params.coilHalfSpanM, y: 0 },
          origin: { x: 0, y: 0 },
          handleKind: 'point' as const,
          color: '#f59e0b',
          onDrag: (world: { x: number; y: number }) => {
            const span = Math.max(0.8, Math.min(2.5, Math.round((Math.abs(world.x)) * 10) / 10));
            return { coilHalfSpanM: Number(span.toFixed(1)) };
          }
        }
      : {
          id: 'tokamak-major-radius',
          label: `R₀=${params.majorRadiusM.toFixed(1)} m`,
          position: { x: params.majorRadiusM, y: 0 },
          origin: { x: 0, y: 0 },
          handleKind: 'radius' as const,
          color: '#f59e0b',
          onDrag: (world: { x: number; y: number }) => {
            const radius = Math.max(1, Math.min(2.2, Math.round((Math.hypot(world.x, world.y)) * 10) / 10));
            return { majorRadiusM: Number(radius.toFixed(1)) };
          }
        }
  ],
  getForceVectors: (state, params) => {
    const velocity = state.velocity;
    const magnetic = state.bField;
    const ax = velocity.y * magnetic.z - velocity.z * magnetic.y;
    const ay = velocity.z * magnetic.x - velocity.x * magnetic.z;
    const az = velocity.x * magnetic.y - velocity.y * magnetic.x;
    const a = fusionDisplayPoint({ x: ax * params.qOverM, y: ay * params.qOverM, z: az * params.qOverM }, params.mode);
    return [{
      id: 'fusion-lorentz-acceleration',
      label: 'a洛 = (q/m)v×B',
      origin: fusionDisplayPoint(state.position, params.mode),
      force: { x: a.x, y: a.y },
      color: '#38bdf8',
      category: 'magnetic',
      unit: 'm/s²'
    }];
  },
  referenceFrames: [{
    id: 'confined-particle',
    label: '约束带电粒子随动参考系',
    getOrigin: (state, params) => fusionDisplayPoint(state.position, params.mode),
    getVelocity: (state, params) => fusionDisplayPoint(state.velocity, params.mode)
  }],
  formatFormulas: (state, params) => {
    const b = Math.hypot(state.bField.x, state.bField.y, state.bField.z);
    const speed = Math.hypot(state.velocity.x, state.velocity.y, state.velocity.z);
    if (params.mode === 'tokamak') return [{
      id: 'tokamak-field', label: '环向磁场与粒子状态',
      latex: 'B_\\phi=B_0 R_0/R',
      substitutedLatex: `\\begin{aligned}|B|&=${b.toFixed(3)}\\text{ T}\\\\v&=${speed.toFixed(3)}\\text{ m/s}\\end{aligned}`
    }];
    return [{
      id: 'magnetic-mirror-mu', label: '轴线磁镜与绝热近似',
      latex: '\\begin{aligned}R_m&=1+(z_c/L)^2\\\\\\sin\\theta_c&=1/\\sqrt{R_m}\\end{aligned}',
      substitutedLatex: `\\begin{aligned}\\theta_c&=${computeMirrorLossConeDeg(params).toFixed(2)}^\\circ\\\\z&=${state.position.z.toFixed(3)}\\text{ m}\\\\N_{\\rm ref}&=${state.reflectionCount}\\\\\\Delta\\mu/\\mu&=${(state.maxMuRelDev * 100).toFixed(2)}\\%\\end{aligned}`
    }];
  }
}), { storyDecks: fusionStoryDecks, liveFormulas, spatial3D: { flattenPlane: 'xy' as const, defaultVisibleHeight: 6.5, sceneDepthRadius: 5, default3DAzimuthRad: 0.5, default3DPolarRad: 1.05 } });

export default stseTokamakMagneticMirrorPlugin;
