import type { PresetSpec } from '@physforge/sim-sdk';
import type { AcGeneratorParams } from './engine.js';

export const acGeneratorPresets: readonly PresetSpec<AcGeneratorParams>[] = [
  {
    id: 'sine-ac-neutral-plane',
    name: '标准正弦交流发电机与削峰填谷 P=U²/R',
    description: '中性面磁通最大而电动势为零，观察瞬时功率削峰填谷等效出有效值 Urms=Um/√2',
    curriculumNotes: '选择性必修二 第三章 第1–2节',
    params: {
      waveform: 'sine',
      turnsN: 10,
      magneticB: 0.5,
      coilAreaS: 0.2,
      freqHz: 2,
      loadR: 10,
      dutyCycleD: 0.5,
      dcOffsetV: 0
    }
  },
  {
    id: 'half-wave-rectifier-rms',
    name: '二极管半波整流波形有效值 (Urms = Um/2)',
    description: '半周期导通另半周期截止，热量减半导致有效值由 Um/√2 降为 Um/2',
    curriculumNotes: '选择性必修二 · 常见非正弦整流有效值计算',
    params: {
      waveform: 'half-wave',
      turnsN: 10,
      magneticB: 0.5,
      coilAreaS: 0.2,
      freqHz: 2,
      loadR: 10,
      dutyCycleD: 0.5,
      dcOffsetV: 0
    }
  },
  {
    id: 'duty-square-wave-rms',
    name: '占空比可调方波有效值 (Urms = Um√D)',
    description: '调节占空比 D（如 D=0.25 -> 0.5 Um），直观对比热功率等价高度',
    curriculumNotes: '选择性必修二 · 高考方波/脉冲有效值',
    params: {
      waveform: 'duty-square',
      turnsN: 10,
      magneticB: 0.5,
      coilAreaS: 0.2,
      freqHz: 2,
      loadR: 10,
      dutyCycleD: 0.25,
      dcOffsetV: 0
    }
  },
  {
    id: 'dc-ac-superposition',
    name: '直流偏置叠加正弦波有效值 (√(Udc² + Um²/2))',
    description: '直流分量与正弦分量正交叠加，总平均功率等于各分量功率之和',
    curriculumNotes: '选择性必修二 · 直交叠加波形热效应',
    params: {
      waveform: 'dc-plus-sine',
      turnsN: 10,
      magneticB: 0.5,
      coilAreaS: 0.2,
      freqHz: 2,
      loadR: 10,
      dutyCycleD: 0.5,
      dcOffsetV: 10
    }
  },
  {
    id: 'full-wave-rectifier-rms',
    name: '理想全波整流 · 负载电压非负',
    description: '比较源电动势与负载电压，说明整流不改变一个参考周期的平方积分。',
    curriculumNotes: '选择性必修二 · 理想整流',
    params: { waveform:'full-wave', turnsN:10, magneticB:.5, coilAreaS:.2, freqHz:2, loadR:10, dutyCycleD:.5, dcOffsetV:0 }
  },{
    id: 'sawtooth-wave-rms',
    name: '锯齿波 · 周期端点跳变',
    description: '独立教学波形，积分 u² 得有效值 Um/√3，端点跳变不改变积分。',
    curriculumNotes: '选择性必修二 · 非正弦波有效值',
    params: { waveform:'sawtooth', turnsN:10, magneticB:.5, coilAreaS:.2, freqHz:2, loadR:10, dutyCycleD:.5, dcOffsetV:0 }
  }
];
