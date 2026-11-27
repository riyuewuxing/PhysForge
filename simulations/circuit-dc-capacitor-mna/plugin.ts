import type { LiveFormulaSpec } from '@physforge/sim-sdk';
import {
  defineSimulationPlugin,
  type ParamFieldSpec
} from '@physforge/sim-sdk';
import {
  checkInvariants,
  computeObservables,
  createInitialState,
  stepCircuit,
  type CircuitParams,
  type CircuitState
} from './engine.js';
import { dividerDefaultCamera, dividerWiperX, dividerWiperY, dividerRFromY, exportDividerDiagram, renderDivider } from './dividerView.js';

import { exportTopologyDiagram, renderTopology, sliderRange, topologyCamera } from './topologyView.js';

const branchPhaseMap = new Map<string, number>();


export interface CurrentParticleOptions {
  spacingPx?: number;
  maxSpeedPx?: number;
  refCurrentAmp?: number;
  isShorted?: boolean;
}

export function voltageToColor(voltage: number | undefined, vMin: number, vMax: number): string {
  if (voltage === undefined || !Number.isFinite(voltage)) return '#94a3b8';

  const min = Number.isFinite(vMin) ? vMin : 0;
  const max = Number.isFinite(vMax) ? vMax : min + 1;
  const span = Math.max(max - min, 1e-3);
  const t = Math.max(0, Math.min(1, (voltage - min) / span));
  const hue = Math.round(215 - t * 210);
  return `hsl(${hue}, 88%, 48%)`;
}

