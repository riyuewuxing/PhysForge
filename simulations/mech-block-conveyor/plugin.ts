import type { LiveFormulaSpec } from '@physforge/sim-sdk';
import { createWorldMapper, defineSimulationPlugin, resolveAndDrawLabels, type CanvasLabel, type DiagramPrimitive, type ParamFieldSpec } from '@physforge/sim-sdk';
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


const liveFormulas: readonly LiveFormulaSpec[] = [
  {
    "id": "belt-kinetic-friction",
    "title": "斜传送带相对滑动时的摩擦力大小",
    "latex": "f_k=\\htmlClass{pf-live-var}{\\htmlData{param=muBlockCarrier}{\\mu_1}}\\htmlClass{pf-live-var}{\\htmlData{param=massBlock}{m_1}}g\\cos \\htmlClass{pf-live-var}{\\htmlData{param=inclineDeg}{\\theta}}",
    "bindings": [
      {
        "tokenKey": "muBlockCarrier",
        "paramKey": "muBlockCarrier",
        "label": "块与带/板间动摩擦因数 μ₁",
        "unit": "",
        "min": 0,
        "max": 0.8,
        "step": 0.05,
        "precision": 3
      },
      {
        "tokenKey": "massBlock",
        "paramKey": "massBlock",
        "label": "物块质量 m₁",
        "unit": "kg",
        "min": 0.5,
        "max": 10,
        "step": 0.5,
        "precision": 2
      },
      {
        "tokenKey": "inclineDeg",
        "paramKey": "inclineDeg",
        "label": "传送带倾角 θ",
        "unit": "°",
        "min": 0,
        "max": 45,
        "step": 1,
        "precision": 1
      }
    ],
    "when": {
      "systemMode": [
        "conveyor"
      ]
    }
  },
  {
    "id": "plank-kinetic-friction",
    "title": "水平木板与木块相对滑动时的摩擦力大小",
    "latex": "f_k=\\htmlClass{pf-live-var}{\\htmlData{param=muBlockCarrier}{\\mu_1}}\\htmlClass{pf-live-var}{\\htmlData{param=massBlock}{m_1}}g",
    "bindings": [
      {
        "tokenKey": "muBlockCarrier",
        "paramKey": "muBlockCarrier",
        "label": "木块—承载面动摩擦因数",
        "unit": "",
        "min": 0,
        "max": 0.8,
        "step": 0.05,
        "precision": 2
      },
      {
        "tokenKey": "massBlock",
        "paramKey": "massBlock",
        "label": "木块质量 m₁",
        "unit": "kg",
        "min": 0.5,
        "max": 10,
        "step": 0.5,
        "precision": 2
      }
    ],
    "when": {
      "systemMode": [
        "plank"
      ]
    }
  }
];
export const mechBlockConveyorPlugin = Object.assign(defineSimulationPlugin<
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
  defaultView: { scale: 0.354, offsetRatioX: 0.05, offsetRatioY: 0.08 },
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
  getControlHandles: (_state, params) => {
    const theta = params.systemMode === 'conveyor' ? degToRad(params.inclineDeg) : 0;
    const origin = { x: 0, y: -0.6 };
    const direction = { x: Math.cos(theta), y: Math.sin(theta) };
    return [{
      id: 'belt-velocity',
      label: `${params.systemMode === 'conveyor' ? 'v带' : 'v板'}=${params.beltVelocity.toFixed(1)}m/s`,
      position: {
        x: origin.x + params.beltVelocity * 0.3 * direction.x,
        y: origin.y + params.beltVelocity * 0.3 * direction.y
      },
      origin,
      handleKind: 'vector',
      color: '#fbbf24',
      onDrag: (wp) => {
        const projection = (wp.x - origin.x) * direction.x + (wp.y - origin.y) * direction.y;
        return { beltVelocity: Number(Math.max(-6, Math.min(6, Math.round((projection / 0.3) * 2) / 2)).toFixed(1)) };
      }
    }];
  },
  getForceVectors: (state, params) => {
    const theta = params.systemMode === 'conveyor' ? degToRad(params.inclineDeg) : 0;
    const m = params.massBlock;
    const g = CLASSROOM_GRAVITY;
    const mg = m * g;
    const normalMag = mg * Math.cos(theta);
    const vRel = state.vBlock - state.vCarrier;
    const fMax = params.muBlockCarrier * normalMag;
    const fAlong = state.coMovingLocked ? m * g * Math.sin(theta) : Math.abs(vRel) < 1e-9 ? 0 : vRel > 0 ? -fMax : fMax;
    const bx = state.xBlock * Math.cos(theta);
    const by = state.xBlock * Math.sin(theta);
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
        const s = state.xCarrier;
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
    const theta = params.systemMode === 'conveyor' ? degToRad(params.inclineDeg) : 0;
    const m = createWorldMapper(viewport);
    const origin = m.toScreen(0, 0);
    const px = (distance: number) => m.len(distance);
    const toLocalX = (distance: number) => px(distance);
    const labels: CanvasLabel[] = [];

    ctx.save();
    // The local belt axis is rotated from world +x by the incline angle.
    ctx.translate(origin.x, origin.y);
    ctx.rotate(-theta);

    if (activeLayers.has('carrier')) {
      if (params.systemMode === 'conveyor') {
        const beltHalf = px(4.5);
        const wheelRadius = px(0.26);
        ctx.fillStyle = 'rgba(51, 65, 85, 0.75)';
        ctx.strokeStyle = '#94a3b8';
        ctx.lineWidth = 2.5;
        ctx.fillRect(-beltHalf, 0, beltHalf * 2, px(0.52));
        ctx.strokeRect(-beltHalf, 0, beltHalf * 2, px(0.52));

        for (const wheelX of [-beltHalf, beltHalf]) {
          ctx.fillStyle = '#475569';
          ctx.beginPath();
          ctx.arc(wheelX, wheelRadius, wheelRadius, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }

        ctx.fillStyle = '#fbbf24';
        const spacing = 0.8;
        const shift = ((state.xCarrier % spacing) + spacing) % spacing;
        for (let s = -4.5 + shift; s <= 4.5; s += spacing) {
          ctx.beginPath();
          ctx.arc(toLocalX(s), px(0.05), px(0.04), 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        const plankLeft = toLocalX(state.xCarrier - 0.5);
        ctx.fillStyle = 'rgba(251, 191, 36, 0.25)';
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 2.5;
        ctx.fillRect(plankLeft, 0, px(5.5), px(0.3));
        ctx.strokeRect(plankLeft, 0, px(5.5), px(0.3));
        ctx.strokeStyle = '#64748b';
        ctx.beginPath();
        ctx.moveTo(-px(12), px(0.32));
        ctx.lineTo(px(12), px(0.32));
        ctx.stroke();
      }
    }

    if (activeLayers.has('scratchTrack') && state.relativeScratch > 0.01) {
      const blockX = toLocalX(state.xBlock);
      const carrierX = toLocalX(state.xCarrier);
      ctx.fillStyle = 'rgba(244, 114, 182, 0.75)';
      ctx.fillRect(Math.min(blockX, carrierX), -px(0.05), Math.abs(blockX - carrierX), px(0.05));
    }

    const blockX = toLocalX(state.xBlock);
    if (activeLayers.has('block')) {
      ctx.fillStyle = '#38bdf8';
      ctx.strokeStyle = '#e0f2fe';
      ctx.lineWidth = 2;
      ctx.fillRect(blockX - px(0.275), -px(0.42), px(0.55), px(0.42));
      ctx.strokeRect(blockX - px(0.275), -px(0.42), px(0.55), px(0.42));
    }

    if (activeLayers.has('forceAndVelocity')) {
      const blockLabel = m.toScreen(state.xBlock * Math.cos(theta), state.xBlock * Math.sin(theta) + 0.62);
      const carrierLabel = m.toScreen(state.xCarrier * Math.cos(theta), state.xCarrier * Math.sin(theta) - 0.72);
      labels.push(
        { id: 'block-velocity', x: blockLabel.x, y: blockLabel.y, text: `v物=${state.vBlock.toFixed(2)} m/s`, color: '#38bdf8', font: 'bold 14px system-ui, sans-serif' },
        { id: 'carrier-velocity', x: carrierLabel.x, y: carrierLabel.y, text: `${params.systemMode === 'conveyor' ? 'v带' : 'v板'}=${state.vCarrier.toFixed(2)} m/s`, color: '#fbbf24', font: 'bold 14px system-ui, sans-serif' }
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
    resolveAndDrawLabels(ctx, labels, viewport.width, viewport.height);
  }
}), { liveFormulas });

export default mechBlockConveyorPlugin;
