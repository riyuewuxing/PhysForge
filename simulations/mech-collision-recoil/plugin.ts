import { createWorldMapper, defineSimulationPlugin, type DiagramPrimitive, type ForceVectorItem, type ParamFieldSpec } from '@physforge/sim-sdk';
import { collisionRecoilPresets } from './presets.js';
import {
  checkInvariants,
  computeObservables,
  createInitialState,
  stepCollisionRecoil,
  type CollisionRecoilParams,
  type CollisionRecoilState
} from './engine.js';

const paramSchema: readonly ParamFieldSpec<CollisionRecoilParams>[] = [
  {
    key: 'mode',
    kind: 'select',
    label: '物理模型',
    defaultValue: 'collision-2d-oblique',
    options: [
      { value: 'collision-2d-oblique', label: '二维非对心斜碰' },
      { value: 'collision-1d', label: '一维正碰 (e∈[0,1])' },
      { value: 'bullet-block', label: '子弹打木块' },
      { value: 'boat-recoil', label: '人船反冲（质心守恒）' }
    ]
  },
  { key: 'mass1', kind: 'number', label: '物体1 / 人质量 m₁', unit: 'kg', min: 0.2, max: 6, step: 0.2, defaultValue: 2 },
  { key: 'mass2', kind: 'number', label: '物体2 / 船质量 m₂', unit: 'kg', min: 0.5, max: 8, step: 0.5, defaultValue: 2 },
  { key: 'v10', kind: 'number', label: '初速度 / 相对速度 v₁₀', unit: 'm/s', min: 0, max: 10, step: 0.5, defaultValue: 4 },
  { key: 'v20', kind: 'number', label: '2号球初速度 v₂₀', unit: 'm/s', min: -5, max: 5, step: 0.5, defaultValue: 0 },
  { key: 'restitutionE', kind: 'number', label: '恢复系数 e', unit: '', min: 0, max: 1, step: 0.05, defaultValue: 1 },
  { key: 'impactParamB', kind: 'number', label: '斜碰瞄准距 b', unit: 'm', min: -0.55, max: 0.55, step: 0.02, defaultValue: 0.36 },
  { key: 'radius1', kind: 'number', label: '1号球半径 R₁', unit: 'm', min: 0.12, max: 0.5, step: 0.02, defaultValue: 0.3 },
  { key: 'radius2', kind: 'number', label: '2号球半径 R₂', unit: 'm', min: 0.12, max: 0.5, step: 0.02, defaultValue: 0.3 },
  { key: 'dragForceF', kind: 'number', label: '木块内部阻力 f', unit: 'N', min: 2, max: 30, step: 2, defaultValue: 10 },
  { key: 'blockLength', kind: 'number', label: '木块 / 船长 L', unit: 'm', min: 1, max: 4, step: 0.2, defaultValue: 2 }
];

