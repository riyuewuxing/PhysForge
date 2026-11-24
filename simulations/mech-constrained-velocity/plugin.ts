import { createWorldMapper, defineSimulationPlugin, type DiagramPrimitive, type ParamFieldSpec } from '@physforge/sim-sdk';
import { constrainedVelocityPresets } from './presets.js';
import {
  checkInvariants,
  computeObservables,
  createInitialState,
  stepConstrainedVelocity,
  type ConstrainedVelocityParams,
  type ConstrainedVelocityState
} from './engine.js';

const paramSchema: readonly ParamFieldSpec<ConstrainedVelocityParams>[] = [
  {
    key: 'mode',
    kind: 'select',
    label: '关联速度模型',
    options: [
      { label: '岸边滑轮收绳拉船', value: 'rope-pull-boat' },
      { label: '直杆靠墙角下滑', value: 'ladder-wall' },
      { label: '斜面推竖直轻杆', value: 'wedge-rod' }
    ],
    defaultValue: 'rope-pull-boat'
  },
  { key: 'driveSpeed', kind: 'number', label: '驱动端速率 v₀', unit: 'm/s', min: 0.5, max: 5, step: 0.5, defaultValue: 1.5 },
  { key: 'heightOrLength', kind: 'number', label: '滑轮高度 H / 杆长 L', unit: 'm', min: 1.0, max: 4.0, step: 0.2, defaultValue: 1.8 },
  { key: 'initialAngleDeg', kind: 'number', label: '初始几何倾角 θ', unit: '°', min: 15, max: 75, step: 5, defaultValue: 25 }
];

export const mechConstrainedVelocityPlugin = defineSimulationPlugin<
  ConstrainedVelocityParams,
  ConstrainedVelocityState
