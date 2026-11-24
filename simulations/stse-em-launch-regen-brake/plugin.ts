import { createWorldMapper, defineSimulationPlugin, drawMetallicRail, resolveAndDrawLabels, type CanvasLabel, type DiagramPrimitive, type ParamFieldSpec } from '@physforge/sim-sdk';
import { emLaunchRegenPresets } from './presets.js';
import {
  checkInvariants,
  computeAnalyticPureEmStopDistance,
  computeObservables,
  createInitialState,
  stepEmLaunchRegen,
  type EmLaunchRegenParams,
  type EmLaunchRegenState
} from './engine.js';

const paramSchema: readonly ParamFieldSpec<EmLaunchRegenParams>[] = [
  {
    key: 'mode',
    kind: 'select',
    label: '系统模式',
    defaultValue: 'railgun',
    options: [
      { value: 'railgun', label: '电磁导轨弹射' },
      { value: 'regen-brake', label: '新能源再生制动' }
    ]
  },
  {
    key: 'driveMode',
    kind: 'select',
    label: '弹射供电方式',
    defaultValue: 'capacitor-pulse',
    options: [
      { value: 'capacitor-pulse', label: '脉冲电容器放电' },
      { value: 'constant-current', label: '恒流脉冲电源' }
    ]
  },
  { key: 'massKg', kind: 'number', label: '弹体/整车质量 M', unit: 'kg', defaultValue: 2.0, min: 0.5, max: 2500, step: 5 },
  { key: 'v0Mps', kind: 'number', label: '初速度 v₀', unit: 'm/s', defaultValue: 25, min: 0, max: 50, step: 1 },
  { key: 'bFieldT', kind: 'number', label: '导轨/电机等效 B', unit: 'T', defaultValue: 4.0, min: 1.0, max: 12.0, step: 0.5 },
  { key: 'trackSpanM', kind: 'number', label: '有效切割跨度 L', unit: 'm', defaultValue: 0.4, min: 0.2, max: 5.0, step: 0.1 },
  { key: 'circuitResOhm', kind: 'number', label: '内阻 R_int', unit: 'Ω', defaultValue: 0.25, min: 0.02, max: 1.0, step: 0.02 },
  { key: 'loadResOhm', kind: 'number', label: '储能负载 R_load', unit: 'Ω', defaultValue: 0.42, min: 0, max: 2.0, step: 0.05 },
  { key: 'capacitanceF', kind: 'number', label: '脉冲电容 C', unit: 'F', defaultValue: 0.2, min: 0.05, max: 2.0, step: 0.05 },
  { key: 'capVoltageV', kind: 'number', label: '电容初电压 U₀', unit: 'V', defaultValue: 800, min: 0, max: 2000, step: 50 },
  { key: 'driveCurrentA', kind: 'number', label: '恒流源电流 I', unit: 'A', defaultValue: 400, min: 50, max: 1000, step: 50 },
  { key: 'aeroDragCoeff', kind: 'number', label: '气动阻力系数 k_d', unit: 'N·s²/m²', defaultValue: 0.02, min: 0, max: 1.0, step: 0.02 },
  { key: 'mechBrakeN', kind: 'number', label: '机械摩擦制动力', unit: 'N', defaultValue: 0, min: 0, max: 4000, step: 100 }
];

