import {
  defineSimulationPlugin,
  type DiagramPrimitive,
  type ParamFieldSpec,
  type ParamValue
} from '@physforge/sim-sdk';
import { transformerGridPresets } from './presets.js';
import {
  checkInvariants,
  computeObservables,
  createInitialState,
  stepTransformerGrid,
  trendSymbol,
  type TransformerGridParams,
  type TransformerGridState
} from './engine.js';

const paramSchema: readonly ParamFieldSpec<TransformerGridParams>[] = [
  {
    key: 'mode',
    kind: 'select',
    label: '系统架构',
    defaultValue: 'multi-tap-transformer',
    options: [
      { value: 'multi-tap-transformer', label: '含原边电阻多副线圈变压器' },
      { value: 'long-distance-grid', label: '发电机→升压→线损→降压输电网' }
    ]
  },
  { key: 'sourceU0', kind: 'number', label: '电源/发电机电压 U₀', unit: 'V', min: 100, max: 500, step: 10, defaultValue: 220 },
  { key: 'primaryR0', kind: 'number', label: '原线圈串联电阻 R₀', unit: 'Ω', min: 0, max: 30, step: 2, defaultValue: 10 },
  { key: 'n1Ratio', kind: 'number', label: '原线圈匝比 n₁', unit: '', min: 1, max: 10, step: 1, defaultValue: 2 },
  { key: 'n2Ratio', kind: 'number', label: '副线圈1匝比 n₂', unit: '', min: 1, max: 10, step: 1, defaultValue: 1 },
  { key: 'n3Ratio', kind: 'number', label: '副线圈2匝比 n₃', unit: '', min: 1, max: 10, step: 1, defaultValue: 1 },
  { key: 'loadR2', kind: 'number', label: '单用户电阻 R₂', unit: 'Ω', min: 10, max: 100, step: 5, defaultValue: 50 },
  { key: 'loadR3', kind: 'number', label: '第2副路电阻 R₃', unit: 'Ω', min: 10, max: 100, step: 5, defaultValue: 40 },
  { key: 'branch3Closed', kind: 'boolean', label: '闭合第 2 副路开关', defaultValue: true },
  { key: 'baselineParallelUsers', kind: 'number', label: '基准并联用户数', unit: '户', min: 1, max: 5, step: 1, defaultValue: 1 },
  { key: 'parallelUsersCount', kind: 'number', label: '当前并联用户数', unit: '户', min: 1, max: 6, step: 1, defaultValue: 2 },
  { key: 'genPowerKw', kind: 'number', label: '发电机总功率 P发', unit: 'kW', min: 20, max: 200, step: 10, defaultValue: 100 },
  { key: 'stepUpRatioK1', kind: 'number', label: '升压变升压比 k₁', unit: '', min: 5, max: 40, step: 5, defaultValue: 20 },
  { key: 'lineResistanceR', kind: 'number', label: '输电线总电阻 R线', unit: 'Ω', min: 2, max: 50, step: 2, defaultValue: 20 }
];