>({
  meta: {
    id: 'mech-constrained-velocity',
    title: '关联速度（绳拉船 / 靠墙杆 / 接触面分解）(M03)',
    textbookRef: '人教版 必修第二册 第五章 第1–2节',
    curriculumTags: ['物理观念', '科学思维'],
    difficulty: '高三一轮',
    version: '2.0.0'
  },
  defaultView: { scale: 0.667, offsetRatioX: -0.2, offsetRatioY: 0.22 },
  paramSchema,
  presets: constrainedVelocityPresets,
  engine: {
    createInitialState,
    step: stepConstrainedVelocity,
    computeObservables,
    checkInvariants
  },
  layers: [
    { id: 'geometry', label: '滑轮/绳杆接触轮廓', defaultVisible: true },
    { id: 'decomposition', label: '合速度与沿绳正交分解', defaultVisible: true }
  ],
  telemetryChannels: [
    { key: 'speedA', label: 'A 端速率', unit: 'm/s', color: '#38bdf8' },
    { key: 'speedB', label: 'B 端速率', unit: 'm/s', color: '#f472b6' },
    { key: 'angleDeg', label: '几何角 θ', unit: '°', color: '#fbbf24' }
  ],
  getControlHandles: (_state, params) => [
    {
      id: 'initial-angle',
      label: `θ=${params.initialAngleDeg}°`,
      position: { x: 1.5, y: 0.8 },
      handleKind: 'angle',
      color: '#fbbf24',
      onDrag: (wp) => ({
        initialAngleDeg: Math.max(15, Math.min(75, Math.round((Math.atan2(Math.max(0.2, wp.y), Math.max(0.2, wp.x)) * 180) / Math.PI / 5) * 5))
      })
    }
  ],
  getForceVectors: (state) => [
    { id: 'gravity-specific-a', label: 'g_A', origin: state.posA, force: { x: 0, y: -9.81 }, color: '#fbbf24', category: 'gravity', unit: 'N/kg' },
    { id: 'gravity-specific-b', label: 'g_B', origin: state.posB, force: { x: 0, y: -9.81 }, color: '#fb923c', category: 'gravity', unit: 'N/kg' }
  ],
  referenceFrames: [
    {
      id: 'block-a',
      label: 'A 端随动参考系',
      getOrigin: (s) => ({ x: s.posA.x, y: s.posA.y }),
      getVelocity: (s) => ({ x: s.velA.x, y: s.velA.y })
    }
  ],
  sceneSerializer: {
    exportScene: (_s, params) => ({
      schemaVersion: '2.0',
      modelId: 'mech-constrained-velocity',
      title: '关联速度约束分解',
      params
    }),
    importScene: (dsl) => dsl.params as Partial<ConstrainedVelocityParams>
  },
  exportDiagramIR: (state, params) => {
    const primitives: DiagramPrimitive[] = [
      { kind: 'hatchedGround', x1: -0.5, y1: 0, x2: 4.5, y2: 0 },
      { kind: 'line', x1: state.posA.x, y1: state.posA.y, x2: state.posB.x, y2: state.posB.y },
      { kind: 'block', cx: state.posA.x, cy: state.posA.y + 0.15, width: 0.4, height: 0.3, label: 'A' },
      { kind: 'arrow', x1: state.posA.x, y1: state.posA.y + 0.15, x2: state.posA.x + state.velA.x * 0.4, y2: state.posA.y + 0.15 + state.velA.y * 0.4, label: 'v_A' },
      { kind: 'mathLabel', x: 2.5, y: 2.2, text: `v_{rope}=${params.driveSpeed}m/s, \\theta=${state.angleDeg.toFixed(1)}^\\circ` }
    ];
    return {
      width: 720,
      height: 440,
      viewBox: { minX: -0.8, minY: -0.6, maxX: 4.8, maxY: 2.8 },
      title: '关联速度与沿绳正交分解配图',
      primitives
    };
  },
  formatFormulas: (state) => [
    {
      id: 'proj-eq',
      label: '速度关联投影守恒',
      latex: '\\mathbf{v}_A\\cdot\\hat{\\mathbf{e}}_{AB} = \\mathbf{v}_B\\cdot\\hat{\\mathbf{e}}_{AB}',
      substitutedLatex: `v_{\\parallel} = ${Math.abs(state.projSpeedA).toFixed(3)}\\text{ m/s},\\; \\theta=${state.angleDeg.toFixed(1)}^\\circ`
    }
  ],
  renderCanvas: (ctx, state, _params, viewport, activeLayers) => {
    const m = createWorldMapper(viewport);
    const toScr = (wx: number, wy: number) => {
      const point = m.toScreen(wx, wy);
      return { sx: point.x, sy: point.y };
    };

    ctx.save();
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    const floorStart = toScr(-1.2, 0);
    const floorEnd = toScr(6.5, 0);
    const wallBottom = toScr(0, 0);
    const wallTop = toScr(0, 4.2);
    ctx.moveTo(floorStart.sx, floorStart.sy);
    ctx.lineTo(floorEnd.sx, floorEnd.sy);
    ctx.moveTo(wallBottom.sx, wallBottom.sy);
    ctx.lineTo(wallTop.sx, wallTop.sy);
    ctx.stroke();

    const pA = toScr(state.posA.x, state.posA.y);
    const pB = toScr(state.posB.x, state.posB.y);
    if (activeLayers.has('geometry')) {
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(pA.sx, pA.sy);
      ctx.lineTo(pB.sx, pB.sy);
      ctx.stroke();

      ctx.fillStyle = '#38bdf8';
      ctx.beginPath();
      ctx.arc(pA.sx, pA.sy, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#f472b6';
      ctx.beginPath();
      ctx.arc(pB.sx, pB.sy, 9, 0, Math.PI * 2);
      ctx.fill();
    }

    if (activeLayers.has('decomposition')) {
      const drawVec = (from: { sx: number; sy: number }, v: { x: number; y: number }, col: string, lbl: string) => {
        if (Math.hypot(v.x, v.y) < 1e-4) return;
      const endpoint = m.toScreen(
        (from === pA ? state.posA.x : state.posB.x) + v.x * 0.35,
        (from === pA ? state.posA.y : state.posB.y) + v.y * 0.35
      );
      const tx = endpoint.x;
      const ty = endpoint.y;
        ctx.strokeStyle = col;
        ctx.fillStyle = col;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(from.sx, from.sy);
        ctx.lineTo(tx, ty);
        ctx.stroke();
        ctx.font = 'bold 12px monospace';
        ctx.fillText(lbl, tx + 6, ty - 6);
      };
      drawVec(pA, state.velA, '#4ade80', `vA=${Math.hypot(state.velA.x, state.velA.y).toFixed(2)}`);
      drawVec(pB, state.velB, '#fbbf24', `vB=${Math.hypot(state.velB.x, state.velB.y).toFixed(2)}`);
    }
    ctx.restore();
  }
});

export default mechConstrainedVelocityPlugin;
