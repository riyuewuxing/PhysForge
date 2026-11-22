import { defineSimulationPlugin, type DiagramPrimitive, type ParamFieldSpec, type ParamValue } from '@physforge/sim-sdk';
import { thermoGasPresets } from './presets.js';
import {
  checkInvariants,
  computeDetachCriticalTempK,
  computeObservables,
  createInitialState,
  stepThermoGasLaws,
  type ThermoGasParams,
  type ThermoGasState
} from './engine.js';

const paramSchema: readonly ParamFieldSpec<ThermoGasParams>[] = [
  {
    key: 'mode',
    kind: 'select',
    label: '热学模型',
    defaultValue: 'stop-pin-cylinder',
    options: [
      { value: 'stop-pin-cylinder', label: '带卡口竖直汽缸活塞' },
      { value: 'mercury-tube-tilt', label: '倾转水银柱玻璃管' },
      { value: 'multi-stroke-pump', label: '变质量打气/抽气筒' }
    ]
  },
  { key: 'molesN', kind: 'number', label: '气体物质的量 n', unit: 'mol', min: 0.1, max: 0.6, step: 0.05, defaultValue: 0.25 },
  { key: 'targetTempK', kind: 'number', label: '目标环境温度 T', unit: 'K', min: 200, max: 600, step: 10, defaultValue: 420 },
  { key: 'heatingRateKPerS', kind: 'number', label: '升降温速率 |dT/dt|', unit: 'K/s', min: 10, max: 150, step: 10, defaultValue: 60 },
  { key: 'pistonAreaCm2', kind: 'number', label: '活塞截面积 S', unit: 'cm²', min: 20, max: 100, step: 10, defaultValue: 50 },
  { key: 'pistonMassKg', kind: 'number', label: '活塞质量 m', unit: 'kg', min: 0, max: 30, step: 2, defaultValue: 10 },
  { key: 'pinVolumeL', kind: 'number', label: '卡口限位容积 V₀', unit: 'L', min: 3, max: 10, step: 0.5, defaultValue: 5 },
  { key: 'tubeTiltDeg', kind: 'number', label: '玻璃管倾角 θ', unit: '°', min: -90, max: 90, step: 15, defaultValue: 0 },
  { key: 'mercuryCm', kind: 'number', label: '水银柱长度 h', unit: 'cm', min: 10, max: 30, step: 2, defaultValue: 20 },
  { key: 'tubeLengthCm', kind: 'number', label: '玻璃管总长 L', unit: 'cm', min: 45, max: 90, step: 5, defaultValue: 75 },
  { key: 'tankVolumeL', kind: 'number', label: '容器定容 V', unit: 'L', min: 2, max: 20, step: 1, defaultValue: 10 },
  { key: 'pumpDeltaVL', kind: 'number', label: '气筒单次容积 ΔV', unit: 'L', min: 0.5, max: 5, step: 0.5, defaultValue: 2.5 },
  { key: 'pumpStrokesK', kind: 'number', label: '操作次数 k', unit: '次', min: 0, max: 10, step: 1, defaultValue: 5 },
  {
    key: 'pumpDirection',
    kind: 'select',
    label: '充气 / 抽气方向',
    defaultValue: 'extract',
    options: [
      { value: 'extract', label: '抽气（降压 P₀[V/(V+ΔV)]ᵏ）' },
      { value: 'inject', label: '打气（增压）' }
    ]
  }
];

