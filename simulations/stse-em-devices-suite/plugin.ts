import { defineSimulationPlugin, type DiagramPrimitive, type ParamFieldSpec } from '@physforge/sim-sdk';
import { emDevicesPresets } from './presets.js';
import {
  checkInvariants,
  computeObservables,
  createInitialState,
  stepEmDevices,
  type EmDevicesParams,
  type EmDevicesState
} from './engine.js';

const paramSchema: readonly ParamFieldSpec<EmDevicesParams>[] = [
  {
    key: 'device',
    kind: 'select',
    label: '电磁器件模块',
    defaultValue: 'cyclotron',
    options: [
      { value: 'velocity-selector', label: '速度选择器 (v = E/B)' },
      { value: 'mass-spectrometer', label: '质谱仪 (R = mv/qB)' },
      { value: 'cyclotron', label: '回旋加速器 (E_km)' },
      { value: 'hall-sensor', label: '霍尔元件 (U_H = IB/nqd)' },
      { value: 'mhd-generator', label: '磁流体发电机 (R=r 峰)' },
      { value: 'em-flowmeter', label: '电磁流量计 (Q = πDU/4B)' }
    ]
  },
  { key: 'eFieldVPerM', kind: 'number', label: '电场强度 E', unit: 'V/m', defaultValue: 2e5, min: 1e4, max: 5e5, step: 1e4 },
  { key: 'bFieldT', kind: 'number', label: '主磁场 B', unit: 'T', defaultValue: 1.5, min: 0.2, max: 4.0, step: 0.1 },
  { key: 'bDeflectT', kind: 'number', label: '偏转磁场 B₂', unit: 'T', defaultValue: 0.5, min: 0.2, max: 2.0, step: 0.1 },
  { key: 'particleSpeedMps', kind: 'number', label: '入射/流速 v', unit: 'm/s', defaultValue: 2e5, min: 100, max: 4e5, step: 500 },
  { key: 'chargeC', kind: 'number', label: '粒子电荷 q', unit: 'C', defaultValue: 1.602176634e-19, min: 1e-20, max: 1e-18, step: 1e-20 },
  { key: 'massKg', kind: 'number', label: '粒子质量 m', unit: 'kg', defaultValue: 1.67262192369e-27, min: 1e-28, max: 1e-25, step: 1e-28 },
  { key: 'cyclotronRadiusM', kind: 'number', label: 'D 形盒半径 R_max', unit: 'm', defaultValue: 0.45, min: 0.15, max: 1.2, step: 0.05 },
  { key: 'cyclotronVoltageV', kind: 'number', label: '加速高频电压 U', unit: 'V', defaultValue: 25000, min: 5000, max: 60000, step: 5000 },
  { key: 'relativisticDetune', kind: 'boolean', label: '启用相对论质速失谐', defaultValue: false },
  { key: 'hallCurrentA', kind: 'number', label: '霍尔控制电流 I', unit: 'A', defaultValue: 3.0, min: 0.5, max: 8.0, step: 0.5 },
  { key: 'hallDensityPerM3', kind: 'number', label: '载流子浓度 n', unit: '/m³', defaultValue: 2e24, min: 1e22, max: 1e26, step: 1e23 },
  { key: 'hallThicknessM', kind: 'number', label: '元件厚度 d', unit: 'm', defaultValue: 0.0005, min: 0.0002, max: 0.003, step: 0.0001 },
  {
    key: 'carrierType',
    kind: 'select',
    label: '载流子类型',
    defaultValue: 'electron',
    options: [
      { value: 'electron', label: '电子 (N 型, q=-e)' },
      { value: 'hole', label: '空穴 (P 型, q=+e)' }
    ]
  },
  { key: 'mhdDuctWidthM', kind: 'number', label: 'MHD 通道极间距 d', unit: 'm', defaultValue: 0.4, min: 0.1, max: 1.0, step: 0.05 },
  { key: 'mhdDuctAreaM2', kind: 'number', label: 'MHD 极板面积 S', unit: 'm²', defaultValue: 0.1, min: 0.02, max: 0.5, step: 0.02 },
  { key: 'mhdPlasmaResOhmM', kind: 'number', label: '等离子体电阻率 ρ', unit: 'Ω·m', defaultValue: 0.2, min: 0.05, max: 1.0, step: 0.05 },
  { key: 'mhdLoadOhm', kind: 'number', label: '外电路负载电阻 R', unit: 'Ω', defaultValue: 0.8, min: 0.1, max: 3.0, step: 0.1 },
  { key: 'flowDiameterM', kind: 'number', label: '流量计管径 D', unit: 'm', defaultValue: 0.2, min: 0.05, max: 0.6, step: 0.05 }
];

