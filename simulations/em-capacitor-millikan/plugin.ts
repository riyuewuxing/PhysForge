import { defineSimulationPlugin, type DiagramPrimitive, type ParamFieldSpec } from '@physforge/sim-sdk';
import { capacitorMillikanPresets } from './presets.js';
import {
  checkInvariants,
  computeCapacitorMetrics,
  computeObservables,
  createInitialState,
  stepCapacitorMillikan,
  type CapacitorMillikanParams,
  type CapacitorMillikanState
} from './engine.js';

const paramSchema: readonly ParamFieldSpec<CapacitorMillikanParams>[] = [
  {
    key: 'switchMode',
    kind: 'select',
    label: '电源开关 S',
    defaultValue: 'open-const-q',
    options: [
      { value: 'open-const-q', label: '断开开关（Q 恒定）' },
      { value: 'closed-const-u', label: '闭合开关（U 恒定）' }
    ]
  },
  {
    key: 'groundMode',
    kind: 'select',
    label: '极板接地位置',
    defaultValue: 'bottom',
    options: [
      { value: 'bottom', label: '下极板接地 (φ下=0)' },
      { value: 'top', label: '上极板接地 (φ上=0)' },
      { value: 'none', label: '中心对称电势参考' }
    ]
  },
  { key: 'sourceVoltageU0', kind: 'number', label: '电源电压 U₀', unit: 'V', min: 50, max: 400, step: 10, defaultValue: 200 },
  { key: 'distanceMm', kind: 'number', label: '极板间距 d', unit: 'mm', min: 8, max: 40, step: 1, defaultValue: 20 },
  { key: 'refDistanceMm', kind: 'number', label: '断开前参考间距 d₀', unit: 'mm', min: 8, max: 40, step: 1, defaultValue: 20 },
  { key: 'areaRatioS', kind: 'number', label: '正对面积比 S/S₀', unit: '', min: 0.3, max: 1, step: 0.05, defaultValue: 1 },
  { key: 'refAreaRatioS', kind: 'number', label: '断开前参考面积比', unit: '', min: 0.3, max: 1, step: 0.05, defaultValue: 1 },
  { key: 'dielectricEr', kind: 'number', label: '相对介电常数 εr', unit: '', min: 1, max: 6, step: 0.5, defaultValue: 1 },
  { key: 'refDielectricEr', kind: 'number', label: '断开前参考 εr0', unit: '', min: 1, max: 6, step: 0.5, defaultValue: 1 },
  { key: 'probeFracP', kind: 'number', label: '探针点 P 高度比', unit: '', min: 0.1, max: 0.9, step: 0.05, defaultValue: 0.4 },
  { key: 'oilDropEnabled', kind: 'boolean', label: '开启密立根油滴', defaultValue: false },
  { key: 'dropChargeSteps', kind: 'number', label: '油滴电荷阶数 n·e', unit: 'step', min: 0, max: 5, step: 1, defaultValue: 2 },
  { key: 'dropMassScale', kind: 'number', label: '油滴相对质量 m', unit: '', min: 0.5, max: 2.5, step: 0.1, defaultValue: 1 },
  { key: 'stokesDrag', kind: 'number', label: '斯托克斯空气阻尼', unit: 's⁻¹', min: 0, max: 12, step: 1, defaultValue: 6 }
];

