import { defineSimulationPlugin, type DiagramPrimitive, type ParamFieldSpec } from '@physforge/sim-sdk';
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

export const emInductionDoubleRodPlugin = defineSimulationPlugin<
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
        mass1: 1.0,
        resistorR: 1.5,
        rodResistance1: 0.5,
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
  getControlHandles: (state, params) => [
    {
      id: 'external-force-rod1',
      label: `F外=${params.externalForce.toFixed(1)}N`,
      position: { x: state.x1 + Math.max(0.25, params.externalForce * 0.1), y: 0 },
      origin: { x: state.x1, y: 0 },
      handleKind: 'vector',
      color: '#4ade80',
      onDrag: (wp) => ({
        externalForce: Number(Math.max(0, Math.min(12, (wp.x - state.x1) * 10)).toFixed(1))
      })
    }
  ],
  getForceVectors: (state, params) => {
    const BL1 = params.magneticB * params.railWidth;
    const fAmp = BL1 * state.current;
    const netElectro1 =
      params.rodMode === 'single' && params.circuitLoad === 'battery' ? fAmp : -fAmp;
    return [
      {
        id: 'ampere-1',
        label: 'F安₁',
        origin: { x: state.x1, y: 0 },
        force: { x: netElectro1, y: 0 },
        category: 'magnetic',
        color: '#fb7185'
      },
      {
        id: 'ext-1',
        label: 'F外',
        origin: { x: state.x1, y: 0 },
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
      getOrigin: (s) => ({ x: s.x1, y: 0 }),
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
        latex: '\\mathcal{E} = BL\\Delta v, \\quad F_{\\text{安}} = BIL',
        substitutedLatex: `\\mathcal{E} = ${emf.toFixed(2)}\\text{ V},\\quad I = ${state.current.toFixed(2)}\\text{ A},\\quad F_{\\text{安}} = ${(BL * Math.abs(state.current)).toFixed(2)}\\text{ N}`
      }
    ];
  },
  renderCanvas: (ctx, state, params, viewport, activeLayers) => {
    const viewSpan = Math.max(12, state.x1 + 3);
    const camShift = Math.max(0, state.x1 - viewSpan * 0.65);
    const pxPerM = (viewport.width * 0.78) / 10;
    const toX = (wx: number) => viewport.width * 0.14 + (wx - camShift) * pxPerM;
    const railTopY = viewport.height * 0.34;
    const railBotY = viewport.height * 0.64;
    const railMidY = 0.5 * (railTopY + railBotY);

    // 1. 导轨与磁场符号
    if (activeLayers.has('railsAndField')) {
      ctx.save();
      ctx.fillStyle = 'rgba(56, 189, 248, 0.07)';
      ctx.fillRect(viewport.width * 0.1, railTopY - 22, viewport.width * 0.85, railBotY - railTopY + 44);

      ctx.strokeStyle = 'rgba(125, 211, 252, 0.5)';
      ctx.lineWidth = 1.4;
      for (let sx = viewport.width * 0.16; sx < viewport.width * 0.9; sx += 58) {
        for (let sy = railTopY + 28; sy < railBotY - 10; sy += 52) {
          ctx.beginPath();
          ctx.arc(sx, sy, 6, 0, Math.PI * 2);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(sx - 4, sy - 4);
          ctx.lineTo(sx + 4, sy + 4);
          ctx.moveTo(sx + 4, sy - 4);
          ctx.lineTo(sx - 4, sy + 4);
          ctx.stroke();
        }
      }

      // 上下导轨线
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(viewport.width * 0.1, railTopY);
      ctx.lineTo(viewport.width * 0.94, railTopY);
      ctx.moveTo(viewport.width * 0.1, railBotY);
      ctx.lineTo(viewport.width * 0.94, railBotY);
      ctx.stroke();
      ctx.restore();
    }

    // 2. 导体棒与左端元件
    if (activeLayers.has('rods')) {
      ctx.save();
      if (params.rodMode === 'single') {
        const leftX = viewport.width * 0.1;
        ctx.strokeStyle = '#94a3b8';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(leftX, railTopY);
        ctx.lineTo(leftX, railBotY);
        ctx.stroke();

        // 绘制负载符号框
        ctx.fillStyle = '#0f172a';
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 2.5;
        ctx.fillRect(leftX - 18, railMidY - 28, 36, 56);
        ctx.strokeRect(leftX - 18, railMidY - 28, 36, 56);
        ctx.fillStyle = '#fbbf24';
        ctx.font = 'bold 14px system-ui, sans-serif';
        const label =
          params.circuitLoad === 'capacitor' ? 'C' : params.circuitLoad === 'battery' ? 'E' : 'R';
        ctx.fillText(label, leftX - 5, railMidY + 5);
      } else {
        // 杆 2
        const x2s = toX(state.x2);
        ctx.fillStyle = '#f472b6';
        ctx.fillRect(x2s - 6, railTopY - 8, 12, railBotY - railTopY + 16);
        ctx.font = 'bold 14px system-ui, sans-serif';
        ctx.fillText(`杆2 (v₂=${state.v2.toFixed(2)})`, x2s - 28, railBotY + 28);
      }

      // 杆 1
      const x1s = toX(state.x1);
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(x1s - 7, railTopY - 8, 14, railBotY - railTopY + 16);
      ctx.font = 'bold 14px system-ui, sans-serif';
      ctx.fillText(`杆1 (v₁=${state.v1.toFixed(2)})`, x1s - 28, railTopY - 16);
      ctx.restore();
    }

    // 3. 电流方向高亮指示
    if (activeLayers.has('currentFlow') && Math.abs(state.current) > 0.02) {
      ctx.save();
      ctx.fillStyle = '#fbbf24';
      ctx.font = 'bold 15px system-ui, sans-serif';
      const dirArrow = state.current > 0 ? '↑' : '↓';
      const x1s = toX(state.x1);
      ctx.fillText(`I = ${Math.abs(state.current).toFixed(2)} A ${dirArrow}`, x1s + 14, railMidY);
      ctx.restore();
    }

    // 4. 安培力与外力矢量
    if (activeLayers.has('forceVectors')) {
      const x1s = toX(state.x1);
      const BL = params.magneticB * params.railWidth;
      const fAmp = BL * state.current;
      const netElectro1 =
        params.rodMode === 'single' && params.circuitLoad === 'battery' ? fAmp : -fAmp;
      const scaleF = 16;

      ctx.save();
      if (Math.abs(netElectro1) > 0.05) {
        const len = Math.max(-90, Math.min(90, netElectro1 * scaleF));
        ctx.strokeStyle = '#fb7185';
        ctx.fillStyle = '#fb7185';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x1s, railMidY - 14);
        ctx.lineTo(x1s + len, railMidY - 14);
        ctx.stroke();
        ctx.font = 'bold 13px system-ui, sans-serif';
        ctx.fillText('F安', x1s + len + (len >= 0 ? 5 : -24), railMidY - 18);
      }

      if (params.externalForce > 0.05) {
        const lenExt = Math.min(95, params.externalForce * scaleF);
        ctx.strokeStyle = '#4ade80';
        ctx.fillStyle = '#4ade80';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x1s, railMidY + 14);
        ctx.lineTo(x1s + lenExt, railMidY + 14);
        ctx.stroke();
        ctx.font = 'bold 13px system-ui, sans-serif';
        ctx.fillText('F外', x1s + lenExt + 5, railMidY + 18);
      }
      ctx.restore();
    }
  }
});

export default emInductionDoubleRodPlugin;