export function drawCurrentParticles(
  ctx: CanvasRenderingContext2D,
  branchId: string,
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  currentAmp: number,
  dtSec: number,
  options?: CurrentParticleOptions
): void {
  if (!Number.isFinite(currentAmp) || Math.abs(currentAmp) < 1e-6) return;

  const requestedSpacing = options?.spacingPx ?? 28;
  const spacing = Number.isFinite(requestedSpacing) ? Math.max(8, requestedSpacing) : 28;
  const requestedMaxSpeed = options?.maxSpeedPx ?? 140;
  const maxSpeed = Number.isFinite(requestedMaxSpeed) ? Math.max(1, requestedMaxSpeed) : 140;
  const requestedReference = options?.refCurrentAmp ?? 1;
  const reference = Number.isFinite(requestedReference) ? Math.max(1e-6, requestedReference) : 1;
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const length = Math.hypot(dx, dy);
  if (length < 12 || !Number.isFinite(length)) return;

  const clampedDt = Number.isFinite(dtSec) ? Math.max(0, Math.min(dtSec, 0.05)) : 0;
  const direction = Math.sign(currentAmp);
  const speed = direction * maxSpeed * Math.tanh(Math.abs(currentAmp) / reference);
  const previousPhase = branchPhaseMap.get(branchId) ?? 0;
  const phase = (((previousPhase + speed * clampedDt) % spacing) + spacing) % spacing;
  branchPhaseMap.set(branchId, phase);

  const ux = dx / length;
  const uy = dy / length;
  const angle = Math.atan2(uy * direction, ux * direction);
  ctx.save();
  ctx.fillStyle = options?.isShorted ? '#ef4444' : '#facc15';
  ctx.strokeStyle = options?.isShorted ? '#7f1d1d' : '#713f12';
  ctx.lineWidth = 1;

  for (let distance = phase; distance < length; distance += spacing) {
    ctx.save();
    ctx.translate(p1.x + ux * distance, p1.y + uy * distance);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(5, 0);
    ctx.lineTo(-3.5, -3.5);
    ctx.lineTo(-2, 0);
    ctx.lineTo(-3.5, 3.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

export function drawShortCircuitGlow(
  ctx: CanvasRenderingContext2D,
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  nowMs: number
): void {
  const safeTime = Number.isFinite(nowMs) ? nowMs : 0;
  const pulse = 0.55 + 0.45 * Math.sin(safeTime * 0.012);
  ctx.save();
  ctx.strokeStyle = `rgba(239, 68, 68, ${pulse.toFixed(2)})`;
  ctx.lineWidth = 8;
  ctx.lineCap = 'round';
  ctx.shadowColor = '#dc2626';
  ctx.shadowBlur = 18 * pulse;
  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.stroke();
  ctx.restore();
}

export function drawShortCircuitBanner(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  detailMessage: string
): void {
  const width = Number.isFinite(canvasWidth) ? Math.max(0, canvasWidth) : 0;
  const barWidth = Math.min(Math.max(0, width - 32), 560);
  const x = (width - barWidth) / 2;
  const y = 14;
  const barHeight = 36;

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = 'rgba(153, 27, 27, 0.92)';
  ctx.strokeStyle = '#f87171';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(x, y, barWidth, barHeight, 8);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#fef2f2';
  ctx.font = 'bold 13px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`警告：电路短路（${detailMessage}）`, x + barWidth / 2, y + barHeight / 2);
  ctx.restore();
}

const paramSchema: readonly ParamFieldSpec<CircuitParams>[] = [
  {
    key: 'topology',
    kind: 'select',
    label: '电路实验拓扑',
    options: [
      { label: '分压电路测小灯泡（非线性 MNA）', value: 'divider-lamp' },
      { label: '闭合电路欧姆定律与输出功率 P-R', value: 'closed-power' },
      { label: '混联滑变动态分析（串反并同）', value: 'series-parallel-dynamic' },
      { label: 'RC 含容电路充放电瞬态', value: 'rc-transient' },
      { label: '电桥含容支路稳态电荷求解', value: 'rc-bridge-charge' },
      { label: '非线性小灯泡 / 二极管伏安特性 (MNA-NR)', value: 'nonlinear-lamp-diode' }
    ],
    defaultValue: 'divider-lamp'
  },
  {
    key: 'emf',
    kind: 'number',
    label: '电源电动势 E',
    unit: 'V',
    min: 0,
    max: 24,
    step: 1,
    defaultValue: 12
  },
  {
    key: 'internalR',
    kind: 'number',
    label: '电源内阻 r',
    unit: 'Ω',
    min: 0,
    max: 5,
    step: 0.2,
    defaultValue: 1
  },
  {
    key: 'r1',
    kind: 'number',
    label: '定值电阻 R₁',
    unit: 'Ω',
    min: 1,
    max: 20,
    step: 1,
    defaultValue: 9
  },
  {
    key: 'r2',
    kind: 'number',
    label: '定值电阻 R₂',
    unit: 'Ω',
    min: 1,
    max: 20,
    step: 1,
    defaultValue: 6
  },
  {
    key: 'sliderR',
    kind: 'number',
    label: '滑动变阻器 R_p',
    unit: 'Ω',
    min: 0,
    max: 20,
    step: 0.5,
    defaultValue: 2
  },
  {
    key: 'capacitance',
    kind: 'number',
    label: '电容器电容 C',
    unit: 'F',
    min: 0.01,
    max: 0.5,
    step: 0.01,
    defaultValue: 0.05
  },
  {
    key: 'switchClosed',
    kind: 'boolean',
    label: '充电初态 / 二极管（取消：放电初态 / 灯泡）',
    defaultValue: true
  }
];


const liveFormulas: readonly LiveFormulaSpec[] = [
  {
    "id": "linear-dc",
    "title": "线性直流稳态闭合电路",
    "latex": "I=\\frac{\\htmlClass{pf-live-var}{\\htmlData{param=emf}{E}}}{R_{\\rm eq}+\\htmlClass{pf-live-var}{\\htmlData{param=internalR}{r}}}",
    "bindings": [
      {
        "tokenKey": "emf",
        "paramKey": "emf",
        "label": "电源电动势 E",
        "unit": "V",
        "min": 0,
        "max": 24,
        "step": 1,
        "precision": 1
      },
      {
        "tokenKey": "internalR",
        "paramKey": "internalR",
        "label": "电源内阻 r",
        "unit": "Ω",
        "min": 0,
        "max": 5,
        "step": 0.2,
        "precision": 2
      }
    ],
    "when": {
      "topology": [
        "closed-power",
        "series-parallel-dynamic"
      ]
    }
  },
  {
    "id": "closed-power",
    "title": "纯电阻外负载输出功率（R+r>0）",
    "latex": "P_R=\\frac{\\htmlClass{pf-live-var}{\\htmlData{param=emf}{E}}^2\\htmlClass{pf-live-var}{\\htmlData{param=sliderR}{R}}}{(R+\\htmlClass{pf-live-var}{\\htmlData{param=internalR}{r}})^2}",
    "bindings": [
      {
        "tokenKey": "emf",
        "paramKey": "emf",
        "label": "电源电动势 E",
        "unit": "V",
        "min": 0,
        "max": 24,
        "step": 1,
        "precision": 1
      },
      {
        "tokenKey": "sliderR",
        "paramKey": "sliderR",
        "label": "滑动变阻器电阻 R_p",
        "unit": "Ω",
        "min": 0,
        "max": 20,
        "step": 0.5,
        "precision": 2
      },
      {
        "tokenKey": "internalR",
        "paramKey": "internalR",
        "label": "电源内阻 r",
        "unit": "Ω",
        "min": 0,
        "max": 5,
        "step": 0.2,
        "precision": 2
      }
    ],
    "when": {
      "topology": [
        "closed-power"
      ]
    }
  },
  {
    "id": "resistor-network",
    "title": "串并联外电路等效电阻",
    "latex": "R_{\\rm eq}=\\htmlClass{pf-live-var}{\\htmlData{param=r1}{R_1}}+\\frac{\\htmlClass{pf-live-var}{\\htmlData{param=r2}{R_2}}\\htmlClass{pf-live-var}{\\htmlData{param=sliderR}{R_p}}}{R_2+R_p}",
    "bindings": [
      {
        "tokenKey": "r1",
        "paramKey": "r1",
        "label": "定值电阻 R₁",
        "unit": "Ω",
        "min": 1,
        "max": 20,
        "step": 1,
        "precision": 2
      },
      {
        "tokenKey": "r2",
        "paramKey": "r2",
        "label": "定值电阻 R₂",
        "unit": "Ω",
        "min": 1,
        "max": 20,
        "step": 1,
        "precision": 2
      },
      {
        "tokenKey": "sliderR",
        "paramKey": "sliderR",
        "label": "滑动变阻器电阻 R_p",
        "unit": "Ω",
        "min": 0,
        "max": 20,
        "step": 0.5,
        "precision": 2
      }
    ],
    "when": {
      "topology": [
        "series-parallel-dynamic"
      ]
    }
  },
  {
    "id": "capacitor-charge",
    "title": "含容支路的电荷及储能",
    "latex": "Q=\\htmlClass{pf-live-var}{\\htmlData{param=capacitance}{C}}U_C,\\quad W_C=\\tfrac12 C U_C^2",
    "bindings": [
      {
        "tokenKey": "capacitance",
        "paramKey": "capacitance",
        "label": "电容 C",
        "unit": "F",
        "min": 0.01,
        "max": 0.5,
        "step": 0.01,
        "precision": 3
      }
    ],
    "when": {
      "topology": [
        "rc-transient",
        "rc-bridge-charge"
      ]
    }
  },
  {
    "id": "nonlinear-kvl",
    "title": "非线性负载串联回路电压方程",
    "latex": "\\htmlClass{pf-live-var}{\\htmlData{param=emf}{E}}=I(\\htmlClass{pf-live-var}{\\htmlData{param=internalR}{r}}+\\htmlClass{pf-live-var}{\\htmlData{param=sliderR}{R_p}})+U_L",
    "bindings": [
      {
        "tokenKey": "emf",
        "paramKey": "emf",
        "label": "电源电动势 E",
        "unit": "V",
        "min": 0,
        "max": 24,
        "step": 1,
        "precision": 1
      },
      {
        "tokenKey": "internalR",
        "paramKey": "internalR",
        "label": "电源内阻 r",
        "unit": "Ω",
        "min": 0,
        "max": 5,
        "step": 0.2,
        "precision": 2
      },
      {
        "tokenKey": "sliderR",
        "paramKey": "sliderR",
        "label": "滑动变阻器电阻 R_p",
        "unit": "Ω",
        "min": 0,
        "max": 20,
        "step": 0.5,
        "precision": 2
      }
    ],
    "when": {
      "topology": [
        "nonlinear-lamp-diode"
      ]
    }
  }
];
/** Standalone workbench has an independent sidebar and measured canvas. */
export function resolveCircuitSliceCamera(params:CircuitParams,width:number,height:number){
  const camera=params.topology==='divider-lamp'?dividerDefaultCamera(width,height,false):topologyCamera(width,height,false);
  return {scale:camera.scale,offsetX:camera.offsetRatioX*width,offsetY:camera.offsetRatioY*height};
}

export const circuitDcCapacitorMnaPlugin = Object.assign(defineSimulationPlugin<CircuitParams, CircuitState>({
  meta: {
    id: 'builder-circuit-mna',
    title: '自由拓扑线性与非线性电路建模器 (B2)',
    textbookRef: '人教版 必修第三册 第十二章 第1–3节',
    curriculumTags: ['物理观念', '科学思维', '科学探究'],
    difficulty: '高三一轮',
    version: '2.0.0'
  },
  defaultView: {
    scale: (params,{width,height}) => (params.topology==='divider-lamp'?dividerDefaultCamera(width,height):topologyCamera(width,height)).scale,
    offsetRatioX: (params,{width,height}) => (params.topology==='divider-lamp'?dividerDefaultCamera(width,height):topologyCamera(width,height)).offsetRatioX,
    offsetRatioY: (params,{width,height}) => (params.topology==='divider-lamp'?dividerDefaultCamera(width,height):topologyCamera(width,height)).offsetRatioY
  },
  getControlHandles: (_state, params) => {
    if (!['closed-power', 'series-parallel-dynamic', 'rc-bridge-charge', 'divider-lamp'].includes(params.topology)) {
      return [];
    }
    const sliderFraction = Math.max(0, Math.min(1, params.sliderR / 20));
    const dividerLamp = params.topology === 'divider-lamp';
    const [minY,maxY]=sliderRange(params);
    return [{
      id: 'slider-resistor',
      label: `Rp=${params.sliderR.toFixed(1)}Ω`,
      position: {
        x: dividerLamp ? dividerWiperX : 1.7,
        y: dividerLamp ? dividerWiperY(params.sliderR) : minY + sliderFraction * (maxY-minY)
      },
      handleKind: 'point',
      showWhenIdle: !dividerLamp,
      color: '#f472b6',
      onDrag: (worldPos) => {
        const value = Number.isFinite(worldPos.y)
          ? (dividerLamp ? dividerRFromY(worldPos.y) : ((worldPos.y - minY) / (maxY-minY)) * 20)
          : params.sliderR;
        const nextR = Math.max(0, Math.min(20, value));
        return { sliderR: Math.round(nextR * 2) / 2 };
      }
    }];
  },
  sceneSerializer: {
    exportScene: (_state, params) => ({
      schemaVersion: '2.0',
      modelId: 'builder-circuit-mna',
      title: '自由拓扑电路仿真',
      params
    }),
    importScene: (dsl) => dsl.params as Partial<CircuitParams>
  },
  exportDiagramIR: (state, params) => params.topology==='divider-lamp' ? exportDividerDiagram(params) : exportTopologyDiagram(state,params),
  paramSchema,
  presets: [
    {
      id: 'divider-lamp-measurement',
      name: '1. 分压电路测小灯泡伏安特性',
      description: '电源经内阻和 20Ω 滑动变阻器构成分压器，小灯泡与滑片下段并联；MNA-NR 实时求解灯泡电压、电流和功率。',
      params: {
        topology: 'divider-lamp',
        emf: 12,
        internalR: 1,
        sliderR: 10,
        switchClosed: true
      }
    },
    {
      id: 'rc-charging-curve',
      name: '2. RC 含容电路指数充电瞬态',
      description: '闭合开关后电源向 0.05 F 电容充电，观察电容电压 Uc 指数上升至 E 与电流指数衰减至 0。',
      params: {
        topology: 'rc-transient',
        emf: 10,
        internalR: 1,
        r1: 9,
        capacitance: 0.05,
        switchClosed: true
      }
    },
    {
      id: 'rc-discharging-curve',
      name: '3. 断开电源电容经 R₁ 指数放电',
      description: '开关断开电源，已充至 E 的电容经定值电阻 R₁ 释放能量，观察指数放电波形。',
      params: {
        topology: 'rc-transient',
        emf: 10,
        internalR: 1,
        r1: 9,
        capacitance: 0.05,
        switchClosed: false
      }
    },
    {
      id: 'closed-circuit-max-power',
      name: '4. 闭合电路输出功率极值 (R = r)',
      description: '拖动外电阻 Rp 使 Rp = r = 2 Ω，直观验证电源输出功率取得极大值 E²/(4r) 且效率恰为 50%。',
      params: {
        topology: 'closed-power',
        emf: 12,
        internalR: 2,
        sliderR: 2
      }
    },
    {
      id: 'bridge-capacitor-polarity',
      name: '5. 直流电桥含容支路电荷与极性反转',
      description: '调节右侧滑变 Rp 跨越平衡点（Rp = R₁），实时观测电容两极板电压与带电量 Q 的正负反转。',
      params: {
        topology: 'rc-bridge-charge',
        emf: 12,
        internalR: 0.5,
        r1: 4,
        r2: 6,
        sliderR: 2,
        capacitance: 0.1
      }
    },
    {
      id: 'nonlinear-diode-iv',
      name: '6. 非线性肖克利二极管 / 小灯泡导通特性',
      description: '采用 Newton-Raphson 非线性 MNA 求解二极管正向导通压降（开关闭合=二极管，断开=幂律小灯泡）。',
      params: {
        topology: 'nonlinear-lamp-diode',
        emf: 5,
        internalR: 0.5,
        sliderR: 10,
        switchClosed: true
      }
    },
    {
      id: 'closed-power-short-circuit',
      name: '7. 理想电源零欧姆短路（无有限解）',
      description: '理想电源经零欧姆外电阻短接，模型无有限解；不将数值占位显示为测量。',
      params: {
        topology: 'closed-power',
        emf: 12,
        internalR: 0,
        r1: 9,
        r2: 6,
        sliderR: 0,
        capacitance: 0.05,
        switchClosed: true
      }
    }
    ,{id:'series-parallel-branches',name:'8. 混联分流与支路电流',description:'R₁ 与 R₂、Rₚ 的并联部分串联；比较两个支路电流。',params:{topology:'series-parallel-dynamic',emf:12,internalR:2,r1:4,r2:6,sliderR:3}},
    {id:'nonlinear-lamp-iv',name:'9. 串联非线性小灯泡',description:'幂律近似下的小灯泡与串联限流电阻。',params:{topology:'nonlinear-lamp-diode',emf:5,internalR:.5,sliderR:10,switchClosed:false}}
  ],
  engine: {
    createInitialState,
    step: stepCircuit,
    computeObservables,
    checkInvariants
  },
  layers: [
    { id: 'schematic', label: '交互电路图与节点电势', defaultVisible: true },
    { id: 'potential-labels', label: '节点电势数值标签', defaultVisible: true },
    { id: 'current-flow', label: '支路电流方向粒子', defaultVisible: true },
    { id: 'short-circuit', label: '短路红光与告警', defaultVisible: true },
    { id: 'meters', label: '电流/电压实时数字表头', defaultVisible: true }
  ],
  telemetryChannels: [
    { key: 'capVoltage', label: '电容电压 Uc', unit: 'V', color: '#38bdf8' },
    { key: 'capCurrent', label: '电容电流 Ic', unit: 'A', color: '#f472b6' },
    { key: 'totalCurrent', label: '干路总电流 I', unit: 'A', color: '#fbbf24' },
    { key: 'outputPower', label: '输出功率 P出', unit: 'W', color: '#4ade80' },
    { key: 'lampCurrent', label: '灯泡电流 I灯', unit: 'A', color: '#fbbf24' },
    { key: 'lampVoltage', label: '灯泡电压 U灯', unit: 'V', color: '#38bdf8' },
    {key:'branchCurrent1',label:'支路电流 I₁',unit:'A',color:'#38bdf8'},
    {key:'branchCurrent2',label:'支路电流 I₂',unit:'A',color:'#f472b6'},
    {key:'terminalVoltage',label:'负载 / 路端电压 U',unit:'V',color:'#38bdf8'}
  ],
  formatFormulas: (state, params) => {
    if(state.modelError)return [{id:'diode-invalid',label:'零串阻二极管超出指数模型适用范围',latex:'R_p+r=0,\\quad U_D/V_T>40',substitutedLatex:'I_D\\;\\text{不提供数值解}'}];
    if(state.idealShort)return [{id:'ideal-short',label:'理想零阻回路不可求唯一有限解',latex:params.emf===0?'0=0\\quad\\text{电流不唯一}':'E\\ne0,\\quad R+r=0',substitutedLatex:'I\\;\\text{不可定义}'}];
    if (params.topology === 'closed-power') {
      return [
        {
          id: 'ohm-power',
          label: '闭合电路欧姆定律与输出功率',
          latex: 'I = \\frac{E}{R + r}, \\quad P_{\\text{出}} = I^2 R',
          substitutedLatex: `I = ${state.totalCurrent.toFixed(2)}\\text{ A},\\; U = ${state.terminalVoltage.toFixed(2)}\\text{ V},\\; P_{\\text{出}} = ${state.outputPower.toFixed(2)}\\text{ W}\\; (\\eta=${(state.efficiency * 100).toFixed(1)}\\%)`
        }
      ];
    }
    if (params.topology === 'divider-lamp') {
      return [
        {
          id: 'nonlinear-lamp-law',
          label: '小灯泡伏安特性（幂律近似）',
          latex: '\\begin{gathered}I_L \\approx 0.25 U_L^{0.65}\\\\ P_L = U_L I_L\\end{gathered}',
          substitutedLatex: `\\begin{gathered}U_L=${state.terminalVoltage.toFixed(2)}\\text{ V}\\\\ I_L=${state.branchCurrent2.toFixed(2)}\\text{ A}\\\\ P_L=${state.outputPower.toFixed(2)}\\text{ W}\\end{gathered}`
        },
        {
          id:'divider-balance',
          label:'电源路端与分压节点',
          latex:'\\begin{gathered}U_s=E-I_s r\\\\ I_s=I_{\\text{下}}+I_L\\end{gathered}',
          substitutedLatex:`\\begin{gathered}U_s=${(state.divider?.sourceTerminalVoltage??0).toFixed(2)}\\text{ V}\\\\ I_s=${state.totalCurrent.toFixed(2)}\\text{ A}\\end{gathered}`
        }
      ];
    }
    if(params.topology==='series-parallel-dynamic')return [{
      id:'parallel-kcl',label:'并联分流与等效电阻',
      latex:'I=I_2+I_p,\\quad R_{eq}=R_1+\\frac{R_2R_p}{R_2+R_p}',
      substitutedLatex:`I=${state.totalCurrent.toFixed(3)}\\text{ A},\\quad I_2=${state.branchCurrent1.toFixed(3)}\\text{ A},\\quad I_p=${state.branchCurrent2.toFixed(3)}\\text{ A}`
    }];
    if(params.topology==='nonlinear-lamp-diode')return [{
      id:'nonlinear-load',label:params.switchClosed?'肖克利二极管（指数限幅近似）':'小灯泡幂律近似',
      latex:params.switchClosed?'I_D=I_s(e^{\\min(U_D/V_T,40)}-1)':'I_L\\approx0.25U_L^{0.65}',
      substitutedLatex:`U=${state.terminalVoltage.toFixed(3)}\\text{ V},\\quad I=${state.totalCurrent.toFixed(3)}\\text{ A}`
    }];
    return [
      {
        id: 'cap-charge',
        label: '电容电量与储能方程（一阶 RC 等效）',
        latex: 'Q = C \\cdot U_C, \\quad E_C = \\frac{1}{2} C U_C^2',
        substitutedLatex: `U_C = ${state.capVoltage.toFixed(2)}\\text{ V},\\; Q = ${state.capCharge.toFixed(3)}\\text{ C},\\; I_C = ${state.capCurrent.toFixed(3)}\\text{ A}`
      }
    ];
  },
  renderCanvas: (ctx,state,params,viewport,activeLayers)=>{
    if(params.topology==='divider-lamp'){renderDivider(ctx,state,params,viewport,activeLayers);return;}
    renderTopology(ctx,state,params,viewport,activeLayers);
  }
}), { liveFormulas,resolveCircuitSliceCamera });

export default circuitDcCapacitorMnaPlugin;
