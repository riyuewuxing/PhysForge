import { CLASSROOM_GRAVITY, degToRad } from '@physforge/physics-core';
import { defineSimulationPlugin, type DiagramPrimitive, type ForceVectorItem, type ParamFieldSpec } from '@physforge/sim-sdk';
import { rigidRollingPresets } from './presets.js';
import {
  SHAPE_INERTIA_COEFF,
  checkInvariants,
  computeRollingFriction,
  computeObservables,
  createInitialState,
  stepRigidRollingSlip,
  type RigidBodyShape,
  type RigidRollingParams,
  type RigidRollingState
} from './engine.js';

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

const paramSchema: readonly ParamFieldSpec<RigidRollingParams>[] = [
  {
    key: 'scenario',
    kind: 'select',
    label: '竞赛物理场景',
    defaultValue: 'flat-bowling-slip',
    options: [
      { value: 'flat-bowling-slip', label: '水平打滑→纯滚动转换 (Hybrid)' },
      { value: 'incline-race', label: '四刚体同斜面纯滚动竞速' }
    ]
  },
  {
    key: 'shape',
    kind: 'select',
    label: '刚体构型 I = c m R²',
    defaultValue: 'solid-sphere',
    options: [
      { value: 'solid-sphere', label: '实心球 (c = 2/5)' },
      { value: 'solid-cylinder', label: '实心圆柱 (c = 1/2)' },
      { value: 'hollow-sphere', label: '空心球壳 (c = 2/3)' },
      { value: 'thin-ring', label: '薄圆环 (c = 1)' }
    ]
  },
  { key: 'massKg', kind: 'number', label: '质量 m', unit: 'kg', defaultValue: 2.0, min: 0.5, max: 10, step: 0.5 },
  { key: 'radiusM', kind: 'number', label: '半径 R', unit: 'm', defaultValue: 0.12, min: 0.06, max: 0.3, step: 0.02 },
  { key: 'v0Mps', kind: 'number', label: '初质心速度 v₀', unit: 'm/s', defaultValue: 7.0, min: -10, max: 15, step: 0.5 },
  { key: 'omega0Radps', kind: 'number', label: '初角速度 ω₀', unit: 'rad/s', defaultValue: 0, min: -150, max: 100, step: 10 },
  { key: 'muK', kind: 'number', label: '动摩擦因数 μ_k', defaultValue: 0.25, min: 0.05, max: 0.8, step: 0.05 },
  { key: 'inclineDeg', kind: 'number', label: '斜面倾角 θ', unit: '°', defaultValue: 20, min: 5, max: 45, step: 5 }
];

