import { createWorldMapper, defineSimulationPlugin, drawGlowVectorArrow, drawRoundedPotentialPath, resolveAndDrawLabels, type CanvasLabel, type DiagramPrimitive, type ParamFieldSpec } from '@physforge/sim-sdk';
import { lcRlcPresets } from './presets.js';
import {
  checkInvariants,
  computeImpedanceSummary,
  computeLcNaturalOmega,
  computeObservables,
  createInitialState,
  stepLcRlcOscillation,
  type LcRlcParams,
  type LcRlcState
} from './engine.js';

const paramSchema: readonly ParamFieldSpec<LcRlcParams>[] = [
  {
    key: 'mode',
    kind: 'select',
    label: '振荡模式',
    defaultValue: 'lc-undamped',
    options: [
      { value: 'lc-undamped', label: '理想 LC 无阻尼自由振荡' },
      { value: 'rlc-damped', label: 'RLC 阻尼衰减振荡' },
      { value: 'rlc-ac-resonance', label: 'RLC 受迫交流谐振' }
    ]
  },
  { key: 'inductanceH', kind: 'number', label: '电感自感系数 L', unit: 'H', min: 0.05, max: 1.0, step: 0.05, defaultValue: 0.25 },
  { key: 'capacitanceF', kind: 'number', label: '电容 C', unit: 'F', min: 0.02, max: 0.5, step: 0.02, defaultValue: 0.1 },
  { key: 'resistanceR', kind: 'number', label: '串联电阻 R', unit: 'Ω', min: 0, max: 6, step: 0.2, defaultValue: 2.0 },
  { key: 'initialChargeC', kind: 'number', label: '电容器初始电量 Q₀', unit: 'C', min: 0.1, max: 1.0, step: 0.1, defaultValue: 0.5 },
  { key: 'driveVoltAmpUm', kind: 'number', label: '交流驱动电压幅值 Um', unit: 'V', min: 0, max: 20, step: 2, defaultValue: 10 },
  { key: 'driveOmega', kind: 'number', label: '驱动角频率 ω', unit: 'rad/s', min: 1, max: 15, step: 0.2, defaultValue: 6.325 }
];

