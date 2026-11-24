import type { LiveFormulaSpec } from '@physforge/sim-sdk';
import { createWorldMapper, defineSimulationPlugin, type DiagramPrimitive, type ParamFieldSpec } from '@physforge/sim-sdk';
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


const liveFormulas: readonly LiveFormulaSpec[] = [{
  "id": "velocity-selector",
  "title": "正交电磁速度选择器（电磁力平衡）",
  "latex": "v_s=\\frac{\\htmlClass{pf-live-var}{\\htmlData{param=eFieldVPerM}{E}}}{\\htmlClass{pf-live-var}{\\htmlData{param=bFieldT}{B}}}",
  "bindings": [
    {
      "tokenKey": "eFieldVPerM",
      "paramKey": "eFieldVPerM",
      "label": "电场强度 E",
      "unit": "V/m",
      "min": 10000,
      "max": 500000,
      "step": 10000,
      "precision": 0
    },
    {
      "tokenKey": "bFieldT",
      "paramKey": "bFieldT",
      "label": "主磁场 B",
      "unit": "T",
      "min": 0.2,
      "max": 4,
      "step": 0.1,
      "precision": 2
    }
  ]
},
{
  "id": "cyclotron-energy",
  "title": "经典回旋加速器极限动能（非相对论）",
  "latex": "E_{\\max}=\\frac{q^2 \\htmlClass{pf-live-var}{\\htmlData{param=bFieldT}{B}}^2 \\htmlClass{pf-live-var}{\\htmlData{param=cyclotronRadiusM}{R}}^2}{2m}",
  "bindings": [
    {
      "tokenKey": "bFieldT",
      "paramKey": "bFieldT",
      "label": "主磁场 B",
      "unit": "T",
      "min": 0.2,
      "max": 4,
      "step": 0.1,
      "precision": 2
    },
    {
      "tokenKey": "cyclotronRadiusM",
      "paramKey": "cyclotronRadiusM",
      "label": "D 形盒半径 R_max",
      "unit": "m",
      "min": 0.15,
      "max": 1.2,
      "step": 0.05,
      "precision": 2
    }
  ]
},
{
  "id": "cyclotron-gap-energy",
  "title": "同步过狭缝的单次能量增量",
  "latex": "\\Delta K=|q|\\htmlClass{pf-live-var}{\\htmlData{param=cyclotronVoltageV}{U}}",
  "bindings": [
    {
      "tokenKey": "cyclotronVoltageV",
      "paramKey": "cyclotronVoltageV",
      "label": "加速高频电压 U",
      "unit": "V",
      "min": 5000,
      "max": 60000,
      "step": 5000,
      "precision": 0
    }
  ]
}];
export const stseEmDevicesSuitePlugin = Object.assign(defineSimulationPlugin<EmDevicesParams, EmDevicesState>({
  meta: {
    id: 'stse-em-devices-suite',
    title: '现代电磁科技器件集成台 (S02)',
    textbookRef: '人教版 选择性必修二 第一章 · 电磁六大科技器件集成',
    curriculumTags: ['物理观念', '科学思维', '科学探究'],
    difficulty: '高三一轮',
    version: '2.0.0'
  },
  renderMode: 'hybrid',
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
    if (!activeLayers.has('main')) return;
    ctx.save();
    const m = createWorldMapper(viewport);
    const center = m.toScreen(-0.25, 0);
    const scale = m.len(0.85);

    ctx.strokeStyle = 'rgba(148,163,184,0.35)';
    ctx.lineWidth = 1;
    const bRailTop = m.toScreen(1.28, 0.6);
    const bRailBottom = m.toScreen(1.28, -0.6);
    const eRailTop = m.toScreen(-1.65, 0.6);
    const eRailBottom = m.toScreen(-1.65, -0.6);
    ctx.beginPath();
    ctx.moveTo(bRailTop.x, bRailTop.y);
    ctx.lineTo(bRailBottom.x, bRailBottom.y);
    ctx.moveTo(eRailTop.x, eRailTop.y);
    ctx.lineTo(eRailBottom.x, eRailBottom.y);
    ctx.stroke();

    // Draw device schematic box
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 2.5;
    if (params.device === 'cyclotron') {
      ctx.beginPath();
      ctx.arc(center.x - m.len(0.04), center.y, scale, Math.PI / 2, (3 * Math.PI) / 2);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(center.x + m.len(0.04), center.y, scale, -Math.PI / 2, Math.PI / 2);
      ctx.closePath();
      ctx.stroke();
    } else {
      const topLeft = m.toScreen(-1.45, 0.6);
      ctx.strokeRect(topLeft.x, topLeft.y, m.len(2.4), m.len(1.2));
    }

    // Draw particle trail & head
    if (state.trail.length > 1) {
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      state.trail.forEach((p, idx) => {
        const point = m.toScreen(-0.25 + p.x * 0.7, p.y * 0.7);
        const sx = point.x;
        const sy = point.y;
        if (idx === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      });
      ctx.stroke();
    }
    ctx.fillStyle = params.carrierType === 'hole' ? '#f43f5e' : '#4ade80';
    ctx.beginPath();
    const particle = m.toScreen(-0.25 + state.particlePos.x * 0.7, state.particlePos.y * 0.7);
    ctx.arc(particle.x, particle.y, m.len(0.03), 0, Math.PI * 2);
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
  getControlHandles: (_state, params) => {
    const controlsDeflectionField = params.device === 'mass-spectrometer';
    const magneticMin = 0.2;
    const magneticMax = controlsDeflectionField ? 2 : 4;
    const magneticField = controlsDeflectionField ? params.bDeflectT : params.bFieldT;
    return [
      {
        id: 'device-b-field',
        label: `B=${magneticField.toFixed(1)} T`,
        position: { x: 1.28, y: -0.6 + ((magneticField - magneticMin) / (magneticMax - magneticMin)) * 1.2 },
        handleKind: 'point' as const,
        color: '#38bdf8',
        onDrag: (world: { x: number; y: number }): Record<string, number> => {
          const value = Number(Math.max(magneticMin, Math.min(magneticMax, Math.round((magneticMin + ((world.y + 0.6) / 1.2) * (magneticMax - magneticMin)) * 10) / 10)).toFixed(1));
          return controlsDeflectionField ? { bDeflectT: value } : { bFieldT: value };
        }
      },
      ...(params.device === 'velocity-selector' ? [{
        id: 'device-e-field',
        label: `E=${(params.eFieldVPerM / 1e5).toFixed(1)}×10⁵ V/m`,
        position: { x: -1.65, y: -0.6 + ((params.eFieldVPerM - 1e4) / 4.9e5) * 1.2 },
        handleKind: 'point' as const,
        color: '#fbbf24',
        onDrag: (world: { x: number; y: number }) => ({
          eFieldVPerM: Math.max(1e4, Math.min(5e5, Math.round((1e4 + ((world.y + 0.6) / 1.2) * 4.9e5) / 1e4) * 1e4))
        })
      }] : [])
    ];
  },
  getForceVectors: (state, params) => {
    if (params.device !== 'velocity-selector' && params.device !== 'mass-spectrometer') return [];
    const chargeSign = params.carrierType === 'hole' ? 1 : -1;
    const charge = chargeSign * Math.abs(params.chargeC);
    const field = params.device === 'mass-spectrometer' ? params.bDeflectT : params.bFieldT;
    const origin = { x: -0.25 + state.particlePos.x * 0.7, y: state.particlePos.y * 0.7 };
    const magneticForce = charge * params.particleSpeedMps * field;
    if (params.device === 'velocity-selector') {
      return [
        {
          id: 'selector-electric-force',
          label: 'F电=qE',
          origin,
          force: { x: 0, y: charge * params.eFieldVPerM },
          color: '#fbbf24',
          category: 'electric',
          unit: 'N'
        },
        {
          id: 'selector-magnetic-force',
          label: 'F洛=qv×B',
          origin,
          force: { x: 0, y: -magneticForce },
          color: '#38bdf8',
          category: 'magnetic',
          unit: 'N'
        }
      ];
    }
    return [{
      id: 'spectrometer-magnetic-force',
      label: 'F洛=qv×B',
      origin,
      force: { x: 0, y: -magneticForce },
      color: '#38bdf8',
      category: 'magnetic',
      unit: 'N'
    }];
  },
  referenceFrames: [{
    id: 'carrier-particle',
    label: '粒子/载流子随动参考系',
    getOrigin: (state) => ({ x: -0.25 + state.particlePos.x * 0.7, y: state.particlePos.y * 0.7 }),
    getVelocity: (state) => ({ x: state.particleVel.x * 0.7, y: state.particleVel.y * 0.7 })
  }],
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
}), { liveFormulas, spatial3D: { flattenPlane: 'xz' as const, defaultVisibleHeight: 3.4, sceneDepthRadius: 4, default3DAzimuthRad: 0.6, default3DPolarRad: 0.9 } });

export default stseEmDevicesSuitePlugin;
