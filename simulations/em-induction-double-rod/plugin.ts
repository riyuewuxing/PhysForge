import type { LiveFormulaSpec } from '@physforge/sim-sdk';
import {inductionScreenBounds,inductionBoundsFit,fitInductionViewport} from './viewport.js';
import { inductionStoryDecks } from './storyDecks.js';
import { drawInductionRail,drawInductionRod,inductionArrowLength,inductionVisualPalette,inductionFieldLabel } from './visualStyle.js';
import { rodDisplayX, inductionDiagramGeometry, inductionDiagramCurrent, inductionFieldPoints, inductionLoadDimensions } from './diagramGeometry.js';
export { rodDisplayX } from './diagramGeometry.js';
import {
  createWorldMapper,
  defineSimulationPlugin,
  drawGlowVectorArrow,
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



const liveFormulas: readonly LiveFormulaSpec[] = [
  {
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
  },
  {
    "id": "single-resistor-ampere",
    "title": "单杆纯电阻闭合回路安培力（总电阻非零）",
    "latex": "|F_{\\rm 安}|=\\frac{\\htmlClass{pf-live-var}{\\htmlData{param=magneticB}{B}}^2\\htmlClass{pf-live-var}{\\htmlData{param=railWidth}{L_1}}^2|v_1|}{\\htmlClass{pf-live-var}{\\htmlData{param=resistorR}{R}}+\\htmlClass{pf-live-var}{\\htmlData{param=rodResistance1}{r_1}}}",
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
      },
      {
        "tokenKey": "resistorR",
        "paramKey": "resistorR",
        "label": "外接电阻 R",
        "unit": "Ω",
        "min": 0,
        "max": 6,
        "step": 0.2,
        "precision": 2
      },
      {
        "tokenKey": "rodResistance1",
        "paramKey": "rodResistance1",
        "label": "杆 1 内阻 r₁",
        "unit": "Ω",
        "min": 0,
        "max": 3,
        "step": 0.1,
        "precision": 2
      }
    ],
    "when": {
      "rodMode": [
        "single"
      ],
      "circuitLoad": [
        "resistor"
      ]
    }
  },
  {
    "id": "double-rod-current",
    "title": "双杆回路电流（L₂ 为有效杆长，总电阻非零）",
    "latex": "I=\\frac{\\htmlClass{pf-live-var}{\\htmlData{param=magneticB}{B}}(\\htmlClass{pf-live-var}{\\htmlData{param=railWidth}{L_1}}v_1-L_2v_2)}{\\htmlClass{pf-live-var}{\\htmlData{param=resistorR}{R}}+r_1+r_2}",
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
      },
      {
        "tokenKey": "resistorR",
        "paramKey": "resistorR",
        "label": "外接电阻 R",
        "unit": "Ω",
        "min": 0,
        "max": 6,
        "step": 0.2,
        "precision": 2
      }
    ],
    "when": {
      "rodMode": [
        "double"
      ]
    }
  }
];
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
  defaultView: {
    // The inspector occupies the right 272 px. Fit the initial circuit
    // (including the single-rod load and rail ends) into the unobscured area.
    scale: (_params, { width, height }) =>
      Math.min(1.5, Math.max(0.1, (width - 320) / (4.8 * Math.min(width, height) * 0.24))),
    offsetRatioX: (_params, { width }) => (width - 280) / (2 * width) - 0.45,
    offsetRatioY: -0.105
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
      ...(params.rodMode === 'double' ? [{
        id: 'ampere-2',
        label: 'F安₂',
        origin: { x: rodDisplayX(state, state.x2), y: 0 },
        force: { x: params.magneticB * getEffectiveL2(params) * state.current, y: 0 },
        category: 'magnetic' as const,
        color: '#f472b6'
      }] : []),
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
    const g=inductionDiagramGeometry(state,params),current=inductionDiagramCurrent(state,params).current;
    const primitives:DiagramPrimitive[]=g.rails.map(seg=>({kind:'line',x1:seg.start.x,y1:seg.start.y,x2:seg.end.x,y2:seg.end.y,strokeWidth:2}));
    for(const seg of [g.rod1,...(g.double?[g.rod2]:[])])primitives.push({kind:'line',x1:seg.start.x,y1:seg.start.y,x2:seg.end.x,y2:seg.end.y,strokeWidth:3});
    if(!g.double)primitives.push({kind:'circuitElement',element:params.circuitLoad==='battery'?'battery':params.circuitLoad==='capacitor'?'capacitor':'resistor',
      x1:g.x2,y1:-g.l1/2,x2:g.x2,y2:g.l1/2,label:params.circuitLoad==='battery'?'E':params.circuitLoad==='capacitor'?'C':'R'});
    for(const p of inductionFieldPoints(params))primitives.push({kind:'fieldMarker',x:p.x,y:p.y,symbol:params.magneticB>=0?'cross':'dot',radius:0.035});
    if(Math.abs(current)>0.02)for(const [index,seg] of g.currentGuides.entries()){
      if(index===1&&!g.double)continue;
      const dx=seg.end.x-seg.start.x,dy=seg.end.y-seg.start.y,length=Math.hypot(dx,dy);
      if(length<0.08)continue;
      const cx=(seg.start.x+seg.end.x)/2,cy=(seg.start.y+seg.end.y)/2;
      const scale=Math.sign(current)*Math.min(0.32,length*0.6)/length;
      primitives.push({kind:'arrow',x1:cx-dx*scale/2,y1:cy-dy*scale/2,x2:cx+dx*scale/2,y2:cy+dy*scale/2});
    }
    if(g.schematicStep)primitives.push({kind:'text',x:(g.minX+g.maxX)/2,y:Math.max(g.l1,g.l2)/2+0.2,text:'不同杆长 · 连接线为示意',align:'middle'});
    const halfHeight=Math.max(g.l1,g.l2)/2+0.65;
    return {width:720,height:380,viewBox:{minX:g.minX-0.3,minY:-halfHeight,maxX:g.maxX+0.3,maxY:halfHeight},
      title:'电磁感应单杆双杆切割配图',primitives};
  },
  formatFormulas: (state, params) => {
    const BL1 = params.magneticB * params.railWidth;
    const BL2 = params.magneticB * getEffectiveL2(params);
    const double = params.rodMode === 'double';
    const emf = double ? BL1 * state.v1 - BL2 * state.v2 : BL1 * state.v1;
    const force1 = Math.abs(BL1 * state.current);
    const force2 = Math.abs(BL2 * state.current);
    return [
      {
        id: 'faraday-emf',
        label: '动生感应电动势与安培力',
        latex: double
          ? '\\begin{aligned}\\mathcal{E}_{\\rm mot}&=B(L_1v_1-L_2v_2)\\\\ |F_{\\text{安},1}|&=|BIL_1|\\\\ |F_{\\text{安},2}|&=|BIL_2|\\end{aligned}'
          : '\\begin{aligned}\\mathcal{E}_{\\rm mot}&=BLv\\\\ |F_{\\text{安}}|&=|BIL|\\end{aligned}',
        substitutedLatex: double
          ? `\\begin{aligned}\\mathcal{E}_{\\rm mot}&=${emf.toFixed(2)}\\text{ V}\\\\ I&=${state.current.toFixed(2)}\\text{ A}\\\\ |F_{\\text{安},1}|&=${force1.toFixed(2)}\\text{ N}\\\\ |F_{\\text{安},2}|&=${force2.toFixed(2)}\\text{ N}\\end{aligned}`
          : `\\begin{aligned}\\mathcal{E}_{\\rm mot}&=${emf.toFixed(2)}\\text{ V}\\\\ I&=${state.current.toFixed(2)}\\text{ A}\\\\ |F_{\\text{安}}|&=${force1.toFixed(2)}\\text{ N}\\end{aligned}`
      },
      ...(double ? [{
        id: 'double-rod-energy-state', label: '两杆速度、总动能和累计焦耳热',
        latex: 'K=\\tfrac12m_1v_1^2+\\tfrac12m_2v_2^2',
        substitutedLatex: `\\begin{aligned}v_1&=${state.v1.toFixed(3)}\\text{ m/s}\\\\v_2&=${state.v2.toFixed(3)}\\text{ m/s}\\\\K&=${(0.5 * params.mass1 * state.v1 ** 2 + 0.5 * params.mass2 * state.v2 ** 2).toFixed(3)}\\text{ J}\\\\Q&=${state.jouleHeat.toFixed(3)}\\text{ J}\\end{aligned}`
      }] : [])
    ];
  },
  renderCanvas: (ctx, state, params, viewport, activeLayers) => {
    const m = createWorldMapper(viewport);
    const toX = (worldX: number) => m.toX(rodDisplayX(state, worldX));
    const center = m.toScreen(0, 0);
    const g=inductionDiagramGeometry(state,params);
    const railMidY = center.y;
    const railTopY = m.toY(g.l1/2);
    const railBotY = m.toY(-g.l1/2);
    const projector=viewport.theme==='projector',palette=inductionVisualPalette(projector);
    const rodWidth=Math.max(10,Math.min(14,m.len(.06)));
    const labels: Array<{ id: string; x: number; y: number; text: string; color: string; font?: string }> = [];

    if (activeLayers.has('railsAndField')) {
      ctx.save();ctx.strokeStyle=palette.field;ctx.fillStyle=palette.field;ctx.globalAlpha=palette.fieldAlpha;ctx.lineWidth=1.4;ctx.lineCap='round';
      for(const p of inductionFieldPoints(params)){
        const q=m.toScreen(p.x,p.y);
        ctx.beginPath();
        if(params.magneticB>=0){ctx.moveTo(q.x-4,q.y-4);ctx.lineTo(q.x+4,q.y+4);ctx.moveTo(q.x+4,q.y-4);ctx.lineTo(q.x-4,q.y+4);ctx.stroke();}
        else{ctx.arc(q.x,q.y,2.2,0,Math.PI*2);ctx.fill();}
      }
      ctx.restore();
      labels.push({id:'magnetic-field-label',x:center.x,y:m.toY(Math.max(g.l1,g.l2)/2)-(g.schematicStep?76:44),text:inductionFieldLabel(params.magneticB),color:palette.note,font:'600 14px system-ui, sans-serif'});
      if(!g.schematicStep){
        const left=m.toX(Math.min(g.x1,g.x2)),right=m.toX(Math.max(g.x1,g.x2));
        for(const rail of g.rails)drawInductionRail(ctx,m.toX(rail.start.x),m.toY(rail.start.y),m.toX(rail.end.x),left,right,9,projector);
      }else{
        ctx.save();ctx.lineCap='round';ctx.lineJoin='round';ctx.strokeStyle=projector?'#475569':'#64748b';ctx.lineWidth=8;
        for(const rail of g.rails){const a=m.toScreen(rail.start.x,rail.start.y),b=m.toScreen(rail.end.x,rail.end.y);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();}
        ctx.strokeStyle=projector?'#cbd5e1':'#e2e8f0';ctx.lineWidth=2;
        for(const rail of g.rails){const a=m.toScreen(rail.start.x,rail.start.y),b=m.toScreen(rail.end.x,rail.end.y);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();}
        ctx.restore();
        labels.push({id:'unequal-rail-note',x:center.x,y:m.toY(Math.max(g.l1,g.l2)/2)-26,text:'不同杆长 · 连接线为示意',color:palette.note});
      }
    }

    if (activeLayers.has('rods')) {
      if (params.rodMode === 'single') {
        const loadX=m.toX(g.x2),{halfGap,halfPlateWidth}=inductionLoadDimensions(g.l1);
        const upper=m.toY(halfGap),lower=m.toY(-halfGap),halfPlate=m.len(halfPlateWidth);
        ctx.save();ctx.strokeStyle=palette.load;ctx.lineWidth=2.8;ctx.shadowColor=palette.load;ctx.shadowBlur=projector?0:9;
        ctx.beginPath();ctx.moveTo(loadX,railTopY);ctx.lineTo(loadX,upper);
        if(params.circuitLoad==='capacitor'||params.circuitLoad==='battery'){
          const lowerPlate=params.circuitLoad==='battery'?halfPlate*0.55:halfPlate;
          ctx.moveTo(loadX-halfPlate,upper);ctx.lineTo(loadX+halfPlate,upper);
          ctx.moveTo(loadX-lowerPlate,lower);ctx.lineTo(loadX+lowerPlate,lower);
        }else{
          for(let i=1;i<=6;i++)ctx.lineTo(loadX+(i===6?0:(i%2===0?1:-1)*halfPlate*0.65),upper+(lower-upper)*i/6);
        }
        ctx.moveTo(loadX,lower);ctx.lineTo(loadX,railBotY);ctx.stroke();ctx.restore();
        labels.push({ id: 'load-label', x: loadX, y: railBotY + 28, text: params.circuitLoad === 'battery' ? '电源 E' : params.circuitLoad === 'capacitor' ? '电容 C' : '电阻 R', color: palette.loadLabel });
      }

      if (params.rodMode === 'double') {
        const x2 = toX(state.x2);
        drawInductionRod(ctx, x2, m.toY(g.l2/2), m.toY(-g.l2/2), state.v2, palette.rod2, palette.rod2Core, rodWidth,projector);
        labels.push({ id: 'rod2-label', x: x2, y: m.toY(-g.l2/2) + 31, text: `杆2 v₂=${state.v2.toFixed(2)} m/s`, color: palette.rod2Label });
      }
      const x1 = toX(state.x1);
      drawInductionRod(ctx, x1, railTopY, railBotY, state.v1, palette.rod, palette.rodCore, rodWidth,projector);
      if (Math.abs(state.v1) > 0.05 || params.rodMode === 'single') {
        const velocityLength = inductionArrowLength(state.v1,60,135);
        if (Math.abs(velocityLength) >= 6) {
          drawGlowVectorArrow(ctx, x1, railMidY + 18, x1 + velocityLength, railMidY + 18, palette.velocity, 5, 17);
          const velocityText = `${params.rodMode === 'double' ? 'v₁' : 'v'} = ${Math.abs(state.v1).toFixed(2)} m/s`;
          ctx.save(); ctx.font='600 14px system-ui, sans-serif';
          const labelWidth=ctx.measureText(velocityText).width; ctx.restore();
          labels.push({id:'velocity-label',x:x1+velocityLength+Math.sign(velocityLength)*(labelWidth/2+12),y:railMidY+18,text:velocityText,color:palette.velocity,font:'600 14px system-ui, sans-serif'});
        }
      }
    }

    const signedCurrent=inductionDiagramCurrent(state,params).current;
    if (activeLayers.has('currentFlow') && Math.abs(signedCurrent) > 0.02) {
      for(const [index,seg] of g.currentGuides.entries()){
        if(index===1&&!g.double)continue;
        const a=m.toScreen(seg.start.x,seg.start.y),b=m.toScreen(seg.end.x,seg.end.y);
        const dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy);
        if(length<16)continue;
        const scale=Math.sign(signedCurrent)*Math.min(70,length*0.65)/length;
        const cx=(a.x+b.x)/2,cy=(a.y+b.y)/2;
        drawGlowVectorArrow(ctx,cx-dx*scale/2,cy-dy*scale/2,cx+dx*scale/2,cy+dy*scale/2,palette.current,3.6,12);
      }
      labels.push({id:'current-label',x:(m.toX(g.x1)+m.toX(g.x2))/2,y:m.toY(-Math.max(g.l1,g.l2)/2)+24,text:`I = ${Math.abs(state.current).toFixed(2)} A`,color:palette.currentLabel,font:'600 15px system-ui, sans-serif'});
    }

    if (activeLayers.has('forceVectors')) {
      const x1 = toX(state.x1);
      const bl = params.magneticB * params.railWidth;
      const ampereForce = bl * state.current;
      const netForce = params.rodMode === 'single' && params.circuitLoad === 'battery' ? ampereForce : -ampereForce;
      if (Math.abs(netForce) > 0.05) {
        const length = inductionArrowLength(netForce,35,145);
        const forceY = railMidY - 18;
        drawGlowVectorArrow(ctx, x1 - 6 * Math.sign(length), forceY, x1 + length, forceY, palette.force, 5, 17);
        const forceLabel = `F安 = ${Math.abs(ampereForce).toFixed(2)} N`;
        const forceLabelFont = viewport.width>=1100?'600 17px system-ui, sans-serif':'600 15px system-ui, sans-serif';
        ctx.save();
        ctx.font = forceLabelFont;
        const forceLabelWidth = ctx.measureText(forceLabel).width + 12;
        ctx.restore();
        labels.push({
          id: 'ampere-force',
          x: x1 + Math.sign(length) * (forceLabelWidth * 0.5 + 14),
          y: forceY - 24,
          text: forceLabel,
          color: palette.force,
          font: forceLabelFont
        });
      }
      if (params.rodMode === 'double') {
        const x2 = toX(state.x2);
        const force2 = params.magneticB * getEffectiveL2(params) * state.current;
        if (Math.abs(force2) > 0.05) {
          const length = inductionArrowLength(force2,35,145);
          const forceY = railMidY - 18;
          drawGlowVectorArrow(ctx, x2 - 6 * Math.sign(length), forceY, x2 + length, forceY, palette.rod2, 5, 17);
          labels.push({ id: 'ampere-force-2', x: x2 + length * 0.5, y: forceY - 24, text: `F安₂ = ${Math.abs(force2).toFixed(2)} N`, color: palette.rod2Label });
        }
      }
      if (Math.abs(params.externalForce) > 0.05) {
        const length = inductionArrowLength(params.externalForce,24,120);
        drawGlowVectorArrow(ctx, x1, railMidY + 37, x1 + length, railMidY + 37, palette.external, 3.5, 12);
        labels.push({ id: 'external-force', x: x1 + length * 0.55, y: railMidY + 57, text: 'F外', color: palette.external });
      }
    }

    resolveAndDrawLabels(ctx, labels, viewport.width, viewport.height);
  }
}), { inductionScreenBounds,inductionBoundsFit,fitInductionViewport,storyDecks: inductionStoryDecks, liveFormulas, spatial3D: { flattenPlane: 'xz' as const, defaultVisibleHeight: 4.8, sceneDepthRadius: 6, default3DAzimuthRad: 0.65, default3DPolarRad: 0.9 } });

export default emInductionDoubleRodPlugin;