export const mechCollisionRecoilPlugin = defineSimulationPlugin<CollisionRecoilParams, CollisionRecoilState>({
  meta: {
    id: 'mech-collision-recoil',
    title: '碰撞、斜碰与反冲动量模型 (M09)',
    textbookRef: '人教版 选择性必修一 第一章',
    curriculumTags: ['物理观念', '科学思维', '科学探究'],
    difficulty: '压轴专题',
    version: '2.0.0'
  },
  defaultView: { scale: 0.5, offsetRatioX: 0.05, offsetRatioY: 0.02 },
  paramSchema,
  presets: collisionRecoilPresets,
  engine: {
    createInitialState,
    step: stepCollisionRecoil,
    computeObservables,
    checkInvariants
  },
  getForceVectors: (state, params) => {
    if (params.mode !== 'collision-1d' && params.mode !== 'bullet-block') return [];
    const g = 9.81;
    const m1 = Math.max(0.05, params.mass1);
    const m2 = Math.max(0.05, params.mass2);
    const vectors: ForceVectorItem[] = [
      { id: 'weight-1', label: 'm₁g', origin: { x: state.x1, y: state.y1 }, force: { x: 0, y: -m1 * g }, color: '#fbbf24', category: 'gravity' as const, unit: 'N' },
      { id: 'normal-1', label: 'N₁', origin: { x: state.x1, y: state.y1 }, force: { x: 0, y: m1 * g }, color: '#38bdf8', category: 'normal' as const, unit: 'N' },
      { id: 'weight-2', label: 'm₂g', origin: { x: state.x2, y: state.y2 }, force: { x: 0, y: -m2 * g }, color: '#fb923c', category: 'gravity' as const, unit: 'N' },
      { id: 'normal-2', label: 'N₂', origin: { x: state.x2, y: state.y2 }, force: { x: 0, y: m2 * g }, color: '#4ade80', category: 'normal' as const, unit: 'N' }
    ];
    if (params.mode === 'bullet-block' && state.bulletPhase === 'penetrating') {
      const drag = Math.max(1, params.dragForceF);
      vectors.push(
        { id: 'bullet-resistance', label: 'f', origin: { x: state.x1, y: state.y1 }, force: { x: -drag, y: 0 }, color: '#f472b6', category: 'friction', unit: 'N' },
        { id: 'block-resistance', label: 'f', origin: { x: state.x2, y: state.y2 }, force: { x: drag, y: 0 }, color: '#a78bfa', category: 'friction', unit: 'N' }
      );
    }
    return vectors;
  },
  layers: [
    { id: 'bodies', label: '碰撞体与轨迹', defaultVisible: true },
    { id: 'momentumTriangle', label: '动量矢量三角形 (p₁+p₂=p总)', defaultVisible: true },
    { id: 'cmLine', label: '系统质心参考轴', defaultVisible: true }
  ],
  telemetryChannels: [
    { key: 'px', label: '系统 x 总动量 px', unit: 'kg·m/s', color: '#38bdf8' },
    { key: 'ek', label: '系统总动能 Ek', unit: 'J', color: '#4ade80' },
    { key: 'heatLostJ', label: '内能/机械能损失 Q', unit: 'J', color: '#fb923c' },
    { key: 'vx1', label: '1号速度 vx₁', unit: 'm/s', color: '#f472b6' }
  ],
  referenceFrames: [
    {
      id: 'cm',
      label: '质心参考系',
      getOrigin: (s, params) => {
        const mTotal = params.mass1 + params.mass2;
        return { x: (params.mass1 * s.x1 + params.mass2 * s.x2) / mTotal, y: 0 };
      },
      getVelocity: (s, params) => ({
        x: s.pInitX / (params.mass1 + params.mass2),
        y: 0
      })
    }
  ],
  getControlHandles: (_s, params) =>
    params.mode === 'collision-2d-oblique'
      ? [
          {
            id: 'impact-b',
            label: `瞄准距 b=${params.impactParamB.toFixed(2)}m`,
            position: { x: -2.6, y: params.impactParamB },
            handleKind: 'point',
            color: '#4ade80',
            onDrag: (wp) => {
              const maxB = 0.9 * (params.radius1 + params.radius2);
              return { impactParamB: Number(Math.max(-maxB, Math.min(maxB, wp.y)).toFixed(2)) };
            }
          }
        ]
      : [],
  sceneSerializer: {
    exportScene: (_s, params) => ({
      schemaVersion: '2.0',
      modelId: 'mech-collision-recoil',
      title: '碰撞与反冲动量模型',
      params
    }),
    importScene: (dsl) => dsl.params as Partial<CollisionRecoilParams>
  },
  exportDiagramIR: (state, params) => {
    const primitives: DiagramPrimitive[] = [
      { kind: 'hatchedGround', x1: -3.5, y1: -0.9, x2: 3.5, y2: -0.9 },
      { kind: 'circle', cx: state.x1, cy: state.y1, r: params.radius1 },
      { kind: 'circle', cx: state.x2, cy: state.y2, r: params.radius2 },
      {
        kind: 'arrow',
        x1: state.x1,
        y1: state.y1,
        x2: state.x1 + state.vx1 * 0.25,
        y2: state.y1 + state.vy1 * 0.25,
        label: 'v_1'
      },
      {
        kind: 'mathLabel',
        x: 3.2,
        y: 1.5,
        text: `e=${params.restitutionE.toFixed(2)},\\; p_x=${state.pInitX.toFixed(2)}`,
        align: 'end'
      }
    ];
    return {
      width: 720,
      height: 400,
      viewBox: { minX: -3.6, minY: -1.4, maxX: 3.6, maxY: 2.0 },
      title: '碰撞与反冲试卷配图',
      primitives
    };
  },
  renderCanvas: (ctx, state, params, viewport, activeLayers) => {
    const m = createWorldMapper(viewport);
    const ppm = m.ppm;
    const toX = (wx: number) => m.toX(wx);
    const toY = (wy: number) => m.toY(wy);

    ctx.save();

    if (activeLayers.has('cmLine')) {
      const xCm = (params.mass1 * state.x1 + params.mass2 * state.x2) / (params.mass1 + params.mass2);
      ctx.save();
      ctx.strokeStyle = 'rgba(244, 63, 94, 0.7)';
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(toX(xCm), toY(-1.5));
      ctx.lineTo(toX(xCm), toY(1.5));
      ctx.stroke();
      ctx.fillStyle = '#fb7185';
      ctx.font = '12px sans-serif';
      ctx.fillText(`CM x=${xCm.toFixed(2)}m`, toX(xCm) + 5, toY(1.35));
      ctx.restore();
    }

    if (activeLayers.has('bodies')) {
      if (params.mode === 'bullet-block' || params.mode === 'boat-recoil') {
        const L = params.blockLength;
        const bx = toX(state.x2 - L / 2);
        const by = toY(0.32);
        ctx.fillStyle = params.mode === 'boat-recoil' ? '#0ea5e9' : '#d97706';
        ctx.fillRect(bx, by, L * ppm, 0.64 * ppm);
        ctx.strokeStyle = '#e2e8f0';
        ctx.strokeRect(bx, by, L * ppm, 0.64 * ppm);

        ctx.fillStyle = params.mode === 'boat-recoil' ? '#f43f5e' : '#38bdf8';
        ctx.beginPath();
        ctx.arc(toX(state.x1), toY(state.y1), Math.max(8, params.radius1 * ppm), 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.strokeStyle = 'rgba(148,163,184,0.35)';
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(toX(-3.5), toY(0));
        ctx.lineTo(toX(3.5), toY(0));
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = '#38bdf8';
        ctx.beginPath();
        ctx.arc(toX(state.x1), toY(state.y1), Math.max(10, params.radius1 * ppm), 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#f472b6';
        ctx.beginPath();
        ctx.arc(toX(state.x2), toY(state.y2), Math.max(10, params.radius2 * ppm), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (activeLayers.has('momentumTriangle')) {
      const m1 = params.mass1;
      const m2 = params.mass2;
      const ox = viewport.width - 170;
      const oy = 95;
      const sc = 12;
      const p1x = m1 * state.vx1 * sc;
      const p1y = -m1 * state.vy1 * sc;
      const p2x = m2 * state.vx2 * sc;
      const p2y = -m2 * state.vy2 * sc;

      ctx.fillStyle = 'rgba(15,23,42,0.7)';
      ctx.fillRect(ox - 15, oy - 48, 155, 96);
      ctx.fillStyle = '#cbd5e1';
      ctx.font = '11px sans-serif';
      ctx.fillText('动量矢量三角形 (p₁+p₂=p)', ox - 8, oy - 32);

      const drawVec = (x0: number, y0: number, dx: number, dy: number, col: string) => {
        ctx.strokeStyle = col;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x0 + dx, y0 + dy);
        ctx.stroke();
      };
      drawVec(ox, oy, p1x, p1y, '#38bdf8');
      drawVec(ox + p1x, oy + p1y, p2x, p2y, '#f472b6');
      drawVec(ox, oy, p1x + p2x, p1y + p2y, '#4ade80');
    }

    ctx.restore();
  },
  formatFormulas: (state, params) => {
    const obs = computeObservables(state, params);
    return [
      {
        id: 'momentum',
        label: '系统总动量与机械能损耗',
        latex: 'p_x = m_1 v_{1x} + m_2 v_{2x}, \\quad Q = \\Delta E_k',
        substitutedLatex: `p_x = ${(obs.px ?? 0).toFixed(3)}\\text{ kg}\\cdot\\text{m/s},\\; Q = ${state.heatLostJ.toFixed(2)}\\text{ J}`
      },
      {
        id: 'dot-cm',
        label: params.mode === 'collision-2d-oblique' ? '速度内积验证 (正交=0)' : '系统质心位置',
        latex: params.mode === 'collision-2d-oblique' ? '\\mathbf{v}_1 \\cdot \\mathbf{v}_2' : 'x_{\\text{cm}} = \\frac{m_1 x_1 + m_2 x_2}{m_1+m_2}',
        substitutedLatex:
          params.mode === 'collision-2d-oblique'
            ? `\\mathbf{v}_1 \\cdot \\mathbf{v}_2 = ${(obs.vDotProduct ?? 0).toFixed(4)}\\text{ m}^2/\\text{s}^2`
            : `x_{\\text{cm}} = ${(obs.xCm ?? 0).toFixed(4)}\\text{ m}`
      }
    ];
  }
});

export default mechCollisionRecoilPlugin;
