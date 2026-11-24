import { createWorldMapper, defineSimulationPlugin, type DiagramPrimitive, type ParamFieldSpec } from '@physforge/sim-sdk';
import { kinematicsChasePresets } from './presets.js';
import {
  checkInvariants,
  computeObservables,
  createInitialState,
  stepKinematicsChase,
  type KinematicsChaseParams,
  type KinematicsChaseState
} from './engine.js';

const paramSchema: readonly ParamFieldSpec<KinematicsChaseParams>[] = [
  {
    key: 'scenario',
    kind: 'select',
    label: '追及相遇情景',
    options: [
      { label: '刹车防撞临界（含反应时间）', value: 'brake-collision-avoid' },
      { label: '匀加速追及匀速（共速极值+相遇）', value: 'accelerate-chase' },
      { label: '双车制动单向锁止分析', value: 'two-stage-overtake' }
    ],
    defaultValue: 'accelerate-chase'
  },
  { key: 'vA0', kind: 'number', label: 'A车初速度 vA0', unit: 'm/s', min: 0, max: 35, step: 1, defaultValue: 0 },
  { key: 'aA', kind: 'number', label: 'A车加速度 aA', unit: 'm/s²', min: -10, max: 8, step: 0.5, defaultValue: 2 },
  { key: 'reactionTime', kind: 'number', label: 'A车反应时间 t反', unit: 's', min: 0, max: 1.5, step: 0.1, defaultValue: 0 },
  { key: 'xB0', kind: 'number', label: '初始间距 xB0', unit: 'm', min: 5, max: 80, step: 1, defaultValue: 16 },
  { key: 'vB0', kind: 'number', label: 'B车初速度 vB0', unit: 'm/s', min: 0, max: 25, step: 1, defaultValue: 8 },
  { key: 'aB', kind: 'number', label: 'B车加速度 aB', unit: 'm/s²', min: -8, max: 6, step: 0.5, defaultValue: 0 }
];

export const mechKinematicsChasePlugin = defineSimulationPlugin<
  KinematicsChaseParams,
  KinematicsChaseState
