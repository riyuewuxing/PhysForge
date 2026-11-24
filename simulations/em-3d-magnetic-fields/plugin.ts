import { magnetic3dStoryDecks } from './storyDecks.js';
import { createWorldMapper, defineSimulationPlugin, type DiagramPrimitive, type LiveFormulaSpec, type ParamFieldSpec } from '@physforge/sim-sdk';
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

/** Proper rotation (determinant +1) preserving v × B and the existing side-view projection. */
export function magnetic3dDisplayPoint(p: { x: number; y: number; z: number }) {
  return { x: p.z, y: p.y, z: -p.x };
}

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

const liveFormulas: readonly LiveFormulaSpec[] = [
  {
    "id": "biot-savart-current",
    "title": "稳恒电流元的毕奥—萨伐尔定律",
    "latex": "d\\mathbf B=\\frac{\\mu_0 \\htmlClass{pf-live-var}{\\htmlData{param=currentI}{I}}}{4\\pi}\\frac{d\\boldsymbol\\ell\\times\\mathbf r}{r^3}",
    "bindings": [
      {
        "tokenKey": "currentI",
        "paramKey": "currentI",
        "label": "线圈/导线电流 I",
        "unit": "A",
        "min": 0,
        "max": 5,
        "step": 0.5,
        "precision": 1
      }
    ],
    "when": {
      "geometryType": [
        "helmholtz-coil",
        "single-loop",
        "finite-solenoid",
        "straight-wire",
        "parallel-wires"
      ]
    }
  },
  {
    "id": "uniform-gyro-frequency",
    "title": "匀强场初始回旋角频率与垂直加速度",
    "latex": "\\begin{aligned}\\omega_c&=\\htmlClass{pf-live-var}{\\htmlData{param=qOverM}{\\left|q/m\\right|}}\\htmlClass{pf-live-var}{\\htmlData{param=uniformBz}{B_z}}\\\\a_{\\perp,0}&=\\omega_c \\htmlClass{pf-live-var}{\\htmlData{param=vPerp}{v_\\perp}}\\end{aligned}",
    "bindings": [
      {
        "tokenKey": "qOverM",
        "paramKey": "qOverM",
        "label": "试探粒子相对荷质比",
        "unit": "",
        "min": 0,
        "max": 4,
        "step": 0.2,
        "precision": 1
      },
      {
        "tokenKey": "uniformBz",
        "paramKey": "uniformBz",
        "label": "匀强模式磁感应强度 Bz",
        "unit": "T",
        "min": 0.5,
        "max": 4,
        "step": 0.5,
        "precision": 1
      },
      {
        "tokenKey": "vPerp",
        "paramKey": "vPerp",
        "label": "垂直初速度 v⊥",
        "unit": "m/s",
        "min": 0,
        "max": 3,
        "step": 0.2,
        "precision": 1
      }
    ],
    "when": {
      "geometryType": [
        "uniform-helix"
      ]
    }
  },
  {
    "id": "uniform-parallel-velocity",
    "title": "匀强磁场沿磁场方向匀速运动",
    "latex": "z=z_0+\\htmlClass{pf-live-var}{\\htmlData{param=vParallel}{v_\\parallel}}t",
    "bindings": [
      {
        "tokenKey": "vParallel",
        "paramKey": "vParallel",
        "label": "轴向初速度 v∥",
        "unit": "m/s",
        "min": -2,
        "max": 2,
        "step": 0.2,
        "precision": 1
      }
    ],
    "when": {
      "geometryType": [
        "uniform-helix"
      ]
    }
  }
];

