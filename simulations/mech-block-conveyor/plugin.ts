import { defineSimulationPlugin, type DiagramPrimitive, type ParamFieldSpec } from '@physforge/sim-sdk';
import { CLASSROOM_GRAVITY, degToRad } from '@physforge/physics-core';
import {
  checkInvariants,
  computeObservables,
  createInitialState,
  stepBlockConveyor,
  type BlockConveyorParams,
  type BlockConveyorState
} from './engine.js';

const paramSchema: readonly ParamFieldSpec<BlockConveyorParams>[] = [
  {
    key: 'systemMode',
    kind: 'select',
    label: '动力学场景',
    options: [
      { label: '水平/倾斜传送带模型', value: 'conveyor' },
      { label: '木块—长木板叠放模型', value: 'plank' }
    ],
    defaultValue: 'conveyor'
  },
  {
    key: 'massBlock',
    kind: 'number',
    label: '物块质量 m₁',
    unit: 'kg',
    min: 0.5,
    max: 10,
    step: 0.5,
    defaultValue: 2.0
  },
  {
    key: 'massPlank',
    kind: 'number',
    label: '木板质量 m₂（板块模式）',
    unit: 'kg',
    min: 0.5,
    max: 10,
    step: 0.5,
    defaultValue: 4.0
  },
  {
    key: 'muBlockCarrier',
    kind: 'number',
    label: '块与带/板间动摩擦因数 μ₁',
    unit: '',
    min: 0,
    max: 0.8,
    step: 0.05,
    defaultValue: 0.25
  },
  {
    key: 'muGround',
    kind: 'number',
    label: '木板与地面摩擦因数 μ₂',
    unit: '',
    min: 0,
    max: 0.5,
    step: 0.05,
    defaultValue: 0
  },
  {
    key: 'inclineDeg',
    kind: 'number',
    label: '传送带倾角 θ',
    unit: '°',
    min: 0,
    max: 45,
    step: 1,
    defaultValue: 0
  },
  {
    key: 'beltVelocity',
    kind: 'number',
    label: '传送带速度 v带',
    unit: 'm/s',
    min: -6,
    max: 6,
    step: 0.5,
    defaultValue: 4.0
  },
  {
    key: 'blockInitialV',
    kind: 'number',
    label: '物块初速度 v₁₀',
    unit: 'm/s',
    min: -6,
    max: 8,
    step: 0.5,
    defaultValue: 0
  },
  {
    key: 'plankInitialV',
    kind: 'number',
    label: '木板初速度 v₂₀',
    unit: 'm/s',
    min: -4,
    max: 6,
    step: 0.5,
    defaultValue: 0
  },
  {
    key: 'externalForcePlank',
    kind: 'number',
    label: '木板外力 F外（板块模式）',
    unit: 'N',
    min: 0,
    max: 30,
    step: 1,
    defaultValue: 0
  }
];

export const mechBlockConveyorPlugin = defineSimulationPlugin<
  BlockConveyorParams,
  BlockConveyorState
