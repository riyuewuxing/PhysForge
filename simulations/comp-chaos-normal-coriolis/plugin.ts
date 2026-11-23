import { defineSimulationPlugin, type DiagramPrimitive, type ParamFieldSpec } from '@physforge/sim-sdk';
import { chaosNormalCoriolisPresets } from './presets.js';
import {
  checkInvariants,
  computeObservables,
  createInitialState,
  stepChaosNormalCoriolis,
  type ChaosNormalCoriolisParams,
  type ChaosNormalCoriolisState
} from './engine.js';

const paramSchema: readonly ParamFieldSpec<ChaosNormalCoriolisParams>[] = [
  {
    key: 'mode',
    kind: 'select',
    label: '动力学模块',
    defaultValue: 'double-pendulum',
    options: [
      { value: 'double-pendulum', label: '混沌双摆 (RK45 + 初值分离)' },
      { value: 'normal-modes', label: '双耦合振子简正模与拍频' },
      { value: 'coriolis-disk', label: '旋转圆盘非惯性科里奥利力' }
    ]
  },
  { key: 'm1Kg', kind: 'number', label: '质点 1 质量 m₁', unit: 'kg', defaultValue: 1.0, min: 0.5, max: 3.0, step: 0.2 },
  { key: 'm2Kg', kind: 'number', label: '质点 2 质量 m₂', unit: 'kg', defaultValue: 1.0, min: 0.5, max: 3.0, step: 0.2 },
  { key: 'l1M', kind: 'number', label: '上杆长 L₁', unit: 'm', defaultValue: 1.0, min: 0.5, max: 1.8, step: 0.1 },
  { key: 'l2M', kind: 'number', label: '下杆长 L₂', unit: 'm', defaultValue: 1.0, min: 0.5, max: 1.8, step: 0.1 },
  { key: 'theta1Deg', kind: 'number', label: '初角 θ₁', unit: '°', defaultValue: 135, min: 10, max: 175, step: 5 },
  { key: 'theta2Deg', kind: 'number', label: '初角 θ₂', unit: '°', defaultValue: 135, min: 10, max: 175, step: 5 },
  { key: 'springKw', kind: 'number', label: '边墙弹簧 k_w', unit: 'N/m', defaultValue: 25, min: 5, max: 60, step: 5 },
  { key: 'springKc', kind: 'number', label: '耦合弹簧 k_c', unit: 'N/m', defaultValue: 10, min: 1, max: 40, step: 2 },
  {
    key: 'normalExcite',
    kind: 'select',
    label: '简正模初态激发',
    defaultValue: 'symmetric',
    options: [
      { value: 'symmetric', label: '同相简正模 x₁=x₂' },
      { value: 'antisymmetric', label: '反相简正模 x₁=-x₂' },
      { value: 'single-beat', label: '单侧偏置（拍频传递）' }
    ]
  },
  { key: 'diskOmegaRadps', kind: 'number', label: '圆盘角速度 Ω', unit: 'rad/s', defaultValue: 1.2, min: 0.2, max: 3.0, step: 0.2 },
  { key: 'puckSpeedMps', kind: 'number', label: '冰球惯性射速 v₀', unit: 'm/s', defaultValue: 0.9, min: 0.3, max: 2.0, step: 0.1 }
];

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

export const compChaosNormalCoriolisPlugin = defineSimulationPlugin<
  ChaosNormalCoriolisParams,
  ChaosNormalCoriolisState