export const thermoPistonGasLawsPlugin = defineSimulationPlugin<ThermoGasParams, ThermoGasState>({
  meta: {
    id: 'thermo-piston-gas-laws',
    title: '汽缸活塞卡口、水银柱与变质量充放气 (T01)',
    textbookRef: '人教版 选择性必修三 第二章',
    curriculumTags: ['物理观念', '科学思维', '科学探究'],
    difficulty: '压轴专题',
    version: '2.0.0'
  },
  paramSchema,
  presets: thermoGasPresets,
  engine: {
    createInitialState,
    step: stepThermoGasLaws,
    computeObservables,
    checkInvariants
  },
  layers: [
    { id: 'apparatus', label: '汽缸 / 水银管 / 气筒装置图', defaultVisible: true },
    { id: 'pvCurve', label: '实时 P-V 态变拐点轨迹', defaultVisible: true }
  ],
  telemetryChannels: [
    { key: 'pressureKPa', label: '气体压强 P', unit: 'kPa', color: '#38bdf8' },
    { key: 'volumeL', label: '气体体积 V', unit: 'L', color: '#4ade80' },
    { key: 'temperatureK', label: '热力学温度 T', unit: 'K', color: '#fbbf24' }
  ],
  getControlHandles: (_s, params) => [
    {
      id: 'target-temp',
      label: params.mode === 'mercury-tube-tilt' ? `θ=${params.tubeTiltDeg}°` : `T目标=${params.targetTempK}K`,
      position: { x: 0, y: params.mode === 'mercury-tube-tilt' ? params.tubeTiltDeg / 90 : (params.targetTempK - 400) / 200 },
      handleKind: 'point',
      color: '#fbbf24',
      onDrag: (wp): Record<string, ParamValue> =>
        params.mode === 'mercury-tube-tilt'
          ? { tubeTiltDeg: Math.round(Math.max(-90, Math.min(90, wp.y * 90)) / 5) * 5 }
          : { targetTempK: Math.round(Math.max(200, Math.min(600, 400 + wp.y * 200)) / 10) * 10 }
    }
  ],
  sceneSerializer: {
    exportScene: (_s, params) => ({
      schemaVersion: '2.0',
      modelId: 'thermo-piston-gas-laws',
      title: '气体实验定律与活塞模型',
      params
    }),
    importScene: (dsl) => dsl.params as Partial<ThermoGasParams>
  },
  exportDiagramIR: (state) => {
    const primitives: DiagramPrimitive[] = [
      { kind: 'line', x1: -1.4, y1: -1.2, x2: -1.4, y2: 1.2, strokeWidth: 2 },
      { kind: 'line', x1: -0.2, y1: -1.2, x2: -0.2, y2: 1.2, strokeWidth: 2 },
      { kind: 'line', x1: -1.4, y1: -1.2, x2: -0.2, y2: -1.2, strokeWidth: 2 },
      { kind: 'block', cx: -0.8, cy: -0.2 + (state.volumeM3 * 1000 - 5) * 0.12, width: 1.15, height: 0.22, label: 'm' },
      {
        kind: 'mathLabel',
        x: 1.8,
        y: 1.0,
        text: `P=${(state.pressurePa / 1000).toFixed(1)}\\text{kPa},\\; V=${(state.volumeM3 * 1000).toFixed(2)}\\text{L}`,
        align: 'end'
      }
    ];
    return {
      width: 680,
      height: 400,
      viewBox: { minX: -2.0, minY: -1.5, maxX: 2.0, maxY: 1.5 },
      title: '汽缸活塞热力学过程配图',
      primitives
    };
  },
  renderCanvas: (ctx, state, params, viewport, activeLayers) => {
    const w = viewport.width;
    const h = viewport.height;
    ctx.save();

    if (activeLayers.has('apparatus')) {
      const cx = w * 0.28;
      const botY = h * 0.8;
      if (params.mode === 'mercury-tube-tilt') {
        const cy = h * 0.5;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate((-params.tubeTiltDeg * Math.PI) / 180);
        const lenPx = params.tubeLengthCm * 2.2;
        const airPx = (state.airColumnCm / params.tubeLengthCm) * lenPx;
        const hgPx = (state.mercuryColumnCm / params.tubeLengthCm) * lenPx;
        ctx.strokeStyle = '#94a3b8';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(-lenPx / 2, -16);
        ctx.lineTo(-lenPx / 2, 16);
        ctx.lineTo(lenPx / 2, 16);
        ctx.moveTo(-lenPx / 2, -16);
        ctx.lineTo(lenPx / 2, -16);
        ctx.stroke();

        ctx.fillStyle = 'rgba(56, 189, 248, 0.22)';
        ctx.fillRect(-lenPx / 2 + 2, -14, airPx, 28);
        ctx.fillStyle = '#cbd5e1';
        ctx.fillRect(-lenPx / 2 + 2 + airPx, -14, hgPx, 28);
        ctx.restore();
      } else {
        const cylW = 110;
        const cylH = 220;
        ctx.strokeStyle = '#94a3b8';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(cx - cylW / 2, botY - cylH);
        ctx.lineTo(cx - cylW / 2, botY);
        ctx.lineTo(cx + cylW / 2, botY);
        ctx.lineTo(cx + cylW / 2, botY - cylH);
        ctx.stroke();

        const volL = state.volumeM3 * 1000;
        const gasH = Math.max(24, Math.min(cylH - 22, (volL / 10) * 140));
        ctx.fillStyle = 'rgba(251, 146, 60, 0.25)';
        ctx.fillRect(cx - cylW / 2 + 2, botY - gasH, cylW - 4, gasH);

        ctx.fillStyle = state.mode === 'pinned' ? '#fbbf24' : '#38bdf8';
        ctx.fillRect(cx - cylW / 2 + 2, botY - gasH - 16, cylW - 4, 16);

        if (params.mode === 'stop-pin-cylinder') {
          const pinH = (params.pinVolumeL / 10) * 140;
          ctx.fillStyle = '#f43f5e';
          ctx.fillRect(cx - cylW / 2 - 4, botY - pinH - 2, 12, 6);
          ctx.fillRect(cx + cylW / 2 - 8, botY - pinH - 2, 12, 6);
        }
      }
    }

    if (activeLayers.has('pvCurve')) {
      const gx = w * 0.54;
      const gy = h * 0.78;
      const gw = w * 0.4;
      const gh = h * 0.56;
      ctx.fillStyle = 'rgba(15, 23, 42, 0.78)';
      ctx.fillRect(gx, gy - gh, gw, gh);
      ctx.strokeStyle = '#475569';
      ctx.strokeRect(gx, gy - gh, gw, gh);

      const toPx = (vL: number) => gx + Math.min(1, Math.max(0, vL / 15)) * (gw - 24) + 12;
      const toPy = (pKPa: number) => gy - Math.min(1, Math.max(0, pKPa / 240)) * (gh - 24) - 12;

      if (state.pvHistory.length > 1) {
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.moveTo(toPx(state.pvHistory[0]!.vL), toPy(state.pvHistory[0]!.pKPa));
        for (let i = 1; i < state.pvHistory.length; i++) {
          ctx.lineTo(toPx(state.pvHistory[i]!.vL), toPy(state.pvHistory[i]!.pKPa));
        }
        ctx.stroke();
      }
      ctx.fillStyle = '#4ade80';
      ctx.beginPath();
      ctx.arc(toPx(state.volumeM3 * 1000), toPy(state.pressurePa / 1000), 5, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#cbd5e1';
      ctx.font = '12px sans-serif';
      const critTxt =
        params.mode === 'stop-pin-cylinder'
          ? `Tcrit=${computeDetachCriticalTempK(params).toFixed(1)}K`
          : `P=${(state.pressurePa / 1000).toFixed(2)} kPa`;
      ctx.fillText(`P-V 状态追踪 · ${critTxt}`, gx + 10, gy - gh + 20);
    }

    ctx.restore();
  },
  formatFormulas: (state, params) => [
    {
      id: 'ideal-gas-law',
      label: '理想气体状态方程与临界判据',
      latex: '\\frac{PV}{T} = nR',
      substitutedLatex: `P=${(state.pressurePa / 1000).toFixed(2)}\\text{ kPa},\\; V=${(state.volumeM3 * 1000).toFixed(2)}\\text{ L},\\; T=${state.temperatureK.toFixed(1)}\\text{ K}${params.mode === 'stop-pin-cylinder' && state.detachTempK ? `,\\; T_{\\text{脱}}=${state.detachTempK.toFixed(2)}\\text{ K}` : ''}`
    }
  ]
});

export default thermoPistonGasLawsPlugin;
