import { defineSimulationPlugin, type DiagramPrimitive, type ParamFieldSpec } from '@physforge/sim-sdk';
import { magnetic3dPresets } from './presets.js';
import {
  buildConductorSegments,
  checkInvariants,
  computeObservables,
  createInitialState,
  stepMagnetic3d,
  trace3dFieldLines,
  type Magnetic3dParams,
  type Magnetic3dState
} from './engine.js';

const paramSchema: readonly ParamFieldSpec<Magnetic3dParams>[] = [
  {
    key: 'geometryType',
    kind: 'select',
    label: '3D 载流构型',
    defaultValue: 'helmholtz-coil',
    options: [
      { value: 'helmholtz-coil', label: '亥姆霍兹双线圈' },
      { value: 'single-loop', label: '单匝环形电流' },
      { value: 'finite-solenoid', label: '有限长通电螺线管' },
      { value: 'straight-wire', label: '长直导线右手螺旋' },
      { value: 'parallel-wires', label: '平行同向双导线' },
      { value: 'uniform-helix', label: '3D 匀强场等距螺旋线' }
    ]
  },
  { key: 'currentI', kind: 'number', label: '线圈/导线电流 I', unit: 'A', min: 0, max: 5, step: 0.5, defaultValue: 2.0 },
  { key: 'radiusR', kind: 'number', label: '线圈半径 R', unit: 'm', min: 0.4, max: 1.6, step: 0.1, defaultValue: 1.0 },
  { key: 'solenoidTurns', kind: 'number', label: '螺线管匝数 N', unit: '匝', min: 4, max: 16, step: 2, defaultValue: 10 },
  { key: 'qOverM', kind: 'number', label: '试探粒子相对荷质比', unit: '', min: 0, max: 4, step: 0.2, defaultValue: 1.5 },
  { key: 'vPerp', kind: 'number', label: '垂直初速度 v⊥', unit: 'm/s', min: 0, max: 3, step: 0.2, defaultValue: 1.2 },
  { key: 'vParallel', kind: 'number', label: '轴向初速度 v∥', unit: 'm/s', min: -2, max: 2, step: 0.2, defaultValue: 0.7 },
  { key: 'uniformBz', kind: 'number', label: '匀强模式磁感应强度 Bz', unit: 'T', min: 0.5, max: 4, step: 0.5, defaultValue: 2.0 }
];