export const stseEmLaunchRegenBrakePlugin = defineSimulationPlugin<EmLaunchRegenParams, EmLaunchRegenState>({
  meta: {
    id: 'stse-em-launch-regen-brake',
    title: '电磁弹射与新能源再生制动 (S03)',
    textbookRef: '人教版 选择性必修二 第二章 & 必修二 · 电磁能流 STSE',
    curriculumTags: ['物理观念', '科学思维', '科学态度与责任'],
    difficulty: '高三一轮',
    version: '2.0.0'
  },
  paramSchema,
  presets: emLaunchRegenPresets,
  engine: {
    createInitialState,
    step: stepEmLaunchRegen,
    computeObservables,
    checkInvariants
  },
  layers: [
    { id: 'track', label: '导轨滑行 / 制动车辆与能量堆叠条', defaultVisible: true }
  ],
  telemetryChannels: [
    { key: 'v', label: '速度 v', unit: 'm/s', color: '#38bdf8' },
    { key: 'x', label: '位移 x', unit: 'm', color: '#fbbf24' },
    { key: 'energyKineticKj', label: '动能 E_k', unit: 'kJ', color: '#4ade80' },
    { key: 'energyRegenKj', label: '再生回收能量', unit: 'kJ', color: '#a855f7' }
  ],
  sceneSerializer: {
    exportScene: (_s, params) => ({
      schemaVersion: '2.0',
      modelId: 'stse-em-launch-regen-brake',
      title: '电磁弹射与再生制动',
      params
    }),
    importScene: (dsl) => dsl.params as Partial<EmLaunchRegenParams>
  },
  exportDiagramIR: (state, params) => {
    const primitives: DiagramPrimitive[] = [
      { kind: 'line', x1: -2.0, y1: -0.6, x2: 2.0, y2: -0.6, strokeWidth: 2 },
      { kind: 'block', cx: -1.2 + Math.min(2.4, state.x * 0.05), cy: -0.35, width: 0.45, height: 0.45, label: 'M' },
      { kind: 'arrow', x1: -1.2 + Math.min(2.4, state.x * 0.05), y1: -0.35, x2: -0.6 + Math.min(2.4, state.x * 0.05), y2: -0.35, label: params.mode === 'railgun' ? 'F_A' : 'F_em' }
    ];
    return {
      width: 680,
      height: 360,
      viewBox: { minX: -2.2, minY: -1.2, maxX: 2.2, maxY: 1.2 },
      title: params.mode === 'railgun' ? '电磁导轨炮模型简图' : '再生制动电磁阻尼受力简图',
      primitives
    };
  },
  renderCanvas: (ctx, state, params, viewport, activeLayers) => {
    if (!activeLayers.has('track')) return;
    const m = createWorldMapper(viewport);
    ctx.save();
    const labels: CanvasLabel[] = [];

    // Top track & sliding armature/vehicle
    const trackLeft = m.toScreen(-2.2, 0.45);
    const trackRight = m.toScreen(2.2, 0.45);
    const trackY = trackLeft.y;
    drawMetallicRail(ctx, trackLeft.x, trackY, trackRight.x, m.len(0.08));

    const maxVisualX = params.mode === 'railgun' ? 25 : Math.max(10, computeAnalyticPureEmStopDistance(params) * 1.15);
    const fracX = Math.min(1, state.x / maxVisualX);
    const car = m.toScreen(-2.0 + fracX * 4.0, 0.58);
    ctx.fillStyle = params.mode === 'railgun' ? '#38bdf8' : '#4ade80';
    ctx.fillRect(car.x - m.len(0.18), car.y - m.len(0.13), m.len(0.36), m.len(0.22));

    // Stacked energy ledger bar
    const total = Math.max(1e-6, state.energyInitialJ + state.energyInputWorkJ);
    const barLeft = m.toScreen(-2.0, -0.65);
    const barRight = m.toScreen(2.0, -0.65);
    const barX = barLeft.x;
    const barY = barLeft.y;
    const barW = barRight.x - barLeft.x;
    const slices = [
      { val: state.energyKineticJ, col: '#38bdf8', name: '动能' },
      { val: state.energyCapJ, col: '#fbbf24', name: '电容余能' },
      { val: state.energyRegenJ, col: '#4ade80', name: '再生回收' },
      { val: state.energyJouleJ, col: '#ef4444', name: '内阻焦耳热' },
      { val: state.energyDragMechJ, col: '#94a3b8', name: '风阻/机械摩擦' }
    ];
    let curX = barX;
    slices.forEach((sl) => {
      const segW = Math.max(0, (sl.val / total) * barW);
      if (segW > 0.5) {
        ctx.fillStyle = sl.col;
        ctx.fillRect(curX, barY, segW, m.len(0.15));
        curX += segW;
      }
    });

    labels.push(
      { id: 'launch-state-summary', ...m.toScreen(0, 0.95), text: `t=${state.t.toFixed(2)}s | x=${state.x.toFixed(2)}m | v=${state.v.toFixed(2)}m/s | 账本残差=${state.ledgerResidualJ.toExponential(2)} J`, color: '#e2e8f0', font: 'bold 13px ui-sans-serif, system-ui' },
      { id: 'launch-energy-summary', ...m.toScreen(-1.95, -0.45), text: `能量流账本占比（总投入 ${(total / 1000).toFixed(2)} kJ）`, color: '#e2e8f0', font: '12px ui-sans-serif, system-ui' }
    );
    resolveAndDrawLabels(ctx, labels, viewport.width, viewport.height);
    ctx.restore();
  },
  getControlHandles: (state, params) => {
    const maxVisualX = params.mode === 'railgun' ? 25 : Math.max(10, computeAnalyticPureEmStopDistance(params) * 1.15);
    const carX = -2 + Math.min(1, state.x / maxVisualX) * 4;
    return [
      params.mode === 'railgun'
        ? {
            id: 'railgun-drive-current',
            label: `I=${params.driveCurrentA} A`,
            position: { x: carX + (params.driveCurrentA / 1000) * 1.1, y: 0.58 },
            origin: { x: carX, y: 0.58 },
            handleKind: 'vector' as const,
            color: '#38bdf8',
            onDrag: (world: { x: number; y: number }) => ({ driveCurrentA: Math.max(50, Math.min(1000, Math.round(((world.x - carX) / 1.1) * 1000 / 50) * 50)) })
          }
        : {
            id: 'regen-v0',
            label: `v₀=${params.v0Mps} m/s`,
            position: { x: carX + (params.v0Mps / 50) * 1.2, y: 0.58 },
            origin: { x: carX, y: 0.58 },
            handleKind: 'vector' as const,
            color: '#4ade80',
            onDrag: (world: { x: number; y: number }) => ({ v0Mps: Math.max(0, Math.min(50, Math.round(((world.x - carX) / 1.2) * 50))) })
          }
    ];
  },
  getForceVectors: (state, params) => {
    const maxVisualX = params.mode === 'railgun' ? 25 : Math.max(10, computeAnalyticPureEmStopDistance(params) * 1.15);
    const origin = { x: -2 + Math.min(1, state.x / maxVisualX) * 4, y: 0.58 };
    const forceEm = params.mode === 'railgun'
      ? params.bFieldT * params.trackSpanM * state.currentA
      : -params.bFieldT * params.trackSpanM * Math.abs(state.currentA);
    const forceDrag = -params.aeroDragCoeff * state.v * Math.abs(state.v) - (state.v > 0 ? params.mechBrakeN : 0);
    return [
      { id: 'em-ampere', label: params.mode === 'railgun' ? 'F安 (发射)' : 'F安 (制动)', origin, force: { x: forceEm, y: 0 }, color: '#38bdf8', category: 'magnetic', unit: 'N' },
      ...(Math.abs(forceDrag) > 1e-3 ? [{ id: 'drag-mechanical', label: 'F阻', origin, force: { x: forceDrag, y: 0 }, color: '#f43f5e', category: 'friction' as const, unit: 'N' }] : [])
    ];
  },
  referenceFrames: [
    {
      id: 'armature-frame',
      label: '电枢/列车随动参考系',
      getOrigin: (state, params) => {
        const maxVisualX = params.mode === 'railgun' ? 25 : Math.max(10, computeAnalyticPureEmStopDistance(params) * 1.15);
        return { x: -2 + Math.min(1, state.x / maxVisualX) * 4, y: 0.58 };
      },
      getVelocity: (state, params) => {
        const maxVisualX = params.mode === 'railgun' ? 25 : Math.max(10, computeAnalyticPureEmStopDistance(params) * 1.15);
        return { x: (state.v / maxVisualX) * 4, y: 0 };
      }
    }
  ],
  formatFormulas: (state, params) => [
    {
      id: 'em-launch-regen-ledger',
      label: '电磁全能量账本与制动解析总距',
      latex:
        params.mode === 'railgun'
          ? 'E_{\\text{in}}=E_k+E_{\\text{cap}}+Q_J+W_{\\text{drag}}'
          : 'x_{\\text{停}}=\\frac{M v_0 R}{B^2 L^2}',
      substitutedLatex: `x=${state.x.toFixed(2)}\\text{ m},\\; E_k=${(state.energyKineticJ / 1000).toFixed(2)}\\text{ kJ},\\; |\\Delta E|=${state.ledgerResidualJ.toExponential(1)}\\text{ J}`
    }
  ]
});

export default stseEmLaunchRegenBrakePlugin;
