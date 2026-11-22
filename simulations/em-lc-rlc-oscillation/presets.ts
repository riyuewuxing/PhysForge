import type { PresetSpec } from '@physforge/sim-sdk';
import type { LcRlcParams } from './engine.js';

export const lcRlcPresets: readonly PresetSpec<LcRlcParams>[] = [
  {
    id: 'lc-free-energy-exchange',
    name: '理想 LC 无阻尼电磁振荡（E_E 与 E_B 互补转化）',
    description: '观察极板电荷与电感电流 π/2 相位差，验证周期 T=2π√(LC) 及能量柱状图严格互补守恒',
    curriculumNotes: '选择性必修二 第四章 · LC 振荡电路',
    params: {
      mode: 'lc-undamped',
      inductanceH: 0.25,
      capacitanceF: 0.1,
      resistanceR: 0,
      initialChargeC: 0.5,
      driveVoltAmpUm: 0,
      driveOmega: 6.325
    }
  },
  {
    id: 'rlc-series-resonance-peak',
    name: 'RLC 串联交流电谐振峰 (XL = XC, I=Um/R)',
    description: '调节电源频率逼近固有频率 f₀，感抗与容抗相互抵消，电路呈现纯阻特性电流达峰值 Um/R',
    curriculumNotes: '选择性必修二 · 交流电谐振相量图',
    params: {
      mode: 'rlc-ac-resonance',
      inductanceH: 0.25,
      capacitanceF: 0.1,
      resistanceR: 2.0,
      initialChargeC: 0,
      driveVoltAmpUm: 10,
      driveOmega: 6.324555
    }
  },
  {
    id: 'rlc-damped-decay',
    name: '有电阻 R 阻尼衰减电磁振荡',
    description: '回路电阻不断将电磁场能转化为焦耳热，能量总量呈指数包络单调衰减',
    curriculumNotes: '选择性必修二 · 阻尼振荡',
    params: {
      mode: 'rlc-damped',
      inductanceH: 0.25,
      capacitanceF: 0.1,
      resistanceR: 0.8,
      initialChargeC: 0.5,
      driveVoltAmpUm: 0,
      driveOmega: 6.325
    }
  }
];