>({
  meta: {
    id: 'mech-block-conveyor',
    title: '动力学板块模型与传送带摩擦力突变',
    textbookRef: '人教版 必修第一册 第四章 第5–6节',
    curriculumTags: ['物理观念', '科学思维', '科学探究'],
    difficulty: '压轴专题',
    version: '1.0.0'
  },
  paramSchema,
  presets: [
    {
      id: 'conveyor-horizontal-startup',
      name: '1. 水平传送带从静止加速至共速',
      description: '物块无初速放上 4 m/s 传送带，观测划痕恰好等于物块对地位移，电机额外耗能一半转化为动能、一半生热。',
      params: {
        systemMode: 'conveyor',
        massBlock: 2.0,
        muBlockCarrier: 0.25,
        inclineDeg: 0,
        beltVelocity: 4.0,
        blockInitialV: 0
      },
      visibleLayers: ['carrier', 'block', 'scratchTrack', 'forceAndVelocity', 'eventPins']
    },
    {
      id: 'conveyor-inclined-downward-break',
      name: '2. 倾斜向下传送带共速摩擦力突变',
      description: '37° 倾斜传送带逆时针向下 4 m/s 运转，因 μ=0.25 < tan37°，共速后滑动摩擦力由向下突变为向上，v-t 出现明显拐点！',
      params: {
        systemMode: 'conveyor',
        massBlock: 2.0,
        muBlockCarrier: 0.25,
        inclineDeg: 37,
        beltVelocity: -4.0,
        blockInitialV: 0
      },
      visibleLayers: ['carrier', 'block', 'scratchTrack', 'forceAndVelocity', 'eventPins']
    },
    {
      id: 'conveyor-misconception-positive-friction',
      name: '3. 易错反例：滑动摩擦力也可以做正功',
      description: '静止物块被高速传送带拖动加速，对地而言滑动摩擦力方向与位移同向，正功使物块动能从 0 增至 mv²/2。',
      params: {
        systemMode: 'conveyor',
        massBlock: 1.5,
        muBlockCarrier: 0.3,
        inclineDeg: 0,
        beltVelocity: 5.0,
        blockInitialV: 0
      },
      visibleLayers: ['carrier', 'block', 'scratchTrack', 'forceAndVelocity', 'eventPins']
    },
    {
      id: 'plank-smooth-ground-momentum',
      name: '4. 光滑地面板块滑行至共速',
      description: '物块以 6 m/s 滑上静止 4 kg 长木板，动量守恒最终共速 2 m/s，实时量化木板位移与相对划痕长度。',
      params: {
        systemMode: 'plank',
        massBlock: 2.0,
        massPlank: 4.0,
        muBlockCarrier: 0.2,
        muGround: 0,
        blockInitialV: 6.0,
        plankInitialV: 0,
        externalForcePlank: 0
      },
      visibleLayers: ['carrier', 'block', 'scratchTrack', 'forceAndVelocity', 'eventPins']
    }
  ],
  engine: {
    createInitialState,
    step: stepBlockConveyor,
    computeObservables,
    checkInvariants
  },
  layers: [
    { id: 'carrier', label: '传送带 / 长木板本体', defaultVisible: true },
    { id: 'block', label: '运动物块', defaultVisible: true },
    { id: 'scratchTrack', label: '相对划痕长度 Δx_rel 可视条', defaultVisible: true },
    { id: 'forceAndVelocity', label: '速度与摩擦力方向矢量', defaultVisible: true },
    { id: 'eventPins', label: '共速临界突变点', defaultVisible: true }
  ],
  telemetryChannels: [
    { key: 'vBlock', label: '物块速度 v物', unit: 'm/s', color: '#38bdf8' },
    { key: 'vCarrier', label: '带/板速度 v带', unit: 'm/s', color: '#fbbf24' },
    { key: 'relativeScratch', label: '累计划痕 Δx_rel', unit: 'm', color: '#f472b6' },
    { key: 'frictionHeat', label: '摩擦生热 Q', unit: 'J', color: '#fb7185' },
    { key: 'kineticEnergy', label: '总动能 Ek', unit: 'J', color: '#4ade80' }
  ],
  getControlHandles: (_state, params) => [
    {
      id: 'belt-velocity',
      label: `${params.systemMode === 'conveyor' ? 'v带' : 'v板'}=${params.beltVelocity.toFixed(1)}m/s`,
      position: { x: params.beltVelocity * 0.3, y: -0.6 },
      origin: { x: 0, y: -0.6 },
      handleKind: 'vector',
      color: '#fbbf24',
      onDrag: (wp) => ({
        beltVelocity: Number(Math.max(-6, Math.min(6, Math.round((wp.x / 0.3) * 2) / 2)).toFixed(1))
      })
    }
  ],
  getForceVectors: (state, params) => {
    const theta = params.systemMode === 'conveyor' ? degToRad(params.inclineDeg) : 0;
    const m = params.massBlock;
    const g = CLASSROOM_GRAVITY;
    const mg = m * g;
    const normalMag = mg * Math.cos(theta);
    const vRel = state.vBlock - state.vCarrier;
    const fMax = params.muBlockCarrier * normalMag;
    const fAlong = state.coMovingLocked ? m * g * Math.sin(theta) : Math.abs(vRel) < 1e-9 ? 0 : vRel > 0 ? -fMax : fMax;
    const bx = state.xBlock * 0.25;
    const by = bx * Math.tan(theta);
    return [
      { id: 'gravity', label: 'mg', origin: { x: bx, y: by }, force: { x: 0, y: -mg }, color: '#fbbf24', unit: 'N' },
      { id: 'normal', label: 'F_N', origin: { x: bx, y: by }, force: { x: -normalMag * Math.sin(theta), y: normalMag * Math.cos(theta) }, color: '#38bdf8', unit: 'N' },
      { id: 'friction', label: 'f', origin: { x: bx, y: by }, force: { x: fAlong * Math.cos(theta), y: fAlong * Math.sin(theta) }, color: '#f472b6', unit: 'N' }
    ];
  },
  referenceFrames: [
    {
      id: 'carrier',
      label: '传送带/长木板参考系',
      getOrigin: (state, params) => {
        const theta = params.systemMode === 'conveyor' ? degToRad(params.inclineDeg) : 0;
        const s = state.xCarrier * 0.25;
        return { x: s * Math.cos(theta), y: s * Math.sin(theta) };
      }
    }
  ],
  sceneSerializer: {
    exportScene: (_s, params) => ({
      schemaVersion: '2.0',
      modelId: 'mech-block-conveyor',
      title: '传送带与板块动力学',
      params
    }),
    importScene: (dsl) => dsl.params as Partial<BlockConveyorParams>
  },
  exportDiagramIR: (state, params) => {
    const theta = params.systemMode === 'conveyor' ? degToRad(params.inclineDeg) : 0;
    const primitives: DiagramPrimitive[] = [
      { kind: 'hatchedGround', x1: -3.2 * Math.cos(theta), y1: -3.2 * Math.sin(theta) - 0.25, x2: 3.2 * Math.cos(theta), y2: 3.2 * Math.sin(theta) - 0.25 },
      { kind: 'block', cx: 0, cy: 0.1, width: 0.7, height: 0.45, angleDeg: params.inclineDeg, label: 'm_1' },
      { kind: 'arrow', x1: 0, y1: 0.1, x2: 0, y2: -0.9, label: 'mg' },
      { kind: 'mathLabel', x: 2.6, y: 1.4, text: `\\mu=${params.muBlockCarrier}, Q=${state.frictionHeat.toFixed(2)} J`, align: 'end' }
    ];
    return {
      width: 720,
      height: 400,
      viewBox: { minX: -3.5, minY: -2, maxX: 3.5, maxY: 2 },
      title: '板块与倾斜传送带受力配图',
      primitives
    };
  },
  formatFormulas: (state) => [
    {
      id: 'scratch-heat',
      label: '相对划痕生热与位移对比',
      latex: 'Q = f_k \\cdot \\Delta x_{\\text{rel}}',
      substitutedLatex: `Q = ${state.frictionHeat.toFixed(2)}\\text{ J},\\; \\Delta x_{\\text{rel}} = ${state.relativeScratch.toFixed(2)}\\text{ m},\\; x_{\\text{物}} = ${state.xBlock.toFixed(2)}\\text{ m}`
    }
  ],
  renderCanvas: (ctx, state, params, viewport, activeLayers) => {
    const theta = params.systemMode === 'conveyor' ? (params.inclineDeg * Math.PI) / 180 : 0;
    const pxPerM = Math.min(viewport.width, viewport.height) * 0.085 * viewport.scale;
    const camCenterS = 0.5 * (state.xBlock + state.xCarrier);

    ctx.save();
    // 把坐标系平移到屏幕中心偏下，并逆时针旋转 theta（Canvas y 向下，故旋转 -theta 使 +x 沿斜面向上！）
    ctx.translate(viewport.width * 0.5 + viewport.offsetX, viewport.height * 0.58 + viewport.offsetY);
    ctx.rotate(-theta);

    const toLocalX = (s: number) => (s - camCenterS) * pxPerM;

    // 1. 传送带或木板
    if (activeLayers.has('carrier')) {
      if (params.systemMode === 'conveyor') {
        const beltLen = 9 * pxPerM;
        const beltHalf = 0.5 * beltLen;
        const rWheel = 22;
        ctx.fillStyle = 'rgba(51, 65, 85, 0.75)';
        ctx.strokeStyle = '#94a3b8';
        ctx.lineWidth = 2.5;
        ctx.fillRect(-beltHalf, 0, beltLen, rWheel * 2);
        ctx.strokeRect(-beltHalf, 0, beltLen, rWheel * 2);

        // 传送带滚轮
        for (const wx of [-beltHalf, beltHalf]) {
          ctx.fillStyle = '#475569';
          ctx.beginPath();
          ctx.arc(wx, rWheel, rWheel, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }

        // 传送带表面移动刻度点，体现传送带速度
        ctx.fillStyle = '#fbbf24';
        const spacing = 0.8;
        const shift = ((state.xCarrier % spacing) + spacing) % spacing;
        for (let m = -4.5 + shift; m <= 4.5; m += spacing) {
          ctx.beginPath();
          ctx.arc(m * pxPerM, 5, 3, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        // 长木板
        const plankW = 5.5 * pxPerM;
        const plankH = 26;
        const plankLeft = toLocalX(state.xCarrier) - 0.5 * pxPerM;
        ctx.fillStyle = 'rgba(251, 191, 36, 0.25)';
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 2.5;
        ctx.fillRect(plankLeft, 0, plankW, plankH);
        ctx.strokeRect(plankLeft, 0, plankW, plankH);
        // 地面线
        ctx.strokeStyle = '#64748b';
        ctx.beginPath();
        ctx.moveTo(-viewport.width, plankH + 1);
        ctx.lineTo(viewport.width, plankH + 1);
        ctx.stroke();
      }
    }

    // 2. 相对划痕视觉高亮带
    if (activeLayers.has('scratchTrack') && state.relativeScratch > 0.01) {
      const xB = toLocalX(state.xBlock);
      const xC = toLocalX(state.xCarrier);
      const left = Math.min(xB, xC);
      const w = Math.abs(xB - xC);
      ctx.fillStyle = 'rgba(244, 114, 182, 0.75)';
      ctx.fillRect(left, -4, w, 4);
    }

    // 3. 物块主体
    const bx = toLocalX(state.xBlock);
    const blockW = 46;
    const blockH = 34;
    if (activeLayers.has('block')) {
      ctx.fillStyle = '#38bdf8';
      ctx.strokeStyle = '#e0f2fe';
      ctx.lineWidth = 2;
      ctx.fillRect(bx - blockW * 0.5, -blockH, blockW, blockH);
      ctx.strokeRect(bx - blockW * 0.5, -blockH, blockW, blockH);
    }

    // 4. 速度标注
    if (activeLayers.has('forceAndVelocity')) {
      ctx.fillStyle = '#38bdf8';
      ctx.font = 'bold 14px system-ui, sans-serif';
      ctx.fillText(`v物=${state.vBlock.toFixed(2)} m/s`, bx - 36, -blockH - 12);
      ctx.fillStyle = '#fbbf24';
      ctx.fillText(
        `${params.systemMode === 'conveyor' ? 'v带' : 'v板'}=${state.vCarrier.toFixed(2)} m/s`,
        toLocalX(state.xCarrier) - 36,
        54
      );
    }

    ctx.restore();

    // 顶部同屏量化对比条（世界固定HUD）
    if (activeLayers.has('scratchTrack')) {
      ctx.save();
      ctx.fillStyle = 'rgba(15, 23, 42, 0.72)';
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.3)';
      ctx.fillRect(16, 16, 330, 74);
      ctx.strokeRect(16, 16, 330, 74);
      ctx.fillStyle = '#e2e8f0';
      ctx.font = 'bold 14px system-ui, sans-serif';
      ctx.fillText(`物块对地位移 x物 = ${state.xBlock.toFixed(2)} m`, 28, 38);
      ctx.fillStyle = '#fbbf24';
      ctx.fillText(`带/板位移 x带 = ${state.xCarrier.toFixed(2)} m`, 28, 59);
      ctx.fillStyle = '#f472b6';
      ctx.fillText(
        `相对划痕 Δx_rel = ${state.relativeScratch.toFixed(2)} m  |  Q = ${state.frictionHeat.toFixed(2)} J`,
        28,
        80
      );
      ctx.restore();
    }
  }
});

export default mechBlockConveyorPlugin;
