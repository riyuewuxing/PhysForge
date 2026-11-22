import { defineSimulationPlugin, type DiagramPrimitive, type ParamFieldSpec } from '@physforge/sim-sdk';
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
  getControlHandles: (_state, params) => [
    {
      id: 'initial-gap',
      label: `Δx₀=${params.xB0}m`,
      position: { x: params.xB0 * 0.05 - 1.2, y: -0.2 },
      handleKind: 'point',
      color: '#f472b6',
      onDrag: (wp) => ({ xB0: Math.max(5, Math.min(80, Math.round((wp.x + 1.2) / 0.05))) })
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
    const ppm = Math.min(viewport.width, viewport.height) * 0.2 * viewport.scale;
    const ox = viewport.width * 0.25 + viewport.offsetX;
    const oy = viewport.height * 0.55 + viewport.offsetY;
    const toScr = (xMeters: number, laneY: number) => ({
      sx: ox + xMeters * 0.05 * ppm,
      sy: oy + laneY * ppm
    });

    ctx.save();
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(20, oy + 0.35 * ppm);
    ctx.lineTo(viewport.width - 20, oy + 0.35 * ppm);
    ctx.stroke();

    if (activeLayers.has('cars')) {
      const pA = toScr(state.xA, 0);
      const pB = toScr(state.xB, 0);
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(pA.sx - 22, pA.sy - 14, 44, 28);
      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 13px sans-serif';
      ctx.fillText('A', pA.sx - 5, pA.sy + 5);

      ctx.fillStyle = '#f472b6';
      ctx.fillRect(pB.sx - 22, pB.sy - 14, 44, 28);
      ctx.fillStyle = '#0f172a';
      ctx.fillText('B', pB.sx - 5, pB.sy + 5);

      ctx.fillStyle = '#e2e8f0';
      ctx.font = 'bold 12px monospace';
      ctx.fillText(`vA=${state.vA.toFixed(1)} m/s`, pA.sx - 28, pA.sy - 22);
      ctx.fillText(`vB=${state.vB.toFixed(1)} m/s`, pB.sx - 28, pB.sy - 22);
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