export const em3dMagneticFieldsPlugin = Object.assign(defineSimulationPlugin<Magnetic3dParams, Magnetic3dState>({
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
    { id: 'handednessTriad', label: '速度、磁场与洛伦兹加速度', defaultVisible: true }
  ],
  telemetryChannels: [
    { key: 'z', label: '粒子轴向位置 z', unit: 'm', color: '#38bdf8' },
    { key: 'bMagMicroT', label: '所在处磁感应强度 |B|', unit: 'μT', color: '#fbbf24' },
    { key: 'ke', label: '粒子比动能 (严格守恒)', unit: 'J/kg', color: '#4ade80' },
    { key: 'vDotF', label: '洛伦兹比功率 v·a (恒0)', unit: 'W/kg', color: '#f472b6' }
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
      { kind: 'trajectory', points: state.trail.map((p) => { const q = magnetic3dDisplayPoint(p); return { x: q.x, y: q.y }; }), strokeWidth: 1.5 },
      { kind: 'circle', cx: state.position.z, cy: state.position.y, r: 0.08, fill: true },
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
    const m = createWorldMapper(viewport);
    const project3D = (p: { x: number; y: number; z: number }) => { const q = magnetic3dDisplayPoint(p); return m.toScreen(q.x, q.y); };

    ctx.save();
    if (activeLayers.has('conductors')) {
      const segs = buildConductorSegments(params);
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      for (const s of segs) {
        const a = project3D(s.a);
        const b = project3D(s.b);
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
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
        ctx.moveTo(p0.x, p0.y);
        for (let i = 1; i < pts.length; i++) {
          const pi = project3D(pts[i]!);
          ctx.lineTo(pi.x, pi.y);
        }
        ctx.stroke();
      }
    }

    if (state.trail.length > 1) {
      ctx.strokeStyle = '#4ade80';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      const t0 = project3D(state.trail[0]!);
      ctx.moveTo(t0.x, t0.y);
      for (let i = 1; i < state.trail.length; i++) {
        const ti = project3D(state.trail[i]!);
        ctx.lineTo(ti.x, ti.y);
      }
      ctx.stroke();
    }
    const sp = project3D(state.position);
    ctx.fillStyle = '#4ade80';
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, m.len(0.03), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  },
  getControlHandles: (state, params) => {
    const origin = {
      x: state.position.z,
      y: state.position.y
    };
    return [
      {
        id: 'particle-vperp',
        label: `v⊥=${params.vPerp.toFixed(1)} m/s`,
        position: { x: origin.x + Math.max(0.15, params.vPerp * 0.35), y: origin.y },
        origin,
        handleKind: 'vector',
        color: '#38bdf8',
        onDrag: (world) => ({
          vPerp: Number(Math.max(0, Math.min(3, Math.round((Math.hypot(world.x - origin.x, world.y - origin.y) / 0.35) * 5) / 5)).toFixed(1))
        })
      }
    ];
  },
  getForceVectors: (state) => {
    const origin = {
      x: state.position.z,
      y: state.position.y
    };
    const acceleration = state.lorentzForce;
    return [
      {
        id: 'lorentz-acceleration',
        label: 'a洛 = (q/m)v×B',
        origin,
        force: { x: acceleration.z, y: acceleration.y },
        color: '#fb7185',
        category: 'magnetic',
        unit: 'm/s²'
      }
    ];
  },
  referenceFrames: [
    {
      id: 'helical-particle',
      label: '带电粒子随动参考系 (2D 投影)',
      getOrigin: (state) => ({
        x: state.position.z,
        y: state.position.y
      }),
      getVelocity: (state) => ({
        x: state.velocity.z,
        y: state.velocity.y
      })
    }
  ],
  formatFormulas: (state, params) => {
    const obs = computeObservables(state);
    if (params.geometryType === 'finite-solenoid') {
      return [
        {
          id: 'local-helical-motion',
          label: '局部匀强磁场近似下的螺旋运动',
          latex: '\\begin{aligned}\\text{局部匀强近似}\\\\ R &= \\frac{mv_\\perp}{|q|B}\\\\ T &= \\frac{2\\pi m}{|q|B}\\end{aligned}'
        }
      ];
    }
    return [
      {
        id: 'biot-savart-lorentz',
        label: '3D 毕奥-萨伐尔磁场与洛伦兹加速度',
        latex: 'd\\mathbf{B}=\\frac{\\mu_0 I}{4\\pi}\\frac{d\\mathbf{l}\\times\\mathbf{r}}{r^3},\\; \\mathbf{a}=\\frac{q}{m}\\mathbf{v}\\times\\mathbf{B}',
        substitutedLatex: `|B|=${(obs.bMagMicroT ?? 0).toFixed(2)}\\ \\mu\\text{T},\\; E_k/m=${(obs.ke ?? 0).toFixed(4)}\\text{ J/kg},\\; \\mathbf{v}\\cdot\\mathbf{a}=${(obs.vDotF ?? 0).toFixed(6)}`
      }
    ];
  }
}), { storyDecks: magnetic3dStoryDecks, liveFormulas, spatial3D: { flattenPlane: 'xy' as const, defaultVisibleHeight: 4.8, sceneDepthRadius: 6,
  default3DAzimuthRad: 0.67, default3DPolarRad: 1.08 } });

export default em3dMagneticFieldsPlugin;
