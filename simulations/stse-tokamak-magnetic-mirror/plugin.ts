import { defineSimulationPlugin, type DiagramPrimitive, type ParamFieldSpec } from '@physforge/sim-sdk';
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

export const stseTokamakMagneticMirrorPlugin = defineSimulationPlugin<TokamakMirrorParams, TokamakMirrorState>({
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
    { key: 'muCurrent', label: '磁矩绝热不变量 μ', unit: 'J/T', color: '#4ade80' },
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
  exportDiagramIR: (state) => {
    const primitives: DiagramPrimitive[] = [
      { kind: 'line', x1: -2.2, y1: 0, x2: 2.2, y2: 0, dashed: true },
      { kind: 'trajectory', points: state.trail.map((p) => ({ x: p.z, y: p.x })), strokeWidth: 1.5 },
      { kind: 'circle', cx: state.position.z, cy: state.position.x, r: 0.08, fill: true }
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
    const ppm = Math.min(viewport.width, viewport.height) * 0.22 * viewport.scale;
    const cx = viewport.width * 0.5 + viewport.offsetX;
    const cy = viewport.height * 0.5 + viewport.offsetY;
    const proj = (p: { x: number; y: number; z: number }) => ({
      sx: cx + (p.z * 0.85 + p.x * 0.32) * ppm,
      sy: cy - (p.y * 0.85 + p.x * 0.2) * ppm
    });
    ctx.save();
    if (activeLayers.has('conductors')) {
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (const seg of buildTokamakMirrorSegments(params)) {
        const a = proj(seg.a);
        const b = proj(seg.b);
        ctx.moveTo(a.sx, a.sy);
        ctx.lineTo(b.sx, b.sy);
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
          if (idx === 0) ctx.moveTo(pt.sx, pt.sy);
          else ctx.lineTo(pt.sx, pt.sy);
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
        if (idx === 0) ctx.moveTo(pt.sx, pt.sy);
        else ctx.lineTo(pt.sx, pt.sy);
      });
      ctx.stroke();
    }
    const sp = proj(state.position);
    ctx.fillStyle = state.escaped ? '#ef4444' : '#4ade80';
    ctx.beginPath();
    ctx.arc(sp.sx, sp.sy, 6, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#e2e8f0';
    ctx.font = 'bold 13px ui-sans-serif, system-ui';
    const crit = computeMirrorLossConeDeg(params);
    ctx.fillText(
      params.mode === 'magnetic-mirror'
        ? `θ=${params.pitchAngleDeg}° (逃逸锥角 θc=${crit.toFixed(1)}°) | 反射次数=${state.reflectionCount} | μ 波动 ${(state.maxMuRelDev * 100).toFixed(2)}% | ${state.escaped ? '已穿透泄漏' : '稳定磁瓶约束'}`
        : `托卡马克螺旋约束 | R₀=${params.majorRadiusM.toFixed(1)}m | 安全因子 q=${params.safetyFactorQ}`,
      18,
      28
    );
    ctx.restore();
  },
  formatFormulas: (state, params) => [
    {
      id: 'magnetic-mirror-mu',
      label: '无散磁镜与磁矩绝热不变量',
      latex: '\\nabla\\cdot\\mathbf{B}=0,\\quad \\mu=\\frac{mv_\\perp^2}{2B},\\quad \\sin\\theta_c=\\frac{1}{\\sqrt{R_m}}',
      substitutedLatex: `|B|=${Math.hypot(state.bField.x, state.bField.y, state.bField.z).toFixed(2)}\\text{ T},\\; \\theta_c=${computeMirrorLossConeDeg(params).toFixed(1)}^\\circ,\\; \\Delta\\mu/\\mu=${(state.maxMuRelDev * 100).toFixed(2)}\\%`
    }
  ]
});

export default stseTokamakMagneticMirrorPlugin;
