import { defineSimulationPlugin, type DiagramPrimitive, type ParamFieldSpec } from '@physforge/sim-sdk';
import { electricalErrorPresets } from './presets.js';
import {
  checkInvariants,
  computeObservables,
  createInitialState,
  stepElectricalErrorLab,
  type ElectricalErrorParams,
  type ElectricalErrorState
} from './engine.js';

const CALIPER_ZERO_X = -1.0;
const CALIPER_RULER_Y = 0.85;
const CALIPER_MM_WORLD = 0.04;
const MICROMETER_ZERO_X = -0.8;
const MICROMETER_RULER_Y = -0.65;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

const paramSchema: readonly ParamFieldSpec<ElectricalErrorParams>[] = [
  {
    key: 'mode',
    kind: 'select',
    label: '电学实验模块',
    defaultValue: 'emf-inner-outer',
    options: [
      { value: 'emf-inner-outer', label: '测电源 E,r 内外接系统误差 (MNA)' },
      { value: 'bulb-iv-curve', label: '小灯泡非线性 I-U（分压/限流）' },
      { value: 'half-bias-rg', label: '半偏法测电流表内阻 R_g' },
      { value: 'caliper-micrometer', label: '游标卡尺与螺旋测微器读数' }
    ]
  },
  {
    key: 'emfWiring',
    kind: 'select',
    label: '测 E,r 电表接法',
    defaultValue: 'voltmeter-across-source',
    options: [
      { value: 'voltmeter-across-source', label: '电压表并接电源（E_测<E, r_测<r）' },
      { value: 'ammeter-in-series', label: '电流表串接电源（E_测=E, r_测=r+R_A）' }
    ]
  },
  { key: 'emfVolts', kind: 'number', label: '电源真电动势 E', unit: 'V', defaultValue: 3.0, min: 1.5, max: 9.0, step: 0.5 },
  { key: 'rInternalOhm', kind: 'number', label: '电源真内阻 r', unit: 'Ω', defaultValue: 1.5, min: 0.2, max: 4.0, step: 0.2 },
  { key: 'rAmmeterOhm', kind: 'number', label: '电流表内阻 R_A', unit: 'Ω', defaultValue: 0.4, min: 0.05, max: 2.0, step: 0.1 },
  { key: 'rVoltmeterOhm', kind: 'number', label: '电压表内阻 R_V', unit: 'Ω', defaultValue: 150, min: 20, max: 3000, step: 50 },
  {
    key: 'bulbWiring',
    kind: 'select',
    label: '滑动变阻器接法',
    defaultValue: 'voltage-divider',
    options: [
      { value: 'voltage-divider', label: '分压式（电压从 0 起连续可调）' },
      { value: 'current-limit', label: '限流式（存在最小底压）' }
    ]
  },
  { key: 'rheostatMaxOhm', kind: 'number', label: '变阻器总阻值 R_p', unit: 'Ω', defaultValue: 20, min: 5, max: 100, step: 5 },
  { key: 'rheostatTapFrac', kind: 'number', label: '滑片比例', defaultValue: 0.5, min: 0.05, max: 1.0, step: 0.05 },
  { key: 'rgTrueOhm', kind: 'number', label: '表头真内阻 R_g', unit: 'Ω', defaultValue: 100, min: 20, max: 300, step: 10 },
  { key: 'halfBiasSupplyV', kind: 'number', label: '半偏法电源 E', unit: 'V', defaultValue: 6.0, min: 1.5, max: 12.0, step: 1.5 },
  { key: 'targetVernierMm', kind: 'number', label: '卡尺示数设定', unit: 'mm', defaultValue: 23.46, min: 0, max: 50, step: 0.02 },
  {
    key: 'vernierDivisions',
    kind: 'select',
    label: '游标分度',
    defaultValue: '50',
    options: [
      { value: '10', label: '10 分度 (0.1 mm)' },
      { value: '20', label: '20 分度 (0.05 mm)' },
      { value: '50', label: '50 分度 (0.02 mm)' }
    ]
  },
  { key: 'targetMicrometerMm', kind: 'number', label: '千分尺示数设定', unit: 'mm', defaultValue: 5.73, min: 0, max: 20, step: 0.01 }
];

