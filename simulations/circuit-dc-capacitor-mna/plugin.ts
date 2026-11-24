import type { LiveFormulaSpec } from '@physforge/sim-sdk';
import {
  createWorldMapper,
  defineSimulationPlugin,
  drawFloatingIUCard,
  drawGlowingBulbSymbol,
  drawGroundSymbol,
  drawRoundedPotentialPath,
  type DiagramPrimitive,
  type ParamFieldSpec
} from '@physforge/sim-sdk';
import {
  checkInvariants,
  computeObservables,
  createInitialState,
  sampleDividerLampIvCurve,
  stepCircuit,
  type CircuitParams,
  type CircuitState
} from './engine.js';

const branchPhaseMap = new Map<string, number>();
let lastCircuitFrameTimeMs: number | undefined;

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
  ctx.fillText(`警告：检测到电路短路（${detailMessage}），已触发拓扑保护`, x + barWidth / 2, y + barHeight / 2);
  ctx.restore();
}

function drawVerticalZigzagResistor(
  ctx: CanvasRenderingContext2D,
  x: number,
  y1: number,
  y2: number,
  tint: string
): void {
  if (![x, y1, y2].every(Number.isFinite) || Math.abs(y2 - y1) < 2) return;
  const start = Math.min(y1, y2);
  const end = Math.max(y1, y2);
  const span = end - start;
  ctx.save();
  ctx.strokeStyle = tint;
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.shadowColor = tint;
  ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.moveTo(x, start);
  const segments = 8;
  for (let index = 1; index < segments; index += 1) {
    ctx.lineTo(x + (index % 2 === 0 ? -8 : 8), start + span * index / segments);
  }
  ctx.lineTo(x, end);
  ctx.stroke();
  ctx.restore();
}

