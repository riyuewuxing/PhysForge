import { defineSimulationPlugin, type DiagramPrimitive, type ParamFieldSpec } from '@physforge/sim-sdk';
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
    const w = viewport.width;
    const h = viewport.height;
    ctx.save();

    if (activeLayers.has('circuit')) {
      const cx = w * 0.25;
      const cy = h * 0.5;
      // LC loop rectangle
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 3;
      ctx.strokeRect(cx - 90, cy - 75, 180, 150);

      // Capacitor plate glow proportional to q
      const qRatio = Math.max(-1, Math.min(1, state.chargeQ / Math.max(0.05, params.initialChargeC)));
      ctx.fillStyle = qRatio >= 0 ? '#f43f5e' : '#38bdf8';
      ctx.fillRect(cx - 110, cy - 16, 40, 6);
      ctx.fillStyle = qRatio >= 0 ? '#38bdf8' : '#f43f5e';
      ctx.fillRect(cx - 110, cy + 10, 40, 6);

      // Inductor core glow proportional to i
      const iMag = Math.min(1, Math.abs(state.currentI) / 2.5);
      ctx.fillStyle = `rgba(74, 222, 128, ${0.2 + 0.7 * iMag})`;
      ctx.fillRect(cx + 76, cy - 35, 28, 70);
      ctx.strokeStyle = '#4ade80';
      ctx.strokeRect(cx + 76, cy - 35, 28, 70);

      ctx.fillStyle = '#e2e8f0';
      ctx.font = '12px sans-serif';
      ctx.fillText(`q = ${state.chargeQ.toFixed(3)} C`, cx - 120, cy + 100);
      ctx.fillText(`i = ${state.currentI.toFixed(2)} A`, cx + 45, cy + 100);
    }

    if (activeLayers.has('energyBars')) {
      const bx = w * 0.52;
      const by = h * 0.75;
      const maxE = Math.max(0.1, state.initialEnergyJ, state.energyElectricJ + state.energyMagneticJ);
      const barMaxH = 150;
      const hE = (state.energyElectricJ / maxE) * barMaxH;
      const hB = (state.energyMagneticJ / maxE) * barMaxH;

      ctx.fillStyle = '#fbbf24';
      ctx.fillRect(bx, by - hE, 44, hE);
      ctx.fillStyle = '#4ade80';
      ctx.fillRect(bx + 68, by - hB, 44, hB);
      ctx.fillStyle = '#e2e8f0';
      ctx.font = '12px sans-serif';
      ctx.fillText(`E_E=${state.energyElectricJ.toFixed(2)}J`, bx - 6, by + 20);
      ctx.fillText(`E_B=${state.energyMagneticJ.toFixed(2)}J`, bx + 62, by + 20);
    }

    if (activeLayers.has('phasorPlot')) {
      const imp = computeImpedanceSummary(params);
      const px = w * 0.8;
      const py = h * 0.45;
      const sc = 18;
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(px - 60, py);
      ctx.lineTo(px + 90, py);
      ctx.moveTo(px, py - 85);
      ctx.lineTo(px, py + 85);
      ctx.stroke();

      // R, XL, XC phasors
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + params.resistanceR * sc, py);
      ctx.stroke();

      ctx.strokeStyle = '#4ade80';
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px, py - Math.min(75, imp.xl * sc));
      ctx.stroke();

      ctx.strokeStyle = '#f472b6';
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px, py + Math.min(75, imp.xc * sc));
      ctx.stroke();

      ctx.fillStyle = '#cbd5e1';
      ctx.font = '11px sans-serif';
      ctx.fillText(`XL=${imp.xl.toFixed(2)}Ω | XC=${imp.xc.toFixed(2)}Ω | |Z|=${imp.zMag.toFixed(2)}Ω`, px - 75, py + 102);
    }

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
