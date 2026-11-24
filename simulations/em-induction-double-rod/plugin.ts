import type { LiveFormulaSpec } from '@physforge/sim-sdk';
import { inductionStoryDecks } from './storyDecks.js';
import {
  createWorldMapper,
  defineSimulationPlugin,
  drawDotCrossField,
  drawGlowVectorArrow,
  drawGlowingConductorRod,
  drawMetallicRail,
  resolveAndDrawLabels,
  type DiagramPrimitive,
  type ParamFieldSpec
} from '@physforge/sim-sdk';
import {
  checkInvariants,
  computeObservables,
  createInitialState,
  getEffectiveL2,
  stepInduction,
  type InductionParams,
  type InductionState
} from './engine.js';

const paramSchema: readonly ParamFieldSpec<InductionParams>[] = [
  {
    key: 'rodMode',
    kind: 'select',
    label: '导轨与杆构型',
    options: [
      { label: '双杆联动切割（动量/共速）', value: 'double' },
      { label: '单杆切割（左端接负载）', value: 'single' }
    ],
    defaultValue: 'double'
  },
  {
    key: 'circuitLoad',
    kind: 'select',
    label: '电路负载（单杆模式）',
    options: [
      { label: '纯电阻负载 R', value: 'resistor' },
      { label: '电容器负载 C（储能充电）', value: 'capacitor' },
      { label: '恒定直流电源 E（电磁驱动）', value: 'battery' }
    ],
    defaultValue: 'resistor'
  },
  {
    key: 'magneticB',
    kind: 'number',
    label: '磁感应强度 B',
    unit: 'T',
    min: 0,
    max: 3,
    step: 0.1,
    defaultValue: 1.5
  },
  {
    key: 'railWidth',
    kind: 'number',
    label: '杆 1 导轨间距 L₁',
    unit: 'm',
    min: 0.5,
    max: 2.0,
    step: 0.1,
    defaultValue: 1.0
  },
  {
    key: 'railWidth2',
    kind: 'number',
    label: '杆 2 导轨间距 L₂ (0=同 L₁)',
    unit: 'm',
    min: 0,
    max: 2.0,
    step: 0.1,
    defaultValue: 0
  },
  {
    key: 'inclineDeg',
    kind: 'number',
    label: '导轨倾角 θ',
    unit: '°',
    min: 0,
    max: 45,
    step: 5,
    defaultValue: 0
  },
  {
    key: 'mass1',
    kind: 'number',
    label: '杆 1 质量 m₁',
    unit: 'kg',
    min: 0.5,
    max: 5,
    step: 0.5,
    defaultValue: 2.0
  },
  {
    key: 'mass2',
    kind: 'number',
    label: '杆 2 质量 m₂',
    unit: 'kg',
    min: 0.5,
    max: 5,
    step: 0.5,
    defaultValue: 1.0
  },
  {
    key: 'resistorR',
    kind: 'number',
    label: '外接电阻 R',
    unit: 'Ω',
    min: 0,
    max: 6,
    step: 0.2,
    defaultValue: 1.5
  },
  {
    key: 'rodResistance1',
    kind: 'number',
    label: '杆 1 内阻 r₁',
    unit: 'Ω',
    min: 0,
    max: 3,
    step: 0.1,
    defaultValue: 0.5
  },
  {
    key: 'rodResistance2',
    kind: 'number',
    label: '杆 2 内阻 r₂',
    unit: 'Ω',
    min: 0,
    max: 3,
    step: 0.1,
    defaultValue: 0.5
  },
  {
    key: 'capacitance',
    kind: 'number',
    label: '电容 C（电容模式）',
    unit: 'F',
    min: 0.05,
    max: 1.0,
    step: 0.05,
    defaultValue: 0.25
  },
  {
    key: 'batteryEmf',
    kind: 'number',
    label: '电源电动势 E（电源模式）',
    unit: 'V',
    min: 0,
    max: 12,
    step: 0.5,
    defaultValue: 6.0
  },
  {
    key: 'externalForce',
    kind: 'number',
    label: '杆 1 恒定外力 F',
    unit: 'N',
    min: 0,
    max: 12,
    step: 0.5,
    defaultValue: 0
  },
  {
    key: 'frictionMu',
    kind: 'number',
    label: '导轨动摩擦因数 μ',
    unit: '',
    min: 0,
    max: 0.5,
    step: 0.02,
    defaultValue: 0
  },
  {
    key: 'v1Initial',
    kind: 'number',
    label: '杆 1 初速度 v₁₀',
    unit: 'm/s',
    min: 0,
    max: 8,
    step: 0.5,
    defaultValue: 6.0
  },
  {
    key: 'v2Initial',
    kind: 'number',
    label: '杆 2 初速度 v₂₀',
    unit: 'm/s',
    min: 0,
    max: 6,
    step: 0.5,
    defaultValue: 0
  }
];