function drawHorizontalZigzagResistor(
  ctx: CanvasRenderingContext2D,
  x1: number,
  x2: number,
  y: number,
  tint: string
): void {
  if (![x1, x2, y].every(Number.isFinite) || Math.abs(x2 - x1) < 2) return;
  const start = Math.min(x1, x2);
  const end = Math.max(x1, x2);
  ctx.save();
  ctx.strokeStyle = tint;
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.shadowColor = tint;
  ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.moveTo(start, y);
  const segments = 8;
  for (let index = 1; index < segments; index += 1) {
    ctx.lineTo(start + (end - start) * index / segments, y + (index % 2 === 0 ? -7 : 7));
  }
  ctx.lineTo(end, y);
  ctx.stroke();
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
    label: '开关闭合（充电 / 断开经 R₁ 放电）',
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
export const circuitDcCapacitorMnaPlugin = Object.assign(defineSimulationPlugin<CircuitParams, CircuitState>({
  meta: {
    id: 'builder-circuit-mna',
    title: '自由拓扑线性与非线性电路建模器 (B2)',
    textbookRef: '人教版 必修第三册 第十二章 第1–3节',
    curriculumTags: ['物理观念', '科学思维', '科学探究'],
    difficulty: '高三一轮',
    version: '2.0.0'
  },
  getControlHandles: (_state, params) => {
    if (!['closed-power', 'series-parallel-dynamic', 'rc-bridge-charge', 'divider-lamp'].includes(params.topology)) {
      return [];
    }
    const sliderFraction = Math.max(0, Math.min(1, params.sliderR / 20));
    const dividerLamp = params.topology === 'divider-lamp';
    const dividerContactFraction = Math.max(0.05, Math.min(0.95, sliderFraction));
    return [{
      id: 'slider-resistor',
      label: `Rp=${params.sliderR.toFixed(1)}Ω`,
      position: {
        x: dividerLamp ? 0.17 : 1.7,
        y: dividerLamp ? -1.093 + dividerContactFraction * 2.52 : -0.7 + sliderFraction * 1.4
      },
      handleKind: 'point',
      showWhenIdle: !dividerLamp,
      color: '#f472b6',
      onDrag: (worldPos) => {
        const value = Number.isFinite(worldPos.y)
          ? (dividerLamp ? ((worldPos.y + 1.093) / 2.52) * 20 : ((worldPos.y + 0.7) / 1.4) * 20)
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
  exportDiagramIR: (_state, params) => {
    const primitives: DiagramPrimitive[] = [
      { kind: 'circuitElement', element: 'battery', x1: -2.2, y1: -1.4, x2: -2.2, y2: 1.4, label: `E=${params.emf}V, r=${params.internalR}\\Omega` },
      { kind: 'line', x1: -2.2, y1: 1.4, x2: -0.6, y2: 1.4 },
      { kind: 'circuitElement', element: 'resistor', x1: -0.6, y1: 1.4, x2: 1.6, y2: 1.4, label: `R_1=${params.r1}\\Omega` },
      { kind: 'line', x1: 1.6, y1: 1.4, x2: 2.2, y2: 1.4 },
      params.topology === 'rc-transient'
        ? { kind: 'circuitElement', element: 'capacitor', x1: 2.2, y1: 1.4, x2: 2.2, y2: -1.4, label: `C=${params.capacitance}F` }
        : params.topology === 'nonlinear-lamp-diode'
          ? { kind: 'circuitElement', element: 'lamp', x1: 2.2, y1: 1.4, x2: 2.2, y2: -1.4, label: params.switchClosed ? 'D' : 'L' }
          : { kind: 'circuitElement', element: 'resistor', x1: 2.2, y1: 1.4, x2: 2.2, y2: -1.4, label: `R_p=${params.sliderR}\\Omega` },
      { kind: 'circuitElement', element: 'ammeter', x1: 2.2, y1: -1.4, x2: -2.2, y2: -1.4, label: 'A' }
    ];
    return {
      width: 720,
      height: 440,
      viewBox: { minX: -3.2, minY: -2.2, maxX: 3.2, maxY: 2.2 },
      title: '直流/含容/非线性电路原理图',
      primitives
    };
  },
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
      name: '7. 闭合电路零欧姆短路保护告警',
      description: '理想电源经零欧姆外电阻短接；节点电压着色、电流粒子与短路横幅共同显示拓扑保护状态。',
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
    { key: 'outputPower', label: '输出功率 P出', unit: 'W', color: '#4ade80' }
  ],
  formatFormulas: (state, params) => {
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
          label: '小灯泡伏安特性（正向工作区）',
          latex: '\\begin{aligned}I_L &= 0.25 U_L^{0.65} \\\\ P_L &= U_L I_L\\end{aligned}',
          substitutedLatex: `U_L = ${state.terminalVoltage.toFixed(2)}\\text{ V},\\quad I_L = ${state.branchCurrent2.toFixed(2)}\\text{ A}\\quad P_L = ${state.outputPower.toFixed(2)}\\text{ W}`
        }
      ];
    }
    return [
      {
        id: 'cap-charge',
        label: '电容电量与储能方程（MNA 求解）',
        latex: 'Q = C \\cdot U_C, \\quad E_C = \\frac{1}{2} C U_C^2',
        substitutedLatex: `U_C = ${state.capVoltage.toFixed(2)}\\text{ V},\\; Q = ${state.capCharge.toFixed(3)}\\text{ C},\\; I_C = ${state.capCurrent.toFixed(3)}\\text{ A}`
      }
    ];
  },
  renderCanvas: (ctx, state, params, viewport, activeLayers) => {
    const m = createWorldMapper(viewport);
    const dividerLamp = params.topology === 'divider-lamp';
    const basePpm = Math.min(viewport.width, viewport.height) * 0.24;
    const px = (pixels: number): number => m.len(pixels / basePpm);
    const ppm = m.ppm;
    const cx = dividerLamp ? viewport.width * 0.5 + viewport.offsetX : m.toX(0);
    const cy = m.toY(0);
    const left = dividerLamp ? cx - Math.min(viewport.width * 0.31, 250) : m.toX(-1.7);
    const right = dividerLamp ? cx + Math.min(viewport.width * 0.31, 250) : m.toX(1.7);
    const top = dividerLamp ? cy - Math.min(viewport.height * 0.27, 140) : m.toY(0.82);
    const bot = dividerLamp ? cy + Math.min(viewport.height * 0.27, 140) : m.toY(-0.82);
    const modelOriginX = viewport.width * 0.45 + viewport.offsetX - (dividerLamp ? 1.53 * ppm : 0);
    const modelOriginY = viewport.height * 0.5 + viewport.offsetY - (dividerLamp ? 0.167 * ppm : 0);
    const finiteVoltages = state.nodeVoltages.filter(Number.isFinite);
    const vMin = Math.min(0, ...finiteVoltages);
    const vMax = Math.max(1, ...finiteVoltages);
    const nodeVoltage = (index: number): number | undefined => state.nodeVoltages[index];
    const sourceVoltage = nodeVoltage(1);
    const loadVoltage = nodeVoltage(2);
    const groundVoltage = nodeVoltage(0) ?? 0;
    const shortEvent = state.events.find((event) => event.id === 'SHORT_CIRCUIT');
    const overcurrent = [state.totalCurrent, state.branchCurrent1, state.branchCurrent2].some(
      (current) => Number.isFinite(current) && Math.abs(current) > 50
    );
    const isShorted = Boolean(shortEvent) || overcurrent;
    const nowMs = typeof performance !== 'undefined' ? performance.now() : state.t * 1000;
    const dtSec = lastCircuitFrameTimeMs === undefined
      ? 0
      : Math.max(0, Math.min((nowMs - lastCircuitFrameTimeMs) / 1000, 0.05));
    lastCircuitFrameTimeMs = nowMs;
    const branchReturnCurrent = params.topology === 'series-parallel-dynamic' || params.topology === 'rc-bridge-charge'
      ? state.branchCurrent1 + state.branchCurrent2
      : state.totalCurrent;

    const drawVoltageSegment = (
      p1: { x: number; y: number },
      p2: { x: number; y: number },
      fromVoltage: number | undefined,
      toVoltage: number | undefined,
      width = 3
    ): void => {
      drawRoundedPotentialPath(
        ctx,
        [p1, p2],
        voltageToColor(fromVoltage, vMin, vMax),
        voltageToColor(toVoltage, vMin, vMax),
        10,
        width
      );
    };

    if (activeLayers.has('schematic')) {
      if (params.topology === 'divider-lamp') {
        const batteryX = modelOriginX - 0.52 * ppm;
        const sliderX = modelOriginX + 1.7 * ppm;
        const yTop = modelOriginY - 1.26 * ppm;
        const yBottom = modelOriginY + 1.26 * ppm;
        const ratio = Math.max(0.05, Math.min(0.95, params.sliderR / 20));
        const contactY = yBottom - ratio * (yBottom - yTop);
        const bulbX = modelOriginX + 2.7 * ppm;
        const bulbY = (contactY + yBottom) * 0.5;
        const bulbRadius = 18;
        const sourceV = state.nodeVoltages[1] ?? params.emf;
        const bulbV = state.nodeVoltages[2] ?? state.terminalVoltage;
        const zeroV = state.nodeVoltages[0] ?? 0;
        const internalRStart = { x: batteryX + 0.28 * ppm, y: yTop };
        const internalREnd = { x: batteryX + 0.9 * ppm, y: yTop };
        const high = { x: batteryX, y: yTop };
        const rheostatTop = { x: sliderX, y: yTop };
        const wiper = { x: sliderX, y: contactY };
        const rheostatBottom = { x: sliderX, y: yBottom };
        const bulbTop = { x: bulbX, y: bulbY - bulbRadius };
        const bulbBottom = { x: bulbX, y: bulbY + bulbRadius };
        const low = { x: batteryX, y: yBottom };

        ctx.save();
        drawRoundedPotentialPath(ctx, [high, internalRStart], voltageToColor(sourceV, vMin, vMax), voltageToColor(sourceV, vMin, vMax), 12, 5);
        drawHorizontalZigzagResistor(ctx, internalRStart.x, internalREnd.x, yTop, voltageToColor(sourceV, vMin, vMax));
        drawRoundedPotentialPath(ctx, [internalREnd, rheostatTop], voltageToColor(sourceV, vMin, vMax), voltageToColor(sourceV, vMin, vMax), 12, 5);
        drawRoundedPotentialPath(ctx, [rheostatBottom, low], voltageToColor(zeroV, vMin, vMax), voltageToColor(zeroV, vMin, vMax), 12, 5);
        drawRoundedPotentialPath(ctx, [wiper, { x: bulbX, y: contactY }, { x: bulbX, y: bulbTop.y }], voltageToColor(bulbV, vMin, vMax), voltageToColor(bulbV, vMin, vMax), 12, 5);
        drawRoundedPotentialPath(ctx, [bulbBottom, { x: bulbX, y: yBottom }, rheostatBottom], voltageToColor(zeroV, vMin, vMax), voltageToColor(zeroV, vMin, vMax), 12, 5);

        // Battery and internal resistance in series with the full rheostat.
        const batteryMid = (yTop + yBottom) * 0.5;
        ctx.strokeStyle = voltageToColor(sourceV, vMin, vMax);
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(batteryX, yTop);
        ctx.lineTo(batteryX, batteryMid - 12);
        ctx.moveTo(batteryX - 14, batteryMid - 8);
        ctx.lineTo(batteryX + 14, batteryMid - 8);
        ctx.moveTo(batteryX - 8, batteryMid + 8);
        ctx.lineTo(batteryX + 8, batteryMid + 8);
        ctx.moveTo(batteryX, batteryMid + 12);
        ctx.lineTo(batteryX, yBottom);
        ctx.stroke();

        // Split rheostat sections share the real MNA wiper node.
        drawVerticalZigzagResistor(ctx, sliderX, yTop + 8, contactY - 8, voltageToColor(sourceV, vMin, vMax));
        drawVerticalZigzagResistor(ctx, sliderX, contactY + 8, yBottom - 8, voltageToColor(zeroV, vMin, vMax));
        ctx.strokeStyle = '#f472b6';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(sliderX + 28, contactY);
        ctx.lineTo(sliderX + 4, contactY);
        ctx.lineTo(sliderX + 13, contactY - 7);
        ctx.moveTo(sliderX + 4, contactY);
        ctx.lineTo(sliderX + 13, contactY + 7);
        ctx.stroke();
        drawGlowingBulbSymbol(ctx, bulbX, bulbY, state.outputPower, 8, bulbRadius);
        drawGroundSymbol(ctx, sliderX, yBottom, '#38bdf8');
        ctx.fillStyle = '#fbbf24';
        ctx.font = '600 13px system-ui, sans-serif';
        ctx.fillText(`E=${params.emf.toFixed(1)} V`, batteryX - 96, batteryMid + 5);
        ctx.fillStyle = '#cbd5e1';
        ctx.fillText(`r=${params.internalR.toFixed(1)} Ω`, batteryX + 20, batteryMid + 4);
        ctx.fillStyle = '#f472b6';
        ctx.fillText(`R₀=20 Ω`, sliderX + 34, yTop + 12);
        ctx.fillText('滑片位置', sliderX - 74, contactY - 9);
        ctx.restore();

        if (activeLayers.has('current-flow')) {
          const options = { isShorted };
          drawCurrentParticles(ctx, 'divider-lamp-upper', high, rheostatTop, state.totalCurrent, dtSec, options);
          drawCurrentParticles(ctx, 'divider-lamp-bulb', { x: bulbX, y: contactY }, bulbBottom, state.branchCurrent2, dtSec, options);
        }

        const samples = sampleDividerLampIvCurve(Math.max(params.emf, 1), 16);
        const cardX = Math.min(viewport.width - 440, bulbX + 26);
        const cardY = Math.min(viewport.height - 144, yBottom + 10);
        drawFloatingIUCard(
          ctx,
          cardX,
          cardY,
          144,
          132,
          samples,
          { u: state.terminalVoltage, i: state.branchCurrent2 }
        );
      } else {
      ctx.save();
      const topLeft = { x: left, y: top };
      const topRight = { x: right, y: top };
      const bottomRight = { x: right, y: bot };
      const bottomLeft = { x: left, y: bot };
      drawVoltageSegment(topLeft, topRight, sourceVoltage, loadVoltage);
      drawVoltageSegment(topRight, bottomRight, loadVoltage, groundVoltage);
      drawVoltageSegment(bottomRight, bottomLeft, groundVoltage, groundVoltage);
      drawVoltageSegment(bottomLeft, topLeft, groundVoltage, sourceVoltage);

      // 左侧电源符号 (E, r)
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(left - px(18), cy - px(28), px(36), px(56));
      const sourceGradient = ctx.createLinearGradient(left, cy - px(28), left, cy + px(28));
      sourceGradient.addColorStop(0, voltageToColor(sourceVoltage, vMin, vMax));
      sourceGradient.addColorStop(1, voltageToColor(groundVoltage, vMin, vMax));
      ctx.strokeStyle = sourceGradient;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(left - px(14), cy - px(8));
      ctx.lineTo(left + px(14), cy - px(8));
      ctx.moveTo(left - px(7), cy + px(8));
      ctx.lineTo(left + px(7), cy + px(8));
      ctx.stroke();
      ctx.fillStyle = '#fbbf24';
      ctx.font = 'bold 14px system-ui, sans-serif';
      ctx.fillText(`E=${params.emf}V, r=${params.internalR}Ω`, left + px(22), cy + px(5));

      // 顶部 R1 电阻框
      ctx.fillStyle = '#1e293b';
      const resistorGradient = ctx.createLinearGradient(cx - px(42), top - px(16), cx + px(42), top + px(16));
      resistorGradient.addColorStop(0, voltageToColor(sourceVoltage, vMin, vMax));
      resistorGradient.addColorStop(1, voltageToColor(loadVoltage, vMin, vMax));
      ctx.strokeStyle = resistorGradient;
      ctx.lineWidth = 3;
      ctx.fillRect(cx - px(42), top - px(16), px(84), px(32));
      ctx.strokeRect(cx - px(42), top - px(16), px(84), px(32));
      ctx.fillStyle = '#38bdf8';
      ctx.fillText(
        params.topology === 'closed-power'
          ? `r=${params.internalR}Ω`
          : `R₁=${params.r1}Ω`,
        cx - px(32),
        top + px(5)
      );

      // 右侧电容或负载元件
      if (params.topology === 'rc-transient') {
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(right - px(16), cy - px(20), px(32), px(40));
        const capacitorGradient = ctx.createLinearGradient(right, cy - px(20), right, cy + px(20));
        capacitorGradient.addColorStop(0, voltageToColor(loadVoltage, vMin, vMax));
        capacitorGradient.addColorStop(1, voltageToColor(groundVoltage, vMin, vMax));
        ctx.strokeStyle = capacitorGradient;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(right - px(16), cy - px(10));
        ctx.lineTo(right + px(16), cy - px(10));
        ctx.moveTo(right - px(16), cy + px(10));
        ctx.lineTo(right + px(16), cy + px(10));
        ctx.stroke();
        ctx.fillStyle = '#4ade80';
        ctx.fillText(`C=${params.capacitance}F`, right - px(75), cy + px(5));
      } else {
        ctx.fillStyle = '#1e293b';
        const loadGradient = ctx.createLinearGradient(right, cy - px(34), right, cy + px(34));
        loadGradient.addColorStop(0, voltageToColor(loadVoltage, vMin, vMax));
        loadGradient.addColorStop(1, voltageToColor(groundVoltage, vMin, vMax));
        ctx.strokeStyle = loadGradient;
        ctx.lineWidth = 3;
        ctx.fillRect(right - px(18), cy - px(34), px(36), px(68));
        ctx.strokeRect(right - px(18), cy - px(34), px(36), px(68));
        ctx.fillStyle = '#f472b6';
        ctx.fillText(`Rp=${params.sliderR}Ω`, right - px(95), cy + px(5));
        if (['closed-power', 'series-parallel-dynamic', 'rc-bridge-charge'].includes(params.topology)) {
          const sliderFraction = Math.max(0, Math.min(1, params.sliderR / 20));
          const contactY = m.toY(-0.7 + sliderFraction * 1.4);
          ctx.strokeStyle = '#f472b6';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(right + px(44), contactY);
          ctx.lineTo(right + px(19), contactY);
          ctx.lineTo(right + px(27), contactY - px(6));
          ctx.moveTo(right + px(19), contactY);
          ctx.lineTo(right + px(27), contactY + px(6));
          ctx.stroke();
        }
      }
      ctx.restore();
      }
    }

    if (activeLayers.has('potential-labels') && activeLayers.has('schematic')) {
      const dividerRatio = Math.max(0.05, Math.min(0.95, params.sliderR / 20));
      const dividerTop = modelOriginY - (dividerLamp ? 1.26 : 0.82) * ppm;
      const dividerBottom = modelOriginY + (dividerLamp ? 1.26 : 0.82) * ppm;
      const dividerWiperY = dividerBottom - dividerRatio * (dividerBottom - dividerTop);
      const nodeLabels = params.topology === 'divider-lamp'
        ? [
            { id: 1, voltage: sourceVoltage, x: modelOriginX + 1.7 * ppm - 6, y: dividerTop - 18 },
            { id: 2, voltage: loadVoltage, x: modelOriginX + 2.7 * ppm + 5, y: dividerWiperY },
            { id: 0, voltage: groundVoltage, x: modelOriginX + 1.7 * ppm + 5, y: dividerBottom + 24 }
          ]
        : [
            { id: 1, voltage: sourceVoltage, x: left + px(6), y: top - px(10) },
            { id: 2, voltage: loadVoltage, x: right - px(72), y: top - px(10) },
            { id: 0, voltage: groundVoltage, x: right - px(52), y: bot + px(18) }
          ];
      ctx.save();
      ctx.font = '12px ui-monospace, SFMono-Regular, Consolas, monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      for (const node of nodeLabels) {
        ctx.fillStyle = voltageToColor(node.voltage, vMin, vMax);
        ctx.beginPath();
        const nodeRadius = dividerLamp ? 4 : px(4);
        const nodeYOffset = dividerLamp ? (node.id === 0 ? -4 : 10) : px(node.id === 0 ? -4 : 10);
        ctx.arc(node.x, node.y + nodeYOffset, nodeRadius, 0, Math.PI * 2);
        ctx.fill();
        const numericVoltage = node.voltage;
        const hasNumericVoltage = typeof numericVoltage === 'number' && Number.isFinite(numericVoltage);
        const voltageLabel = params.topology === 'divider-lamp' && hasNumericVoltage
          ? `${numericVoltage === 0 ? '' : numericVoltage > 0 ? '+' : ''}${numericVoltage.toFixed(1)} V`
          : `N${node.id}=${numericVoltage?.toFixed(2) ?? '—'}V`;
        ctx.fillText(voltageLabel, node.x + (dividerLamp ? 8 : px(8)), node.y);
      }
      ctx.restore();
    }

    if (activeLayers.has('current-flow') && activeLayers.has('schematic') && params.topology !== 'divider-lamp') {
      const branchOptions = { isShorted };
      drawCurrentParticles(ctx, 'builder-circuit-mna-top-a', { x: left + px(20), y: top }, { x: cx - px(48), y: top }, state.totalCurrent, dtSec, branchOptions);
      drawCurrentParticles(ctx, 'builder-circuit-mna-top-b', { x: cx + px(48), y: top }, { x: right - px(20), y: top }, state.totalCurrent, dtSec, branchOptions);
      drawCurrentParticles(ctx, 'builder-circuit-mna-return', { x: right, y: top + px(40) }, { x: right, y: bot - px(40) }, branchReturnCurrent, dtSec, branchOptions);
    }

    if (isShorted && activeLayers.has('short-circuit')) {
      drawShortCircuitGlow(ctx, { x: left, y: top }, { x: right, y: top }, nowMs);
      drawShortCircuitGlow(ctx, { x: right, y: top }, { x: right, y: bot }, nowMs);
    }

    if (activeLayers.has('meters')) {
      ctx.save();
      const meterCenterX = dividerLamp ? modelOriginX + 1.7 * ppm : cx;
      const meterY = dividerLamp ? modelOriginY + 0.74 * ppm : bot;
      const drawMeter = (
        x: number,
        label: string,
        value: number,
        unit: string,
        tint: string
      ) => {
        const radius = dividerLamp ? 28 : px(34);
        ctx.save();
        ctx.shadowColor = tint;
        ctx.shadowBlur = 14;
        ctx.fillStyle = 'rgba(10, 16, 27, 0.94)';
        ctx.strokeStyle = tint;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, meterY, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.textAlign = 'center';
        ctx.fillStyle = '#f8fafc';
        ctx.font = 'bold 13px ui-monospace, monospace';
        ctx.fillText(value.toFixed(2), x, meterY + (dividerLamp ? 2 : px(2)));
        ctx.fillStyle = tint;
        ctx.font = 'bold 10px ui-monospace, monospace';
        ctx.fillText(unit, x, meterY + (dividerLamp ? 16 : px(16)));
        ctx.fillStyle = '#cbd5e1';
        ctx.font = '10px system-ui, sans-serif';
        ctx.fillText(label, x, meterY + radius + (dividerLamp ? 14 : px(14)));
        ctx.restore();
      };

      if (dividerLamp) {
        const bulbX = modelOriginX + 2.7 * ppm;
        const yTop = modelOriginY - 1.26 * ppm;
        const yBottom = modelOriginY + 1.26 * ppm;
        const ratio = Math.max(0.05, Math.min(0.95, params.sliderR / 20));
        const contactY = yBottom - ratio * (yBottom - yTop);
        const voltmeterX = meterCenterX + 1.56 * ppm;
        ctx.save();
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)';
        ctx.lineWidth = 1.6;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(bulbX, contactY);
        ctx.lineTo(voltmeterX, contactY);
        ctx.lineTo(voltmeterX, meterY);
        ctx.moveTo(voltmeterX, meterY);
        ctx.lineTo(voltmeterX, yBottom);
        ctx.lineTo(bulbX, yBottom);
        ctx.stroke();
        ctx.restore();
        drawMeter(meterCenterX, '电流 I', state.branchCurrent2, 'A', '#fbbf24');
        drawMeter(voltmeterX, '电压 U', state.terminalVoltage, 'V', '#38bdf8');
      } else {
        drawMeter(meterCenterX - px(48), '电流 I', state.totalCurrent, 'A', '#fbbf24');
        drawMeter(meterCenterX + px(48), '电压 U', state.terminalVoltage, 'V', '#38bdf8');
      }
      ctx.restore();
    }

    if (isShorted && activeLayers.has('short-circuit')) {
      drawShortCircuitBanner(
        ctx,
        ctx.canvas.width,
        shortEvent?.label ?? `支路电流超过 50 A（I=${Math.max(Math.abs(state.totalCurrent), Math.abs(state.branchCurrent1), Math.abs(state.branchCurrent2)).toFixed(1)} A）`
      );
    }
  }
}), { liveFormulas });

export default circuitDcCapacitorMnaPlugin;