>({
  meta: {
    id: 'comp-chaos-normal-coriolis',
    title: '混沌双摆、简正模与科里奥利力 (C02)',
    textbookRef: '人教版 选择性必修一 & 强基竞赛 · 分析力学与非惯性系',
    curriculumTags: ['物理观念', '科学思维'],
    difficulty: '压轴专题',
    version: '2.0.0'
  },
  paramSchema,
  presets: chaosNormalCoriolisPresets,
  engine: {
    createInitialState,
    step: stepChaosNormalCoriolis,
    computeObservables,
    checkInvariants
  },
  layers: [
    { id: 'main', label: '混沌分叉 / 简正波形 / 双系对照', defaultVisible: true }
  ],
  telemetryChannels: [
    { key: 'dpEnergyDriftRel', label: '双摆能量漂移', unit: '', color: '#4ade80' },
    { key: 'dpDivergenceRad', label: '双初值分离角距', unit: 'rad', color: '#f43f5e' },
    { key: 'x1Nm', label: '振子 1 位移', unit: 'm', color: '#38bdf8' },
    { key: 'x2Nm', label: '振子 2 位移', unit: 'm', color: '#fbbf24' }
  ],
  getControlHandles: (state, params) => {
    if (params.mode !== 'double-pendulum') return [];
    const theta1 = state.dpState[0]!;
    const theta2 = state.dpState[1]!;
    const bob1 = { x: params.l1M * Math.sin(theta1), y: -params.l1M * Math.cos(theta1) };
    const bob2 = {
      x: bob1.x + params.l2M * Math.sin(theta2),
      y: bob1.y - params.l2M * Math.cos(theta2)
    };
    const angleFrom = (x: number, y: number) => {
      const thetaDeg = (Math.atan2(x, -y) * 180) / Math.PI;
      return Number(clamp(thetaDeg, 10, 175).toFixed(1));
    };
    return [
      {
        id: 'double-pendulum-bob1',
        label: `θ₁=${params.theta1Deg.toFixed(1)}°`,
        position: bob1,
        handleKind: 'point',
        color: '#38bdf8',
        onDrag: (worldPos) => ({ theta1Deg: angleFrom(worldPos.x, worldPos.y) })
      },
      {
        id: 'double-pendulum-bob2',
        label: `θ₂=${params.theta2Deg.toFixed(1)}°`,
        position: bob2,
        handleKind: 'point',
        color: '#fbbf24',
        onDrag: (worldPos) => ({ theta2Deg: angleFrom(worldPos.x - bob1.x, worldPos.y - bob1.y) })
      }
    ];
  },
  referenceFrames: [
    {
      id: 'inertial',
      label: '地面惯性系',
      description: '惯性实验室坐标系，原点位于旋转圆盘中心。',
      getOrigin: () => ({ x: 0, y: 0 }),
      getVelocity: () => ({ x: 0, y: 0 })
    },
    {
      id: 'rotating-disk',
      label: '旋转圆盘非惯性系',
      description: '圆盘中心与惯性系重合；科里奥利模式的并列视图同时展示两系轨迹。',
      getOrigin: () => ({ x: 0, y: 0 }),
      getVelocity: () => ({ x: 0, y: 0 })
    }
  ],
  sceneSerializer: {
    exportScene: (_s, params) => ({
      schemaVersion: '2.0',
      modelId: 'comp-chaos-normal-coriolis',
      title: '混沌双摆、简正模与科里奥利力',
      params
    }),
    importScene: (dsl) => dsl.params as Partial<ChaosNormalCoriolisParams>
  },
  exportDiagramIR: (state, params) => {
    const primitives: DiagramPrimitive[] = [
      { kind: 'line', x1: 0, y1: 1.0, x2: Math.sin(state.dpState[0]!), y2: 1.0 - Math.cos(state.dpState[0]!) },
      { kind: 'circle', cx: Math.sin(state.dpState[0]!), cy: 1.0 - Math.cos(state.dpState[0]!), r: 0.08, fill: true },
      { kind: 'mathLabel', x: 0, y: -1.2, text: `\\text{Mode: }${params.mode}`, align: 'middle' }
    ];
    return {
      width: 680,
      height: 400,
      viewBox: { minX: -2.2, minY: -1.5, maxX: 2.2, maxY: 1.5 },
      title: '分析力学与非惯性系示意图',
      primitives
    };
  },
  renderCanvas: (ctx, state, params, viewport, activeLayers) => {
    const w = viewport.width;
    const h = viewport.height;
    if (!activeLayers.has('main')) return;
    ctx.save();

    if (params.mode === 'double-pendulum') {
      const cx = w * 0.45 + viewport.offsetX;
      const cy = h * 0.5 + viewport.offsetY;
      const sc = Math.min(w, h) * 0.24 * viewport.scale;
      const drawDp = (s: readonly [number, number, number, number], col: string) => {
        const x1 = cx + params.l1M * sc * Math.sin(s[0]);
        const y1 = cy + params.l1M * sc * Math.cos(s[0]);
        const x2 = x1 + params.l2M * sc * Math.sin(s[1]);
        const y2 = y1 + params.l2M * sc * Math.cos(s[1]);
        ctx.strokeStyle = col;
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(x1, y1, 6, 0, Math.PI * 2);
        ctx.arc(x2, y2, 6, 0, Math.PI * 2);
        ctx.fill();
      };
      drawDp(state.dpShadow, 'rgba(244, 63, 94, 0.55)');
      drawDp(state.dpState, '#38bdf8');
      ctx.fillStyle = '#e2e8f0';
      ctx.font = 'bold 13px ui-sans-serif, system-ui';
      ctx.fillText(`混沌双摆 Δθ₀=1e-4 分离 | 最大能量漂移 ${state.dpMaxRelDrift.toExponential(2)}`, 20, 28);
      ctx.restore();
      return;
    }

    if (params.mode === 'normal-modes') {
      const cy = h * 0.3;
      const x1Px = w * 0.35 + state.nmVerlet.positions[0]! * 70;
      const x2Px = w * 0.65 + state.nmVerlet.positions[1]! * 70;
      ctx.strokeStyle = '#64748b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(w * 0.15, cy);
      ctx.lineTo(x1Px, cy);
      ctx.lineTo(x2Px, cy);
      ctx.lineTo(w * 0.85, cy);
      ctx.stroke();
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(x1Px - 14, cy - 14, 28, 28);
      ctx.fillStyle = '#fbbf24';
      ctx.fillRect(x2Px - 14, cy - 14, 28, 28);

      const py0 = h * 0.72;
      state.nmTrail.forEach((pt, idx) => {
        const px = w * 0.1 + (idx / 160) * w * 0.8;
        ctx.fillStyle = '#38bdf8';
        ctx.fillRect(px, py0 - pt.x1 * 60, 2.5, 2.5);
        ctx.fillStyle = '#fbbf24';
        ctx.fillRect(px, py0 - pt.x2 * 60, 2.5, 2.5);
      });
      ctx.fillStyle = '#e2e8f0';
      ctx.font = 'bold 13px ui-sans-serif, system-ui';
      ctx.fillText(`耦合振子 (${params.normalExcite}) | x₁=${state.nmVerlet.positions[0]!.toFixed(3)}, x₂=${state.nmVerlet.positions[1]!.toFixed(3)}`, 20, 28);
      ctx.restore();
      return;
    }

    // Coriolis dual viewport: Left Lab, Right Rotating Frame
    const rDisk = Math.min(w * 0.18, h * 0.32);
    const drawDisk = (cx: number, cy: number, title: string, pts: readonly { x: number; y: number }[], head: { x: number; y: number }, col: string) => {
      ctx.strokeStyle = '#64748b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, rDisk, 0, Math.PI * 2);
      ctx.stroke();
      if (pts.length > 1) {
        ctx.strokeStyle = col;
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        pts.forEach((p, idx) => {
          const sx = cx + p.x * rDisk * 0.45;
          const sy = cy - p.y * rDisk * 0.45;
          if (idx === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        });
        ctx.stroke();
      }
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(cx + head.x * rDisk * 0.45, cy - head.y * rDisk * 0.45, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#e2e8f0';
      ctx.font = 'bold 13px ui-sans-serif, system-ui';
      ctx.fillText(title, cx - rDisk, cy + rDisk + 24);
    };
    drawDisk(
      w * 0.28,
      h * 0.5,
      '地面惯性系（自由直轨）',
      state.coriolisTrail.map((p) => ({ x: p.lx, y: p.ly })),
      state.labPos,
      '#4ade80'
    );
    drawDisk(
      w * 0.72,
      h * 0.5,
      '转动圆盘系（科里奥利偏折）',
      state.coriolisTrail.map((p) => ({ x: p.rx, y: p.ry })),
      { x: state.rotDirectState[0]!, y: state.rotDirectState[1]! },
      '#38bdf8'
    );
    ctx.fillStyle = '#e2e8f0';
    ctx.fillText(`双系轨迹重合偏差: ${state.coriolisDeviation.toExponential(2)}`, 20, 28);
    ctx.restore();
  },
  formatFormulas: (state, params) => [
    {
      id: 'comp-advanced-mech',
      label: '强基分析力学核心关系',
      latex:
        params.mode === 'normal-modes'
          ? '\\omega_1=\\sqrt{\\frac{k_w}{m}},\\quad \\omega_2=\\sqrt{\\frac{k_w+2k_c}{m}}'
          : '\\mathbf{a}_{\\text{非}}=-2\\boldsymbol{\\Omega}\\times\\mathbf{v}_r-\\boldsymbol{\\Omega}\\times(\\boldsymbol{\\Omega}\\times\\mathbf{r}_r)',
      substitutedLatex: `\\Delta E_{\\text{rel}}=${state.dpMaxRelDrift.toExponential(2)},\\; \\text{CorDev}=${state.coriolisDeviation.toExponential(2)}`
    }
  ]
});

export default compChaosNormalCoriolisPlugin;