export const emTransformerGridPlugin = defineSimulationPlugin<TransformerGridParams, TransformerGridState>({
  meta: {
    id: 'em-transformer-grid',
    title: '理想变压器动态分析与高压输电网 (E08)',
    textbookRef: '人教版 选择性必修二 第三章 第3–4节',
    curriculumTags: ['物理观念', '科学思维', '科学探究'],
    difficulty: '高三一轮',
    version: '2.0.0'
  },
  paramSchema,
  presets: transformerGridPresets,
  engine: {
    createInitialState,
    step: stepTransformerGrid,
    computeObservables,
    checkInvariants
  },
  layers: [
    { id: 'topology', label: '变压器铁芯 / 高压输电拓扑', defaultVisible: true },
    { id: 'powerWaterfall', label: '功率损耗流瀑布条 (↑/↓指示)', defaultVisible: true }
  ],
  telemetryChannels: [
    { key: 'u1', label: '原端电压 U₁', unit: 'V', color: '#38bdf8' },
    { key: 'u2', label: '副边/末端电压 U₂', unit: 'V', color: '#4ade80' },
    { key: 'pLineLossW', label: '线路损耗 ΔP', unit: 'W', color: '#f43f5e' },
    { key: 'efficiencyPct', label: '传输效率 η', unit: '%', color: '#fbbf24' }
  ],
  getControlHandles: (_s, params) => [
    {
      id: 'step-up-ratio',
      label: params.mode === 'long-distance-grid' ? `k₁=${params.stepUpRatioK1}` : `R₀=${params.primaryR0}Ω`,
      position: { x: params.mode === 'long-distance-grid' ? (params.stepUpRatioK1 - 20) * 0.08 : (params.primaryR0 - 10) * 0.08, y: 0.7 },
      handleKind: 'point',
      color: '#fbbf24',
      onDrag: (wp): Record<string, ParamValue> =>
        params.mode === 'long-distance-grid'
          ? { stepUpRatioK1: Math.round(Math.max(5, Math.min(40, 20 + wp.x * 12.5)) / 5) * 5 }
          : { primaryR0: Math.round(Math.max(0, Math.min(30, 10 + wp.x * 12.5))) }
    }
  ],
  sceneSerializer: {
    exportScene: (_s, params) => ({
      schemaVersion: '2.0',
      modelId: 'em-transformer-grid',
      title: '理想变压器与高压输电',
      params
    }),
    importScene: (dsl) => dsl.params as Partial<TransformerGridParams>
  },
  exportDiagramIR: (state, params) => {
    const primitives: DiagramPrimitive[] = [
      { kind: 'line', x1: -0.1, y1: -0.9, x2: -0.1, y2: 0.9, strokeWidth: 2 },
      { kind: 'line', x1: 0.1, y1: -0.9, x2: 0.1, y2: 0.9, strokeWidth: 2 },
      { kind: 'circuitElement', element: 'resistor', x1: -2.2, y1: 0.7, x2: -0.6, y2: 0.7, label: `R_0=${params.primaryR0}` },
      {
        kind: 'mathLabel',
        x: 2.2,
        y: 1.2,
        text: `\\eta=${(state.current.efficiency * 100).toFixed(1)}\\%,\\; \\Delta P=${state.current.pLineLossW.toFixed(0)}\\text{W}`,
        align: 'end'
      }
    ];
    return {
      width: 720,
      height: 380,
      viewBox: { minX: -2.6, minY: -1.4, maxX: 2.6, maxY: 1.5 },
      title: '变压器与高压输电网配图',
      primitives
    };
  },
  renderCanvas: (ctx, state, params, viewport, activeLayers) => {
    const w = viewport.width;
    const h = viewport.height;
    const c = state.current;
    const b = state.baseline;
    ctx.save();

    if (activeLayers.has('topology')) {
      const cy = h * 0.4;
      if (params.mode === 'multi-tap-transformer') {
        const cx = w * 0.45;
        // Core lines
        ctx.strokeStyle = '#94a3b8';
        ctx.lineWidth = 5;
        ctx.strokeRect(cx - 56, cy - 75, 112, 150);

        // Coils & loops
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(cx - 170, cy - 55);
        ctx.lineTo(cx - 56, cy - 55);
        ctx.moveTo(cx - 170, cy + 55);
        ctx.lineTo(cx - 56, cy + 55);
        ctx.stroke();

        ctx.strokeStyle = '#4ade80';
        ctx.beginPath();
        ctx.moveTo(cx + 56, cy - 55);
        ctx.lineTo(cx + 185, cy - 55);
        ctx.moveTo(cx + 56, cy + 55);
        ctx.lineTo(cx + 185, cy + 55);
        ctx.stroke();

        // Trend arrows next to meters
        ctx.font = 'bold 14px monospace';
        ctx.fillStyle = '#38bdf8';
        ctx.fillText(`U₁=${c.u1.toFixed(1)}V (${trendSymbol(c.u1, b.u1)})`, cx - 220, cy - 70);
        ctx.fillText(`I₁=${c.i1.toFixed(2)}A (${trendSymbol(c.i1, b.i1)})`, cx - 220, cy + 82);
        ctx.fillStyle = '#4ade80';
        ctx.fillText(`U₂=${c.u2.toFixed(1)}V (${trendSymbol(c.u2, b.u2)})`, cx + 75, cy - 70);
        ctx.fillText(`I₂=${c.i2.toFixed(2)}A (${trendSymbol(c.i2, b.i2)})`, cx + 75, cy + 82);
      } else {
        // 4-stage grid nodes
        const xs = [w * 0.14, w * 0.36, w * 0.64, w * 0.86];
        const titles = ['发电机 P发', `升压变 (k₁=${params.stepUpRatioK1})`, `输电线 (R=${params.lineResistanceR}Ω)`, '降压→用户'];
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(xs[0]!, cy);
        ctx.lineTo(xs[3]!, cy);
        ctx.stroke();

        xs.forEach((nx, i) => {
          ctx.fillStyle = '#1e293b';
          ctx.strokeStyle = i === 2 ? '#f43f5e' : '#38bdf8';
          ctx.fillRect(nx - 42, cy - 26, 84, 52);
          ctx.strokeRect(nx - 42, cy - 26, 84, 52);
          ctx.fillStyle = '#e2e8f0';
          ctx.font = '12px sans-serif';
          ctx.fillText(titles[i]!, nx - 38, cy + 4);
        });
      }
    }

    if (activeLayers.has('powerWaterfall')) {
      const barX = w * 0.14;
      const barW = w * 0.72;
      const barY = h * 0.74;
      const barH = 26;
      const total = Math.max(1, c.pInW);
      const userFrac = c.pUserW / total;
      const lossFrac = c.pLineLossW / total;

      ctx.fillStyle = '#4ade80';
      ctx.fillRect(barX, barY, barW * userFrac, barH);
      ctx.fillStyle = '#f43f5e';
      ctx.fillRect(barX + barW * userFrac, barY, barW * lossFrac, barH);
      ctx.strokeStyle = '#64748b';
      ctx.strokeRect(barX, barY, barW, barH);

      ctx.fillStyle = '#e2e8f0';
      ctx.font = '13px sans-serif';
      ctx.fillText(
        `功率瀑布流：总投入 ${(total / 1000).toFixed(2)} kW ＝ 有效利用 ${(c.pUserW / 1000).toFixed(2)} kW (${(c.efficiency * 100).toFixed(2)}%) ＋ 线损 ${(c.pLineLossW / 1000).toFixed(2)} kW`,
        barX,
        barY - 12
      );
    }

    ctx.restore();
  },
  formatFormulas: (state) => [
    {
      id: 'transformer-eq',
      label: '理想变压器功率与输电损耗流',
      latex: '\\frac{U_1}{n_1} = \\frac{U_k}{n_k},\\quad \\Delta P = \\left(\\frac{P}{U_{\\text{送}}}\\right)^2 R_{\\text{线}}',
      substitutedLatex: `P_{\\text{in}}=${state.current.pInW.toFixed(1)}\\text{ W},\\; \\Delta P=${state.current.pLineLossW.toFixed(1)}\\text{ W},\\; \\eta=${(state.current.efficiency * 100).toFixed(2)}\\%`
    }
  ]
});

export default emTransformerGridPlugin;