export const emLcRlcOscillationPlugin = defineSimulationPlugin<LcRlcParams, LcRlcState>({
  meta: {
    id: 'em-lc-rlc-oscillation',
    title: 'LC 电磁振荡与 RLC 交流谐振 (E09)',
    textbookRef: '人教版 选择性必修二 第四章',
    curriculumTags: ['物理观念', '科学思维', '科学探究'],
    difficulty: '高三一轮',
    version: '2.0.0'
  },
  paramSchema,
  presets: lcRlcPresets,
  engine: {
    createInitialState,
    step: stepLcRlcOscillation,
    computeObservables,
    checkInvariants
  },
  layers: [
    { id: 'circuit', label: 'LC / RLC 振荡回路', defaultVisible: true },
    { id: 'energyBars', label: '电场能 E_E 与磁场能 E_B 互补柱状图', defaultVisible: true },
    { id: 'phasorPlot', label: '感抗/容抗/电阻旋转相量与谐振峰', defaultVisible: true }
  ],
  telemetryChannels: [
    { key: 'chargeQ', label: '极板电荷 q(t)', unit: 'C', color: '#38bdf8' },
    { key: 'currentI', label: '振荡电流 i(t)', unit: 'A', color: '#f472b6' },
    { key: 'energyElectricJ', label: '电场能 E_E', unit: 'J', color: '#fbbf24' },
    { key: 'energyMagneticJ', label: '磁场能 E_B', unit: 'J', color: '#4ade80' }
  ],
  getControlHandles: (_s, params) => [
    {
      id: 'drive-omega',
      label: `ω=${params.driveOmega.toFixed(1)}`,
      position: { x: (params.driveOmega - 6) * 0.2, y: -0.9 },
      handleKind: 'point',
      color: '#fbbf24',
      onDrag: (wp) => ({ driveOmega: Number(Math.max(1, Math.min(15, 6 + wp.x * 5)).toFixed(1)) })
    }
  ],
  sceneSerializer: {
    exportScene: (_s, params) => ({
      schemaVersion: '2.0',
      modelId: 'em-lc-rlc-oscillation',
      title: 'LC 振荡与 RLC 谐振',
      params
    }),
    importScene: (dsl) => dsl.params as Partial<LcRlcParams>
  },
  exportDiagramIR: (state, params) => {
    const primitives: DiagramPrimitive[] = [
      { kind: 'circuitElement', element: 'capacitor', x1: -1.4, y1: -0.6, x2: -1.4, y2: 0.6, label: `C=${params.capacitanceF}` },
      { kind: 'circuitElement', element: 'resistor', x1: 1.4, y1: -0.6, x2: 1.4, y2: 0.6, label: `L=${params.inductanceH}` },
      { kind: 'line', x1: -1.4, y1: 0.6, x2: 1.4, y2: 0.6 },
      { kind: 'line', x1: -1.4, y1: -0.6, x2: 1.4, y2: -0.6 },
      {
        kind: 'mathLabel',
        x: 0,
        y: 1.1,
        text: `q=${state.chargeQ.toFixed(2)}\\text{C},\\; i=${state.currentI.toFixed(2)}\\text{A}`,
        align: 'middle'
      }
    ];
    return {
      width: 680,
      height: 360,
      viewBox: { minX: -2.2, minY: -1.2, maxX: 2.2, maxY: 1.4 },
      title: 'LC 电磁振荡原理配图',
      primitives
    };
  },
  renderCanvas: (ctx, state, params, viewport, activeLayers) => {
    const m = createWorldMapper(viewport);
    const labels: CanvasLabel[] = [];
    const line = (worldPoints: Array<{ x: number; y: number }>, color: string, width: number) => {
      if (worldPoints.length < 2) return;
      const points = worldPoints.map((point) => m.toScreen(point.x, point.y));
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(points[0]!.x, points[0]!.y);
      for (const point of points.slice(1)) ctx.lineTo(point.x, point.y);
      ctx.stroke();
    };
    const fillWorldRect = (x: number, y: number, width: number, height: number) => {
      const a = m.toScreen(x, y + height);
      const b = m.toScreen(x + width, y);
      ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    };
    ctx.save();

    if (activeLayers.has('circuit')) {
      const corners = [
        m.toScreen(-1.95, 0.65), m.toScreen(-0.45, 0.65),
        m.toScreen(-0.45, -0.65), m.toScreen(-1.95, -0.65),
        m.toScreen(-1.95, 0.65)
      ];
      drawRoundedPotentialPath(ctx, corners, '#38bdf8', '#4ade80', m.len(0.12), 3);

      // Capacitor plate charge and inductor current remain in the circuit world frame.
      const qRatio = Math.max(-1, Math.min(1, state.chargeQ / Math.max(0.05, params.initialChargeC)));
      ctx.fillStyle = qRatio >= 0 ? '#f43f5e' : '#38bdf8';
      fillWorldRect(-2.1, -0.06, 0.3, 0.035);
      ctx.fillStyle = qRatio >= 0 ? '#38bdf8' : '#f43f5e';
      fillWorldRect(-2.1, 0.04, 0.3, 0.035);

      const iMag = Math.min(1, Math.abs(state.currentI) / 2.5);
      ctx.fillStyle = `rgba(74, 222, 128, ${0.2 + 0.7 * iMag})`;
      fillWorldRect(-0.58, -0.34, 0.26, 0.68);
      ctx.strokeStyle = '#4ade80';
      const coilA = m.toScreen(-0.58, 0.34);
      const coilB = m.toScreen(-0.32, -0.34);
      ctx.strokeRect(Math.min(coilA.x, coilB.x), Math.min(coilA.y, coilB.y), Math.abs(coilB.x - coilA.x), Math.abs(coilB.y - coilA.y));
      const qLabel = m.toScreen(-1.35, -0.82);
      const iLabel = m.toScreen(-0.35, -0.82);
      labels.push(
        { id: 'lc-charge', x: qLabel.x, y: qLabel.y, text: `q=${state.chargeQ.toFixed(3)} C`, color: '#e2e8f0', font: '12px sans-serif' },
        { id: 'lc-current', x: iLabel.x, y: iLabel.y, text: `i=${state.currentI.toFixed(2)} A`, color: '#e2e8f0', font: '12px sans-serif' }
      );
    }

    if (activeLayers.has('energyBars')) {
      const maxE = Math.max(0.1, state.initialEnergyJ, state.energyElectricJ + state.energyMagneticJ);
      const barMaxH = 0.85;
      const hE = (state.energyElectricJ / maxE) * barMaxH;
      const hB = (state.energyMagneticJ / maxE) * barMaxH;

      ctx.fillStyle = '#fbbf24';
      fillWorldRect(0.12, -0.45, 0.3, hE);
      ctx.fillStyle = '#4ade80';
      fillWorldRect(0.62, -0.45, 0.3, hB);
      const electric = m.toScreen(0.27, -0.62);
      const magnetic = m.toScreen(0.77, -0.62);
      labels.push(
        { id: 'lc-electric-energy', x: electric.x, y: electric.y, text: `E_E=${state.energyElectricJ.toFixed(2)}J`, color: '#fbbf24', font: '11px sans-serif' },
        { id: 'lc-magnetic-energy', x: magnetic.x, y: magnetic.y, text: `E_B=${state.energyMagneticJ.toFixed(2)}J`, color: '#4ade80', font: '11px sans-serif' }
      );
    }

    if (activeLayers.has('phasorPlot')) {
      const imp = computeImpedanceSummary(params);
      const center = m.toScreen(1.72, 0.12);
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      const axisLeft = m.toScreen(1.25, 0.12);
      const axisRight = m.toScreen(2.15, 0.12);
      const axisTop = m.toScreen(1.72, 0.82);
      const axisBottom = m.toScreen(1.72, -0.62);
      ctx.moveTo(axisLeft.x, axisLeft.y);
      ctx.lineTo(axisRight.x, axisRight.y);
      ctx.moveTo(axisTop.x, axisTop.y);
      ctx.lineTo(axisBottom.x, axisBottom.y);
      ctx.stroke();

      const scale = 0.14;
      drawGlowVectorArrow(ctx, center.x, center.y, m.toScreen(1.72 + params.resistanceR * scale, 0.12).x, center.y, '#38bdf8', 3, 10);
      const inductive = m.toScreen(1.72, 0.12 + Math.min(0.7, imp.xl * scale));
      const capacitive = m.toScreen(1.72, 0.12 - Math.min(0.7, imp.xc * scale));
      drawGlowVectorArrow(ctx, center.x, center.y, inductive.x, inductive.y, '#4ade80', 3, 10);
      drawGlowVectorArrow(ctx, center.x, center.y, capacitive.x, capacitive.y, '#f472b6', 3, 10);
      labels.push({ id: 'lc-phasor-summary', x: center.x, y: m.toScreen(1.72, -0.72).y, text: `XL=${imp.xl.toFixed(2)}Ω | XC=${imp.xc.toFixed(2)}Ω | |Z|=${imp.zMag.toFixed(2)}Ω`, color: '#cbd5e1', font: '11px sans-serif' });
    }

    const railA = m.toScreen(-1, -0.9);
    const railB = m.toScreen(1.8, -0.9);
    ctx.strokeStyle = 'rgba(251,191,36,0.4)';
    ctx.lineWidth = m.len(0.08);
    ctx.beginPath();
    ctx.moveTo(railA.x, railA.y);
    ctx.lineTo(railB.x, railB.y);
    ctx.stroke();
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(railA.x, railA.y);
    ctx.lineTo(railB.x, railB.y);
    ctx.stroke();
    labels.push({ id: 'lc-drive-frequency', x: m.toScreen(0.4, -1.12).x, y: m.toScreen(0.4, -1.12).y, text: `驱动频率 ω=${params.driveOmega.toFixed(1)} rad/s`, color: '#fbbf24', font: 'bold 12px sans-serif' });
    resolveAndDrawLabels(ctx, labels, viewport.width, viewport.height);
    ctx.restore();
  },
  formatFormulas: (state, params) => {
    const w0 = computeLcNaturalOmega(params);
    const t0 = (2 * Math.PI) / w0;
    return [
      {
        id: 'lc-period',
        label: 'LC 振荡固有周期与能量转换',
        latex: 'T = 2\\pi\\sqrt{LC},\\quad E_{\\text{总}} = \\frac{q^2}{2C} + \\frac{1}{2}Li^2',
        substitutedLatex: `T_0=${t0.toFixed(4)}\\text{ s},\\; E_E=${state.energyElectricJ.toFixed(3)}\\text{ J},\\; E_B=${state.energyMagneticJ.toFixed(3)}\\text{ J}`
      }
    ];
  }
});

export default emLcRlcOscillationPlugin;