export const emCapacitorMillikanPlugin = defineSimulationPlugin<CapacitorMillikanParams, CapacitorMillikanState>({
  meta: {
    id: 'em-capacitor-millikan',
    title: '平行板电容器动态分析与密立根油滴 (E02)',
    textbookRef: '人教版 必修第三册 第十章 第4节',
    curriculumTags: ['物理观念', '科学思维', '科学探究'],
    difficulty: '高三一轮',
    version: '2.0.0'
  },
  paramSchema,
  presets: capacitorMillikanPresets,
  engine: {
    createInitialState,
    step: stepCapacitorMillikan,
    computeObservables,
    checkInvariants
  },
  layers: [
    { id: 'plates', label: '可拖动平行极板与电介质', defaultVisible: true },
    { id: 'electrometer', label: '静电计指针偏角监测', defaultVisible: true },
    { id: 'oilDrop', label: '密立根油滴与 P 点电势探针', defaultVisible: true }
  ],
  telemetryChannels: [
    { key: 'capacitancePF', label: '电容 C', unit: 'pF', color: '#38bdf8' },
    { key: 'voltageV', label: '两板电压 U', unit: 'V', color: '#fbbf24' },
    { key: 'fieldE', label: '板间场强 E', unit: 'V/m', color: '#4ade80' },
    { key: 'phiPV', label: '探针点 P 电势 φP', unit: 'V', color: '#f472b6' }
  ],
  getForceVectors: (state, params) => {
    if (!params.oilDropEnabled) return [];
    const m = computeCapacitorMetrics(params);
    const halfSpan = (params.distanceMm / 20) * 0.7;
    const dropY = -halfSpan + state.dropYFrac * (2 * halfSpan);
    const fRatio = (params.dropChargeSteps * m.fieldE) / (2 * 10000 * params.dropMassScale);
    return [
      { id: 'drop-mg', label: 'mg', origin: { x: 0, y: dropY }, force: { x: 0, y: -1.5 }, category: 'gravity', color: '#f59e0b' },
      { id: 'drop-qe', label: 'qE', origin: { x: 0, y: dropY }, force: { x: 0, y: 1.5 * fRatio }, category: 'electric', color: '#38bdf8' }
    ];
  },
  getControlHandles: (_s, params) => {
    const halfSpan = (params.distanceMm / 20) * 0.7;
    return [
      {
        id: 'top-plate-dist',
        label: `d=${params.distanceMm}mm`,
        position: { x: 0, y: halfSpan },
        handleKind: 'point',
        color: '#38bdf8',
        onDrag: (wp) => ({
          distanceMm: Math.round(Math.max(8, Math.min(40, (Math.abs(wp.y) / 0.7) * 20)))
        })
      },
      {
        id: 'probe-p',
        label: `P (${(params.probeFracP * 100).toFixed(0)}%)`,
        position: { x: -0.9, y: -halfSpan + params.probeFracP * 2 * halfSpan },
        handleKind: 'point',
        color: '#f472b6',
        onDrag: (wp) => {
          const frac = (wp.y + halfSpan) / (2 * halfSpan);
          return { probeFracP: Number(Math.max(0.1, Math.min(0.9, frac)).toFixed(2)) };
        }
      }
    ];
  },
  sceneSerializer: {
    exportScene: (_s, params) => ({
      schemaVersion: '2.0',
      modelId: 'em-capacitor-millikan',
      title: '平行板电容器与密立根油滴',
      params
    }),
    importScene: (dsl) => dsl.params as Partial<CapacitorMillikanParams>
  },
  exportDiagramIR: (_s, params) => {
    const m = computeCapacitorMetrics(params);
    const halfD = (params.distanceMm / 20) * 0.7;
    const primitives: DiagramPrimitive[] = [
      { kind: 'line', x1: -1.5, y1: halfD, x2: 1.5 * (2 * params.areaRatioS - 1), y2: halfD, strokeWidth: 3 },
      { kind: 'line', x1: -1.5, y1: -halfD, x2: 1.5, y2: -halfD, strokeWidth: 3 },
      { kind: 'circle', cx: 0, cy: -halfD + params.probeFracP * 2 * halfD, r: 0.05, fill: true },
      {
        kind: 'mathLabel',
        x: 2.2,
        y: 1.2,
        text: `C=${(m.capacitanceF * 1e12).toFixed(1)}\\text{pF},\\; U=${m.voltageV.toFixed(0)}\\text{V}`,
        align: 'end'
      }
    ];
    return {
      width: 680,
      height: 400,
      viewBox: { minX: -2.4, minY: -1.6, maxX: 2.4, maxY: 1.6 },
      title: '平行板电容器动态分析配图',
      primitives
    };
  },
  renderCanvas: (ctx, state, params, viewport, activeLayers) => {
    const ppm = Math.min(viewport.width, viewport.height) * 0.22 * viewport.scale;
    const cx = viewport.width * 0.43 + viewport.offsetX;
    const cy = viewport.height * 0.52 + viewport.offsetY;
    const toX = (wx: number) => cx + wx * ppm;
    const toY = (wy: number) => cy - wy * ppm;

    const halfD = (params.distanceMm / 20) * 0.7;
    const m = computeCapacitorMetrics(params);

    ctx.save();

    if (activeLayers.has('plates')) {
      if (params.dielectricEr > 1.05) {
        ctx.fillStyle = 'rgba(56, 189, 248, 0.16)';
        ctx.fillRect(toX(-1.4), toY(halfD), 2.8 * ppm, 2 * halfD * ppm);
      }

      // Top movable plate (reflects areaRatioS horizontal shift)
      const shiftX = (1 - params.areaRatioS) * 2.4;
      ctx.fillStyle = '#e2e8f0';
      ctx.fillRect(toX(-1.5 + shiftX), toY(halfD) - 8, 3.0 * ppm, 8);
      // Bottom fixed plate
      ctx.fillRect(toX(-1.5), toY(-halfD), 3.0 * ppm, 8);

      // Electric field arrows between overlapping region
      ctx.strokeStyle = 'rgba(74, 222, 128, 0.45)';
      ctx.lineWidth = 1.4;
      for (let i = -2; i <= 2; i++) {
        const fx = -1.5 + shiftX + 0.5 + ((i + 2) / 4) * (2.2 - shiftX);
        if (fx > 1.4) continue;
        ctx.beginPath();
        ctx.moveTo(toX(fx), toY(halfD - 0.05));
        ctx.lineTo(toX(fx), toY(-halfD + 0.05));
        ctx.stroke();
      }

      // Ground symbol
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 2;
      if (params.groundMode !== 'none') {
        const gy = params.groundMode === 'bottom' ? toY(-halfD) + 12 : toY(halfD) - 16;
        const gx = toX(-1.7);
        ctx.beginPath();
        ctx.moveTo(toX(-1.5), params.groundMode === 'bottom' ? toY(-halfD) + 4 : toY(halfD) - 4);
        ctx.lineTo(gx, params.groundMode === 'bottom' ? toY(-halfD) + 4 : toY(halfD) - 4);
        ctx.lineTo(gx, gy);
        ctx.moveTo(gx - 12, gy);
        ctx.lineTo(gx + 12, gy);
        ctx.moveTo(gx - 7, gy + 5);
        ctx.lineTo(gx + 7, gy + 5);
        ctx.stroke();
      }
    }

    if (activeLayers.has('oilDrop')) {
      const py = -halfD + params.probeFracP * 2 * halfD;
      ctx.fillStyle = '#f472b6';
      ctx.beginPath();
      ctx.arc(toX(-0.9), toY(py), 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = '12px sans-serif';
      ctx.fillText(`P (φ=${m.phiPV.toFixed(1)}V)`, toX(-0.9) + 10, toY(py) + 4);

      if (params.oilDropEnabled) {
        const dropY = -halfD + state.dropYFrac * 2 * halfD;
        ctx.fillStyle = '#fbbf24';
        ctx.beginPath();
        ctx.arc(toX(0), toY(dropY), 7, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (activeLayers.has('electrometer')) {
      const ex = viewport.width - 135;
      const ey = cy;
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(ex, ey, 46, 0, Math.PI * 2);
      ctx.stroke();

      const rad = ((state.electrometerAngleDeg - 90) * Math.PI) / 180;
      ctx.strokeStyle = '#f43f5e';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex + 38 * Math.cos(rad), ey + 38 * Math.sin(rad));
      ctx.stroke();
      ctx.fillStyle = '#cbd5e1';
      ctx.font = '12px sans-serif';
      ctx.fillText(`静电计 ${m.voltageV.toFixed(0)}V`, ex - 42, ey + 66);
      ctx.fillText(params.switchMode === 'open-const-q' ? 'S断开 (Q恒定)' : 'S闭合 (U恒定)', ex - 46, ey + 84);
    }

    ctx.restore();
  },
  formatFormulas: (_s, params) => {
    const m = computeCapacitorMetrics(params);
    return [
      {
        id: 'cap-main',
        label: '电容与场强定义',
        latex: 'C = \\frac{\\varepsilon_r S}{4\\pi k d},\\quad E = \\frac{U}{d}',
        substitutedLatex: `C=${(m.capacitanceF * 1e12).toFixed(2)}\\text{ pF},\\; Q=${(m.chargeC * 1e9).toFixed(3)}\\text{ nC},\\; E=${m.fieldE.toFixed(1)}\\text{ V/m}`
      },
      {
        id: 'cap-probe',
        label: '静电计与 P 点电势',
        latex: '\\varphi_P',
        substitutedLatex: `U=${m.voltageV.toFixed(1)}\\text{ V},\\; \\varphi_P=${m.phiPV.toFixed(2)}\\text{ V}`
      }
    ];
  }
});

export default emCapacitorMillikanPlugin;