export const expElectricalErrorLabPlugin = defineSimulationPlugin<ElectricalErrorParams, ElectricalErrorState>({
  meta: {
    id: 'exp-electrical-error-lab',
    title: '电学核心实验真误差与精密读数台 (X02)',
    textbookRef: '人教版 必修第三册 第十一、十二章 · 非理想电表误差与读数',
    curriculumTags: ['科学探究', '科学思维', '物理观念'],
    difficulty: '高三一轮',
    version: '2.0.0'
  },
  paramSchema,
  presets: electricalErrorPresets,
  engine: {
    createInitialState,
    step: stepElectricalErrorLab,
    computeObservables,
    checkInvariants
  },
  layers: [
    { id: 'main', label: 'MNA 误差曲线 / 刻度尺视图', defaultVisible: true }
  ],
  telemetryChannels: [
    { key: 'eFittedV', label: '拟合电动势 E_测', unit: 'V', color: '#38bdf8' },
    { key: 'rFittedOhm', label: '拟合内阻 r_测', unit: 'Ω', color: '#fbbf24' },
    { key: 'rgMeasuredOhm', label: '半偏法测得 R_g', unit: 'Ω', color: '#4ade80' },
    { key: 'vernierReadoutMm', label: '游标卡尺读数', unit: 'mm', color: '#a855f7' }
  ],
  getControlHandles: (_state, params) => {
    if (params.mode !== 'caliper-micrometer') return [];
    const divisions = Number(params.vernierDivisions) || 50;
    const vernierStep = 1 / divisions;
    return [
      {
        id: 'vernier-jaw',
        label: `${params.targetVernierMm.toFixed(2)}mm`,
        position: {
          x: CALIPER_ZERO_X + params.targetVernierMm * CALIPER_MM_WORLD,
          y: CALIPER_RULER_Y
        },
        handleKind: 'point',
        color: '#a855f7',
        onDrag: (worldPos) => {
          const rawMm = clamp((worldPos.x - CALIPER_ZERO_X) / CALIPER_MM_WORLD, 0, 50);
          const snappedMm = Math.round(rawMm / vernierStep) * vernierStep;
          return { targetVernierMm: Number(snappedMm.toFixed(3)) };
        }
      },
      {
        id: 'micrometer-thimble',
        label: `${params.targetMicrometerMm.toFixed(2)}mm`,
        position: {
          x: MICROMETER_ZERO_X + params.targetMicrometerMm * CALIPER_MM_WORLD,
          y: MICROMETER_RULER_Y
        },
        handleKind: 'point',
        color: '#38bdf8',
        onDrag: (worldPos) => {
          const rawMm = clamp((worldPos.x - MICROMETER_ZERO_X) / CALIPER_MM_WORLD, 0, 20);
          return { targetMicrometerMm: Number((Math.round(rawMm / 0.01) * 0.01).toFixed(2)) };
        }
      }
    ];
  },
  sceneSerializer: {
    exportScene: (_s, params) => ({
      schemaVersion: '2.0',
      modelId: 'exp-electrical-error-lab',
      title: '电学核心实验真误差仿真台',
      params
    }),
    importScene: (dsl) => dsl.params as Partial<ElectricalErrorParams>
  },
  exportDiagramIR: (state, params) => {
    const primitives: DiagramPrimitive[] = [
      { kind: 'circuitElement', element: 'battery', x1: -1.6, y1: -0.6, x2: -1.6, y2: 0.6, label: `E=${params.emfVolts}V` },
      { kind: 'circuitElement', element: 'ammeter', x1: -1.6, y1: 0.6, x2: 0, y2: 0.6, label: 'A' },
      { kind: 'circuitElement', element: 'resistor', x1: 0, y1: 0.6, x2: 1.6, y2: 0.6, label: 'R_L' },
      { kind: 'circuitElement', element: 'voltmeter', x1: -0.4, y1: 0.6, x2: -0.4, y2: -0.6, label: 'V' },
      { kind: 'line', x1: 1.6, y1: 0.6, x2: 1.6, y2: -0.6 },
      { kind: 'line', x1: -1.6, y1: -0.6, x2: 1.6, y2: -0.6 }
    ];
    return {
      width: 680,
      height: 400,
      viewBox: { minX: -2.2, minY: -1.4, maxX: 2.2, maxY: 1.4 },
      title: `电学实验误差电路与读数 (${params.mode}, E测=${state.emfSummary.eFittedV.toFixed(2)}V)`,
      primitives
    };
  },
  renderCanvas: (ctx, state, params, viewport, activeLayers) => {
    const w = viewport.width;
    const h = viewport.height;
    if (!activeLayers.has('main')) return;
    ctx.save();

    if (params.mode === 'caliper-micrometer') {
      const ppm = Math.min(w, h) * 0.24 * viewport.scale;
      const anchorX = w * 0.45 + viewport.offsetX;
      const anchorY = h * 0.5 + viewport.offsetY;
      const toScreen = (x: number, y: number) => ({ x: anchorX + x * ppm, y: anchorY - y * ppm });
      const jawX = CALIPER_ZERO_X + state.instrument.vernierReadoutMm * CALIPER_MM_WORLD;
      const thimbleX = MICROMETER_ZERO_X + state.instrument.microReadoutMm * CALIPER_MM_WORLD;

      // Main scale and sliding vernier jaw.
      ctx.fillStyle = '#e2e8f0';
      const mainStart = toScreen(CALIPER_ZERO_X - 0.15, CALIPER_RULER_Y + 0.12);
      const mainEnd = toScreen(CALIPER_ZERO_X + 2.15, CALIPER_RULER_Y - 0.16);
      ctx.fillRect(mainStart.x, mainStart.y, mainEnd.x - mainStart.x, mainEnd.y - mainStart.y);
      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 12px ui-sans-serif, system-ui';
      const jawTop = toScreen(jawX, CALIPER_RULER_Y + 0.12);
      const jawBottom = toScreen(jawX, CALIPER_RULER_Y - 0.22);
      ctx.strokeStyle = '#7c3aed';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(jawTop.x, jawTop.y);
      ctx.lineTo(jawBottom.x, jawBottom.y);
      ctx.stroke();
      ctx.fillText(`主尺整毫米 = ${state.instrument.vernierMainMm} mm | 第 ${state.instrument.vernierCoincidentIndex} 格对齐`, mainStart.x, mainStart.y - 8);
      for (let mm = 0; mm <= 50; mm++) {
        const tick = toScreen(CALIPER_ZERO_X + mm * CALIPER_MM_WORLD, CALIPER_RULER_Y);
        const tickEnd = toScreen(CALIPER_ZERO_X + mm * CALIPER_MM_WORLD, CALIPER_RULER_Y - (mm % 10 === 0 ? 0.16 : 0.08));
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = mm % 10 === 0 ? 1.6 : 0.8;
        ctx.beginPath();
        ctx.moveTo(tick.x, tick.y);
        ctx.lineTo(tickEnd.x, tickEnd.y);
        ctx.stroke();
        if (mm % 10 === 0) ctx.fillText(String(mm), tick.x - 4, tick.y + 17);
      }

      // Micrometer sleeve and thimble use the same millimeter scale.
      ctx.fillStyle = '#cbd5e1';
      const sleeveStart = toScreen(MICROMETER_ZERO_X - 0.1, MICROMETER_RULER_Y + 0.16);
      const sleeveEnd = toScreen(MICROMETER_ZERO_X + 1.05, MICROMETER_RULER_Y - 0.16);
      ctx.fillRect(sleeveStart.x, sleeveStart.y, sleeveEnd.x - sleeveStart.x, sleeveEnd.y - sleeveStart.y);
      ctx.fillStyle = '#94a3b8';
      const thimbleTop = toScreen(thimbleX - 0.08, MICROMETER_RULER_Y + 0.28);
      const thimbleBottom = toScreen(thimbleX + 0.12, MICROMETER_RULER_Y - 0.28);
      ctx.fillRect(thimbleTop.x, thimbleTop.y, thimbleBottom.x - thimbleTop.x, thimbleBottom.y - thimbleTop.y);
      ctx.fillStyle = '#0f172a';
      ctx.fillText(
        `固定刻度 ${state.instrument.microFixedHalfMmCount * 0.5} mm + 可动 ${state.instrument.microThimbleDiv}×0.01 = ${state.instrument.microReadoutMm.toFixed(2)} mm`,
        sleeveStart.x,
        sleeveStart.y - 8
      );

      ctx.fillStyle = '#e2e8f0';
      ctx.font = 'bold 14px ui-sans-serif, system-ui';
      ctx.fillText(
        `${params.vernierDivisions} 分度游标卡尺 = ${state.instrument.vernierReadoutMm.toFixed(2)} mm | 千分尺 = ${state.instrument.microReadoutMm.toFixed(2)} mm`,
        20,
        30
      );
      ctx.restore();
      return;
    }

    const gx = w * 0.15;
    const gy = h * 0.82;
    const gw = w * 0.75;
    const gh = h * 0.58;
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(gx, gy - gh);
    ctx.lineTo(gx, gy);
    ctx.lineTo(gx + gw, gy);
    ctx.stroke();

    if (params.mode === 'bulb-iv-curve') {
      const pts = state.bulbCurve;
      const maxU = Math.max(1, params.emfVolts);
      const maxI = Math.max(0.2, ...pts.map((p) => p.currentA));
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 2.8;
      ctx.beginPath();
      pts.forEach((p, idx) => {
        const sx = gx + (p.voltageV / maxU) * gw;
        const sy = gy - (p.currentA / maxI) * gh;
        if (idx === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      });
      ctx.stroke();
      ctx.fillStyle = '#e2e8f0';
      ctx.font = 'bold 13px ui-sans-serif, system-ui';
      ctx.fillText(`小灯泡 I-U 曲线（${params.bulbWiring === 'voltage-divider' ? '分压从 0V 起调' : '限流起始压降 ' + pts[0]!.voltageV.toFixed(2) + 'V'}）`, 20, 30);
      ctx.restore();
      return;
    }

    // U-I line for Emf or Half-bias bar comparison
    if (params.mode === 'emf-inner-outer') {
      const pts = state.emfSummary.uiCurve;
      const maxI = Math.max(0.5, ...pts.map((p) => p.currentA)) * 1.15;
      const maxU = Math.max(1, params.emfVolts) * 1.1;
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      pts.forEach((p, idx) => {
        const sx = gx + (p.currentA / maxI) * gw;
        const sy = gy - (p.voltageV / maxU) * gh;
        if (idx === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      });
      ctx.stroke();
      ctx.fillStyle = '#e2e8f0';
      ctx.font = 'bold 13px ui-sans-serif, system-ui';
      ctx.fillText(
        `真值 E=${params.emfVolts.toFixed(2)}V, r=${params.rInternalOhm.toFixed(2)}Ω | MNA 拟合 E测=${state.emfSummary.eFittedV.toFixed(4)}V, r测=${state.emfSummary.rFittedOhm.toFixed(4)}Ω`,
        20,
        30
      );
      ctx.restore();
      return;
    }

    // Half-bias comparison bars
    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(gx + 60, gy - 160, 80, 160);
    ctx.fillStyle = '#4ade80';
    ctx.fillRect(gx + 220, gy - 160 * (state.halfBias.rgMeasuredOhm / state.halfBias.rgTrueOhm), 80, 160 * (state.halfBias.rgMeasuredOhm / state.halfBias.rgTrueOhm));
    ctx.fillStyle = '#e2e8f0';
    ctx.font = 'bold 13px ui-sans-serif, system-ui';
    ctx.fillText(
      `半偏法 R_g真=${state.halfBias.rgTrueOhm.toFixed(1)}Ω vs MNA 测得 R₂=${state.halfBias.rgMeasuredOhm.toFixed(3)}Ω (偏小 ${(state.halfBias.biasRelativeErr * 100).toFixed(2)}%)`,
      20,
      30
    );
    ctx.restore();
  },
  formatFormulas: (state, params) => [
    {
      id: 'electrical-error-mna',
      label: params.mode === 'half-bias-rg' ? '半偏法系统偏小关系' : '非理想电表对 E, r 测量影响',
      latex:
        params.mode === 'half-bias-rg'
          ? 'R_{g,\\text{测}} = R_2 < R_{g,\\text{真}}'
          : 'E_{\\text{测}}=\\frac{R_V}{R_V+r}E,\\quad r_{\\text{测}}=\\frac{r R_V}{r+R_V}',
      substitutedLatex: `E_{\\text{测}}=${state.emfSummary.eFittedV.toFixed(4)}\\text{ V},\\; r_{\\text{测}}=${state.emfSummary.rFittedOhm.toFixed(4)}\\ \\Omega,\\; R_{g,\\text{测}}=${state.halfBias.rgMeasuredOhm.toFixed(3)}\\ \\Omega`
    }
  ]
});

export default expElectricalErrorLabPlugin;