export const compRigidRollingSlipPlugin = defineSimulationPlugin<RigidRollingParams, RigidRollingState>({
  meta: {
    id: 'comp-rigid-rolling-slip',
    title: '刚体定轴转动与滑滚转换 (C01)',
    textbookRef: '人教版 选择性必修一 & 强基竞赛 · 刚体转动与滑滚',
    curriculumTags: ['物理观念', '科学思维'],
    difficulty: '压轴专题',
    version: '2.0.0'
  },
  paramSchema,
  presets: rigidRollingPresets,
  engine: {
    createInitialState,
    step: stepRigidRollingSlip,
    computeObservables,
    checkInvariants
  },
  layers: [
    { id: 'main', label: '刚体滚轮与角线速度对照', defaultVisible: true }
  ],
  telemetryChannels: [
    { key: 'v', label: '质心速度 v', unit: 'm/s', color: '#38bdf8' },
    { key: 'omegaR', label: '边缘转动线速度 ωR', unit: 'm/s', color: '#fbbf24' },
    { key: 'slipSpeed', label: '触地相对滑速 v-ωR', unit: 'm/s', color: '#f43f5e' },
    { key: 'currentEnergyJ', label: '机械能 E', unit: 'J', color: '#4ade80' }
  ],
  getControlHandles: (state, params) => {
    if (params.scenario !== 'flat-bowling-slip' || state.t > 1e-12) return [];
    const radius = Math.max(0.05, params.radiusM);
    const velocityScale = 0.15;
    const angularScale = 0.015;
    const originY = radius;
    return [
      {
        id: 'initial-velocity',
        label: `v₀=${params.v0Mps.toFixed(2)}m/s`,
        position: { x: params.v0Mps * velocityScale, y: originY + 0.4 },
        origin: { x: 0, y: originY + 0.4 },
        handleKind: 'vector',
        color: '#38bdf8',
        onDrag: (worldPos) => ({ v0Mps: Number(clamp(worldPos.x / velocityScale, -10, 15).toFixed(2)) })
      },
      {
        id: 'initial-omega',
        label: `ω₀=${params.omega0Radps.toFixed(1)}rad/s`,
        position: { x: params.omega0Radps * radius * angularScale, y: originY },
        origin: { x: 0, y: originY },
        handleKind: 'vector',
        color: '#fbbf24',
        onDrag: (worldPos) => ({ omega0Radps: Number(clamp(worldPos.x / (radius * angularScale), -150, 100).toFixed(2)) })
      }
    ];
  },
  getForceVectors: (state, params): ForceVectorItem[] => {
    const incline = params.scenario === 'incline-race' ? degToRad(params.inclineDeg) : 0;
    const tangent = { x: Math.cos(incline), y: -Math.sin(incline) };
    const normal = { x: Math.sin(incline), y: Math.cos(incline) };
    const radius = Math.max(0.05, params.radiusM);
    const rowIndex: Record<RigidBodyShape, number> = {
      'solid-sphere': 0,
      'solid-cylinder': 1,
      'hollow-sphere': 2,
      'thin-ring': 3
    };
    let alongTrack = state.x;
    let rowY = 0;
    if (params.scenario === 'incline-race') {
      const maxX = Math.max(8, ...Object.values(state.inclinePositions));
      alongTrack = -1.4 + (state.inclinePositions[params.shape]! / maxX) * 2.8;
      rowY = 1.5 - rowIndex[params.shape] * 1.0;
    }
    const center = {
      x: alongTrack * tangent.x + radius * normal.x,
      y: rowY + alongTrack * tangent.y + radius * normal.y
    };
    const contact = { x: center.x - radius * normal.x, y: center.y - radius * normal.y };
    const friction = computeRollingFriction(
      state.v,
      state.omega,
      radius,
      params.massKg,
      params.muK,
      SHAPE_INERTIA_COEFF[params.shape],
      incline,
      CLASSROOM_GRAVITY
    );
    const weight = params.massKg * CLASSROOM_GRAVITY;
    const normalForce = weight * Math.max(0, Math.cos(incline));
    const vectors: ForceVectorItem[] = [
      { id: 'gravity', label: 'mg', origin: center, force: { x: 0, y: -weight }, color: '#fbbf24', category: 'gravity' },
      {
        id: 'normal', label: 'F_N', origin: contact,
        force: { x: normalForce * normal.x, y: normalForce * normal.y },
        color: '#38bdf8', category: 'normal'
      }
    ];
    if (Math.abs(friction.frictionAlongTangent) > 1e-5) {
      vectors.push({
        id: 'friction', label: friction.label, origin: contact,
        force: {
          x: friction.frictionAlongTangent * tangent.x,
          y: friction.frictionAlongTangent * tangent.y
        },
        color: '#f472b6', category: 'friction'
      });
    }
    return vectors;
  },
  sceneSerializer: {
    exportScene: (_s, params) => ({
      schemaVersion: '2.0',
      modelId: 'comp-rigid-rolling-slip',
      title: '刚体定轴转动与滑滚转换',
      params
    }),
    importScene: (dsl) => dsl.params as Partial<RigidRollingParams>
  },
  exportDiagramIR: (state, params) => {
    const primitives: DiagramPrimitive[] = [
      { kind: 'hatchedGround', x1: -2.0, y1: -0.5, x2: 2.0, y2: -0.5 },
      { kind: 'circle', cx: -0.4 + Math.min(1.6, state.x * 0.1), cy: -0.1, r: 0.4 },
      { kind: 'arrow', x1: -0.4 + Math.min(1.6, state.x * 0.1), y1: -0.1, x2: 0.3 + Math.min(1.6, state.x * 0.1), y2: -0.1, label: 'v' },
      { kind: 'mathLabel', x: 0, y: 1.0, text: `I=${SHAPE_INERTIA_COEFF[params.shape].toFixed(2)}mR^2`, align: 'middle' }
    ];
    return {
      width: 680,
      height: 360,
      viewBox: { minX: -2.2, minY: -1.1, maxX: 2.2, maxY: 1.3 },
      title: '刚体滑滚转换模型配图',
      primitives
    };
  },
  renderCanvas: (ctx, state, params, viewport, activeLayers) => {
    const w = viewport.width;
    const h = viewport.height;
    if (!activeLayers.has('main')) return;
    ctx.save();

    const ppm = Math.min(w, h) * 0.24 * viewport.scale;
    const anchorX = w * 0.45 + viewport.offsetX;
    const anchorY = h * 0.5 + viewport.offsetY;
    const toScreen = (x: number, y: number) => ({ x: anchorX + x * ppm, y: anchorY - y * ppm });

    if (params.scenario === 'incline-race') {
      const shapes: { key: RigidBodyShape; label: string; col: string }[] = [
        { key: 'solid-sphere', label: '实心球 (c=0.40)', col: '#4ade80' },
        { key: 'solid-cylinder', label: '实心圆柱 (c=0.50)', col: '#38bdf8' },
        { key: 'hollow-sphere', label: '空心球壳 (c=0.67)', col: '#fbbf24' },
        { key: 'thin-ring', label: '薄圆环 (c=1.00)', col: '#f43f5e' }
      ];
      const maxX = Math.max(8, ...Object.values(state.inclinePositions));
      const incline = degToRad(params.inclineDeg);
      const tangent = { x: Math.cos(incline), y: -Math.sin(incline) };
      const normal = { x: Math.sin(incline), y: Math.cos(incline) };
      shapes.forEach((sh, idx) => {
        const rowY = 1.5 - idx * 1.0;
        const start = toScreen(-1.4 * tangent.x, rowY - 1.4 * tangent.y);
        const end = toScreen(1.4 * tangent.x, rowY + 1.4 * tangent.y);
        ctx.strokeStyle = '#475569';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        ctx.stroke();

        const along = -1.4 + (state.inclinePositions[sh.key]! / maxX) * 2.8;
        const center = toScreen(along * tangent.x + params.radiusM * normal.x, rowY + along * tangent.y + params.radiusM * normal.y);
        ctx.fillStyle = sh.col;
        ctx.beginPath();
        ctx.arc(center.x, center.y, Math.max(8, params.radiusM * ppm), 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#e2e8f0';
        ctx.font = 'bold 12px ui-sans-serif, system-ui';
        ctx.fillText(`${sh.label}: x=${state.inclinePositions[sh.key]!.toFixed(2)}m`, start.x, start.y - 16);
      });
      ctx.restore();
      return;
    }

    const groundY = anchorY;
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(w * 0.08, groundY);
    ctx.lineTo(w * 0.92, groundY);
    ctx.stroke();

    const rPx = Math.max(8, params.radiusM * ppm);
    const ball = toScreen(state.x, params.radiusM);
    const ballX = ball.x;
    const ballY = ball.y;
    ctx.fillStyle = state.mode === 'pure-rolling' ? 'rgba(74, 222, 128, 0.25)' : 'rgba(244, 63, 94, 0.25)';
    ctx.strokeStyle = state.mode === 'pure-rolling' ? '#4ade80' : '#f43f5e';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(ballX, ballY, rPx, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Spoke to show rotation phase theta
    ctx.beginPath();
    ctx.moveTo(ballX, ballY);
    ctx.lineTo(ballX + rPx * Math.cos(-state.theta), ballY - rPx * Math.sin(-state.theta));
    ctx.stroke();

    ctx.fillStyle = '#e2e8f0';
    ctx.font = 'bold 13px ui-sans-serif, system-ui';
    ctx.fillText(
      `状态: ${state.mode === 'pure-rolling' ? '纯滚动 (v=ωR)' : '滑动搓地中'} | v=${state.v.toFixed(3)} m/s | ωR=${(state.omega * params.radiusM).toFixed(3)} m/s${state.transitionTimeS !== null ? ` | t_c=${state.transitionTimeS.toFixed(4)}s` : ''}`,
      20,
      30
    );
    ctx.restore();
  },
  formatFormulas: (state, params) => [
    {
      id: 'rigid-rolling',
      label: '刚体滑滚转换动力学',
      latex: 'I=cmR^2,\\quad t_c=\\frac{v_0-\\omega_0 R}{(1+1/c)\\mu_k g}',
      substitutedLatex: `v=${state.v.toFixed(3)}\\text{ m/s},\\; \\omega R=${(state.omega * params.radiusM).toFixed(3)}\\text{ m/s}`
    }
  ]
});

export default compRigidRollingSlipPlugin;
