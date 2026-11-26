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
      driveOmega: 1 / Math.sqrt(0.25 * 0.1)
    }
  },
  {
    id: 'rlc-damped-decay',
    name: '有电阻 R 阻尼衰减电磁振荡',
    description: '回路电阻不断将电磁场能转化为焦耳热，电磁储能单调转化为焦耳热，振荡包络衰减',
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
  },
  {id:'rlc-critical-decay',name:'临界阻尼 · 非振荡衰减',description:'L=C=0.25，R=2 Ω，电荷不反复过零。',curriculumNotes:'临界阻尼边界',params:{mode:'rlc-damped',inductanceH:.25,capacitanceF:.25,resistanceR:2,initialChargeC:.5}},
  {id:'rlc-overdamped-decay',name:'过阻尼 · 非振荡衰减',description:'L=C=0.25，R=3 Ω，比较非振荡慢衰减。',curriculumNotes:'过阻尼边界',params:{mode:'rlc-damped',inductanceH:.25,capacitanceF:.25,resistanceR:3,initialChargeC:.5}},
  {id:'rlc-detuned-driven',name:'有阻受迫 · 失谐响应',description:'ω=4 rad/s，实际瞬态与理论特解区分。',curriculumNotes:'阻抗与相位',params:{mode:'rlc-ac-resonance',inductanceH:.25,capacitanceF:.1,resistanceR:.8,driveVoltAmpUm:10,driveOmega:4}},
  {id:'lc-lossless-resonance',name:'零电阻精确谐振 · 无有限周期稳态',description:'理想无损，非零驱动下的世俗增长；不人为加电阻。',curriculumNotes:'理想模型的适用边界',params:{mode:'rlc-ac-resonance',inductanceH:.25,capacitanceF:.1,resistanceR:0,driveVoltAmpUm:10,driveOmega:1/Math.sqrt(.25*.1)}},
  {id:'lc-lossless-detuned',name:'零电阻失谐 · 非吸引特解',description:'齐次振荡不衰减，实际时域不等于特解。',curriculumNotes:'零阻尼失谐',params:{mode:'rlc-ac-resonance',inductanceH:.25,capacitanceF:.1,resistanceR:0,driveVoltAmpUm:10,driveOmega:4}},
  {id:'lc-zero-excitation',name:'零初态零驱动 · 无激发',description:'零电阻精确谐振条件下零驱动，不产生电流。',curriculumNotes:'零源退化条件',params:{mode:'rlc-ac-resonance',inductanceH:.25,capacitanceF:.1,resistanceR:0,driveVoltAmpUm:0,driveOmega:1/Math.sqrt(.25*.1)}}
];
