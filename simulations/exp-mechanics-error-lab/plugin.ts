import { defineSimulationPlugin, type DiagramPrimitive, type ParamFieldSpec } from '@physforge/sim-sdk';
import { mechanicsErrorPresets } from './presets.js';
import {
  checkInvariants,
  computeObservables,
  createInitialState,
  stepMechanicsErrorLab,
  type MechanicsErrorParams,
  type MechanicsErrorState
} from './engine.js';

const paramSchema: readonly ParamFieldSpec<MechanicsErrorParams>[] = [
  {
    key: 'scenario',
    kind: 'select',
    label: '实验误差类型',
    defaultValue: 'under-compensated',
    options: [
      { value: 'ideal-compensated', label: '恰当平衡摩擦力 (过原点)' },
      { value: 'under-compensated', label: '平衡不足/水平阻力 (正 F 截距)' },
      { value: 'over-compensated', label: '过度平衡倾角过大 (正 a 截距)' },
      { value: 'heavy-hanger-bend', label: '钩码质量过大 m≈M (末端弯曲)' }
    ]
  },
  { key: 'cartMassKg', kind: 'number', label: '小车质量 M', unit: 'kg', defaultValue: 0.4, min: 0.1, max: 1.5, step: 0.05 },
  { key: 'hangerMassKg', kind: 'number', label: '当前悬挂钩码 m', unit: 'kg', defaultValue: 0.04, min: 0.01, max: 0.5, step: 0.01 },
  { key: 'trackTiltDeg', kind: 'number', label: '木板倾角 θ', unit: '°', defaultValue: 0, min: 0, max: 10, step: 0.5 },
  { key: 'frictionForceN', kind: 'number', label: '轨道阻力 f', unit: 'N', defaultValue: 0.06, min: 0, max: 0.3, step: 0.01 },
  { key: 'readingNoiseMm', kind: 'number', label: '刻度读数高斯噪声 σ', unit: 'mm', defaultValue: 0, min: 0, max: 0.8, step: 0.05 },
  { key: 'seed', kind: 'number', label: 'PRNG 随机种子', defaultValue: 20261122, min: 1, max: 99999999, step: 1 },
  {
    key: 'phyphoxOverlayCsv',
    kind: 'select',
    label: 'Phyphox 实测 CSV 叠加对照',
    defaultValue: '',
    options: [
      { value: '', label: '不叠加外部实测散点' },
      { value: '0.1;0.08\n0.2;0.31\n0.4;0.79', label: 'Phyphox 分号实测对照样本' }
    ]
  }
];

