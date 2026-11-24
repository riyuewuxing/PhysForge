import { createWorldMapper, defineSimulationPlugin, resolveAndDrawLabels, type CanvasLabel, type DiagramPrimitive, type ParamFieldSpec } from '@physforge/sim-sdk';
import { CLASSROOM_GRAVITY } from '@physforge/physics-core';
import { chaosNormalCoriolisPresets } from './presets.js';
import {
  checkInvariants,
  computeObservables,
  createInitialState,
  stepChaosNormalCoriolis,
  type ChaosNormalCoriolisParams,
  type ChaosNormalCoriolisState
} from './engine.js';

const paramSchema: readonly ParamFieldSpec<ChaosNormalCoriolisParams>[] = [
  {
    key: 'mode',
    kind: 'select',
    label: '动力学模块',
    defaultValue: 'double-pendulum',
    options: [
      { value: 'double-pendulum', label: '混沌双摆 (RK45 + 初值分离)' },
      { value: 'normal-modes', label: '双耦合振子简正模与拍频' },
      { value: 'coriolis-disk', label: '旋转圆盘非惯性科里奥利力' }
    ]
  },
  { key: 'm1Kg', kind: 'number', label: '质点 1 质量 m₁', unit: 'kg', defaultValue: 1.0, min: 0.5, max: 3.0, step: 0.2 },
  { key: 'm2Kg', kind: 'number', label: '质点 2 质量 m₂', unit: 'kg', defaultValue: 1.0, min: 0.5, max: 3.0, step: 0.2 },
  { key: 'l1M', kind: 'number', label: '上杆长 L₁', unit: 'm', defaultValue: 1.0, min: 0.5, max: 1.8, step: 0.1 },
  { key: 'l2M', kind: 'number', label: '下杆长 L₂', unit: 'm', defaultValue: 1.0, min: 0.5, max: 1.8, step: 0.1 },
  { key: 'theta1Deg', kind: 'number', label: '初角 θ₁', unit: '°', defaultValue: 135, min: 10, max: 175, step: 5 },
  { key: 'theta2Deg', kind: 'number', label: '初角 θ₂', unit: '°', defaultValue: 135, min: 10, max: 175, step: 5 },
  { key: 'springKw', kind: 'number', label: '边墙弹簧 k_w', unit: 'N/m', defaultValue: 25, min: 5, max: 60, step: 5 },
  { key: 'springKc', kind: 'number', label: '耦合弹簧 k_c', unit: 'N/m', defaultValue: 10, min: 1, max: 40, step: 2 },
  {
    key: 'normalExcite',
    kind: 'select',
    label: '简正模初态激发',
    defaultValue: 'symmetric',
    options: [
      { value: 'symmetric', label: '同相简正模 x₁=x₂' },
      { value: 'antisymmetric', label: '反相简正模 x₁=-x₂' },
      { value: 'single-beat', label: '单侧偏置（拍频传递）' }
    ]
  },
  { key: 'diskOmegaRadps', kind: 'number', label: '圆盘角速度 Ω', unit: 'rad/s', defaultValue: 1.2, min: 0.2, max: 3.0, step: 0.2 },
  { key: 'puckSpeedMps', kind: 'number', label: '冰球惯性射速 v₀', unit: 'm/s', defaultValue: 0.9, min: 0.3, max: 2.0, step: 0.1 }
];

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

export const compChaosNormalCoriolisPlugin = defineSimulationPlugin<
  ChaosNormalCoriolisParams,
  ChaosNormalCoriolisState