export const em3dMagneticFieldsPlugin = defineSimulationPlugin<Magnetic3dParams, Magnetic3dState>({
  meta: {
    id: 'em-3d-magnetic-fields',
    title: '3D 电磁空间场与左手/右手定则 (E10)',
    textbookRef: '人教版 选择性必修二 第一章 & 必修三 第十三章',
    curriculumTags: ['物理观念', '科学思维', '科学探究'],
    difficulty: '压轴专题',
    version: '2.0.0'
  },
  renderMode: 'three3d',
  paramSchema,
  presets: magnetic3dPresets,
  engine: {
    createInitialState,
    step: stepMagnetic3d,
    computeObservables,
    checkInvariants
  },
  layers: [
    { id: 'conductors', label: '3D 载流线圈/导线', defaultVisible: true },
    { id: 'fieldLines3d', label: '3D Biot-Savart 空间磁感线', defaultVisible: true },
    { id: 'handednessTriad', label: '左手定则 v × B → F 正交三轴', defaultVisible: true }
  ],
  telemetryChannels: [
    { key: 'z', label: '粒子轴向位置 z', unit: 'm', color: '#38bdf8' },
    { key: 'bMagMicroT', label: '所在处磁感应强度 |B|', unit: 'μT', color: '#fbbf24' },
    { key: 'ke', label: '粒子动能 Ek (严格守恒)', unit: 'J', color: '#4ade80' },
    { key: 'vDotF', label: '洛伦兹功率 v·F (恒0)', unit: 'W', color: '#f472b6' }
  ],
  sceneSerializer: {
    exportScene: (_s, params) => ({
      schemaVersion: '2.0',
      modelId: 'em-3d-magnetic-fields',
      title: '3D 电磁空间场',
      params
    }),
    importScene: (dsl) => dsl.params as Partial<Magnetic3dParams>
  },
  exportDiagramIR: (state, params) => {
    const primitives: DiagramPrimitive[] = [
      { kind: 'circle', cx: 0, cy: 0, r: params.radiusR, dashed: true },
      { kind: 'trajectory', points: state.trail.map((p) => ({ x: p.x, y: p.z })), strokeWidth: 1.5 },
      { kind: 'circle', cx: state.position.x, cy: state.position.z, r: 0.08, fill: true },
      {
        kind: 'mathLabel',
        x: 1.8,
        y: 1.5,
        text: `I=${params.currentI}\\text{A},\\; R=${params.radiusR.toFixed(1)}\\text{m}`,
        align: 'end'
      }
    ];
    return {
      width: 680,
      height: 440,
      viewBox: { minX: -2.2, minY: -2.2, maxX: 2.2, maxY: 2.2 },
      title: '3D 电磁空间场二维侧视配图',
      primitives
    };
  },
  // Pure 2D XY projection fallback for non-WebGL headless / singlefile inspection
  renderCanvas: (ctx, state, params, viewport, activeLayers) => {
    const ppm = Math.min(viewport.width, viewport.height) * 0.22 * viewport.scale;
    const cx = viewport.width * 0.5 + viewport.offsetX;
    const cy = viewport.height * 0.5 + viewport.offsetY;
    const project3D = (p: { x: number; y: number; z: number }) => ({
      sx: cx + (p.x + p.z * 0.45) * ppm,
      sy: cy - (p.y + p.z * 0.25) * ppm
    });

    ctx.save();
    if (activeLayers.has('conductors')) {
      const segs = buildConductorSegments(params);
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      for (const s of segs) {
        const a = project3D(s.a);
        const b = project3D(s.b);
        ctx.moveTo(a.sx, a.sy);
        ctx.lineTo(b.sx, b.sy);
      }
      ctx.stroke();
    }

    if (activeLayers.has('fieldLines3d')) {
      const lines = trace3dFieldLines(params);
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.5)';
      ctx.lineWidth = 1.4;
      for (const pts of lines) {
        if (pts.length < 2) continue;
        ctx.beginPath();
        const p0 = project3D(pts[0]!);
        ctx.moveTo(p0.sx, p0.sy);
        for (let i = 1; i < pts.length; i++) {
          const pi = project3D(pts[i]!);
          ctx.lineTo(pi.sx, pi.sy);
        }
        ctx.stroke();
      }
    }

    if (state.trail.length > 1) {
      ctx.strokeStyle = '#4ade80';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      const t0 = project3D(state.trail[0]!);
      ctx.moveTo(t0.sx, t0.sy);
      for (let i = 1; i < state.trail.length; i++) {
        const ti = project3D(state.trail[i]!);
        ctx.lineTo(ti.sx, ti.sy);
      }
      ctx.stroke();
    }
    const sp = project3D(state.position);
    ctx.fillStyle = '#4ade80';
    ctx.beginPath();
    ctx.arc(sp.sx, sp.sy, 6.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  },
  formatFormulas: (state) => {
    const obs = computeObservables(state);
    return [
      {
        id: 'biot-savart-lorentz',
        label: '3D 毕奥-萨伐尔磁场与洛伦兹力',
        latex: 'd\\mathbf{B}=\\frac{\\mu_0 I}{4\\pi}\\frac{d\\mathbf{l}\\times\\mathbf{r}}{r^3},\\; \\mathbf{F}=q\\mathbf{v}\\times\\mathbf{B}',
        substitutedLatex: `|B|=${(obs.bMagMicroT ?? 0).toFixed(2)}\\ \\mu\\text{T},\\; E_k=${(obs.ke ?? 0).toFixed(4)}\\text{ J},\\; \\mathbf{v}\\cdot\\mathbf{F}=${(obs.vDotF ?? 0).toFixed(6)}`
      }
    ];
  }
});

export default em3dMagneticFieldsPlugin;