>({
  meta: {
    id: 'mech-kinematics-chase',
    title: '运动学追及相遇与多过程图像 (M01)',
    textbookRef: '人教版 必修第一册 第二章 第4节',
    curriculumTags: ['物理观念', '科学思维', '科学探究'],
    difficulty: '高三一轮',
    version: '2.0.0'
  },
  defaultView: { scale: 0.833, offsetRatioX: -0.2, offsetRatioY: 0.05 },
  paramSchema,
  presets: kinematicsChasePresets,
  engine: {
    createInitialState,
    step: stepKinematicsChase,
    computeObservables,
    checkInvariants
  },
  layers: [
    { id: 'cars', label: 'A/B 两车实时位置', defaultVisible: true },
    { id: 'eventPins', label: '共速与相遇临界钉点', defaultVisible: true }
  ],
  telemetryChannels: [
    { key: 'vA', label: 'A车速度 vA', unit: 'm/s', color: '#38bdf8' },
    { key: 'vB', label: 'B车速度 vB', unit: 'm/s', color: '#f472b6' },
    { key: 'deltaX', label: '两车间距 Δx', unit: 'm', color: '#4ade80' },
    { key: 'xA', label: 'A车位移 xA', unit: 'm', color: '#fbbf24' }
  ],
  getForceVectors: (state) => [
    { id: 'net-force-a', label: 'F_A (m=1 kg)', origin: { x: state.xA * 0.05, y: 0 }, force: { x: state.aACurrent, y: 0 }, color: '#38bdf8', category: 'net', unit: 'N' },
    { id: 'net-force-b', label: 'F_B (m=1 kg)', origin: { x: state.xB * 0.05, y: 0 }, force: { x: state.aBCurrent, y: 0 }, color: '#f472b6', category: 'net', unit: 'N' }
  ],
  getControlHandles: (_state, params) => [
    {
      id: 'initial-gap',
      label: `Δx₀=${params.xB0}m`,
      position: { x: params.xB0 * 0.05, y: 0.2 },
      handleKind: 'point',
      color: '#f472b6',
      onDrag: (wp) => ({ xB0: Math.max(5, Math.min(80, Math.round(wp.x / 0.05))) })
    }
  ],
  referenceFrames: [
    {
      id: 'car-a',
      label: 'A 车随动参考系',
      getOrigin: (state) => ({ x: state.xA * 0.05, y: 0 })
    }
  ],
  sceneSerializer: {
    exportScene: (_s, params) => ({
      schemaVersion: '2.0',
      modelId: 'mech-kinematics-chase',
      title: '追及相遇多过程',
      params
    }),
    importScene: (dsl) => dsl.params as Partial<KinematicsChaseParams>
  },
  exportDiagramIR: (state, params) => {
    const xa = Math.max(-2.5, Math.min(2.2, -1.8 + state.xA * 0.04));
    const xb = Math.max(-2.2, Math.min(2.5, -1.8 + state.xB * 0.04));
    const primitives: DiagramPrimitive[] = [
      { kind: 'hatchedGround', x1: -2.8, y1: -0.5, x2: 2.8, y2: -0.5 },
      { kind: 'block', cx: xa, cy: -0.25, width: 0.6, height: 0.36, label: 'A' },
      { kind: 'block', cx: xb, cy: -0.25, width: 0.6, height: 0.36, label: 'B' },
      { kind: 'arrow', x1: xa, y1: 0.15, x2: xa + Math.max(0.2, state.vA * 0.04), y2: 0.15, label: 'v_A' },
      { kind: 'arrow', x1: xb, y1: 0.15, x2: xb + Math.max(0.2, state.vB * 0.04), y2: 0.15, label: 'v_B' },
      { kind: 'mathLabel', x: 0, y: 0.9, text: `x_0 = ${params.xB0} m, \\Delta x = ${(state.xB - state.xA).toFixed(2)} m`, align: 'middle' }
    ];
    return {
      width: 720,
      height: 360,
      viewBox: { minX: -3, minY: -1.2, maxX: 3, maxY: 1.4 },
      title: '追及相遇过程示意图',
      primitives
    };
  },
  formatFormulas: (state) => [
    {
      id: 'chase-eq',
      label: '实时追及间距与相对速度',
      latex: '\\Delta x = x_B - x_A, \\quad \\Delta v = v_A - v_B',
      substitutedLatex: `\\Delta x = ${(state.xB - state.xA).toFixed(2)}\\text{ m},\\; v_A=${state.vA.toFixed(2)},\\; v_B=${state.vB.toFixed(2)}\\text{ m/s}`
    }
  ],
  renderCanvas: (ctx, state, _params, viewport, activeLayers) => {
    const m = createWorldMapper(viewport);
    const basePpm = Math.min(viewport.width, viewport.height) * 0.24 * 0.833;
    const toScr = (xMeters: number, laneY: number) => {
      const point = m.toScreen(xMeters * 0.05, -laneY);
      return { sx: point.x, sy: point.y };
    };

    ctx.save();
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    const trackStart = toScr(-20, 0.35);
    const trackEnd = toScr(120, 0.35);
    ctx.moveTo(trackStart.sx, trackStart.sy);
    ctx.lineTo(trackEnd.sx, trackEnd.sy);
    ctx.stroke();

    if (activeLayers.has('cars')) {
      const pA = toScr(state.xA, 0);
      const pB = toScr(state.xB, 0);
      ctx.fillStyle = '#38bdf8';
      const carWidth = m.len(44 / basePpm);
      const carHeight = m.len(28 / basePpm);
      ctx.fillRect(pA.sx - carWidth * 0.5, pA.sy - carHeight * 0.5, carWidth, carHeight);
      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 13px sans-serif';
      ctx.fillText('A', pA.sx - m.len(5 / basePpm), pA.sy + m.len(5 / basePpm));

      ctx.fillStyle = '#f472b6';
      ctx.fillRect(pB.sx - carWidth * 0.5, pB.sy - carHeight * 0.5, carWidth, carHeight);
      ctx.fillStyle = '#0f172a';
      ctx.fillText('B', pB.sx - m.len(5 / basePpm), pB.sy + m.len(5 / basePpm));

      ctx.fillStyle = '#e2e8f0';
      ctx.font = 'bold 12px monospace';
      ctx.fillText(`vA=${state.vA.toFixed(1)} m/s`, pA.sx - m.len(28 / basePpm), pA.sy - m.len(22 / basePpm));
      ctx.fillText(`vB=${state.vB.toFixed(1)} m/s`, pB.sx - m.len(28 / basePpm), pB.sy - m.len(22 / basePpm));
    }

    if (activeLayers.has('eventPins')) {
      for (const ev of state.events) {
        if (!ev.position) continue;
        const p = toScr(ev.position.x, -0.5);
        ctx.fillStyle = '#fbbf24';
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = 'bold 11px sans-serif';
        ctx.fillText(`${ev.label} @${ev.time.toFixed(2)}s`, p.sx + 8, p.sy + 4);
      }
    }
    ctx.restore();
  }
});

export default mechKinematicsChasePlugin;