>({
  meta: {
    id: 'comp-chaos-normal-coriolis',
    title: '混沌双摆、简正模与科里奥利力 (C02)',
    textbookRef: '人教版 选择性必修一 & 强基竞赛 · 分析力学与非惯性系',
    curriculumTags: ['物理观念', '科学思维'],
    difficulty: '压轴专题',
    version: '2.0.0'
  },
  paramSchema,
  presets: chaosNormalCoriolisPresets,
  engine: {
    createInitialState,
    step: stepChaosNormalCoriolis,
    computeObservables,
    checkInvariants
  },
  layers: [
    { id: 'main', label: '混沌分叉 / 简正波形 / 双系对照', defaultVisible: true }
  ],
  telemetryChannels: [
    { key: 'dpEnergyDriftRel', label: '双摆能量漂移', unit: '', color: '#4ade80' },
    { key: 'dpDivergenceRad', label: '双初值分离角距', unit: 'rad', color: '#f43f5e' },
    { key: 'x1Nm', label: '振子 1 位移', unit: 'm', color: '#38bdf8' },
    { key: 'x2Nm', label: '振子 2 位移', unit: 'm', color: '#fbbf24' }
  ],
  getForceVectors: (state, params) => {
    if (params.mode === 'double-pendulum') {
      const [theta1, theta2] = state.dpState;
      const bob1 = { x: params.l1M * Math.sin(theta1), y: -params.l1M * Math.cos(theta1) };
      const bob2 = { x: bob1.x + params.l2M * Math.sin(theta2), y: bob1.y - params.l2M * Math.cos(theta2) };
      return [
        { id: 'weight-1', label: 'm₁g', origin: bob1, force: { x: 0, y: -params.m1Kg * CLASSROOM_GRAVITY }, color: '#fbbf24', category: 'gravity', unit: 'N' },
        { id: 'weight-2', label: 'm₂g', origin: bob2, force: { x: 0, y: -params.m2Kg * CLASSROOM_GRAVITY }, color: '#fb923c', category: 'gravity', unit: 'N' }
      ];
    }
    if (params.mode === 'normal-modes') {
      const [x1, x2] = state.nmVerlet.positions;
      const safeX1 = x1 ?? 0;
      const safeX2 = x2 ?? 0;
      const origin1 = { x: safeX1, y: 0 };
      const origin2 = { x: safeX2, y: 0 };
      return [
        { id: 'normal-restoring-1', label: 'F₁', origin: origin1, force: { x: -params.springKw * safeX1 - params.springKc * (safeX1 - safeX2), y: 0 }, color: '#38bdf8', category: 'other', unit: 'N' },
        { id: 'normal-restoring-2', label: 'F₂', origin: origin2, force: { x: -params.springKw * safeX2 - params.springKc * (safeX2 - safeX1), y: 0 }, color: '#fbbf24', category: 'other', unit: 'N' }
      ];
    }
    const [x, y, vx, vy] = state.rotDirectState;
    const omega = params.diskOmegaRadps;
    return [
      { id: 'coriolis-specific', label: 'a_C (F/m)', origin: { x, y }, force: { x: 2 * omega * vy, y: -2 * omega * vx }, color: '#38bdf8', category: 'other', unit: 'N/kg' },
      { id: 'centrifugal-specific', label: 'a_cf (F/m)', origin: { x, y }, force: { x: omega * omega * x, y: omega * omega * y }, color: '#f472b6', category: 'other', unit: 'N/kg' }
    ];
  },
  getControlHandles: (state, params) => {
    if (params.mode !== 'double-pendulum') return [];
    const theta1 = state.dpState[0]!;
    const theta2 = state.dpState[1]!;
    const bob1 = { x: params.l1M * Math.sin(theta1), y: -params.l1M * Math.cos(theta1) };
    const bob2 = {
      x: bob1.x + params.l2M * Math.sin(theta2),
      y: bob1.y - params.l2M * Math.cos(theta2)
    };
    const angleFrom = (x: number, y: number) => {
      const thetaDeg = (Math.atan2(x, -y) * 180) / Math.PI;
      return Number(clamp(thetaDeg, 10, 175).toFixed(1));
    };
    return [
      {
        id: 'double-pendulum-bob1',
        label: `θ₁=${params.theta1Deg.toFixed(1)}°`,
        position: bob1,
        handleKind: 'point',
        color: '#38bdf8',
        onDrag: (worldPos) => ({ theta1Deg: angleFrom(worldPos.x, worldPos.y) })
      },
      {
        id: 'double-pendulum-bob2',
        label: `θ₂=${params.theta2Deg.toFixed(1)}°`,
        position: bob2,
        handleKind: 'point',
        color: '#fbbf24',
        onDrag: (worldPos) => ({ theta2Deg: angleFrom(worldPos.x - bob1.x, worldPos.y - bob1.y) })
      }
    ];
  },
  referenceFrames: [
    {
      id: 'inertial',
      label: '地面惯性系',
      description: '惯性实验室坐标系，原点位于旋转圆盘中心。',
      getOrigin: () => ({ x: 0, y: 0 }),
      getVelocity: () => ({ x: 0, y: 0 })
    },
    {
      id: 'rotating-disk',
      label: '旋转圆盘非惯性系',
      description: '圆盘中心与惯性系重合；科里奥利模式的并列视图同时展示两系轨迹。',
      getOrigin: () => ({ x: 0, y: 0 }),
      getVelocity: () => ({ x: 0, y: 0 })
    }
  ],
  sceneSerializer: {
    exportScene: (_s, params) => ({
      schemaVersion: '2.0',
      modelId: 'comp-chaos-normal-coriolis',
      title: '混沌双摆、简正模与科里奥利力',
      params
    }),
    importScene: (dsl) => dsl.params as Partial<ChaosNormalCoriolisParams>
  },
  exportDiagramIR: (state, params) => {
    const primitives: DiagramPrimitive[] = [
      { kind: 'line', x1: 0, y1: 1.0, x2: Math.sin(state.dpState[0]!), y2: 1.0 - Math.cos(state.dpState[0]!) },
      { kind: 'circle', cx: Math.sin(state.dpState[0]!), cy: 1.0 - Math.cos(state.dpState[0]!), r: 0.08, fill: true },
      { kind: 'mathLabel', x: 0, y: -1.2, text: `\\text{Mode: }${params.mode}`, align: 'middle' }
    ];
    return {
      width: 680,
      height: 400,
      viewBox: { minX: -2.2, minY: -1.5, maxX: 2.2, maxY: 1.5 },
      title: '分析力学与非惯性系示意图',
      primitives
    };
  },
  renderCanvas: (ctx, state, params, viewport, activeLayers) => {
    const m = createWorldMapper(viewport);
    if (!activeLayers.has('main')) return;
    ctx.save();

    if (params.mode === 'double-pendulum') {
      const pivot = m.toScreen(0, 0);
      const drawDp = (s: readonly [number, number, number, number], col: string) => {
        const bob1 = m.toScreen(params.l1M * Math.sin(s[0]), -params.l1M * Math.cos(s[0]));
        const bob2 = m.toScreen(
          params.l1M * Math.sin(s[0]) + params.l2M * Math.sin(s[1]),
          -params.l1M * Math.cos(s[0]) - params.l2M * Math.cos(s[1])
        );
        ctx.strokeStyle = col;
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        ctx.moveTo(pivot.x, pivot.y);
        ctx.lineTo(bob1.x, bob1.y);
        ctx.lineTo(bob2.x, bob2.y);
        ctx.stroke();
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(bob1.x, bob1.y, m.len(0.035), 0, Math.PI * 2);
        ctx.arc(bob2.x, bob2.y, m.len(0.035), 0, Math.PI * 2);
        ctx.fill();
      };
      drawDp(state.dpShadow, 'rgba(244, 63, 94, 0.55)');
      drawDp(state.dpState, '#38bdf8');
      ctx.fillStyle = '#e2e8f0';
      ctx.font = 'bold 13px ui-sans-serif, system-ui';
      ctx.fillText(`混沌双摆 Δθ₀=1e-4 分离 | 最大能量漂移 ${state.dpMaxRelDrift.toExponential(2)}`, 20, 28);
      ctx.restore();
      return;
    }

    if (params.mode === 'normal-modes') {
      const labels: CanvasLabel[] = [];
      const yMass = 0.5;
      const x1 = -0.9 + state.nmVerlet.positions[0]!;
      const x2 = 0.9 + state.nmVerlet.positions[1]!;
      const drawSpring = (startX: number, endX: number, y: number, color: string) => {
        const start = m.toScreen(startX, y);
        const end = m.toScreen(endX, y);
        const dx = end.x - start.x;
        const segments = 12;
        const amplitude = m.len(0.085);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.7;
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        for (let i = 1; i < segments; i++) {
          const t = i / segments;
          ctx.lineTo(start.x + dx * t, start.y + (i % 2 === 0 ? -amplitude : amplitude));
        }
        ctx.lineTo(end.x, end.y);
        ctx.stroke();
      };
      const wallLeft = m.toScreen(-2, 0.5);
      const wallRight = m.toScreen(2, 0.5);
      const mass1 = m.toScreen(x1, yMass);
      const mass2 = m.toScreen(x2, yMass);
      const halfMass = m.len(0.16);
      ctx.strokeStyle = '#64748b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(wallLeft.x, wallLeft.y - m.len(0.35));
      ctx.lineTo(wallLeft.x, wallLeft.y + m.len(0.35));
      ctx.moveTo(wallRight.x, wallRight.y - m.len(0.35));
      ctx.lineTo(wallRight.x, wallRight.y + m.len(0.35));
      ctx.stroke();
      drawSpring(-2, x1 - 0.16, yMass, '#94a3b8');
      drawSpring(x1 + 0.16, x2 - 0.16, yMass, '#a78bfa');
      drawSpring(x2 + 0.16, 2, yMass, '#94a3b8');
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(mass1.x - halfMass, mass1.y - halfMass, halfMass * 2, halfMass * 2);
      ctx.fillStyle = '#fbbf24';
      ctx.fillRect(mass2.x - halfMass, mass2.y - halfMass, halfMass * 2, halfMass * 2);

      const graphLeft = -1.8;
      const graphRight = 1.8;
      const graphBottom = -1.45;
      const graphCenterY = -1.0;
      const graphTop = -0.55;
      const graphA = m.toScreen(graphLeft, graphBottom);
      const graphB = m.toScreen(graphLeft, graphTop);
      const graphC = m.toScreen(graphRight, graphBottom);
      ctx.strokeStyle = '#64748b';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(graphA.x, graphA.y);
      ctx.lineTo(graphB.x, graphB.y);
      ctx.lineTo(graphB.x + m.len(graphRight - graphLeft), graphB.y);
      ctx.moveTo(graphA.x, graphA.y);
      ctx.lineTo(graphC.x, graphC.y);
      ctx.stroke();
      const drawTrail = (key: 'x1' | 'x2', color: string) => {
        if (state.nmTrail.length < 2) return;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        state.nmTrail.forEach((pt, idx) => {
          const wx = graphLeft + (idx / (state.nmTrail.length - 1)) * (graphRight - graphLeft);
          const wy = graphCenterY + clamp(pt[key] * 0.35, -0.42, 0.42);
          const point = m.toScreen(wx, wy);
          if (idx === 0) ctx.moveTo(point.x, point.y);
          else ctx.lineTo(point.x, point.y);
        });
        ctx.stroke();
      };
      drawTrail('x1', '#38bdf8');
      drawTrail('x2', '#fbbf24');
      labels.push(
        { id: 'normal-mode-summary', x: viewport.width * 0.5, y: 28, text: `耦合振子 (${params.normalExcite}) | x₁=${state.nmVerlet.positions[0]!.toFixed(3)}, x₂=${state.nmVerlet.positions[1]!.toFixed(3)}`, color: '#e2e8f0', font: 'bold 13px ui-sans-serif, system-ui' },
        { id: 'normal-mode-mass-1', x: mass1.x, y: mass1.y, text: 'm₁', color: '#0f172a', font: 'bold 12px ui-sans-serif, system-ui' },
        { id: 'normal-mode-mass-2', x: mass2.x, y: mass2.y, text: 'm₂', color: '#0f172a', font: 'bold 12px ui-sans-serif, system-ui' }
      );
      resolveAndDrawLabels(ctx, labels, viewport.width, viewport.height);
      ctx.restore();
      return;
    }

    const labels: CanvasLabel[] = [];
    const rDisk = m.len(1.0);
    const drawDisk = (worldX: number, title: string, pts: readonly { x: number; y: number }[], head: { x: number; y: number }, col: string) => {
      const center = m.toScreen(worldX, 0);
      ctx.strokeStyle = '#64748b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(center.x, center.y, rDisk, 0, Math.PI * 2);
      ctx.stroke();
      if (pts.length > 1) {
        ctx.strokeStyle = col;
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        pts.forEach((p, idx) => {
          const point = m.toScreen(worldX + p.x * 0.45, p.y * 0.45);
          if (idx === 0) ctx.moveTo(point.x, point.y);
          else ctx.lineTo(point.x, point.y);
        });
        ctx.stroke();
      }
      const headPoint = m.toScreen(worldX + head.x * 0.45, head.y * 0.45);
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(headPoint.x, headPoint.y, m.len(0.035), 0, Math.PI * 2);
      ctx.fill();
      const titlePoint = m.toScreen(worldX, -1.25);
      labels.push({ id: `coriolis-${worldX}`, x: titlePoint.x, y: titlePoint.y, text: title, color: '#e2e8f0', font: 'bold 13px ui-sans-serif, system-ui' });
    };
    drawDisk(
      -1.25,
      '地面惯性系（自由直轨）',
      state.coriolisTrail.map((p) => ({ x: p.lx, y: p.ly })),
      state.labPos,
      '#4ade80'
    );
    drawDisk(
      1.25,
      '转动圆盘系（科里奥利偏折）',
      state.coriolisTrail.map((p) => ({ x: p.rx, y: p.ry })),
      { x: state.rotDirectState[0]!, y: state.rotDirectState[1]! },
      '#38bdf8'
    );
    labels.push({ id: 'coriolis-summary', x: viewport.width * 0.5, y: 28, text: `双系轨迹重合偏差: ${state.coriolisDeviation.toExponential(2)}`, color: '#e2e8f0', font: 'bold 13px ui-sans-serif, system-ui' });
    resolveAndDrawLabels(ctx, labels, viewport.width, viewport.height);
    ctx.restore();
  },
  formatFormulas: (state, params) => [
    {
      id: 'comp-advanced-mech',
      label: '强基分析力学核心关系',
      latex:
        params.mode === 'normal-modes'
          ? '\\omega_1=\\sqrt{\\frac{k_w}{m}},\\quad \\omega_2=\\sqrt{\\frac{k_w+2k_c}{m}}'
          : '\\mathbf{a}_{\\text{非}}=-2\\boldsymbol{\\Omega}\\times\\mathbf{v}_r-\\boldsymbol{\\Omega}\\times(\\boldsymbol{\\Omega}\\times\\mathbf{r}_r)',
      substitutedLatex: `\\Delta E_{\\text{rel}}=${state.dpMaxRelDrift.toExponential(2)},\\; \\text{CorDev}=${state.coriolisDeviation.toExponential(2)}`
    }
  ]
});

export default compChaosNormalCoriolisPlugin;