export const stseEmDevicesSuitePlugin = defineSimulationPlugin<EmDevicesParams, EmDevicesState>({
  meta: {
    id: 'stse-em-devices-suite',
    title: '现代电磁科技器件集成台 (S02)',
    textbookRef: '人教版 选择性必修二 第一章 · 电磁六大科技器件集成',
    curriculumTags: ['物理观念', '科学思维', '科学探究'],
    difficulty: '高三一轮',
    version: '2.0.0'
  },
  paramSchema,
  presets: emDevicesPresets,
  engine: {
    createInitialState,
    step: stepEmDevices,
    computeObservables,
    checkInvariants
  },
  layers: [
    { id: 'main', label: '电磁器件工作原理动态视图', defaultVisible: true }
  ],
  telemetryChannels: [
    { key: 'selectedSpeed', label: '选择速度 E/B', unit: 'm/s', color: '#38bdf8' },
    { key: 'hallVoltageMv', label: '霍尔电压 U_H', unit: 'mV', color: '#f59e0b' },
    { key: 'mhdOutputWatt', label: 'MHD 输出功率', unit: 'W', color: '#4ade80' },
    { key: 'flowVoltageMv', label: '流量计感生电压', unit: 'mV', color: '#a855f7' }
  ],
  sceneSerializer: {
    exportScene: (_s, params) => ({
      schemaVersion: '2.0',
      modelId: 'stse-em-devices-suite',
      title: '现代电磁器件集成台',
      params
    }),
    importScene: (dsl) => dsl.params as Partial<EmDevicesParams>
  },
  exportDiagramIR: (state, params) => {
    const primitives: DiagramPrimitive[] = [
      { kind: 'rect', x: -1.6, y: -1.0, width: 3.2, height: 2.0 },
      { kind: 'fieldMarker', x: -0.8, y: 0.5, symbol: 'cross', radius: 0.12 },
      { kind: 'trajectory', points: state.trail.slice(-30).map((p) => ({ x: p.x, y: p.y })), strokeWidth: 1.5 },
      { kind: 'mathLabel', x: 0, y: 1.25, text: `\\text{Device: }${params.device}`, align: 'middle' }
    ];
    return {
      width: 680,
      height: 400,
      viewBox: { minX: -2.2, minY: -1.5, maxX: 2.2, maxY: 1.5 },
      title: '现代电磁器件原理配图',
      primitives
    };
  },
  renderCanvas: (ctx, state, params, viewport, activeLayers) => {
    const w = viewport.width;
    const h = viewport.height;
    if (!activeLayers.has('main')) return;
    ctx.save();
    const cx = w * 0.45;
    const cy = h * 0.52;
    const scale = Math.min(w, h) * 0.28;

    // Draw device schematic box
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 2.5;
    if (params.device === 'cyclotron') {
      ctx.beginPath();
      ctx.arc(cx - 8, cy, scale, Math.PI / 2, (3 * Math.PI) / 2);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx + 8, cy, scale, -Math.PI / 2, Math.PI / 2);
      ctx.closePath();
      ctx.stroke();
    } else {
      ctx.strokeRect(cx - scale * 1.4, cy - scale * 0.7, scale * 2.8, scale * 1.4);
    }

    // Draw particle trail & head
    if (state.trail.length > 1) {
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      state.trail.forEach((p, idx) => {
        const sx = cx + p.x * scale * 0.7;
        const sy = cy - p.y * scale * 0.7;
        if (idx === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      });
      ctx.stroke();
    }
    ctx.fillStyle = params.carrierType === 'hole' ? '#f43f5e' : '#4ade80';
    ctx.beginPath();
    ctx.arc(cx + state.particlePos.x * scale * 0.7, cy - state.particlePos.y * scale * 0.7, 6, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#e2e8f0';
    ctx.font = 'bold 14px ui-sans-serif, system-ui';
    const summaryMap: Record<EmDevicesParams['device'], string> = {
      'velocity-selector': `速度选择器 v_sel = E/B = ${state.selectedSpeed.toFixed(0)} m/s`,
      'mass-spectrometer': `质谱仪偏转半径 R = ${state.spectrometerRadiusM.toExponential(3)} m`,
      'cyclotron': `回旋出射动能 E_km = ${(state.cyclotronMaxEnergyJ / 1.602176634e-13).toFixed(3)} MeV (解析相对差 ${state.cyclotronRelError.toExponential(2)})`,
      'hall-sensor': `霍尔电压 U_H = ${(state.hallVoltageV * 1000).toFixed(4)} mV (${params.carrierType === 'electron' ? '电子负极性' : '空穴正极性'})`,
      'mhd-generator': `MHD E=${state.mhdEmfV.toFixed(1)}V | r=${state.mhdInternalOhm.toFixed(2)}Ω | P=${state.mhdOutputWatt.toFixed(0)}W (峰值 ${state.mhdMaxPowerWatt.toFixed(0)}W)`,
      'em-flowmeter': `电磁流量计 Q = ${state.flowRateM3ps.toExponential(3)} m³/s | U=${(state.flowVoltageV * 1000).toFixed(2)} mV`
    };
    ctx.fillText(summaryMap[params.device], 20, 30);
    ctx.restore();
  },
  formatFormulas: (state, params) => [
    {
      id: 'em-devices-law',
      label: '电磁科技器件核心公式',
      latex:
        params.device === 'hall-sensor'
          ? 'U_H = \\frac{I B}{n q d}'
          : params.device === 'mhd-generator'
            ? 'P = \\left(\\frac{B d v}{R + r}\\right)^2 R'
            : 'E_{km} = \\frac{q^2 B^2 R_{\\max}^2}{2m}',
      substitutedLatex:
        params.device === 'hall-sensor'
          ? `U_H=${(state.hallVoltageV * 1000).toFixed(3)}\\text{ mV}`
          : `P=${state.mhdOutputWatt.toFixed(1)}\\text{ W},\\; R_{\\text{int}}=${state.mhdInternalOhm.toFixed(2)}\\ \\Omega`
    }
  ]
});

export default stseEmDevicesSuitePlugin;
