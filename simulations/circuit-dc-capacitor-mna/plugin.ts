import { defineSimulationPlugin, type ParamFieldSpec } from '@physforge/sim-sdk';
import {
  checkInvariants,
  computeObservables,
  createInitialState,
  stepCircuit,
  type CircuitParams,
  type CircuitState
} from './engine.js';

const paramSchema: readonly ParamFieldSpec<CircuitParams>[] = [
  {
    key: 'topology',
    kind: 'select',
    label: '电路实验拓扑',
    options: [
      { label: '闭合电路欧姆定律与输出功率 P-R', value: 'closed-power' },
      { label: '混联滑变动态分析（串反并同）', value: 'series-parallel-dynamic' },
      { label: 'RC 含容电路充放电瞬态', value: 'rc-transient' },
      { label: '电桥含容支路稳态电荷求解', value: 'rc-bridge-charge' }
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
    min: 0.2,
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
    min: 0.5,
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
    id: 'circuit-dc-capacitor-mna',
    title: '高中直流与含容电路动态分析（纯 TS MNA 求解器）',
    textbookRef: '人教版 必修第三册 第十二章 第1–3节',
    curriculumTags: ['物理观念', '科学思维', '科学探究'],
    difficulty: '高三一轮',
    version: '1.0.0'
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

    if (activeLayers.has('schematic')) {
      ctx.save();
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 3;
      ctx.strokeRect(left, top, w, h);

      // 左侧电源符号 (E, r)
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(left - 18, cy - 28, 36, 56);
      ctx.strokeStyle = '#fbbf24';
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
      ctx.strokeStyle = '#38bdf8';
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
        ctx.strokeStyle = '#4ade80';
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
        ctx.strokeStyle = '#f472b6';
        ctx.lineWidth = 2.5;
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
  }
});

export default circuitDcCapacitorMnaPlugin;
