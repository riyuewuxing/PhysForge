import { createWorldMapper, defineSimulationPlugin, resolveAndDrawLabels, type CanvasLabel, type DiagramPrimitive, type ForceVectorItem, type ParamFieldSpec } from '@physforge/sim-sdk';
import { acGeneratorPresets } from './presets.js';
import {
  checkInvariants,
  computeObservables,
  createInitialState,
  evalWaveformVoltage,
  stepAcGeneratorRms,
  type AcGeneratorParams,
  type AcGeneratorState
} from './engine.js';

const paramSchema: readonly ParamFieldSpec<AcGeneratorParams>[] = [
  {
    key: 'waveform',
    kind: 'select',
    label: '波形类型',
    defaultValue: 'sine',
    options: [
      { value: 'sine', label: '标准正弦交流电 (Um/√2)' },
      { value: 'half-wave', label: '半波整流波 (Um/2)' },
      { value: 'full-wave', label: '全波整流波 (Um/√2)' },
      { value: 'duty-square', label: '占空比方波 (Um√D)' },
      { value: 'sawtooth', label: '锯齿波 (Um/√3)' },
      { value: 'dc-plus-sine', label: '直流偏置叠加正弦波' }
    ]
  },
  { key: 'turnsN', kind: 'number', label: '线圈匝数 N', unit: '匝', min: 1, max: 30, step: 1, defaultValue: 10 },
  { key: 'magneticB', kind: 'number', label: '磁感应强度 B', unit: 'T', min: 0, max: 2, step: 0.1, defaultValue: 0.5 },
  { key: 'coilAreaS', kind: 'number', label: '线圈面积 S', unit: 'm²', min: 0.05, max: 0.5, step: 0.05, defaultValue: 0.2 },
  { key: 'freqHz', kind: 'number', label: '旋转频率 f', unit: 'Hz', min: 0.5, max: 5, step: 0.5, defaultValue: 2 },
  { key: 'loadR', kind: 'number', label: '等效负载电阻 R', unit: 'Ω', min: 2, max: 30, step: 2, defaultValue: 10 },
  { key: 'dutyCycleD', kind: 'number', label: '方波占空比 D', unit: '', min: 0.1, max: 1, step: 0.05, defaultValue: 0.5 },
  { key: 'dcOffsetV', kind: 'number', label: '直流偏置电压 Udc', unit: 'V', min: 0, max: 20, step: 2, defaultValue: 0 }
];