export const expMechanicsErrorLabPlugin = defineSimulationPlugin<MechanicsErrorParams, MechanicsErrorState>({
  meta: {
    id: 'exp-mechanics-error-lab',
    title: '力学实验真误差与纸带逐差仿真台 (X01)',
    textbookRef: '人教版 必修第一册 第四章 · 探究 a-F 异常图线溯源',
    curriculumTags: ['科学探究', '科学思维', '物理观念'],
    difficulty: '高三一轮',
    version: '2.0.0'
  },
  paramSchema,
  presets: mechanicsErrorPresets,
  engine: {
    createInitialState,
    step: stepMechanicsErrorLab,
    computeObservables,
    checkInvariants
  },
  layers: [
    { id: 'tape', label: '50Hz 打点纸带缩放刻度', defaultVisible: true },
    { id: 'afCurve', label: 'a-F 拟合曲线与 CSV 实验叠加', defaultVisible: true }
  ],
  telemetryChannels: [
    { key: 'aTrueMps2', label: '真实加速度 a_true', unit: 'm/s²', color: '#4ade80' },
    { key: 'aDiffMeasuredMps2', label: '逐差法测得加速度', unit: 'm/s²', color: '#38bdf8' },
    { key: 'interceptFitA', label: '拟合 a 轴截距', unit: 'm/s²', color: '#f59e0b' },
    { key: 'rSquared', label: '线性拟合决定系数 R²', unit: '', color: '#a855f7' }
  ],
  sceneSerializer: {
    exportScene: (_s, params) => ({
      schemaVersion: '2.0',
      modelId: 'exp-mechanics-error-lab',
      title: '力学核心实验真误差仿真台',
      params
    }),
    importScene: (dsl) => dsl.params as Partial<MechanicsErrorParams>
  },
  exportDiagramIR: (state) => {
    const pts = state.afCurve.map((p) => ({ x: -1.5 + p.fAppN * 0.5, y: -1.1 + p.aMeasured * 0.45 }));
    const primitives: DiagramPrimitive[] = [
      { kind: 'arrow', x1: -1.7, y1: -1.1, x2: 1.9, y2: -1.1, label: 'F(N)' },
      { kind: 'arrow', x1: -1.5, y1: -1.3, x2: -1.5, y2: 1.4, label: 'a(m/s^2)' }
    ];
    if (pts.length > 1) primitives.push({ kind: 'polyline', points: pts });
    return {
      width: 680,
      height: 400,
      viewBox: { minX: -2.2, minY: -1.6, maxX: 2.2, maxY: 1.6 },
      title: 'a-F 实验系统误差曲线配图',
      primitives
    };
  },
  renderCanvas: (ctx, state, _params, viewport, activeLayers) => {
    const w = viewport.width;
    const h = viewport.height;
    ctx.save();

    if (activeLayers.has('tape')) {
      const ty = h * 0.16;
      ctx.fillStyle = '#e2e8f0';
      ctx.fillRect(w * 0.08, ty, w * 0.84, 34);
      const maxCm = Math.max(20, state.tapeDots[state.tapeDots.length - 1]?.posCm ?? 20);
      state.tapeDots.forEach((d) => {
        const px = w * 0.1 + (d.posCm / maxCm) * (w * 0.78);
        ctx.fillStyle = '#0f172a';
        ctx.beginPath();
        ctx.arc(px, ty + 17, 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = '10px ui-sans-serif, system-ui';
        ctx.fillText(`x${d.index}:${d.posCm.toFixed(2)}`, px - 14, ty + 48);
      });
    }

    if (activeLayers.has('afCurve')) {
      const gx = w * 0.14;
      const gy = h * 0.86;
      const gw = w * 0.76;
      const gh = h * 0.5;
      ctx.strokeStyle = '#64748b';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(gx, gy - gh);
      ctx.lineTo(gx, gy);
      ctx.lineTo(gx + gw, gy);
      ctx.stroke();

      const maxF = Math.max(0.8, ...state.afCurve.map((p) => p.fAppN));
      const maxA = Math.max(2.0, ...state.afCurve.map((p) => Math.max(p.aMeasured, p.aAnalytic)));
      const toX = (f: number) => gx + (f / maxF) * gw;
      const toY = (a: number) => gy - Math.max(-0.2, Math.min(1.1, a / maxA)) * gh;

      // Analytical curve
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      state.afCurve.forEach((pt, idx) => {
        const px = toX(pt.fAppN);
        const py = toY(pt.aAnalytic);
        if (idx === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();

      // Measured points
      ctx.fillStyle = '#fbbf24';
      state.afCurve.forEach((pt) => {
        ctx.beginPath();
        ctx.arc(toX(pt.fAppN), toY(pt.aMeasured), 4.5, 0, Math.PI * 2);
        ctx.fill();
      });

      // CSV Overlay points
      ctx.fillStyle = '#f43f5e';
      state.csvOverlayPoints.forEach((pt) => {
        ctx.fillRect(toX(pt.fAppN) - 3, toY(pt.a) - 3, 6, 6);
      });
    }

    ctx.fillStyle = '#e2e8f0';
    ctx.font = 'bold 13px ui-sans-serif, system-ui';
    ctx.fillText(
      `a_true=${state.aTrueMps2.toFixed(4)} | 逐差 a_diff=${state.aDiffMeasuredMps2.toFixed(4)} m/s² | F轴截距=${state.interceptFitF.toFixed(4)}N | R²=${state.rSquared.toFixed(5)}`,
      20,
      26
    );
    ctx.restore();
  },
  formatFormulas: (state) => [
    {
      id: 'mechanics-error-diff',
      label: '打点逐差与真实加速度模型',
      latex: 'a_{\\text{真}}=\\frac{mg+Mg\\sin\\theta-f}{M+m},\\quad a=\\frac{(s_4+s_5+s_6)-(s_1+s_2+s_3)}{9T^2}',
      substitutedLatex: `a_{\\text{真}}=${state.aTrueMps2.toFixed(4)}\\text{ m/s}^2,\\; a_{\\text{逐}}=${state.aDiffMeasuredMps2.toFixed(4)}\\text{ m/s}^2,\\; R^2=${state.rSquared.toFixed(5)}`
    }
  ]
});

export default expMechanicsErrorLabPlugin;
