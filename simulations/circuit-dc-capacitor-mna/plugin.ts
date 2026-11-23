import { defineSimulationPlugin, type DiagramPrimitive, type ParamFieldSpec } from '@physforge/sim-sdk';
import {
  checkInvariants,
  computeObservables,
  createInitialState,
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

const paramSchema: readonly ParamFieldSpec<CircuitParams>[] = [
  {
    key: 'topology',
    kind: 'select',
    label: '电路实验拓扑',
    options: [
      { label: '闭合电路欧姆定律与输出功率 P-R', value: 'closed-power' },
      { label: '混联滑变动态分析（串反并同）', value: 'series-parallel-dynamic' },
      { label: 'RC 含容电路充放电瞬态', value: 'rc-transient' },
      { label: '电桥含容支路稳态电荷求解', value: 'rc-bridge-charge' },
      { label: '非线性小灯泡 / 二极管伏安特性 (MNA-NR)', value: 'nonlinear-lamp-diode' }
    ],
    defaultValue: 'rc-transient'
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

export const circuitDcCapacitorMnaPlugin = defineSimulationPlugin<CircuitParams, CircuitState>({
  meta: {
    id: 'builder-circuit-mna',
    title: '自由拓扑线性与非线性电路建模器 (B2)',
    textbookRef: '人教版 必修第三册 第十二章 第1–3节',
    curriculumTags: ['物理观念', '科学思维', '科学探究'],
    difficulty: '高三一轮',
    version: '2.0.0'
  },
  getControlHandles: (_state, params) => [
    {
      id: 'slider-resistor',
      label: `Rp=${params.sliderR.toFixed(1)}Ω`,
      position: { x: -1.5 + (params.sliderR / 20) * 3.0, y: -1.2 },
      handleKind: 'point',
      color: '#f472b6',
      onDrag: (worldPos) => {
        const nextR = Math.max(0, Math.min(20, ((worldPos.x + 1.5) / 3.0) * 20));
        return { sliderR: Math.round(nextR * 2) / 2 };
      }
    }
  ],
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
      id: 'rc-charging-curve',
      name: '1. RC 含容电路指数充电瞬态',
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
      name: '2. 断开电源电容经 R₁ 指数放电',
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
      name: '3. 闭合电路输出功率极值 (R = r)',
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
      name: '4. 直流电桥含容支路电荷与极性反转',
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
      name: '5. 非线性肖克利二极管 / 小灯泡导通特性',
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
      name: '6. 闭合电路零欧姆短路保护告警',
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
    const cx = viewport.width * 0.5 + viewport.offsetX;
    const cy = viewport.height * 0.5 + viewport.offsetY;
    const w = Math.min(viewport.width * 0.62, 500);
    const h = Math.min(viewport.height * 0.54, 280);
    const left = cx - 0.5 * w;
    const right = cx + 0.5 * w;
    const top = cy - 0.5 * h;
    const bot = cy + 0.5 * h;
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
      const gradient = ctx.createLinearGradient(p1.x, p1.y, p2.x, p2.y);
      gradient.addColorStop(0, voltageToColor(fromVoltage, vMin, vMax));
      gradient.addColorStop(1, voltageToColor(toVoltage, vMin, vMax));
      ctx.save();
      ctx.strokeStyle = gradient;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
      ctx.restore();
    };

    if (activeLayers.has('schematic')) {
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
      ctx.fillRect(left - 18, cy - 28, 36, 56);
      const sourceGradient = ctx.createLinearGradient(left, cy - 28, left, cy + 28);
      sourceGradient.addColorStop(0, voltageToColor(sourceVoltage, vMin, vMax));
      sourceGradient.addColorStop(1, voltageToColor(groundVoltage, vMin, vMax));
      ctx.strokeStyle = sourceGradient;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(left - 14, cy - 8);
      ctx.lineTo(left + 14, cy - 8);
      ctx.moveTo(left - 7, cy + 8);
      ctx.lineTo(left + 7, cy + 8);
      ctx.stroke();
      ctx.fillStyle = '#fbbf24';
      ctx.font = 'bold 14px system-ui, sans-serif';
      ctx.fillText(`E=${params.emf}V, r=${params.internalR}Ω`, left + 22, cy + 5);

      // 顶部 R1 电阻框
      ctx.fillStyle = '#1e293b';
      const resistorGradient = ctx.createLinearGradient(cx - 42, top - 16, cx + 42, top + 16);
      resistorGradient.addColorStop(0, voltageToColor(sourceVoltage, vMin, vMax));
      resistorGradient.addColorStop(1, voltageToColor(loadVoltage, vMin, vMax));
      ctx.strokeStyle = resistorGradient;
      ctx.lineWidth = 3;
      ctx.fillRect(cx - 42, top - 16, 84, 32);
      ctx.strokeRect(cx - 42, top - 16, 84, 32);
      ctx.fillStyle = '#38bdf8';
      ctx.fillText(
        params.topology === 'closed-power' ? `Rp=${params.sliderR}Ω` : `R₁=${params.r1}Ω`,
        cx - 32,
        top + 5
      );

      // 右侧电容或负载元件
      if (params.topology === 'rc-transient') {
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(right - 16, cy - 20, 32, 40);
        const capacitorGradient = ctx.createLinearGradient(right, cy - 20, right, cy + 20);
        capacitorGradient.addColorStop(0, voltageToColor(loadVoltage, vMin, vMax));
        capacitorGradient.addColorStop(1, voltageToColor(groundVoltage, vMin, vMax));
        ctx.strokeStyle = capacitorGradient;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(right - 16, cy - 10);
        ctx.lineTo(right + 16, cy - 10);
        ctx.moveTo(right - 16, cy + 10);
        ctx.lineTo(right + 16, cy + 10);
        ctx.stroke();
        ctx.fillStyle = '#4ade80';
        ctx.fillText(`C=${params.capacitance}F`, right - 75, cy + 5);
      } else {
        ctx.fillStyle = '#1e293b';
        const loadGradient = ctx.createLinearGradient(right, cy - 34, right, cy + 34);
        loadGradient.addColorStop(0, voltageToColor(loadVoltage, vMin, vMax));
        loadGradient.addColorStop(1, voltageToColor(groundVoltage, vMin, vMax));
        ctx.strokeStyle = loadGradient;
        ctx.lineWidth = 3;
        ctx.fillRect(right - 18, cy - 34, 36, 68);
        ctx.strokeRect(right - 18, cy - 34, 36, 68);
        ctx.fillStyle = '#f472b6';
        ctx.fillText(
          params.topology === 'closed-power'
            ? `P出=${state.outputPower.toFixed(1)}W`
            : `Rp=${params.sliderR}Ω`,
          right - 95,
          cy + 5
        );
      }
      ctx.restore();
    }

    if (activeLayers.has('potential-labels') && activeLayers.has('schematic')) {
      const nodeLabels = [
        { id: 1, voltage: sourceVoltage, x: left + 6, y: top - 10 },
        { id: 2, voltage: loadVoltage, x: right - 72, y: top - 10 },
        { id: 0, voltage: groundVoltage, x: right - 52, y: bot + 18 }
      ];
      ctx.save();
      ctx.font = '12px ui-monospace, SFMono-Regular, Consolas, monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      for (const node of nodeLabels) {
        ctx.fillStyle = voltageToColor(node.voltage, vMin, vMax);
        ctx.beginPath();
        ctx.arc(node.x, node.y + (node.id === 0 ? -4 : 10), 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillText(`N${node.id}=${node.voltage?.toFixed(2) ?? '—'}V`, node.x + 8, node.y);
      }
      ctx.restore();
    }

    if (activeLayers.has('current-flow') && activeLayers.has('schematic')) {
      const branchOptions = { isShorted };
      drawCurrentParticles(ctx, 'builder-circuit-mna-top-a', { x: left + 20, y: top }, { x: cx - 48, y: top }, state.totalCurrent, dtSec, branchOptions);
      drawCurrentParticles(ctx, 'builder-circuit-mna-top-b', { x: cx + 48, y: top }, { x: right - 20, y: top }, state.totalCurrent, dtSec, branchOptions);
      drawCurrentParticles(ctx, 'builder-circuit-mna-return', { x: right, y: top + 40 }, { x: right, y: bot - 40 }, branchReturnCurrent, dtSec, branchOptions);
    }

    if (isShorted && activeLayers.has('short-circuit')) {
      drawShortCircuitGlow(ctx, { x: left, y: top }, { x: right, y: top }, nowMs);
      drawShortCircuitGlow(ctx, { x: right, y: top }, { x: right, y: bot }, nowMs);
    }

    if (activeLayers.has('meters')) {
      ctx.save();
      ctx.fillStyle = 'rgba(15, 23, 42, 0.78)';
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.4)';
      ctx.lineWidth = 1.5;
      ctx.fillRect(16, 16, 330, 82);
      ctx.strokeRect(16, 16, 330, 82);

      ctx.fillStyle = '#fbbf24';
      ctx.font = 'bold 14px system-ui, sans-serif';
      ctx.fillText(`干路电流 I = ${state.totalCurrent.toFixed(3)} A`, 28, 40);
      ctx.fillStyle = '#38bdf8';
      ctx.fillText(`路端 / 电容电压 U = ${state.terminalVoltage.toFixed(3)} V`, 28, 63);
      ctx.fillStyle = '#4ade80';
      ctx.fillText(
        `输出功率 P = ${state.outputPower.toFixed(2)} W  |  Q = ${state.capCharge.toFixed(3)} C`,
        28,
        86
      );
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
});

export default circuitDcCapacitorMnaPlugin;