export const emAcGeneratorRmsPlugin = defineSimulationPlugin<AcGeneratorParams, AcGeneratorState>({
  meta: {
    id: 'em-ac-generator-rms',
    title: '交流电产生与有效值削峰填谷推导 (E07)',
    textbookRef: '人教版 选择性必修二 第三章 第1–2节',
    curriculumTags: ['物理观念', '科学思维', '科学探究'],
    difficulty: '高三一轮',
    version: '2.0.0'
  },
  paramSchema,
  presets: acGeneratorPresets,
  engine: {
    createInitialState,
    step: stepAcGeneratorRms,
    computeObservables,
    checkInvariants
  },
  getForceVectors: (state, params): ForceVectorItem[] => {
    const current = state.uInstV / Math.max(0.1, params.loadR);
    const effectiveSideLengthM = Math.sqrt(Math.max(1e-9, params.coilAreaS));
    const sideForceN = params.turnsN * params.magneticB * current * effectiveSideLengthM * Math.sin(state.angleRad);
    const projectedHalfWidth = 0.48 * Math.cos(state.angleRad);
    const tiltY = 0.12 * Math.sin(state.angleRad);
    return [
      {
        id: 'ampere-force-a', label: 'F_A (l=√S)', origin: { x: -1.19 - projectedHalfWidth, y: 0.42 + tiltY },
        force: { x: 0, y: -sideForceN }, color: '#f472b6', category: 'magnetic', unit: 'N'
      },
      {
        id: 'ampere-force-b', label: 'F_B (l=√S)', origin: { x: -1.19 + projectedHalfWidth, y: 0.42 - tiltY },
        force: { x: 0, y: sideForceN }, color: '#38bdf8', category: 'magnetic', unit: 'N'
      }
    ];
  },
  referenceFrames: [
    {
      id: 'coil-frame',
      label: '线圈中心参考系（平动原点）',
      getOrigin: () => ({ x: -1.19, y: 0 }),
      getVelocity: () => ({ x: 0, y: 0 })
    }
  ],
  layers: [
    { id: 'coil3d', label: '2.5D 旋转线框与中性面提示', defaultVisible: true },
    { id: 'powerFill', label: '瞬时功率 p(t) 削峰填谷对照', defaultVisible: true }
  ],
  telemetryChannels: [
    { key: 'uInstV', label: '瞬时电动势/电压 u(t)', unit: 'V', color: '#38bdf8' },
    { key: 'uRmsV', label: '等效有效值 Urms', unit: 'V', color: '#fbbf24' },
    { key: 'fluxWb', label: '磁通量 Φ(t)', unit: 'Wb', color: '#4ade80' },
    { key: 'pInstW', label: '瞬时热功率 p(t)', unit: 'W', color: '#f472b6' }
  ],
  getControlHandles: (_s, params) => [
    {
      id: 'duty-cycle',
      label: `D=${(params.dutyCycleD * 100).toFixed(0)}%`,
      position: { x: params.dutyCycleD * 2 - 1, y: -0.9 },
      handleKind: 'point',
      color: '#fbbf24',
      onDrag: (wp) => ({ dutyCycleD: Number(Math.max(0.1, Math.min(1, (wp.x + 1) / 2)).toFixed(2)) })
    }
  ],
  sceneSerializer: {
    exportScene: (_s, params) => ({
      schemaVersion: '2.0',
      modelId: 'em-ac-generator-rms',
      title: '交流电与有效值推导',
      params
    }),
    importScene: (dsl) => dsl.params as Partial<AcGeneratorParams>
  },
  exportDiagramIR: (state) => {
    const pts = [];
    for (let i = 0; i <= 40; i++) {
      const f = i / 40;
      pts.push({ x: -2 + 4 * f, y: Math.sin(2 * Math.PI * f) });
    }
    const primitives: DiagramPrimitive[] = [
      { kind: 'line', x1: -2.2, y1: 0, x2: 2.2, y2: 0 },
      { kind: 'polyline', points: pts },
      {
        kind: 'mathLabel',
        x: 2.0,
        y: 1.15,
        text: `U_m=${state.uPeakV.toFixed(1)}\\text{V},\\; U_{\\text{rms}}=${state.uRmsV.toFixed(2)}\\text{V}`,
        align: 'end'
      }
    ];
    return {
      width: 680,
      height: 360,
      viewBox: { minX: -2.4, minY: -1.4, maxX: 2.4, maxY: 1.4 },
      title: '交流电有效值波形配图',
      primitives
    };
  },
  renderCanvas: (ctx, state, params, viewport, activeLayers) => {
    const m = createWorldMapper(viewport);
    const labels: CanvasLabel[] = [];
    const fillWorldRect = (x: number, y: number, width: number, height: number) => {
      const a = m.toScreen(x, y + height);
      const b = m.toScreen(x + width, y);
      ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    };
    const line = (points: Array<{ x: number; y: number }>, close = false) => {
      if (points.length === 0) return;
      const first = m.toScreen(points[0]!.x, points[0]!.y);
      ctx.beginPath();
      ctx.moveTo(first.x, first.y);
      for (let i = 1; i < points.length; i++) {
        const point = m.toScreen(points[i]!.x, points[i]!.y);
        ctx.lineTo(point.x, point.y);
      }
      if (close) ctx.closePath();
    };
    ctx.save();

    if (activeLayers.has('coil3d')) {
      // Magnetic poles and rotating coil occupy the left world-space panel.
      ctx.fillStyle = 'rgba(244, 63, 94, 0.25)';
      fillWorldRect(-1.85, -0.62, 0.28, 1.24);
      ctx.fillStyle = 'rgba(56, 189, 248, 0.25)';
      fillWorldRect(-0.53, -0.62, 0.28, 1.24);
      labels.push(
        { id: 'generator-pole-n', x: m.toScreen(-1.71, 0).x, y: m.toScreen(-1.71, 0).y, text: 'N', color: '#e2e8f0', font: 'bold 16px sans-serif' },
        { id: 'generator-pole-s', x: m.toScreen(-0.39, 0).x, y: m.toScreen(-0.39, 0).y, text: 'S', color: '#e2e8f0', font: 'bold 16px sans-serif' }
      );

      const projW = 0.48 * Math.cos(state.angleRad);
      const tiltY = 0.12 * Math.sin(state.angleRad);
      ctx.strokeStyle = state.atNeutralPlane ? '#fbbf24' : '#38bdf8';
      ctx.lineWidth = 3;
      line([
        { x: -1.19 - projW, y: 0.42 + tiltY },
        { x: -1.19 + projW, y: 0.42 - tiltY },
        { x: -1.19 + projW, y: -0.42 - tiltY },
        { x: -1.19 - projW, y: -0.42 + tiltY }
      ], true);
      ctx.stroke();

      if (state.atNeutralPlane) {
        const label = m.toScreen(-1.18, 0.92);
        labels.push({ id: 'generator-neutral-plane', x: label.x, y: label.y, text: '★ 中性面附近：Φ 最大，e ≈ 0', color: '#fbbf24', font: 'bold 12px sans-serif' });
      }
    }

    if (activeLayers.has('powerFill')) {
      const graphX0 = 0.3;
      const graphWidth = 1.85;
      const voltageCenterY = 0.42;
      const powerBottomY = -0.52;
      const R = Math.max(0.1, params.loadR);
      const uScale = Math.max(1, state.uPeakV + params.dcOffsetV);
      const pMax = Math.max(0.1, (uScale * uScale) / R);

      const pAvgH = (state.pAvgW / pMax) * 0.46;
      ctx.fillStyle = 'rgba(251, 191, 36, 0.16)';
      fillWorldRect(graphX0, powerBottomY, graphWidth, pAvgH);
      ctx.strokeStyle = '#fbbf24';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      const avgLeft = m.toScreen(graphX0, powerBottomY + pAvgH);
      const avgRight = m.toScreen(graphX0 + graphWidth, powerBottomY + pAvgH);
      ctx.moveTo(avgLeft.x, avgLeft.y);
      ctx.lineTo(avgRight.x, avgRight.y);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i <= 120; i++) {
        const f = i / 120;
        const u = evalWaveformVoltage(f, state.uPeakV, params);
        const point = m.toScreen(graphX0 + f * graphWidth, voltageCenterY + (u / uScale) * 0.32);
        if (i === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
      }
      ctx.stroke();

      ctx.strokeStyle = '#f472b6';
      ctx.beginPath();
      for (let i = 0; i <= 120; i++) {
        const f = i / 120;
        const u = evalWaveformVoltage(f, state.uPeakV, params);
        const p = (u * u) / R;
        const point = m.toScreen(graphX0 + f * graphWidth, powerBottomY + (p / pMax) * 0.46);
        if (i === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
      }
      ctx.stroke();

      const voltageLabel = m.toScreen(graphX0 + graphWidth / 2, 0.88);
      const powerLabel = m.toScreen(graphX0 + graphWidth / 2, -0.02);
      labels.push(
        { id: 'generator-voltage-wave', x: voltageLabel.x, y: voltageLabel.y, text: `u(t) 波形 · Urms = ${state.uRmsV.toFixed(2)} V`, color: '#cbd5e1', font: '12px sans-serif' },
        { id: 'generator-power-wave', x: powerLabel.x, y: powerLabel.y, text: `p(t)=u²/R · 虚线 Pavg=${state.pAvgW.toFixed(1)}W`, color: '#cbd5e1', font: '12px sans-serif' }
      );
    }

    const railStart = m.toScreen(-1, -0.9);
    const railEnd = m.toScreen(1, -0.9);
    ctx.save();
    ctx.strokeStyle = 'rgba(251, 191, 36, 0.3)';
    ctx.lineWidth = m.len(0.1);
    ctx.shadowColor = '#fbbf24';
    ctx.shadowBlur = 16;
    ctx.beginPath();
    ctx.moveTo(railStart.x, railStart.y);
    ctx.lineTo(railEnd.x, railEnd.y);
    ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(railStart.x, railStart.y);
    ctx.lineTo(railEnd.x, railEnd.y);
    ctx.stroke();
    for (const duty of [0.1, 0.25, 0.5, 0.75, 1]) {
      const tick = m.toScreen(duty * 2 - 1, -0.9);
      ctx.beginPath();
      ctx.moveTo(tick.x, tick.y - m.len(0.07));
      ctx.lineTo(tick.x, tick.y + m.len(0.07));
      ctx.stroke();
    }

    labels.push({ id: 'generator-duty-rail', x: m.toScreen(0, -1.12).x, y: m.toScreen(0, -1.12).y, text: `占空比 D=${(params.dutyCycleD * 100).toFixed(0)}%`, color: '#fbbf24', font: 'bold 13px sans-serif' });
    resolveAndDrawLabels(ctx, labels, viewport.width, viewport.height);
    ctx.restore();
  },
  formatFormulas: (state) => [
    {
      id: 'ac-rms-eq',
      label: '有效值热量等效与峰值',
      latex: 'E_m = NBS\\omega,\\quad U_{\\text{rms}} = \\sqrt{\\frac{1}{T}\\int_0^T u^2(t)\\,dt}',
      substitutedLatex: `U_m=${state.uPeakV.toFixed(2)}\\text{ V},\\; U_{\\text{rms}}=${state.uRmsV.toFixed(2)}\\text{ V},\\; P_{\\text{avg}}=${state.pAvgW.toFixed(2)}\\text{ W}`
    }
  ]
});

export default emAcGeneratorRmsPlugin;
