import type { LiveFormulaSpec } from '@physforge/sim-sdk';
import { createWorldMapper, defineSimulationPlugin, resolveAndDrawLabels, type CanvasLabel, type DiagramPrimitive, type ParamFieldSpec } from '@physforge/sim-sdk';
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


const liveFormulas: readonly LiveFormulaSpec[] = [{
  "id": "parallel-capacitance",
  "title": "平行板电容（σ=S/S₀，忽略边缘效应）",
  "latex": "C=\\frac{\\varepsilon_0\\htmlClass{pf-live-var}{\\htmlData{param=dielectricEr}{\\varepsilon_r}}S_0\\htmlClass{pf-live-var}{\\htmlData{param=areaRatioS}{\\sigma}}}{\\htmlClass{pf-live-var}{\\htmlData{param=distanceMm}{d}}}",
  "bindings": [
    {
      "tokenKey": "dielectricEr",
      "paramKey": "dielectricEr",
      "label": "相对介电常数 εr",
      "unit": "",
      "min": 1,
      "max": 6,
      "step": 0.5,
      "precision": 2
    },
    {
      "tokenKey": "areaRatioS",
      "paramKey": "areaRatioS",
      "label": "正对面积比 S/S₀",
      "unit": "",
      "min": 0.3,
      "max": 1,
      "step": 0.05,
      "precision": 3
    },
    {
      "tokenKey": "distanceMm",
      "paramKey": "distanceMm",
      "label": "极板间距 d",
      "unit": "mm",
      "min": 8,
      "max": 40,
      "step": 1,
      "precision": 1
    }
  ]
}];
export const emCapacitorMillikanPlugin = Object.assign(defineSimulationPlugin<CapacitorMillikanParams, CapacitorMillikanState>({
  meta: {
    id: 'em-capacitor-millikan',
    title: '平行板电容器动态分析与密立根油滴 (E02)',
    textbookRef: '人教版 必修第三册 第十章 第4节',
    curriculumTags: ['物理观念', '科学思维', '科学探究'],
    difficulty: '高三一轮',
    version: '2.0.0'
  },
  defaultView: { scale: 0.917, offsetRatioX: -0.02, offsetRatioY: 0.02 },
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
  referenceFrames: [
    {
      id: 'oil-droplet',
      label: '油滴随动参考系',
      getOrigin: (s, p) => {
        const halfSpan = (p.distanceMm / 20) * 0.7;
        return { x: 0, y: -halfSpan + s.dropYFrac * 2 * halfSpan };
      },
      getVelocity: (s, p) => ({ x: 0, y: s.dropVy * ((p.distanceMm / 20) * 1.4) })
    }
  ],
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
    const mapper = createWorldMapper(viewport);
    const labels: CanvasLabel[] = [];
    const fillWorldRect = (x: number, y: number, width: number, height: number) => {
      const a = mapper.toScreen(x, y + height);
      const b = mapper.toScreen(x + width, y);
      ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    };

    const halfD = (params.distanceMm / 20) * 0.7;
    const metrics = computeCapacitorMetrics(params);

    ctx.save();

    if (activeLayers.has('plates')) {
      if (params.dielectricEr > 1.05) {
        ctx.fillStyle = 'rgba(56, 189, 248, 0.16)';
        fillWorldRect(-1.4, -halfD, 2.8, 2 * halfD);
      }

      // Top movable plate (reflects areaRatioS horizontal shift)
      const shiftX = (1 - params.areaRatioS) * 2.4;
      ctx.fillStyle = '#e2e8f0';
      fillWorldRect(-1.5 + shiftX, halfD - 0.04, 3, 0.04);
      // Bottom fixed plate
      fillWorldRect(-1.5, -halfD - 0.04, 3, 0.04);

      // Electric field arrows between overlapping region
      ctx.strokeStyle = 'rgba(74, 222, 128, 0.45)';
      ctx.lineWidth = 1.4;
      for (let i = -2; i <= 2; i++) {
        const fx = -1.5 + shiftX + 0.5 + ((i + 2) / 4) * (2.2 - shiftX);
        if (fx > 1.4) continue;
        const top = mapper.toScreen(fx, halfD - 0.05);
        const bottom = mapper.toScreen(fx, -halfD + 0.05);
        ctx.beginPath();
        ctx.moveTo(top.x, top.y);
        ctx.lineTo(bottom.x, bottom.y);
        ctx.stroke();
      }

      // Ground symbol
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 2;
      if (params.groundMode !== 'none') {
        const plateY = params.groundMode === 'bottom' ? -halfD - 0.04 : halfD + 0.04;
        const stemEnd = params.groundMode === 'bottom' ? plateY - 0.16 : plateY + 0.16;
        const gx = -1.7;
        const plate = mapper.toScreen(-1.5, plateY);
        const elbow = mapper.toScreen(gx, plateY);
        const ground = mapper.toScreen(gx, stemEnd);
        ctx.beginPath();
        ctx.moveTo(plate.x, plate.y);
        ctx.lineTo(elbow.x, elbow.y);
        ctx.lineTo(ground.x, ground.y);
        for (const width of [0.12, 0.075, 0.04]) {
          const left = mapper.toScreen(gx - width, stemEnd);
          const right = mapper.toScreen(gx + width, stemEnd);
          ctx.moveTo(left.x, left.y);
          ctx.lineTo(right.x, right.y);
        }
        ctx.stroke();
      }
    }

    if (activeLayers.has('oilDrop')) {
      const py = -halfD + params.probeFracP * 2 * halfD;
      const probe = mapper.toScreen(-0.9, py);
      ctx.fillStyle = '#f472b6';
      ctx.beginPath();
      ctx.arc(probe.x, probe.y, mapper.len(0.025), 0, Math.PI * 2);
      ctx.fill();
      labels.push({ id: 'capacitor-probe-label', x: probe.x, y: probe.y, text: `P (φ=${metrics.phiPV.toFixed(1)}V)`, color: '#f472b6', font: '12px sans-serif' });

      if (params.oilDropEnabled) {
        const dropY = -halfD + state.dropYFrac * 2 * halfD;
        const drop = mapper.toScreen(0, dropY);
        ctx.fillStyle = '#fbbf24';
        ctx.beginPath();
        ctx.arc(drop.x, drop.y, mapper.len(0.035), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (activeLayers.has('electrometer')) {
      const meter = mapper.toScreen(2.05, 0);
      const ex = meter.x;
      const ey = meter.y;
      const radius = mapper.len(0.3);
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(ex, ey, radius, 0, Math.PI * 2);
      ctx.stroke();

      const rad = ((state.electrometerAngleDeg - 90) * Math.PI) / 180;
      ctx.strokeStyle = '#f43f5e';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex + radius * 0.82 * Math.cos(rad), ey + radius * 0.82 * Math.sin(rad));
      ctx.stroke();
      labels.push(
        { id: 'electrometer-value', x: ex, y: ey + radius + mapper.len(0.12), text: `静电计 ${metrics.voltageV.toFixed(0)}V`, color: '#cbd5e1', font: '12px sans-serif' },
        { id: 'electrometer-mode', x: ex, y: ey + radius + mapper.len(0.3), text: params.switchMode === 'open-const-q' ? 'S断开 (Q恒定)' : 'S闭合 (U恒定)', color: '#cbd5e1', font: '11px sans-serif' }
      );
    }

    resolveAndDrawLabels(ctx, labels, viewport.width, viewport.height);
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
}), { liveFormulas });

export default emCapacitorMillikanPlugin;