/** Display-space origin shared by rods, handles, FBD and the orthographic 3D stage. */
export function rodDisplayX(state: { x1: number }, x: number): number {
  return x - (1.2 + Math.max(0, state.x1 - 1.6));
}

const liveFormulas: readonly LiveFormulaSpec[] = [{
  "id": "rod-emf",
  "title": "杆长、速度与磁场互相垂直",
  "latex": "|\\mathcal E_1|=\\htmlClass{pf-live-var}{\\htmlData{param=magneticB}{B}}\\htmlClass{pf-live-var}{\\htmlData{param=railWidth}{L_1}}|v_1|",
  "bindings": [
    {
      "tokenKey": "magneticB",
      "paramKey": "magneticB",
      "label": "磁感应强度 B",
      "unit": "T",
      "min": 0,
      "max": 3,
      "step": 0.1,
      "precision": 2
    },
    {
      "tokenKey": "railWidth",
      "paramKey": "railWidth",
      "label": "杆 1 导轨间距 L₁",
      "unit": "m",
      "min": 0.5,
      "max": 2,
      "step": 0.1,
      "precision": 2
    }
  ]
}];
export const emInductionDoubleRodPlugin = Object.assign(defineSimulationPlugin<
  InductionParams,
  InductionState
>({
  meta: {
    id: 'em-induction-double-rod',
    title: '电磁感应单杆与双杆切割综合模型',
    textbookRef: '人教版 选择性必修二 第二章 第2–4节',
    curriculumTags: ['物理观念', '科学思维', '科学探究'],
    difficulty: '压轴专题',
    version: '2.0.0'
  },
  renderMode: 'hybrid',
  defaultView: { scale: 1.5, offsetRatioY: -0.105 },
  paramSchema,
  presets: [
    {
      id: 'double-rod-momentum-conservation',
      name: '1. 光滑双杆无外力切割（动量守恒）',
      description: '杆 1 以 6 m/s 向右初速进入磁场，安培力等大反向使系统总动量守恒，最终共速 4 m/s 并产生 12 J 焦耳热。',
      params: {
        rodMode: 'double',
        circuitLoad: 'resistor',
        magneticB: 1.5,
        railWidth: 1.0,
        mass1: 2.0,
        mass2: 1.0,
        resistorR: 1.5,
        rodResistance1: 0.5,
        rodResistance2: 0.5,
        externalForce: 0,
        frictionMu: 0,
        v1Initial: 6.0,
        v2Initial: 0
      },
      visibleLayers: ['railsAndField', 'rods', 'currentFlow', 'forceVectors']
    },
    {
      id: 'double-rod-constant-force',
      name: '2. 恒力拉动双杆（等加速度稳定差）',
      description: '对杆 1 施加恒力 6 N，两杆最终达到共同加速度 a = F/(m1+m2) 并保持恒定速度差与恒定电流。',
      params: {
        rodMode: 'double',
        circuitLoad: 'resistor',
        magneticB: 1.5,
        railWidth: 1.0,
        mass1: 2.0,
        mass2: 1.0,
        resistorR: 1.5,
        rodResistance1: 0.5,
        rodResistance2: 0.5,
        externalForce: 6.0,
        frictionMu: 0,
        v1Initial: 0,
        v2Initial: 0
      },
      visibleLayers: ['railsAndField', 'rods', 'currentFlow', 'forceVectors']
    },
    {
      id: 'single-rod-capacitor',
      name: '3. 单杆接电容器（电荷与动能分配）',
      description: '初速度 4 m/s 滑入磁场对电容器充电，当 BLv = q/C 时电流归零，稳定匀速运动。',
      params: {
        rodMode: 'single',
        circuitLoad: 'capacitor',
        magneticB: 2.0,
        railWidth: 1.0,
        mass1: 1.0,
        resistorR: 1.0,
        rodResistance1: 0,
        capacitance: 0.25,
        externalForce: 0,
        frictionMu: 0,
        v1Initial: 4.0
      },
      visibleLayers: ['railsAndField', 'rods', 'currentFlow', 'forceVectors']
    },
    {
      id: 'single-rod-battery-drive',
      name: '4. 单杆接恒定电源（电磁驱动/反电动势）',
      description: '电源驱动静止导体棒加速切割，随着反电动势 BLv 增大，电流减小直至 BLv = E 达稳定速度。',
      params: {
        rodMode: 'single',
        circuitLoad: 'battery',
        magneticB: 1.5,
        railWidth: 1.0,
        mass1: 4.5,
        resistorR: 2.0,
        rodResistance1: 0,
        batteryEmf: 6.0,
        externalForce: 0,
        frictionMu: 0,
        v1Initial: 0
      },
      visibleLayers: ['railsAndField', 'rods', 'currentFlow', 'forceVectors']
    },
    {
      id: 'unequal-double-rod-momentum',
      name: '5. 不等距双杆切割（L₁≠L₂ 广义动量守恒）',
      description: '杆1在宽轨 L₁=1.2m，杆2在窄轨 L₂=0.6m，系统总动量不守恒但满足 m₁L₂v₁+m₂L₁v₂=const，终态 L₁v₁=L₂v₂。',
      params: {
        rodMode: 'double',
        circuitLoad: 'resistor',
        magneticB: 1.5,
        railWidth: 1.2,
        railWidth2: 0.6,
        mass1: 2.0,
        mass2: 1.0,
        resistorR: 1.5,
        rodResistance1: 0.5,
        rodResistance2: 0.5,
        externalForce: 0,
        frictionMu: 0,
        v1Initial: 4.0,
        v2Initial: 0
      },
      visibleLayers: ['railsAndField', 'rods', 'currentFlow', 'forceVectors']
    },
    {
      id: 'single-rod-ideal-cap-constant-force',
      name: '6. 零阻单杆接电容器恒力驱动（a=F/(m+CB²L²)）',
      description: '零内阻条件下恒力拉动产生等价惯量匀加速，充电电流恒定且电荷量 q=∫Idt 线性增长。',
      params: {
        rodMode: 'single',
        circuitLoad: 'capacitor',
        magneticB: 2.0,
        railWidth: 1.0,
        mass1: 1.0,
        resistorR: 0,
        rodResistance1: 0,
        capacitance: 0.25,
        externalForce: 4.0,
        frictionMu: 0,
        v1Initial: 0
      },
      visibleLayers: ['railsAndField', 'rods', 'currentFlow', 'forceVectors']
    }
  ],
  engine: {
    createInitialState,
    step: stepInduction,
    computeObservables,
    checkInvariants
  },
  layers: [
    { id: 'railsAndField', label: '金属导轨与匀强磁场', defaultVisible: true },
    { id: 'rods', label: '导体棒与电路元件', defaultVisible: true },
    { id: 'currentFlow', label: '感应电流方向箭头', defaultVisible: true },
    { id: 'forceVectors', label: '安培力与外力矢量', defaultVisible: true }
  ],
  telemetryChannels: [
    { key: 'v1', label: '杆 1 速度 v₁', unit: 'm/s', color: '#38bdf8' },
    { key: 'v2', label: '杆 2 速度 v₂', unit: 'm/s', color: '#f472b6' },
    { key: 'current', label: '回路电流 I', unit: 'A', color: '#fbbf24' },
    { key: 'kineticEnergy', label: '总动能 Ek', unit: 'J', color: '#4ade80' },
    { key: 'jouleHeat', label: '累计焦耳热 Q', unit: 'J', color: '#fb7185' }
  ],
  getControlHandles: (state, params) => params.externalForce > 0.05 ? [
    {
      id: 'external-force-rod1',
      label: `F外=${params.externalForce.toFixed(1)}N`,
      position: { x: rodDisplayX(state, state.x1) + Math.max(0.25, params.externalForce * 0.1), y: 0 },
      origin: { x: rodDisplayX(state, state.x1), y: 0 },
      handleKind: 'vector',
      color: '#4ade80',
      onDrag: (wp) => ({
        externalForce: Number(Math.max(0, Math.min(12, (wp.x - rodDisplayX(state, state.x1)) * 10)).toFixed(1))
      })
    }
  ] : [],
  getForceVectors: (state, params) => {
    const BL1 = params.magneticB * params.railWidth;
    const fAmp = BL1 * state.current;
    const netElectro1 =
      params.rodMode === 'single' && params.circuitLoad === 'battery' ? fAmp : -fAmp;
    return [
      {
        id: 'ampere-1',
        label: 'F安₁',
        origin: { x: rodDisplayX(state, state.x1), y: 0 },
        force: { x: netElectro1, y: 0 },
        category: 'magnetic',
        color: '#fb7185'
      },
      {
        id: 'ext-1',
        label: 'F外',
        origin: { x: rodDisplayX(state, state.x1), y: 0 },
        force: { x: params.externalForce, y: 0 },
        category: 'other',
        color: '#4ade80'
      }
    ];
  },
  referenceFrames: [
    {
      id: 'rod1',
      label: '杆 1 随动参考系',
      getOrigin: (s) => ({ x: rodDisplayX(s, s.x1), y: 0 }),
      getVelocity: (s) => ({ x: s.v1, y: 0 })
    }
  ],
  sceneSerializer: {
    exportScene: (_s, params) => ({
      schemaVersion: '2.0',
      modelId: 'em-induction-double-rod',
      title: '电磁感应单杆与双杆模型',
      params
    }),
    importScene: (dsl) => dsl.params as Partial<InductionParams>
  },
  exportDiagramIR: (state, params) => {
    const L1 = params.railWidth;
    const L2 = getEffectiveL2(params);
    const primitives: DiagramPrimitive[] = [
      { kind: 'line', x1: -0.5, y1: L1 * 0.5, x2: 4.5, y2: L1 * 0.5, strokeWidth: 2 },
      { kind: 'line', x1: -0.5, y1: -L1 * 0.5, x2: 4.5, y2: -L1 * 0.5, strokeWidth: 2 },
      { kind: 'line', x1: state.x1, y1: -L1 * 0.55, x2: state.x1, y2: L1 * 0.55, strokeWidth: 3 },
      ...(params.rodMode === 'double'
        ? [{ kind: 'line', x1: state.x2, y1: -L2 * 0.55, x2: state.x2, y2: L2 * 0.55, strokeWidth: 3 } as DiagramPrimitive]
        : []),
      {
        kind: 'mathLabel',
        x: 4.2,
        y: 1.0,
        text: `B=${params.magneticB}\\text{T},\\; q=\\int I\\,dt=${state.qTotalIntegral.toFixed(2)}\\text{C}`,
        align: 'end'
      }
    ];
    return {
      width: 720,
      height: 380,
      viewBox: { minX: -0.8, minY: -1.3, maxX: 4.6, maxY: 1.4 },
      title: '电磁感应单杆双杆切割配图',
      primitives
    };
  },
  formatFormulas: (state, params) => {
    const BL = params.magneticB * params.railWidth;
    const emf =
      params.rodMode === 'double' ? BL * (state.v1 - state.v2) : BL * state.v1;
    return [
      {
        id: 'faraday-emf',
        label: '动生感应电动势与安培力',
        latex: `\\begin{aligned}\\mathcal{E} &= BL${params.rodMode === 'double' ? '\\Delta v' : 'v'} \\\\ F_{\\text{安}} &= BIL\\end{aligned}`,
        substitutedLatex: `\\begin{aligned}\\mathcal{E} &= ${emf.toFixed(2)}\\text{ V} \\\\ I &= ${state.current.toFixed(2)}\\text{ A},\\quad F_{\\text{安}} = ${(BL * Math.abs(state.current)).toFixed(2)}\\text{ N}\\end{aligned}`
      }
    ];
  },
  renderCanvas: (ctx, state, params, viewport, activeLayers) => {
    const m = createWorldMapper(viewport);
    const toX = (worldX: number) => m.toX(rodDisplayX(state, worldX));
    const center = m.toScreen(0, 0);
    const pixelsPerMeter = m.ppm;
    const halfGap = Math.max(84, params.railWidth * pixelsPerMeter * 0.62);
    const railMidY = center.y;
    const railTopY = railMidY - halfGap;
    const railBotY = railMidY + halfGap;
    const basePixelsPerMeter = Math.min(viewport.width, viewport.height) * 0.24 * 1.5;
    const spanHalf = m.len(320 / basePixelsPerMeter);
    const railLeft = center.x - spanHalf - m.len(40 / basePixelsPerMeter);
    const railRight = center.x + spanHalf - m.len(20 / basePixelsPerMeter);
    const labels: Array<{ id: string; x: number; y: number; text: string; color: string; font?: string }> = [];

    if (activeLayers.has('railsAndField')) {
      drawDotCrossField(
        ctx,
        railLeft + 24,
        railTopY + 12,
        railRight - railLeft - 48,
        railBotY - railTopY - 24,
        'in',
        m.len(76 / basePixelsPerMeter),
        m.len(56 / basePixelsPerMeter)
      );
      drawMetallicRail(ctx, railLeft, railTopY, railRight, 8);
      drawMetallicRail(ctx, railLeft, railBotY, railRight, 8);
    }

    if (activeLayers.has('rods')) {
      if (params.rodMode === 'single') {
        const loadX = railLeft + m.len(18 / basePixelsPerMeter);
        ctx.save();
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 2.4;
        ctx.shadowColor = '#fbbf24';
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.moveTo(loadX, railTopY);
        ctx.lineTo(loadX, railMidY - 15);
        if (params.circuitLoad === 'capacitor') {
          ctx.moveTo(loadX - 12, railMidY - 8);
          ctx.lineTo(loadX + 12, railMidY - 8);
          ctx.moveTo(loadX - 12, railMidY + 8);
          ctx.lineTo(loadX + 12, railMidY + 8);
        } else if (params.circuitLoad === 'battery') {
          ctx.moveTo(loadX - 10, railMidY - 6);
          ctx.lineTo(loadX + 10, railMidY - 6);
          ctx.moveTo(loadX - 6, railMidY + 5);
          ctx.lineTo(loadX + 6, railMidY + 5);
        } else {
          ctx.moveTo(loadX, railMidY - 15);
          ctx.lineTo(loadX - 8, railMidY - 10);
          ctx.lineTo(loadX + 8, railMidY - 4);
          ctx.lineTo(loadX - 8, railMidY + 2);
          ctx.lineTo(loadX + 8, railMidY + 8);
        }
        ctx.moveTo(loadX, railMidY + 15);
        ctx.lineTo(loadX, railBotY);
        ctx.stroke();
        ctx.restore();
        labels.push({ id: 'load-label', x: loadX, y: railMidY + 34, text: params.circuitLoad === 'battery' ? '电源 E' : params.circuitLoad === 'capacitor' ? '电容 C' : '电阻 R', color: '#fcd34d' });
      }

      if (params.rodMode === 'double') {
        const x2 = toX(state.x2);
        drawGlowingConductorRod(ctx, x2, railTopY, railBotY, state.v2, '#f472b6', '#fbcfe8', 10);
        labels.push({ id: 'rod2-label', x: x2, y: railBotY + 31, text: `杆2 v₂=${state.v2.toFixed(2)} m/s`, color: '#f9a8d4' });
      }
      const x1 = toX(state.x1);
      drawGlowingConductorRod(ctx, x1, railTopY, railBotY, state.v1, '#38bdf8', '#e0f2fe', 11);
      if (Math.abs(state.v1) > 0.05 || params.rodMode === 'single') {
        const velocityLength = Math.max(-110, Math.min(110, state.v1 * 18));
        if (Math.abs(velocityLength) >= 6) {
          drawGlowVectorArrow(ctx, x1, railMidY + 14, x1 + velocityLength, railMidY + 14, '#38bdf8', 4.5, 14);
        }
      }
    }

    if (activeLayers.has('currentFlow') && Math.abs(state.current) > 0.02) {
      const x1 = toX(state.x1);
      const direction = state.current >= 0 ? 1 : -1;
      const start = x1 - 56 * direction;
      drawGlowVectorArrow(ctx, start, railBotY + 18, start + 58 * direction, railBotY + 18, '#f59e0b', 4, 13);
      labels.push({ id: 'current-label', x: start + 28 * direction, y: railBotY + 28, text: `I = ${Math.abs(state.current).toFixed(2)} A`, color: '#fbbf24', font: '600 14px system-ui, sans-serif' });
    }

    if (activeLayers.has('forceVectors')) {
      const x1 = toX(state.x1);
      const bl = params.magneticB * params.railWidth;
      const ampereForce = bl * state.current;
      const netForce = params.rodMode === 'single' && params.circuitLoad === 'battery' ? ampereForce : -ampereForce;
      if (Math.abs(netForce) > 0.05) {
        const length = Math.max(-120, Math.min(120, netForce * 24));
        const forceY = railMidY - 14;
        drawGlowVectorArrow(ctx, x1 - 6 * Math.sign(length), forceY, x1 + length, forceY, '#fb7185', 4.5, 14);
        const forceLabel = `F安 = ${Math.abs(ampereForce).toFixed(2)} N`;
        const forceLabelFont = '600 15px system-ui, sans-serif';
        ctx.save();
        ctx.font = forceLabelFont;
        const forceLabelWidth = ctx.measureText(forceLabel).width + 12;
        ctx.restore();
        labels.push({
          id: 'ampere-force',
          x: x1 + Math.sign(length) * (forceLabelWidth * 0.5 + 14),
          y: forceY - 24,
          text: forceLabel,
          color: '#fb7185',
          font: forceLabelFont
        });
      }
      if (Math.abs(params.externalForce) > 0.05) {
        const length = Math.max(-100, Math.min(100, params.externalForce * 16));
        drawGlowVectorArrow(ctx, x1, railMidY + 12, x1 + length, railMidY + 12, '#4ade80', 3.5, 12);
        labels.push({ id: 'external-force', x: x1 + length * 0.55, y: railMidY + 33, text: 'F外', color: '#4ade80' });
      }
    }

    resolveAndDrawLabels(ctx, labels, viewport.width, viewport.height);
  }
}), { storyDecks: inductionStoryDecks, liveFormulas, spatial3D: { flattenPlane: 'xz' as const, defaultVisibleHeight: 4.8, sceneDepthRadius: 6, default3DAzimuthRad: 0.65, default3DPolarRad: 0.9 } });

export default emInductionDoubleRodPlugin;
